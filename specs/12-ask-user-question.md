# 12. AskUserQuestion Routing

## 12.1 Overview

`AskUserQuestion` is a tool that Claude Code agents use to ask interactive questions with predefined options. ClaudeCube intercepts these via `PreToolUse` and routes them to Telegram, allowing the human to answer remotely.

This is a **content question**, not a permission question — the agent is asking the user something, not requesting permission to do something. The answer is delivered back via a block reason, which the agent reads as the user's response.

## 12.2 Interception Point

Early in the PreToolUse handler, **before the rule engine**. In local mode or when Telegram is unavailable, passthrough (`{}`) lets the terminal handle it normally.

```
PreToolUse input received
  |-- session tracking (ensureRegistered, updateToolUse, updateState)
  |-- tool is "AskUserQuestion"?
  |     |-- local mode? -> return {} (passthrough)
  |     |-- questionHandler exists? -> route to Telegram, return block with answer
  |     |-- no Telegram -> return {} (passthrough)
  |-- not AskUserQuestion -> fall through to rule engine
```

## 12.3 Tool Input Schema

```typescript
{
  questions: Array<{
    question: string;       // Full question text
    header: string;         // Short label (max 12 chars)
    options: Array<{ label: string; description: string }>;
    multiSelect: boolean;
  }>;
}
```

## 12.4 Telegram Message Format

### Single-Select

```
❓ Question — <session label>

<header>
<question text>

Tap an option or reply with text for a custom answer.

[option 1 label]
[option 2 label]
[option 3 label]
```

One inline button per option, each on its own row. The session label appears in the title line; the header moves to the body.

### Multi-Select

```
❓ Question — <session label>

<header>
<question text>

Toggle options, then tap Done.

[⬜ option 1 label]
[⬜ option 2 label]
[⬜ option 3 label]
[✅ Done]
```

Toggle buttons use ✅/⬜ prefix. The "Done" button resolves the question with all selected options.

### Multiple Questions

When the tool input contains multiple questions (1–4), they are sent sequentially — one at a time. Each must be answered before the next is sent.

### After Answering

The message is edited to append:
```
✅ Answered: <selected label> (HH:MM:SS)
```

## 12.5 Answer Delivery

Block reason format:

- **Single question**: `User answered via Telegram: <answer>`
- **Multiple questions**: `User answered via Telegram:\n- <header1>: <answer1>\n- <header2>: <answer2>`

The PreToolUse response uses `decision: "block"` with the answer in `reason`. The agent reads the block reason as the user's response and proceeds without re-asking.

## 12.6 Callback Handling

| Callback Data | Action |
|---|---|
| `qopt:<id>:<index>` | **Single-select**: resolves immediately with the selected option label. **Multi-select**: toggles the option and edits the button text. |
| `qdone:<id>` | Multi-select "Done" — resolves with comma-joined selected labels. |
| Text reply to question message | Treated as "Other" (custom text answer). |

Callback data format is well within Telegram's 64-byte limit.

## 12.7 Reply Routing

`QuestionHandler` exposes `tryHandleReply(messageId, text, ctx)`, called from `ApprovalManager`'s text reply handler. This dispatches replies to the correct handler:

1. Check if `messageId` is in `questionMessages` map.
2. If yes: resolve the pending question with the reply text, return `true`.
3. If no: return `false` (let ApprovalManager handle it as a normal approval reply).

## 12.8 Edge Cases

| Scenario | Behavior |
|---|---|
| Local mode active | Passthrough (`{}`) — terminal handles normally (checked before Telegram) |
| No Telegram configured | Passthrough (`{}`) — terminal handles normally |
| Telegram send fails | Passthrough (`{}`) — graceful degradation |
| Zero multi-select selections | "Done" with no selections resolves with "(no selection)" |
| Concurrent questions from different sessions | Each gets a unique ID; maps track independently |
| Button label truncation | Labels truncated to 40 characters |
| Callback data size | `qopt:<id>:<index>` is well within 64-byte Telegram limit |

## 12.9 Audit

Logged with:
- `decidedBy: "telegram-question"`
- `decision: "deny"` (the tool is blocked — the block reason carries the answer)
- `reason`: contains the user's answer

## Cross-References

- Interception point in PreToolUse: [Permission Evaluation](03-permission-evaluation.md) §3.0
- Telegram integration details: [Telegram Integration](06-telegram.md) §6.8
- QuestionHandler class: `src/telegram/question-handler.ts`
