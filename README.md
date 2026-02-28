# ClaudeCube

Hooks-based orchestrator for [Claude Code](https://docs.anthropic.com/en/docs/claude-code) sessions with safety rules and remote control via Telegram.

ClaudeCube monitors your existing `claude` CLI sessions (running in tmux panes) via Claude Code's hooks system. It auto-approves safe operations, blocks dangerous ones, and escalates uncertain decisions to an LLM evaluator or to your phone as Telegram notifications with inline Approve/Deny buttons.

```
~/.claude/settings.json
  hooks call: curl → http://localhost:7080/hooks/<event>
                          |
                 +--------v---------+
                 |    ClaudeCube     |
                 |  (HTTP server)   |
                 |                  |
                 |  RuleEngine      |──→ allow/deny (instant)
                 |      |           |
                 |      └─escalate──|──→ LLM evaluator (Haiku)
                 |           |      |       |
                 |           |      |       └─uncertain──→ Telegram
                 |           |      |          (inline approve/deny)
                 |  Stop     |      |
                 |  handler ─|──────|──→ decide: let stop or force-continue
                 |           |      |
                 |  Telegram |      |──→ /status, free-text → tmux send-keys
                 |  bot      |      |
                 +------------------+
```

## Setup

### 1. Install

```bash
npm install
npm run build
```

### 2. Install hooks into Claude Code

```bash
npx tsx src/index.ts --install
```

This patches `~/.claude/settings.json` to add ClaudeCube hooks for `PreToolUse`, `Stop`, `SessionStart`, `SessionEnd`, and `Notification` events. Existing hooks are preserved.

### 3. Create a Telegram bot (optional)

1. Message [@BotFather](https://t.me/BotFather) on Telegram → `/newbot` → name it "ClaudeCube"
2. Copy the bot token it gives you
3. Message your new bot and send `/start`
4. Get your chat ID (the bot logs it on first `/start`)

### 4. Set environment variables

```bash
export ANTHROPIC_API_KEY="sk-ant-..."       # for the Haiku evaluator
export TELEGRAM_BOT_TOKEN="123456:ABC-DEF..." # from BotFather
export TELEGRAM_CHAT_ID="your-chat-id"        # from step above
```

Telegram is optional — without it, the LLM evaluator makes all escalation decisions autonomously.

## Usage

### Start the server

```bash
npx tsx src/index.ts
```

This starts the HTTP server on port 7080 and the Telegram bot. Then open `claude` in tmux as usual — ClaudeCube intercepts tool calls via hooks.

### CLI options

| Flag | Short | Description | Default |
|------|-------|-------------|---------|
| `--install` | | Install hooks into `~/.claude/settings.json` | |
| `--uninstall` | | Remove ClaudeCube hooks from settings | |
| `--status` | | Query running server for active sessions | |
| `--port` | | Custom server port | `7080` |
| `--config` | `-c` | Path to orchestrator config | `config/orchestrator.yaml` |
| `--rules` | `-r` | Path to safety rules | `config/rules.yaml` |
| `--verbose` | `-v` | Enable debug logging | off |

## How permissions work

Every tool call in a monitored Claude session goes through this flow:

1. **Deny rules** checked first → immediate block
2. **Allow rules** checked next → auto-approve
3. **No match** → LLM evaluator (Haiku) decides based on context
4. **LLM uncertain** → Telegram message with Approve/Deny inline buttons
5. **Telegram timeout** (5 min default) → denied automatically

All decisions are logged to `.claudecube/audit/`.

### Stop handler

When a Claude session stops, ClaudeCube evaluates whether to force-continue:

- **Error detected** → automatically retries with "try a different approach" (up to `maxRetries`)
- **Question detected** → escalates to Telegram: "Agent stopped. Force continue?"
- **Normal completion** → lets the session stop

### Default rules

Out of the box, `config/rules.yaml` includes:

**Blocked** — destructive commands (`rm -rf /`), force push, edits to `.env`/`.pem`/credentials files

**Auto-approved** — read-only tools (`Read`, `Glob`, `Grep`), file edits within `src/`, safe dev commands (`npm test`, `git status`, etc.)

**Escalated** — everything else

### Customizing rules

Edit `config/rules.yaml`. Each rule has:

```yaml
- name: "Human-readable name"
  action: deny | allow | escalate
  tool: "ToolName"              # supports pipe-separated: "Write|Edit"
  match:                        # optional — omit to match all uses of the tool
    field_name:                 # matches against tool input fields
      - pattern: "^src/.*"
        type: regex             # regex, glob, or literal
  reason: "Why this rule exists"
```

### Policies (human feedback)

Policies are a separate system from safety rules. While rules are deterministic regexp-based checks, **policies are free-text instructions** that you create from Telegram to teach the LLM evaluator your preferences over time.

#### How it works

1. A tool call escalates to Telegram (the LLM evaluator is uncertain or denies).
2. You receive an approval message with Approve/Deny buttons.
3. Instead of tapping a button, **reply with text** — your reply is saved as a policy and the tool call is approved.
4. On future evaluations, the LLM evaluator sees your policies and can confidently approve matching tool calls without asking you again.

#### Example

You receive a Telegram approval for `npm install lodash`. Instead of tapping Approve, you reply:

> Always allow npm install in this project

This creates a policy scoped to the `Bash` tool. Next time a similar `npm install` is escalated, the LLM evaluator sees this policy, follows it, and auto-approves.

#### Policies vs rules

| | Rules (`config/rules.yaml`) | Policies (`config/policies.yaml`) |
|---|---|---|
| **Type** | Deterministic (regexp/glob/literal) | Advisory (free-text for LLM) |
| **Speed** | Instant — no API call | Requires LLM evaluation |
| **Creation** | Edit YAML manually, or `- add rule: ...` in Telegram reply | Reply with text to a Telegram approval |
| **Effect** | Hard allow/deny/escalate | Influences LLM confidence and decision |
| **Position** | Step 1 (before LLM) | Step 2 (within LLM evaluation) |

#### Managing policies

- **Create**: Reply with text to any Telegram approval request
- **View**: Open `config/policies.yaml` (YAML file, created at runtime)
- **Delete**: Edit `config/policies.yaml` directly (remove entries)
- **Promote to rule**: When a policy is stable, convert it to a hard rule in `config/rules.yaml` for instant, deterministic evaluation. See [Policy-to-Rule Promotion](specs/08-policy-learning.md#85-policy-to-rule-promotion).

#### Adding rules from Telegram

To create a hard **rule** (not a policy) from Telegram, include the `- add rule:` directive in your reply:

```
Yes, allow it.
- add rule: allow npm install commands
```

This approves the current tool call, forwards your text to the session, and also creates a new entry in `config/rules.yaml` (picked up automatically via hot-reload).

## Telegram commands

Once the bot is running, you can control sessions from your phone:

| Command | Description |
|---------|-------------|
| `/status` | List all active sessions with state, denials, and cwd |
| `/panes` | List Claude panes in tmux |
| `/send <pane-id> <text>` | Send text to a specific tmux pane |
| Free text | Forwarded to the first Claude pane via tmux |

## Configuration

### `config/orchestrator.yaml`

Controls the server port, escalation behavior, Telegram settings, and stop handler:

```yaml
server:
  port: 7080

escalation:
  evaluatorModel: "claude-haiku-4-5-20251001"
  confidenceThreshold: 0.8
  telegramTimeoutSeconds: 300

stop:
  retryOnError: true
  maxRetries: 2
  escalateToTelegram: true
```

## Project structure

```
src/
  index.ts                  # CLI entry point — server startup + --install/--uninstall
  server.ts                 # HTTP server with routes per hook event
  session-tracker.ts        # Tracks active Claude sessions and their state
  tmux.ts                   # List Claude panes, send keys for text injection
  installer.ts              # Patches ~/.claude/settings.json with hooks
  rule-engine/
    types.ts                # Zod schemas for safety rules
    parser.ts               # YAML loader + validation
    engine.ts               # Deny-first rule evaluator
  policies/
    types.ts                # Zod schemas for policies
    store.ts                # In-memory + YAML-persisted policy store
  hooks/
    pre-tool-use.ts         # PreToolUse → RuleEngine → allow/deny/escalate
    stop.ts                 # Stop → error retry / Telegram escalation
    lifecycle.ts            # SessionStart/End/Notification → session tracking
    audit-hook.ts           # Structured JSONL audit logging
  telegram/
    bot.ts                  # Telegraf bot + session commands + tmux integration
    approval.ts             # Inline keyboard approval flow
    notifications.ts        # Session start/end notifications and alerts
  escalation/
    handler.ts              # LLM evaluator + Telegram fallback
    llm-evaluator.ts        # Haiku-based safety evaluation
  config/
    loader.ts               # YAML config loader
    types.ts                # Config Zod schemas
  util/
    logger.ts               # Structured logging
hooks/
  claudecube-hook.sh        # Shell script called by Claude Code hooks
config/
  rules.yaml                # Safety rules (edit this)
  policies.yaml             # Policies from human feedback (created at runtime)
  orchestrator.yaml         # Server + escalation settings (edit this)
```
