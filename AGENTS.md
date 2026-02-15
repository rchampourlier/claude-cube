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
- **Node >= 22** — uses `node:util` `parseArgs`, top-level await patterns
- **`@anthropic-ai/claude-code`** — the Claude Code SDK. Provides `query()` to spawn agents, hook types (`HookInput`, `HookJSONOutput`), and message types (`SDKMessage`, `SDKResultMessage`). Types are in `node_modules/@anthropic-ai/claude-code/sdk.d.ts`.
- **`@anthropic-ai/sdk`** — direct Anthropic API client, used only by the LLM evaluator (`src/escalation/llm-evaluator.ts`) to call Haiku.
- **Telegraf** — Telegram bot framework. Inline keyboards for approval flow.
- **Zod** — runtime validation of YAML configs and rules.
- **yaml** — YAML parsing for `config/rules.yaml` and `config/orchestrator.yaml`.
- **micromatch** — glob pattern matching in the rule engine.

## Architecture

### Permission flow (the core loop)

Every tool call from a sub-agent triggers a `PreToolUse` hook:

```
PreToolUse hook fires
  → RuleEngine.evaluate(toolName, toolInput)
    → DENY rules checked first → block immediately
    → ALLOW rules checked next → approve immediately
    → No match → EscalationHandler
      → LlmEvaluator (Haiku) → if confident, decide
                               → if uncertain, Telegram approval
```

This flow lives across three files:
1. `src/hooks/permission-hook.ts` — the hook callback wired into the SDK
2. `src/rule-engine/engine.ts` — deterministic rule evaluation
3. `src/escalation/handler.ts` — LLM + Telegram escalation coordinator

### Module dependency graph

```
index.ts → Orchestrator
  → AgentManager  → query() from SDK
  → RuleEngine    → rules.yaml
  → EscalationHandler → LlmEvaluator (Anthropic API)
                      → ApprovalManager (Telegram)
  → TelegramBot   → Telegraf
  → AuditLog       → JSONL files
  → NotificationManager → TelegramBot
```

### Key modules

| Module | Entry | Responsibility |
|--------|-------|----------------|
| `src/rule-engine/` | `engine.ts` | Stateless deny-first rule evaluator. Partitions rules at construction. |
| `src/hooks/` | `permission-hook.ts` | Bridges SDK hooks → rule engine → escalation. Must use SDK's `HookInput`/`HookJSONOutput` types. |
| `src/escalation/` | `handler.ts` | Two-phase: LLM evaluator first, Telegram fallback if uncertain. |
| `src/telegram/` | `bot.ts`, `approval.ts` | Bot lifecycle, inline keyboard approval with promise-per-request pattern, timeout handling. |
| `src/agents/` | `manager.ts` | Wraps SDK `query()`. Owns agent lifecycle: spawn, drive (async iterate messages), abort, resume. |
| `src/orchestrator.ts` | — | Top-level coordinator. Modes: single, parallel (`Promise.all`), pipeline (sequential with context chaining). |
| `src/config/` | `types.ts`, `loader.ts` | Zod schemas for `orchestrator.yaml`. |

## Conventions

### Imports

All local imports must use `.js` extensions (Node16 ESM resolution):
```typescript
import { RuleEngine } from "./engine.js";       // correct
import { RuleEngine } from "./engine";           // wrong — will fail at runtime
```

### SDK hook types

Hook callbacks must accept the full `HookInput` union from `@anthropic-ai/claude-code` and narrow via `input.hook_event_name`:

```typescript
import type { HookInput, HookJSONOutput } from "@anthropic-ai/claude-code";

async (input: HookInput): Promise<HookJSONOutput> => {
  if (input.hook_event_name !== "PreToolUse") return {};
  // input is now narrowed to PreToolUseHookInput
  input.tool_name;  // safe
};
```

Do NOT define custom hook input types — use the SDK's. The union includes events like `Notification` and `SessionStart` that lack `tool_name`/`tool_input`.

### Rule engine

- Rules in `config/rules.yaml` are validated with Zod at load time, including regex compilation.
- The `tool` field supports pipe-separated names: `"Write|Edit"`.
- Match conditions are OR within a field (any pattern match = field matches), and the rule matches if the tool name matches AND any field's patterns match.
- If a rule has no `match` block, it matches all uses of that tool.

### Telegram approval

`ApprovalManager` uses a `Map<string, PendingApproval>` keyed by unique request IDs. Each `requestApproval()` call returns a `Promise` that resolves when the user taps a button or the timeout expires. Keep this pattern — it decouples the approval lifecycle from the hook callback.

### Error handling

- The orchestrator catches agent exceptions and records them in `AgentState`.
- Telegram send failures are caught and logged, never thrown — the bot being down should not crash agents.
- LLM evaluator failures return `{ allowed: false, confident: false }` to trigger Telegram fallback.

## Config files

- `config/rules.yaml` — safety rules. Schema: `src/rule-engine/types.ts` (`RulesConfigSchema`).
- `config/orchestrator.yaml` — model, budget, escalation, Telegram settings. Schema: `src/config/types.ts` (`OrchestratorConfigSchema`).

When adding new config fields, add them to the Zod schema first with a `.default()` value to keep backward compatibility.

## What's missing (future work)

- **Tests** — no test files exist yet. Use Node's built-in test runner (`node --test`). Place test files as `*.test.ts` next to source files.
- **Denial loop detection** — `AgentState.consecutiveDenials` is tracked but not yet acted on. Should inject a "try a different approach" prompt after N consecutive denials and send a Telegram alert.
- **Free-text forwarding** — Telegram free-text messages are received but not yet injected into the agent conversation. Needs the SDK's streaming input mode (`AsyncIterable<SDKUserMessage>` prompt).
- **Structured output** — the SDK supports `outputFormat` for JSON schema output. Could be used for pipeline mode to pass structured data between agents.
- **Graceful resume on laptop reopen** — pending approvals timeout and deny, but there's no mechanism to re-queue them.
