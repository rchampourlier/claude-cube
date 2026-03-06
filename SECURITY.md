# ClaudeCube Telegram Bot — Security Analysis

## Context
ClaudeCube's Telegram bot is the human escalation channel for permission decisions. If compromised, an attacker could approve arbitrary tool calls (file writes, shell commands, git pushes) on your machine. This analysis covers the current security posture and practical improvements.

---

## Current Security Model

### What's in place
- **Single chat ID middleware** (`src/telegram/bot.ts:44-52`): Every incoming message/callback is checked against the configured `TELEGRAM_CHAT_ID`. Mismatches get "Unauthorized." and are dropped.
- **Long-polling** (not webhooks): The bot connects outbound to Telegram — no inbound HTTP endpoint to attack.
- **Env-var secrets**: Bot token and chat ID are read from environment variables, not committed to the repo.

### What happens if someone messages the bot
1. Telegram delivers the message to the bot's polling loop
2. The middleware extracts `ctx.chat.id` and compares it to the configured ID
3. Mismatch → logs `"Rejected message from unauthorized chat"`, replies "Unauthorized.", returns
4. **No command handlers, callbacks, or text handlers execute**

---

## Can the chat ID be brute-forced?

**Short answer: No, not practically.**

### Why it's hard
1. **You can't spoof `chat.id` in Telegram.** The `chat.id` field is set server-side by Telegram's API — the sender cannot forge it. An attacker would need to actually *be* in a chat with that ID.
2. **Personal chat IDs** are your Telegram user ID (positive integer, typically 8-10 digits). To "try" a different chat ID, the attacker would need a different Telegram account.
3. **Telegram rate-limits account creation and bot interactions.** Mass-creating accounts to enumerate chat IDs triggers anti-spam.
4. **The attacker needs to know the bot's username first.** Without it, they can't even send a message.

### Residual risks
- **Chat ID is not a secret** — it's your Telegram user ID, visible in many contexts (e.g., forwarded messages, user profiles, bots you've interacted with). Security-through-obscurity is weak here.
- **The "Unauthorized." reply confirms the bot exists and is running**, which is minor info leakage.
- **If an attacker obtains your bot token** (from env leak, process memory, logs), they can call `getUpdates` or `sendMessage` directly via the Bot API — the chat ID middleware is bypassed entirely because they'd be using the HTTP API, not going through the bot's polling handlers.

---

## Threat Model Summary

| Threat | Risk | Current mitigation |
|--------|------|--------------------|
| Random user messages bot | **Low** | Chat ID middleware blocks |
| Brute-force chat ID | **Very low** | Can't spoof; rate-limited by Telegram |
| Attacker knows bot username | **Low** | Still blocked by chat ID check |
| Bot token leaked | **High** | None — full API access |
| Telegram account/session stolen | **High** | None — attacker IS the authorized chat |
| Callback ID guessing (`approve:req_N_timestamp`) | **Low** | Requires being in the authorized chat first |
| Group chat with multiple users | **Medium** | No per-user verification; anyone in chat can approve |

---

## Recommendations to Harden the Bot

### 1. Stop replying "Unauthorized." to unknown chats
**Why:** Confirms the bot is alive. Silent drop is better.
**How:** Remove `ctx.reply("Unauthorized.")` in the middleware — just log and return.

### 2. Add Telegram user ID verification (in addition to chat ID)
**Why:** If the bot is ever added to a group, or if someone gains access to the chat, per-user verification ensures only YOU can approve actions.
**How:** Check `ctx.from.id` against a configured `TELEGRAM_USER_ID` in the middleware.

### 3. Use cryptographic callback data
**Why:** Current callback IDs (`req_${counter}_${timestamp}`) are sequential and guessable. Though chat ID middleware blocks external users, defense-in-depth is good.
**How:** Use `crypto.randomUUID()` or HMAC-signed tokens instead of `req_N_timestamp`.

### 4. Add a confirmation PIN for high-risk approvals
**Why:** If your Telegram session is stolen, the attacker can approve everything. A PIN adds a second factor.
**How:** For `Bash` tool approvals or certain patterns, require a reply like "approve 1234" with a configured PIN.

### 5. Restrict bot discoverability
**Why:** If no one knows the bot username, they can't message it.
**How:** In BotFather, disable "Allow Groups?" and "Allow joining groups via link". Keep the username non-obvious.

### 6. Monitor and alert on rejected messages
**Why:** Repeated rejections could indicate an attack.
**How:** Already logging `log.warn` — consider rate-limiting or temporarily disabling the bot after N rejections.

### 7. Rotate the bot token periodically
**Why:** Limits the window of a token leak.
**How:** Use BotFather's `/revoke` and update the env var.

---

## Implementation Priority

### Quick wins (minimal code)
- [ ] Remove "Unauthorized." reply (1 line)
- [ ] Switch callback IDs to `crypto.randomUUID()` (1 line)
- [ ] Add `TELEGRAM_USER_ID` check to middleware (3-4 lines)

### Medium effort
- [ ] PIN-based confirmation for high-risk tools
- [ ] Rejection rate-limiting

### Operational (no code)
- [ ] BotFather settings (disable groups)
- [ ] Token rotation schedule

---

## Files involved
- `src/telegram/bot.ts:44-52` — Auth middleware
- `src/telegram/approval.ts:295` — Callback ID generation
- `src/index.ts:121-122` — Env var loading
