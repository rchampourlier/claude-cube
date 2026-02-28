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
1. ensureRegistered(sessionId, cwd, transcriptPath)

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
   |           --> clear retries, FALL THROUGH to step 5

5. Transcript analysis + Telegram escalation
   |-- config.escalateToTelegram AND approvalManager?
   |     --> Read transcript (last 15 messages)
   |     --> Generate LLM summary (graceful degradation on failure)
   |     --> Extract recent tools from transcript
   |     --> requestStopDecision(sessionId, lastMessage, label, cwd, paneId,
   |                             { summary, recentTools })
   |     |-- approved with text --> return { decision: "block",
   |     |                                   reason: "User answered: <text>" }
   |     |-- approved (button) ---> return { decision: "block",
   |     |                                   reason: "User wants you to continue" }
   |     |-- denied/timeout ------> return {} (let stop)

6. No Telegram --> clear retries, return {} (let stop)
```

**Key change**: All stops (after retry exhaustion, questions, and normal completions) go through transcript analysis + Telegram escalation when `escalateToTelegram` is enabled. The previous behavior of only escalating questions is replaced by universal escalation with transcript context.

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
- On max retries reached: clear the session's retry count and fall through to transcript analysis + Telegram.
- On normal stop (non-error): fall through to transcript analysis + Telegram (retry count cleared when no Telegram is available).

### Retry Message

When forcing a retry, the handler returns:
```json
{
  "decision": "block",
  "reason": "The previous approach hit an error. Try a different approach to accomplish the task."
}
```

This message is passed back to Claude Code, which treats the blocked stop as an instruction to continue with the provided reason as guidance.

## 5.3 Transcript Analysis + Telegram Escalation

All stops (after error retries are exhausted, on questions, and on normal completions) are escalated to Telegram with transcript analysis when `escalateToTelegram` is enabled.

### Transcript Analysis

Before sending the Telegram message, the handler:
1. Reads the transcript (last 15 messages) via `readTranscript()`.
2. Generates an LLM summary via `summarizeTranscript()`.
3. Extracts recent tool names via `extractRecentTools()`.

All analysis steps degrade gracefully: if the transcript path is unavailable, the file is unreadable, or the LLM call fails, the stop flow continues without the failed component. See [Transcript Analysis](11-transcript-analysis.md) for details.

### Stop Message Format

```
🛑 Agent stopped — <label>

📋 Summary:
<LLM-generated summary>

Last message:
<last 800 chars of assistant message>

Recent tools: Edit(src/foo.ts), Bash(npm test), Read(package.json)

Reply to send instructions. Buttons to continue or let stop.
[▶️ Continue] [⏹️ Let stop]
```

The summary and recent tools lines are omitted when transcript analysis is unavailable.

### Telegram Flow

1. Call `approvalManager.requestStopDecision(sessionId, lastMessage, label, cwd, paneId, { summary, recentTools })`.
2. The Telegram message shows the LLM summary, last message (truncated to 800 chars), recent tools, and "Continue" / "Let stop" buttons.
3. If the user replies with text, the handler returns it as the agent's "answer" via the block reason.

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
- Transcript analysis (reader, summarizer, graceful degradation) is described in [Transcript Analysis](11-transcript-analysis.md).
- Configuration is described in [Configuration](09-configuration.md).
