# AGENTS.md

Guide for AI agents working on the ClaudeCube codebase.

## Build & verify

```bash
npm run build          # tsc → dist/
npm run lint           # tsc --noEmit (type-check only)
npm run test           # node --test --import tsx 'src/**/*.test.ts'
npx tsx src/index.ts --help   # quick smoke test
```

Always run `npm run lint` after making changes. The project must compile with zero errors.

## Tech stack

- **TypeScript** (strict, ESM, Node16 module resolution)
- **Node >= 22** — uses `node:util` `parseArgs`, `fetch`, top-level await patterns
- **`@anthropic-ai/sdk`** — direct Anthropic API client, used by the LLM evaluator (`src/escalation/llm-evaluator.ts`) to call Haiku.
- **Telegraf** — Telegram bot framework. Inline keyboards for approval flow.
- **Zod** — runtime validation of YAML configs and rules.
- **yaml** — YAML parsing for config files (`rules.yaml`, `orchestrator.yaml`).
- **micromatch** — glob pattern matching in the rule engine.

## Architecture

ClaudeCube is a **hooks-based orchestrator**. It does NOT spawn agents — instead it monitors existing `claude` CLI sessions via Claude Code's hooks system.

### How it works

1. Claude Code hooks (configured in `~/.claude/settings.json`) call a shell script (`hooks/claudecube-hook.sh`) on events
2. The shell script POSTs to ClaudeCube's local HTTP server (`http://localhost:7080/hooks/<event>`)
3. ClaudeCube evaluates rules, optionally escalates to LLM/Telegram, and returns decisions
4. The shell script outputs the response back to Claude Code

### Operating mode (local/remote)

ClaudeCube has two runtime modes controlled by `ModeManager` (`src/mode.ts`):

- **Remote** (default): Full Telegram oversight — escalations, stop decisions, and questions flow through Telegram.
- **Local**: Telegram disabled for decisions. Escalations, stop decisions, and questions passthrough (`{}`) to the terminal. The LLM evaluator still runs and auto-approves when confident.

Switching: Telegram `/mode` command, `GET/POST /mode` HTTP endpoint, or `mode.autoDetect` (macOS idle detection). See `specs/13-local-mode.md`.

### Permission flow (the core loop)

```
Claude Code fires PreToolUse hook
  → Shell script → HTTP POST /hooks/PreToolUse
    → AskUserQuestion? → local mode → passthrough {}
                        → remote mode → Telegram question routing
    → RuleEngine.evaluate(toolName, toolInput)
      → DENY rules checked first → block immediately
      → ALLOW rules checked next → approve immediately
      → No match → EscalationHandler
        → LlmEvaluator (Haiku) → if confident allow → approve
                                 → if uncertain/deny:
                                   → local mode → passthrough {}
                                   → remote mode → Telegram approval
```

### Stop handler flow

```
Claude Code fires Stop hook
  → Shell script → HTTP POST /hooks/Stop
    → Check stop_hook_active (prevent loops)
    → Detect error pattern in last_assistant_message → force retry
    → local mode → let stop (passthrough)
    → remote mode → Transcript analysis + Telegram escalation
```

### Module dependency graph

```
index.ts (CLI + server startup)
  → server.ts (HTTP routes: /hooks/*, /status, /mode)
    → hooks/pre-tool-use.ts → RuleEngine → rules.yaml
                             → EscalationHandler → LlmEvaluator (Anthropic API)
                             |                   → ApprovalManager (Telegram)
                             → ModeManager (local/remote mode check)
    → hooks/stop.ts → StopConfig + ApprovalManager + ModeManager
    → hooks/lifecycle.ts → SessionTracker + NotificationManager
  → mode.ts (runtime local/remote mode state)
  → session-tracker.ts (active session state)
  → telegram/ → Telegraf bot + approval + notifications + /mode command
  → tmux.ts → list panes, send keys
  → installer.ts → patch ~/.claude/settings.json
```

### Key modules

| Module | Entry | Responsibility |
|--------|-------|----------------|
| `src/mode.ts` | — | Runtime local/remote mode state (`ModeManager`) |
| `src/server.ts` | — | HTTP server with routes per hook event + `/status` + `/mode` endpoints |
| `src/hooks/pre-tool-use.ts` | — | PreToolUse handler: rule engine → escalation → audit |
| `src/hooks/stop.ts` | — | Stop handler: error retry, question escalation |
| `src/hooks/lifecycle.ts` | — | SessionStart/End/Notification handlers. Uses `ensureRegistered` to merge synthetic→real sessions. |
| `src/session-tracker.ts` | — | Tracks active sessions and their state. Two-tier: synthetic (from tmux scan) → real (from hooks). |
| `src/tmux.ts` | — | List Claude panes in tmux, send keys for text injection |
| `src/installer.ts` | — | Patches `~/.claude/settings.json` to add/remove hooks |
| `src/rule-engine/` | `engine.ts` | Stateless deny-first rule evaluator. Partitions rules at construction. |
| `src/escalation/` | `handler.ts` | Two-phase: LLM evaluator first, Telegram fallback if uncertain. |
| `src/telegram/` | `bot.ts`, `approval.ts` | Bot lifecycle, inline keyboard approval, interactive `/status` (inline buttons → session details), question routing, tmux integration. All messages follow the pattern `<emoji> <b>Title</b> — <code>session</code>`. |
| `src/config/` | `types.ts`, `loader.ts` | Zod schemas for `orchestrator.yaml`. |
| `hooks/claudecube-hook.sh` | — | Shell script called by Claude Code hooks; curls ClaudeCube server. |

## Session tracking (two-tier model)

`SessionTracker` maintains a map of active sessions. Sessions enter via two paths:

1. **Synthetic sessions** — At startup, `registerFromTmux()` scans all tmux panes running `claude` and creates entries keyed `tmux_%<paneId>`. These provide immediate `/status` visibility but lack real session IDs.
2. **Real sessions** — When a Claude session fires its first hook (SessionStart or PreToolUse), `ensureRegistered()` is called. It merges with any existing synthetic session matching by pane ID (preferred) or CWD (fallback), transferring the label and metadata.

**Important**: Always use `ensureRegistered()` (not `register()`) when a real session arrives, to avoid duplicate entries. `register()` unconditionally creates a new entry without checking for synthetic matches.

## Testing (TDD)

Tests use Node's built-in test runner (`node:test`) with `tsx` for TypeScript support. Test files live next to their source files with a `.test.ts` suffix.

```bash
npm run test                    # run all tests
node --test --import tsx src/session-tracker.test.ts  # run a single test file
```

### TDD workflow for bug fixes

When fixing a regression or bug, follow this workflow:

1. **Write the test first** — create a test that exercises the expected behavior. The test should fail (RED) with the current broken code.
2. **Confirm RED** — run the test and verify it fails for the right reason (the assertion message should describe the expected behavior).
3. **Fix the implementation** — make the minimal code change to fix the bug.
4. **Confirm GREEN** — run the test and verify it passes.
5. **Run all tests** — ensure the fix doesn't break anything else: `npm run test && npm run lint`.

### Testability via dependency injection

Modules that depend on external systems (tmux, Telegram, Anthropic API) accept injectable dependencies via constructor options. Production code uses defaults; tests inject mocks.

Example — `SessionTracker` accepts tmux functions:
```typescript
// Production (defaults to real tmux)
const tracker = new SessionTracker();

// Test (injectable mocks)
const tracker = new SessionTracker({
  resolveLabel: () => null,
  findPaneForCwd: () => null,
  listClaudePanes: () => [],
});
```

When adding new external dependencies to a module, expose them as injectable deps to keep the code testable.

## Specs-first workflow

Before implementing changes, review the relevant specs in `specs/` and update them to reflect the planned changes. Specs should be updated **before** writing code so that they serve as the source of truth for the implementation. After implementation, verify that specs still accurately describe the new behavior.

## Conventions

### Imports

All local imports must use `.js` extensions (Node16 ESM resolution):
```typescript
import { RuleEngine } from "./engine.js";       // correct
import { RuleEngine } from "./engine";           // wrong — will fail at runtime
```

### Rule engine

- Rules in `~/.config/claude-cube/rules.yaml` are validated with Zod at load time, including regex compilation.
- The `tool` field supports pipe-separated names: `"Write|Edit"`.
- Match conditions are OR within a field (any pattern match = field matches), and the rule matches if the tool name matches AND any field's patterns match.
- If a rule has no `match` block, it matches all uses of that tool.

### Policies (human feedback)

Policies are free-text instructions created from Telegram text replies, fed to the LLM evaluator as context. They are distinct from **safety rules** (`rules.yaml`) which are deterministic regexp/glob/literal checks. See `src/policies/` and [08-policy-learning.md](specs/08-policy-learning.md).

- **Shared**: `~/.config/claude-cube/policies.yaml` — user-editable, persisted across sessions
- **Local**: `~/.config/claude-cube/policies.local.yaml` — machine-specific, grows via Telegram approvals

Both files are loaded by `PolicyStore` and merged at runtime. New policies from Telegram are always saved to the local file.

Policy descriptions follow a consistent style: imperative verb-first, no filler phrases. Repo-scoped policies use the suffix `Authorized repos: repo1, repo2` so the repo list is easy to scan and extend. Use `/consolidate-policies` to analyze and merge redundant policies.

### Telegram commands

When adding a new Telegram bot command, add an entry to the `COMMANDS` constant at the top of `src/telegram/bot.ts` so that `/help` stays up to date.

### Telegram approval

`ApprovalManager` uses a `Map<string, PendingApproval>` keyed by unique request IDs. Each `requestApproval()` call returns a `Promise` that resolves when the user taps a button or the timeout expires.

### Error handling

- Telegram send failures are caught and logged, never thrown — the bot being down should not crash the server.
- LLM evaluator failures return `{ allowed: false, confident: false }` to trigger Telegram fallback.
- The hook shell script fails open — if ClaudeCube is not running, hooks pass through silently.

## Config files

Runtime config lives in `~/.config/claude-cube/` (bootstrapped from `config/` templates on first run):

- `rules.yaml` — safety rules. Schema: `src/rule-engine/types.ts` (`RulesConfigSchema`).
- `policies.yaml` — shared policies. Schema: `src/policies/types.ts`.
- `policies.local.yaml` — local policies, grows via Telegram. Same schema.
- `orchestrator.yaml` — server port, escalation, Telegram, stop handler settings. Schema: `src/config/types.ts` (`OrchestratorConfigSchema`).

When adding new config fields, add them to the Zod schema first with a `.default()` value to keep backward compatibility.

## CLI usage

```
claudecube                 # Start server (port 7080) + Telegram bot
claudecube --install       # Patch ~/.claude/settings.json with hooks
claudecube --uninstall     # Remove ClaudeCube hooks from settings
claudecube --status        # Query GET /status and print
claudecube --port 9090     # Custom port
```
