# AGENTS.md

Guide for AI agents working on the ClaudeCube codebase.

## Build & verify

```bash
npm run build          # tsc → dist/
npm run lint           # tsc --noEmit (type-check only)
npm run test           # node --test (no tests yet — add *.test.ts next to source files)
npx tsx src/index.ts --help   # quick smoke test
```

Always run `npm run lint` after making changes. The project must compile with zero errors.

## Tech stack

- **TypeScript** (strict, ESM, Node16 module resolution)
- **Node >= 22** — uses `node:util` `parseArgs`, `fetch`, top-level await patterns
- **`@anthropic-ai/sdk`** — direct Anthropic API client, used by the LLM evaluator (`src/escalation/llm-evaluator.ts`) to call Haiku.
- **Telegraf** — Telegram bot framework. Inline keyboards for approval flow.
- **Zod** — runtime validation of YAML configs and rules.
- **yaml** — YAML parsing for `config/rules.yaml` and `config/orchestrator.yaml`.
- **micromatch** — glob pattern matching in the rule engine.

## Architecture

ClaudeCube is a **hooks-based orchestrator**. It does NOT spawn agents — instead it monitors existing `claude` CLI sessions via Claude Code's hooks system.

### How it works

1. Claude Code hooks (configured in `~/.claude/settings.json`) call a shell script (`hooks/claudecube-hook.sh`) on events
2. The shell script POSTs to ClaudeCube's local HTTP server (`http://localhost:7080/hooks/<event>`)
3. ClaudeCube evaluates rules, optionally escalates to LLM/Telegram, and returns decisions
4. The shell script outputs the response back to Claude Code

### Permission flow (the core loop)

```
Claude Code fires PreToolUse hook
  → Shell script → HTTP POST /hooks/PreToolUse
    → RuleEngine.evaluate(toolName, toolInput)
      → DENY rules checked first → block immediately
      → ALLOW rules checked next → approve immediately
      → No match → EscalationHandler
        → LlmEvaluator (Haiku) → if confident, decide
                                 → if uncertain, Telegram approval
```

### Stop handler flow

```
Claude Code fires Stop hook
  → Shell script → HTTP POST /hooks/Stop
    → Check stop_hook_active (prevent loops)
    → Detect error pattern in last_assistant_message → force retry
    → Detect question pattern → escalate to Telegram
    → Otherwise → let stop
```

### Module dependency graph

```
index.ts (CLI + server startup)
  → server.ts (HTTP routes)
    → hooks/pre-tool-use.ts → RuleEngine → rules.yaml
                             → EscalationHandler → LlmEvaluator (Anthropic API)
                                                 → ApprovalManager (Telegram)
    → hooks/stop.ts → StopConfig + ApprovalManager
    → hooks/lifecycle.ts → SessionTracker + NotificationManager
  → session-tracker.ts (active session state)
  → telegram/ → Telegraf bot + approval + notifications
  → tmux.ts → list panes, send keys
  → installer.ts → patch ~/.claude/settings.json
```

### Key modules

| Module | Entry | Responsibility |
|--------|-------|----------------|
| `src/server.ts` | — | HTTP server with routes per hook event + `/status` endpoint |
| `src/hooks/pre-tool-use.ts` | — | PreToolUse handler: rule engine → escalation → audit |
| `src/hooks/stop.ts` | — | Stop handler: error retry, question escalation |
| `src/hooks/lifecycle.ts` | — | SessionStart/End/Notification handlers for session tracking |
| `src/session-tracker.ts` | — | Tracks active sessions and their state |
| `src/tmux.ts` | — | List Claude panes in tmux, send keys for text injection |
| `src/installer.ts` | — | Patches `~/.claude/settings.json` to add/remove hooks |
| `src/rule-engine/` | `engine.ts` | Stateless deny-first rule evaluator. Partitions rules at construction. |
| `src/escalation/` | `handler.ts` | Two-phase: LLM evaluator first, Telegram fallback if uncertain. |
| `src/telegram/` | `bot.ts`, `approval.ts` | Bot lifecycle, inline keyboard approval, session status, tmux integration. |
| `src/config/` | `types.ts`, `loader.ts` | Zod schemas for `orchestrator.yaml`. |
| `hooks/claudecube-hook.sh` | — | Shell script called by Claude Code hooks; curls ClaudeCube server. |

## Conventions

### Imports

All local imports must use `.js` extensions (Node16 ESM resolution):
```typescript
import { RuleEngine } from "./engine.js";       // correct
import { RuleEngine } from "./engine";           // wrong — will fail at runtime
```

### Rule engine

- Rules in `config/rules.yaml` are validated with Zod at load time, including regex compilation.
- The `tool` field supports pipe-separated names: `"Write|Edit"`.
- Match conditions are OR within a field (any pattern match = field matches), and the rule matches if the tool name matches AND any field's patterns match.
- If a rule has no `match` block, it matches all uses of that tool.

### Policies (human feedback)

Policies are free-text instructions created from Telegram text replies, stored in `config/policies.yaml`, and fed to the LLM evaluator as context. They are distinct from **safety rules** (`config/rules.yaml`) which are deterministic regexp/glob/literal checks. See `src/policies/` and [08-policy-learning.md](specs/08-policy-learning.md).

### Telegram approval

`ApprovalManager` uses a `Map<string, PendingApproval>` keyed by unique request IDs. Each `requestApproval()` call returns a `Promise` that resolves when the user taps a button or the timeout expires.

### Error handling

- Telegram send failures are caught and logged, never thrown — the bot being down should not crash the server.
- LLM evaluator failures return `{ allowed: false, confident: false }` to trigger Telegram fallback.
- The hook shell script fails open — if ClaudeCube is not running, hooks pass through silently.

## Config files

- `config/rules.yaml` — safety rules. Schema: `src/rule-engine/types.ts` (`RulesConfigSchema`).
- `config/orchestrator.yaml` — server port, escalation, Telegram, stop handler settings. Schema: `src/config/types.ts` (`OrchestratorConfigSchema`).

When adding new config fields, add them to the Zod schema first with a `.default()` value to keep backward compatibility.

## CLI usage

```
claudecube                 # Start server (port 7080) + Telegram bot
claudecube --install       # Patch ~/.claude/settings.json with hooks
claudecube --uninstall     # Remove ClaudeCube hooks from settings
claudecube --status        # Query GET /status and print
claudecube --port 9090     # Custom port
```
