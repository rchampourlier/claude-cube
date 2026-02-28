# 6. Telegram Integration

Telegram serves as the human interface for ClaudeCube, providing interactive permission decisions, session monitoring, and remote control of Claude sessions via tmux. It handles both the escalation path from [LLM evaluation](04-llm-evaluation.md) and the question flow from [Stop handling](05-stop-handling.md).

## 6.1 Bot Setup and Lifecycle

The `TelegramBot` class (`src/telegram/bot.ts`) wraps the Telegraf framework.

### Construction

```typescript
class TelegramBot {
  constructor(token: string, chatId: string, deps: TelegramBotDeps);
  async start(): Promise<void>;
  async stop(): Promise<void>;
  async sendMessage(text: string, parseMode?: "Markdown" | "HTML"): Promise<void>;
  get telegram(): Telegraf.telegram;    // raw API access
  get callbackQuery(): Telegraf;        // for registering action handlers
}

interface TelegramBotDeps {
  sessionTracker: SessionTracker;
  onFreeText?: (chatId: number, text: string) => void;
}
```

### Authorization

All incoming messages are filtered through a middleware that checks `ctx.chat.id` against the configured `chatId`. Messages from unauthorized chats receive "Unauthorized." and are dropped. Only a single chat is authorized.

### Lifecycle

- `start()`: Launches the bot in long-polling mode. Registers SIGINT/SIGTERM shutdown handlers. Idempotent.
- `stop()`: Stops the bot. Idempotent.

### Bot Commands

| Command | Description | Implementation |
|---|---|---|
| `/start` | Returns the chat ID | Used for initial setup verification |
| `/status` | Lists all active sessions | Queries `SessionTracker.getAll()`, formats with state, denial count, CWD, last tool, age |
| `/panes` | Lists Claude panes in tmux | Calls `listClaudePanes()`, displays window name and pane ID |
| `/send <window-name> <text>` | Sends text to a Claude session by tmux window name | Resolves window name to pane ID, then calls `sendKeys()` |

### /panes Display Format

The `/panes` command displays Claude sessions grouped by tmux window name for human readability:

```
claude3-specs — %1
refactor-auth — %28
api-client — %13
```

Format: `<window-name> — <pane-id>`. The window name is the primary identifier the user sees and uses with `/send`.

### /send by Window Name

The `/send` command accepts a tmux window name as the target instead of a raw pane ID:

```
/send claude3-specs please continue with the refactoring
```

Resolution:
1. Search `listClaudePanes()` for a pane whose `windowName` matches the target.
2. If exactly one match: send keys to that pane.
3. If no match: report "No Claude pane found with window name '<name>'."
4. If multiple matches (multiple claude panes in the same window): send to the first one and note the ambiguity.

### Free-Text Forwarding

Non-command, non-reply text messages are forwarded to the first Claude pane in tmux via `sendKeys(panes[0].paneId, text)`. If no Claude panes exist, reports "No Claude panes found."

## 6.2 Message-to-Session Mapping

Every message sent by ClaudeCube to Telegram (approval requests, stop decisions) is mapped to the originating session and tmux pane. This enables correct routing when the user replies.

### Data Structure

```typescript
interface MessageContext {
  approvalId: string;
  sessionId: string;
  paneId: string;       // tmux pane ID for direct send-keys
  label: string;        // human-readable session label
}

// Map from Telegram message ID → context
private messageContext = new Map<number, MessageContext>();
```

### Flow

1. When sending an approval/stop message to Telegram, store the mapping:
   `telegramMessageId → { approvalId, sessionId, paneId, label }`
2. When the user replies to a message, look up the context by `reply_to_message.message_id`.
3. Route the reply to the correct pane using the stored `paneId`.
4. Clean up the mapping when the approval is resolved or times out.

This ensures that in multi-session scenarios, replies are always routed to the correct Claude session.

## 6.3 Permission Approval Flow

The `ApprovalManager` class (`src/telegram/approval.ts`) handles interactive permission decisions.

### Interface

```typescript
interface ApprovalResult {
  approved: boolean;
  reason: string;
  policyText?: string;
}

class ApprovalManager {
  constructor(bot: TelegramBot, chatId: string, timeoutMs: number = 300_000,
              sessionTracker: SessionTracker | null = null);
  async requestApproval(toolName: string, toolInput: Record<string, unknown>,
                        context: { agentId: string; label?: string; reason: string }): Promise<ApprovalResult>;
  async requestStopDecision(sessionId: string, lastMessage: string, label?: string,
                            cwd?: string, paneId?: string | null,
                            options?: { summary?: string; recentTools?: string }): Promise<ApprovalResult>;
  get pendingCount(): number;
}
```

### Permission Request Message

When a tool call needs human approval, a message is sent to Telegram:

```
Permission Request

Session: <label>
Tool: <toolName>
Reason: <LLM's assessment>

<formatted tool input>

Reply with text to approve + create a policy.
Use "- add rule: <description>" to also create a safety rule.
```

With inline buttons: **[Approve]** | **[Deny]** | **[Details]**

### Tool Input Formatting

The tool input is formatted differently depending on the tool:
- **Bash**: Shows the `command` field
- **Write/Edit/Read**: Shows the `file_path` or `filePath` field
- **Other tools**: JSON-formatted, truncated to 500 characters

### Resolution Paths

| User Action | Result |
|---|---|
| Tap "Approve" | `{ approved: true, reason: "Approved via Telegram" }` |
| Tap "Deny" | `{ approved: false, reason: "Denied via Telegram" }` |
| Tap "Details" | Fetches transcript summary (does NOT resolve the approval) — see below |
| Reply with text | Evaluated by LLM — see [6.4 Text Reply Evaluation](#64-text-reply-evaluation) |
| No response within timeout | `{ approved: false, reason: "Telegram approval timed out" }` |
| Message send fails | `{ approved: false, reason: "Telegram send failed: <error>" }` |

### Internal Mechanics

Maps coordinate state:
- `pending: Map<string, PendingApproval>` -- keyed by request ID (`"req_<N>_<timestamp>"`)
- `messageContext: Map<number, MessageContext>` -- maps Telegram message IDs to session/pane context for reply routing

Timeout is implemented via `Promise.race([approvalPromise, timeoutPromise])`.

Callback handlers are registered using Telegraf's action system:
- `/^approve:(.+)$/` -- matches "Approve" button callbacks
- `/^deny:(.+)$/` -- matches "Deny" button callbacks
- `/^details:(.+)$/` -- matches "Details" button callbacks (non-resolving)

### Details Button Flow

The "Details" button provides additional session context without resolving the approval:

1. User taps "Details" on an approval message.
2. `answerCbQuery()` is called to dismiss the loading indicator.
3. The handler looks up the session's `transcriptPath` via `sessionTracker.getTranscriptPath(sessionId)`.
4. If no transcript is available, replies with "No transcript available for this session."
5. Reads the last 15 messages via `readTranscript()`.
6. Generates an LLM summary via `summarizeTranscript()`.
7. Sends the summary as a **reply** to the approval message (keeping the original message and its buttons intact).

The summary message format:
```
📋 Session context: <label>

<LLM-generated summary>

Recent activity:
  Agent: <last assistant text, truncated>
    Tools: Edit, Bash
  User: <last user text, truncated>
  Agent: <text>
    Tools: Read
```

After reading the details, the user can still tap Approve/Deny or reply with text.

See [Transcript Analysis](11-transcript-analysis.md) for details on the reader and summarizer.

## 6.4 Text Reply Evaluation

When a user replies to an approval or stop message with text, the reply is **evaluated by an LLM** to determine the user's intent. This replaces the previous behavior of blindly treating all text replies as "approve + create policy."

### Intent Classification

The LLM classifies the reply into one of these intents:

| Intent | Action |
|---|---|
| **Approve** | Approve the tool call. Resolve the pending request with `approved: true`. |
| **Deny** | Deny the tool call. Resolve with `approved: false`. |
| **Forward to session** | Approve the tool call AND forward the text to the Claude session via tmux (using the message-to-session mapping). |
| **Add policy** | Approve the tool call AND create a soft policy in the [PolicyStore](08-policy-learning.md) for future LLM evaluations. |

### Explicit Syntax Convention

To reduce ambiguity, the user can use explicit directives in their reply:

- **Plain text**: Forwarded to the Claude session as guidance (implicit approve).
- **`add policy: <description>`**: Triggers soft policy creation in the PolicyStore. The policy is included in future LLM evaluations.

Example reply:
```
approve. add policy: it's ok to push on the default repository, as long as it's not a force-push
```

This would: approve the tool call and save "it's ok to push on the default repository, as long as it's not a force-push" as a policy for the LLM evaluator.

### Policy-to-Rule Promotion

Policies are soft guidance for the LLM evaluator. Over time, stable policies can be promoted to hard rules in `config/rules.yaml` via a dedicated skill. See [Policy Learning](08-policy-learning.md) for details.

### Stop Decision Text Replies

For stop decision messages, text replies are always treated as "forward to session" (the user is answering the agent's question). The reply text is sent back to Claude Code via the hook response (`decision: "block", reason: "The user answered your question: <text>"`), and the text is also forwarded to the correct tmux pane via the message-to-session mapping.

## 6.5 Stop Decision Flow

When a Claude session stops (for any reason — questions, errors after retries, or normal completion), `requestStopDecision()` sends an enriched message with optional transcript analysis:

```
🛑 Agent stopped — <label>

📋 Summary:
<LLM-generated summary of session activity>

Last message:
<last 800 characters of the assistant message>

Recent tools: Edit(src/foo.ts), Bash(npm test), Read(package.json)

Reply to send instructions. Buttons to continue or let stop.
```

With inline buttons: **[Continue]** | **[Let stop]**

The summary and recent tools lines are included when transcript analysis is available (passed via the `options` parameter). When unavailable, the message shows only the last message — graceful degradation.

Resolution follows the same pattern as permission requests, with buttons mapped to approved/denied. Text replies are forwarded to the session as the agent's answer.

See [Stop Handling](05-stop-handling.md) for the full stop flow and [Transcript Analysis](11-transcript-analysis.md) for details on transcript reading and summarization.

## 6.6 Session Notifications

The `NotificationManager` class (`src/telegram/notifications.ts`) sends one-way informational messages.

### Interface

```typescript
class NotificationManager {
  constructor(bot: TelegramBot, sessionTracker: SessionTracker, config: TelegramConfig);
  async sessionStarted(sessionId: string, cwd: string): Promise<void>;
  async sessionEnded(sessionId: string): Promise<void>;
  async denialAlert(sessionId: string, denialCount: number, lastTool: string): Promise<void>;
}
```

### Notifications

| Event | Condition | Message |
|---|---|---|
| Session start | `config.notifyOnStart` | "Session started\n<label>\nCWD: <cwd>" |
| Session end | `config.notifyOnComplete` | "Session ended\n<label>" |
| Denial alert | `denialCount >= config.denialAlertThreshold` | "<label> has been denied N times. Last tool: <tool>. The session may be stuck." |

### Error Handling

All notification sends are wrapped in try/catch. Telegram failures are logged but never thrown. A failing bot does not crash the server.

### Note on Unwired Functionality

The `denialAlert()` method is fully implemented but **never called** from any hook handler. The pre-tool-use handler records denials via `sessionTracker.recordDenial()` but does not check the count against the threshold or trigger the alert.

## 6.7 Tmux Remote Control

The Telegram bot provides remote control of tmux-based Claude sessions:

- `/panes` lists all tmux panes running `claude` with human-readable window names
- `/send <window-name> <text>` sends text to a specific session by window name
- Free text messages are forwarded to the first Claude pane
- Replies to approval/stop messages are routed to the correct pane via message-to-session mapping

This uses the `listClaudePanes()` and `sendKeys()` functions from `src/tmux.ts` (see [Session Management](07-session-management.md)).

## Cross-References

- The approval flow is invoked by the [Escalation Handler](04-llm-evaluation.md) when the LLM is uncertain or denies.
- The stop decision flow is invoked by the [Stop Handler](05-stop-handling.md) for all stops (after retries).
- The "Details" button and stop message enrichment use [Transcript Analysis](11-transcript-analysis.md).
- Policy creation from text replies feeds into the [Policy Learning](08-policy-learning.md) system.
- Session notifications are triggered by [Lifecycle Hooks](07-session-management.md).
- Tmux functions are described in [Session Management](07-session-management.md).
