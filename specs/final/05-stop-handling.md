# 5. Stop Handling

When a Claude Code session stops (the agent finishes its turn), ClaudeCube evaluates whether to let it stop, force a retry, or escalate to the human. This prevents premature stops due to errors and gives the human a chance to respond to agent questions.

## 5.1 Stop Hook Handler

The handler is created via `createStopHandler()` in `src/hooks/stop.ts`.

### Input Schema

```typescript
interface StopInput {
  hook_event_name: "Stop";
  session_id: string;
  cwd: string;
  transcript_path: string;
  stop_hook_active?: boolean;
  last_assistant_message?: string;
}
```

**Note on available data**: Claude Code's Stop hook only provides `last_assistant_message` as a plain text string. It does **not** include suggested follow-up actions or tab-completion suggestions. To access richer information (e.g., suggested actions that would appear as tab-completable items in Claude Code's UI), the transcript file at `transcript_path` would need to be parsed.

### Response Schema

```typescript
interface StopResponse {
  decision?: "block";    // only set when preventing the stop
  reason?: string;       // guidance message sent to the agent
}
```

An empty object `{}` means "let the session stop normally."

### Complete Decision Flow

```
1. ensureRegistered(sessionId, cwd)

2. stop_hook_active check
   |-- true --> return {} (prevent infinite loops)

3. No last_assistant_message?
   |-- true --> return {} (let stop)

4. Error detection heuristic
   |-- matches error AND config.retryOnError?
   |     |-- retries < maxRetries
   |     |     --> increment retries
   |     |     --> return { decision: "block",
   |     |                  reason: "Try a different approach" }
   |     |-- retries >= maxRetries
   |           --> clear retries, return {} (let stop)

5. Question detection heuristic
   |-- matches question AND config.escalateToTelegram AND approvalManager?
   |     --> requestStopDecision(sessionId, lastMessage, label)
   |     |-- approved with text --> return { decision: "block",
   |     |                                   reason: "User answered: <text>" }
   |     |-- approved (button) ---> return { decision: "block",
   |     |                                   reason: "User wants you to continue" }
   |     |-- denied/timeout ------> return {} (let stop)

6. Default --> clear retries, return {} (let stop)
```

## 5.2 Error Retry Logic

### Error Detection Heuristic

Two regex patterns:

**Error pattern** (must match):
```
/error|failed|cannot|unable|exception|traceback/i
```

**Success anti-pattern** (must NOT match):
```
/successfully|completed|fixed|resolved/i
```

A message is classified as an error only if it matches the error pattern AND does not match the success anti-pattern. This prevents messages like "Error was successfully resolved" from triggering a retry.

### Retry Tracking

A module-level `Map<string, number>` tracks retry counts per session:

```typescript
const retryCount = new Map<string, number>();
```

- On error detection: increment and check against `config.maxRetries`.
- On max retries reached: clear the session's retry count and let it stop.
- On normal stop (non-error): clear the session's retry count.

### Retry Message

When forcing a retry, the handler returns:
```json
{
  "decision": "block",
  "reason": "The previous approach hit an error. Try a different approach to accomplish the task."
}
```

This message is passed back to Claude Code, which treats the blocked stop as an instruction to continue with the provided reason as guidance.

## 5.3 Question Escalation

### Question Detection Heuristic

```
/\?$|\bshould I\b|\bwould you like\b|\bdo you want/i
```

Tests against the trimmed last message. Matches:
- Messages ending with `?`
- Messages containing "should I", "would you like", "do you want"

### Telegram Flow

When a question is detected and Telegram escalation is enabled:
1. Call `approvalManager.requestStopDecision(sessionId, lastMessage, label)`.
2. The Telegram message shows the agent's last message (truncated to 800 chars) with "Continue" and "Let stop" buttons.
3. If the user replies with text, the handler returns it as the agent's "answer" via the block reason.

### Follow-Up Suggestions (Future Enhancement)

Claude Code does not include suggested follow-up actions in the Stop hook payload. A future enhancement could parse `transcript_path` to extract suggested actions (if present) and:
- Display them as additional buttons in the Telegram message.
- Use the first suggested action as the "Continue" button's payload instead of a generic "continue" message.

## 5.4 Stop Loop Prevention

A key invariant: a stop-hook block causes Claude Code to continue, which may trigger another stop. Without protection, this creates an infinite loop.

**Two-layer prevention:**

1. **Shell script** (`hooks/claudecube-hook.sh`): If `stop_hook_active` is `true` in the JSON input, exit immediately without contacting the server.
2. **Handler** (`src/hooks/stop.ts`): If `stop_hook_active` is `true`, return `{}` immediately.

Claude Code sets `stop_hook_active: true` when a stop event is triggered by a previous stop-hook block. The shell script check is an optimization (avoids the HTTP round-trip), while the handler check is the authoritative guard.

## Configuration

Stop behavior is configured in `config/orchestrator.yaml`:

```yaml
stop:
  retryOnError: true        # auto-retry on error detection
  maxRetries: 2             # max consecutive retries before allowing stop
  escalateToTelegram: true  # forward questions to Telegram
```

## Known Issues

- The `retryCount` map is never cleaned up for sessions that end via `SessionEnd` without a preceding `Stop` event (e.g., session crashes). This causes a minor memory leak of `Map` entries.
- The heuristics are intentionally broad. False positives are acceptable because: error false positives are bounded by `maxRetries`, and question false positives escalate to a human who can simply tap "Let stop."

## Cross-References

- The stop handler is invoked by the HTTP server when a `Stop` event is received (see [Infrastructure](10-infrastructure.md)).
- Telegram stop decisions use the `ApprovalManager` described in [Telegram Integration](06-telegram.md).
- Configuration is described in [Configuration](09-configuration.md).
