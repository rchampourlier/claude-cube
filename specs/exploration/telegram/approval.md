# `src/telegram/approval.ts` -- Telegram Approval Manager

## Purpose

Manages the asynchronous approval flow via Telegram inline keyboards. When the LLM evaluator is uncertain about a tool call, or when a Claude session stops with a question, this module sends a Telegram message with inline Approve/Deny buttons and waits for the human's response. Also supports text replies that create persistent policies.

## Public Interface

### Types

#### `ApprovalResult`

```typescript
interface ApprovalResult {
  approved: boolean;
  reason: string;
  policyText?: string;   // present when the human replied with text
}
```

### Class: `ApprovalManager`

#### Constructor

```typescript
constructor(
  bot: TelegramBot,
  chatId: string,
  timeoutMs: number = 300_000,   // 5 minutes
)
```

Initializes pending request tracking and registers callback and reply handlers on the bot.

#### Method: `requestApproval(toolName, toolInput, context): Promise<ApprovalResult>`

```typescript
async requestApproval(
  toolName: string,
  toolInput: Record<string, unknown>,
  context: { agentId: string; label?: string; reason: string },
): Promise<ApprovalResult>
```

Sends a permission request message to Telegram and waits for a response.

**Message format:**
```
Permission Request

Session: <label or truncated agentId>
Tool: <toolName>
Reason: <reason>

<formatted tool input>

Reply with text to approve + create a policy.
```

**Buttons:** "Approve" | "Deny"

**Returns:** Resolves when:
1. User taps "Approve" -> `{ approved: true, reason: "Approved via Telegram" }`
2. User taps "Deny" -> `{ approved: false, reason: "Denied via Telegram" }`
3. User replies with text -> `{ approved: true, reason: "Approved via Telegram with policy: <text>", policyText: "<text>" }`
4. Timeout expires -> `{ approved: false, reason: "Telegram approval timed out" }`
5. Message send fails -> `{ approved: false, reason: "Telegram send failed: <error>" }`

#### Method: `requestStopDecision(sessionId, lastMessage, label?): Promise<ApprovalResult>`

```typescript
async requestStopDecision(
  sessionId: string,
  lastMessage: string,
  label?: string,
): Promise<ApprovalResult>
```

Sends a stop decision message to Telegram.

**Message format:**
```
Agent stopped

Session: <label or truncated sessionId>

Last message:
<truncated to 800 chars>

Reply with text to answer the agent and force-continue.
```

**Buttons:** "Continue" | "Let stop"

**Returns:** Same resolution pattern as `requestApproval`, with button labels mapped to approved/denied.

#### Property: `pendingCount: number` (getter)

Returns the number of pending approval requests.

## Internal Logic

### Pending Request Tracking

Two maps coordinate state:

```typescript
private pending = new Map<string, PendingApproval>();
private messageToApproval = new Map<number, string>();
```

- `pending`: Maps request ID (`"req_<N>_<timestamp>"` or `"stop_<N>_<timestamp>"`) to a `PendingApproval` object containing the `resolve` function for the promise, the `messageId`, `toolName`, and `createdAt`.
- `messageToApproval`: Maps Telegram message IDs to request IDs, enabling text reply correlation.

### Callback Handler (`setupCallbackHandler`)

Registers two Telegraf action handlers:

1. `/^approve:(.+)$/` -- Extracts the request ID from the callback data, resolves the pending promise with `approved: true`, updates the message text with a timestamp.
2. `/^deny:(.+)$/` -- Same pattern, resolves with `approved: false`.

Both handlers call `ctx.answerCbQuery()` and `ctx.editMessageText()` to provide UI feedback. If the request has already been handled or expired, responds with "Request expired or already handled."

### Reply Handler (`setupReplyHandler`)

Listens for text messages that are replies to existing messages (`reply_to_message`). If the replied-to message corresponds to a pending approval:
1. Treat the reply as an approval with policy text.
2. Resolve with `{ approved: true, policyText: <text> }`.
3. Confirm via Telegram reply.

### Timeout Handling

Each `requestApproval` and `requestStopDecision` creates a `setTimeout` that resolves the race with a denial after `timeoutMs`. Uses `Promise.race([promise, timeout])`.

On timeout:
1. Clean up the pending request.
2. Resolve with `{ approved: false, reason: "...timed out" }`.
3. Send a timeout notification message to the chat.

### Cleanup

The `cleanup(id)` method removes the request from both `pending` and `messageToApproval` maps.

### Helper Functions

#### `formatToolInput(toolName, input): string`

Produces a concise summary of the tool input for display in the Telegram message:
- `Bash`: shows the `command` field.
- `Write`, `Edit`, `Read`: shows the `file_path` or `filePath` field.
- Other tools: JSON-formatted, truncated to 500 characters.

#### `escapeMarkdownCodeBlock(text): string`

Replaces backticks with single quotes inside code blocks to avoid Markdown rendering issues.

## Dependencies

- `telegraf` (external, `Markup`) -- inline keyboard builder.
- `./bot.js` (`TelegramBot`) -- bot instance for sending messages and registering handlers.
- `../util/logger.js` (`createLogger`) -- structured logging.

## Constraints & Invariants

- Request IDs are unique, generated from an auto-incrementing counter plus a timestamp: `"req_<N>_<timestamp>"`.
- Each pending request can only be resolved once. After resolution, it is cleaned up from both maps.
- The timeout promise does not cancel the callback/reply handlers directly. Instead, if the callback fires after timeout, the `pending.get(id)` returns `undefined` and the callback responds with "Request expired."
- `requestStopDecision` truncates the last message to 800 characters from the end (most recent content).
- Telegram send failures return an immediate denial result rather than throwing.

## Edge Cases

- If the bot cannot send the approval message (network error, rate limiting), the method returns `{ approved: false, reason: "Telegram send failed: ..." }` immediately.
- If a user taps a button for an already-resolved request, they get "Request expired or already handled."
- Multiple pending requests can exist simultaneously (e.g., two different sessions waiting for approval).
