# 3. Permission Evaluation

The PreToolUse handler is the core of ClaudeCube's permission system. Every tool call from a monitored Claude Code session flows through this handler, which coordinates the rule engine, escalation pipeline, session tracking, and audit logging.

## 3.1 PreToolUse Handler

The handler is created via the factory function `createPreToolUseHandler()` in `src/hooks/pre-tool-use.ts`.

### Input Schema

```typescript
interface PreToolUseInput {
  hook_event_name: "PreToolUse";
  tool_name: string;
  tool_input: Record<string, unknown>;
  session_id: string;
  cwd: string;
  transcript_path: string;
}
```

### Response Schema

```typescript
interface PreToolUseResponse {
  decision?: "block" | "approve";
  reason?: string;
  hookSpecificOutput?: {
    hookEventName: "PreToolUse";
    permissionDecision: "allow" | "deny";
    permissionDecisionReason?: string;
  };
}
```

The response includes both top-level `decision`/`reason` fields and a `hookSpecificOutput` block following Claude Code's hook protocol. For allow decisions from the rule engine, only `hookSpecificOutput` is populated. For deny and escalation decisions, both are set.

### Complete Decision Flow

```
1. Session tracking
   |-- ensureRegistered(sessionId, cwd)    [auto-registers if unknown]
   |-- updateToolUse(sessionId, toolName)
   |-- updateState(sessionId, "permission_pending")
   v
2. Rule engine evaluation
   |-- ruleEngine.evaluate(toolName, toolInput)
   |
   |-- action: "allow"
   |     |-- auditLog.log({ decidedBy: "rule", ... })
   |     |-- sessionTracker.updateState("active")
   |     |-- return { hookSpecificOutput: { permissionDecision: "allow" } }
   |
   |-- action: "deny"
   |     |-- auditLog.log({ decidedBy: "rule", ... })
   |     |-- sessionTracker.recordDenial()
   |     |-- sessionTracker.updateState("active")
   |     |-- return { decision: "block", hookSpecificOutput: { permissionDecision: "deny" } }
   |
   |-- action: "escalate"
         |-- sessionTracker.updateState("permission_pending")
         v
3. Escalation (see Section 4)
   |-- escalationHandler.evaluate(toolName, toolInput, context)
   |
   |-- escalation allowed
   |     |-- auditLog.log({ decidedBy: "llm"|"telegram", ... })
   |     |-- sessionTracker.updateState("active")
   |     |-- return { decision: "approve", hookSpecificOutput: { permissionDecision: "allow" } }
   |
   |-- escalation denied
         |-- auditLog.log({ decidedBy: "llm"|"telegram"|"timeout", ... })
         |-- sessionTracker.recordDenial()
         |-- sessionTracker.updateState("active")
         |-- return { decision: "block", hookSpecificOutput: { permissionDecision: "deny" } }
```

### Dependencies

| Dependency | Source | Role |
|---|---|---|
| `RuleEngine` | `src/rule-engine/engine.ts` | First-pass rule evaluation |
| `EscalationHandler` | `src/escalation/handler.ts` | LLM + Telegram escalation |
| `AuditLog` | `src/hooks/audit-hook.ts` | Decision logging |
| `SessionTracker` | `src/session-tracker.ts` | Session state management |

### Design Pattern

**Factory Function** -- `createPreToolUseHandler` receives all dependencies via parameters and returns a closure. This enables dependency injection without a DI framework.

## 3.2 Session State During Evaluation

The session state transitions through the evaluation:
- `active` (normal operation)
- `permission_pending` (while rule engine is evaluating or awaiting escalation)
- `active` (after decision is made)

The `permission_pending` state is visible in the `/status` endpoint, letting the user know a session is waiting for a permission decision.

## 3.3 Audit Logging

Every permission decision is recorded in a JSONL audit trail by `AuditLog` (`src/hooks/audit-hook.ts`).

### Audit Entry Structure

```typescript
interface AuditEntry {
  timestamp: string;                              // ISO 8601
  sessionId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  decision: "allow" | "deny";
  reason: string;
  decidedBy: "rule" | "llm" | "telegram" | "timeout";
  ruleName?: string;
}
```

### Storage

- **Format**: JSONL (one JSON object per line).
- **Location**: `.claudecube/audit/audit-<YYYY-MM-DD>.jsonl` relative to the process working directory.
- **Write method**: Synchronous append (`appendFileSync`).
- **Error handling**: Errors are logged but not thrown. A failing audit log does not block the permission decision.

### Initialization

```typescript
const auditLog = new AuditLog(join(process.cwd(), ".claudecube", "audit"));
```

The log directory is created recursively at construction time. The file name is determined by the date at construction, so all entries for a server instance go to the same file even if the server runs past midnight.

## Cross-References

- The rule engine (invoked in step 2) is described in [Safety Rule System](02-safety-rules.md).
- The escalation pipeline (invoked in step 3) is described in [LLM-Based Evaluation](04-llm-evaluation.md).
- Session tracking is described in [Session Management](07-session-management.md).
- The Telegram approval flow (part of escalation) is described in [Telegram Integration](06-telegram.md).
