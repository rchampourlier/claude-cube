# 14. Notifications

## 14.1 Overview

When Claude is waiting for user input — permission approval, question answer, or after stopping — the user may be in another app and miss it. ClaudeCube provides two notification mechanisms to get the user's attention:

1. **macOS native notification** via `osascript` — alerts the user regardless of which app is focused.
2. **🔔 emoji prefix on the tmux window name** — visual indicator to find the right terminal window/pane.

Both are implemented in `src/notify.ts` as fire-and-forget operations that never block or fail the hook.

## 14.2 macOS Notifications

`showMacNotification(title, message)` executes:

```
osascript -e 'display notification "<message>" with title "<title>" sound name "Glass"'
```

- Plays the "Glass" system sound for audio alerting.
- No click action — the notification is informational only.
- `execSync` with 5-second timeout, wrapped in try/catch.
- If `osascript` fails (non-macOS, permissions, etc.), the error is logged at debug level and swallowed.

## 14.3 Tmux Window Alert

`addTmuxAlert(paneId)` prepends 🔔 to the tmux window name:

1. Reads current window name via `tmux display-message -t <paneId> -p '#{window_name}'`.
2. If already prefixed with 🔔, no-op.
3. Renames the window to `🔔 <originalName>`.
4. Sets `automatic-rename off` on the window to prevent tmux from overwriting the name.

`clearTmuxAlert(paneId)` reverses the process:

1. Reads current window name.
2. If not prefixed with 🔔, no-op.
3. Strips the `🔔 ` prefix and renames.
4. Re-enables `automatic-rename on`.

### Label Stripping

`resolveLabel()` in `src/tmux.ts` strips the 🔔 prefix from returned window names. This prevents the emoji from leaking into session labels used in Telegram messages and the `/status` endpoint.

## 14.4 Trigger Points

| Scenario | Title | Message | When Cleared |
|---|---|---|---|
| Escalation → Telegram | "Permission needed" | `<toolName>` | After Telegram decision |
| Escalation → local passthrough | "Permission needed in terminal" | `<toolName>` | Next tool call (safety net) |
| AskUserQuestion → Telegram | "Question from Claude" | First 100 chars of question | After answer received |
| Stop → Telegram | "Claude stopped" | `<label>` or "session" | After stop decision |
| Stop → local mode | "Claude stopped" | `<label>` or "session" | Next tool call (safety net) |

## 14.5 Alert Lifecycle

```
Tool call arrives → clearAlert() (cleanup from previous escalation)
  → Rule engine: allow/deny → no alert
  → Escalate → LLM: confident allow → no alert
  → LLM uncertain:
    → Remote mode: alertUser() → wait for Telegram → clearAlert()
    → Local mode: alertUser() → return passthrough → [cleared on next tool call]
```

The safety-net `clearAlert()` at the top of every `PreToolUse` handler ensures stale alerts are always cleaned up, even if:
- A local-mode passthrough was approved in the terminal (no callback to clear).
- A previous handler crashed after setting the alert.

On `SessionEnd`, `clearAlert()` is called before `deregister()` to clean up the tmux window name.

## 14.6 Cross-References

- Permission evaluation flow: [Permission Evaluation](03-permission-evaluation.md)
- Stop handling: [Stop Handling](05-stop-handling.md)
- Telegram integration: [Telegram Integration](06-telegram.md)
- Session management and tmux: [Session Management](07-session-management.md)
- Local mode behavior: [Local Mode](13-local-mode.md)
