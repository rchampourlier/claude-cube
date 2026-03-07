# 13. Local Mode

## 13.1 Overview

ClaudeCube operates in one of two modes: **remote** or **local**.

- **Remote mode** (default, current behavior): All escalations, stop decisions, and questions flow through Telegram. The human interacts via the Telegram bot.
- **Local mode**: Telegram is disabled entirely. Escalations, stop decisions, and questions passthrough to the terminal (`{}`). The LLM evaluator still runs and auto-approves when confident, but its fallback is passthrough instead of Telegram.

The mode is a runtime toggle — not persisted to disk. On startup, the mode is set from the `mode.default` config value (default: `"remote"`).

## 13.2 Mode Manager

The `ModeManager` is a runtime state holder. It is created in `src/index.ts` and injected into handlers the same way `sessionTracker` is today.

### Interface

```typescript
type OperatingMode = "remote" | "local";

class ModeManager {
  constructor(defaultMode: OperatingMode);
  getMode(): OperatingMode;
  setMode(mode: OperatingMode): void;
}
```

Not persisted. Not serialized. Resets to default on server restart.

## 13.3 Behavior by Subsystem

| Subsystem | Remote (current) | Local |
|---|---|---|
| Rule engine allow/deny | Unchanged | Unchanged |
| LLM confident approve | Auto-approve | Auto-approve |
| LLM uncertain/deny | Telegram approval (blocks) | Passthrough `{}` to terminal |
| Stop (after retries) | Transcript + Telegram (blocks) | Return `{}` (let stop) |
| AskUserQuestion | Route to Telegram | Passthrough `{}` to terminal |
| Telegram bot | Active | Stays running (for `/mode` command) but sends no messages |
| Audit logging | Logged | Logged with `decidedBy: "passthrough"` |
| Notifications | macOS + 🔔 (cleared after decision) | macOS + 🔔 (cleared on next tool call) |

**Note on local mode notifications**: Even in local mode, `alertUser()` fires for escalation and stop events — the user needs to look at the terminal. The tmux 🔔 prefix is cleared on the next tool call (safety-net in `PreToolUse`). See [Notifications](14-notifications.md).

### Key Points

- Error retry logic is **unaffected** by mode — retries always run regardless of mode.
- In local mode, no Telegram messages are sent (no notifications, no approvals, no questions).
- The Telegram bot process stays alive so the user can send `/mode remote` to switch back.

## 13.4 Switching Mechanisms

### 1. Telegram Command

`/mode` toggles between local and remote. `/mode local` or `/mode remote` sets explicitly.

The bot replies with a confirmation message (e.g., "Mode switched to local").

### 2. HTTP Endpoint

- `GET /mode` — returns `{ "mode": "local" | "remote" }`.
- `POST /mode` — accepts `{ "mode": "local" | "remote" }`, sets it, returns the new mode.

### 3. Auto-Detection (Optional, macOS Only)

Polls idle time via `ioreg -c IOHIDSystem` (reads `HIDIdleTime` in nanoseconds).

- When idle exceeds `idleThresholdSeconds` → switch to remote.
- When user returns (idle drops below threshold) → switch to local.

Configurable via `mode.autoDetect`, `mode.idleThresholdSeconds`, and `mode.pollIntervalSeconds` in `~/.config/claude-cube/orchestrator.yaml`.

Degrades gracefully on non-macOS: if `ioreg` is unavailable, auto-detection silently disables itself and logs a warning.

## 13.5 Configuration

New section in `~/.config/claude-cube/orchestrator.yaml`:

```yaml
mode:
  default: "remote"              # startup mode
  autoDetect: false              # idle-based auto-switching (macOS only)
  idleThresholdSeconds: 300      # idle time before switching to remote
  pollIntervalSeconds: 60        # how often to check idle time
```

All fields have defaults, making the entire `mode` section optional. See [Configuration](09-configuration.md) for the full schema.

## 13.6 Transition Behavior

- **Remote → Local**: Pending Telegram approvals are NOT canceled. They drain naturally — if answered in Telegram, they still resolve. Only new decisions passthrough.
- **Local → Remote**: No special handling. Future decisions go through Telegram.

## 13.7 Limitations

- **No policy learning in local mode**: Terminal approvals don't flow back to ClaudeCube, so no policies are created. Acceptable trade-off — policies are learned in remote mode.
- **macOS-only auto-detection**: `ioreg` is macOS-specific. Linux/other platforms use manual switching only.

## Cross-References

- Mode check in PreToolUse: [Permission Evaluation](03-permission-evaluation.md) §3.0, §3.1
- Mode check in escalation: [LLM-Based Evaluation](04-llm-evaluation.md) §4.2
- Mode check in stop handler: [Stop Handling](05-stop-handling.md) §5.1
- Mode check in AskUserQuestion: [AskUserQuestion Routing](12-ask-user-question.md) §12.2
- `/mode` Telegram command: [Telegram Integration](06-telegram.md) §6.1
- Configuration schema: [Configuration](09-configuration.md) §9.1
