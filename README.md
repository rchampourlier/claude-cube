# ClaudeCube

Orchestrate autonomous [Claude Code](https://docs.anthropic.com/en/docs/claude-code) agents with safety rules and remote control via Telegram.

ClaudeCube sits between you and your agents: it auto-approves safe operations, blocks dangerous ones, and escalates uncertain decisions to an LLM evaluator or to your phone as Telegram notifications with inline Approve/Deny buttons.

```
rules.yaml                        Telegram (your phone)
    |                                    ^  |
    v                                    |  v
+--------------------------------------+--------+
|              ClaudeCube                        |
|                                                |
|  RuleEngine ──deny──> blocked                  |
|      |                                         |
|      ├──allow──> approved                      |
|      |                                         |
|      └──escalate──> LLM Evaluator (Haiku)      |
|                         |                      |
|                         ├──confident──> decide  |
|                         └──uncertain──> Telegram|
|                              (inline buttons)  |
+------------------------------------------------+
```

## Setup

### 1. Install

```bash
npm install
npm run build
```

### 2. Create a Telegram bot

1. Message [@BotFather](https://t.me/BotFather) on Telegram → `/newbot` → name it "ClaudeCube"
2. Copy the bot token it gives you
3. Message your new bot and send `/start`
4. Get your chat ID (the bot logs it on first `/start`)

### 3. Set environment variables

```bash
export ANTHROPIC_API_KEY="sk-ant-..."       # for agents and the Haiku evaluator
export TELEGRAM_BOT_TOKEN="123456:ABC-DEF..." # from BotFather
export TELEGRAM_CHAT_ID="your-chat-id"        # from step above
```

Telegram is optional — without it, the LLM evaluator makes all escalation decisions autonomously.

## Usage

### Single agent

```bash
npx tsx src/index.ts --prompt "Fix the bug in src/auth.ts"
```

### Parallel agents

Run multiple tasks concurrently:

```bash
npx tsx src/index.ts --mode parallel \
  --prompt "Add input validation to the login form" \
  --prompt "Write unit tests for the user service"
```

### Pipeline

Run tasks sequentially, each receiving the previous agent's result as context:

```bash
npx tsx src/index.ts --mode pipeline \
  --prompt "Analyze the codebase and find performance bottlenecks" \
  --prompt "Fix the most critical bottleneck you found"
```

### Options

| Flag | Short | Description | Default |
|------|-------|-------------|---------|
| `--prompt` | `-p` | Agent prompt (repeatable) | required |
| `--mode` | `-m` | `single`, `parallel`, or `pipeline` | `single` |
| `--config` | `-c` | Path to orchestrator config | `config/orchestrator.yaml` |
| `--rules` | `-r` | Path to safety rules | `config/rules.yaml` |
| `--cwd` | | Working directory for agents | current directory |
| `--verbose` | `-v` | Enable debug logging | off |

## How permissions work

Every tool call an agent makes goes through this flow:

1. **Deny rules** checked first → immediate block
2. **Allow rules** checked next → auto-approve
3. **No match** → LLM evaluator (Haiku) decides based on context
4. **LLM uncertain** → Telegram message with Approve/Deny inline buttons
5. **Telegram timeout** (5 min default) → denied automatically

All decisions are logged to `.claudecube/audit/`.

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

## Telegram commands

Once the bot is running, you can control agents from your phone:

| Command | Description |
|---------|-------------|
| `/status` | List all agents with status, cost, and turn count |
| `/abort <id>` | Kill a running agent |
| `/budget` | Show total cost across all agents |
| Free text | Forwarded as context to the active agent |

## Configuration

### `config/orchestrator.yaml`

Controls the model, budget limits, escalation behavior, and Telegram settings:

```yaml
model: "claude-sonnet-4-5-20250929"
maxTotalBudgetUsd: 20.00
maxAgents: 5

escalation:
  evaluatorModel: "claude-haiku-4-5-20251001"
  confidenceThreshold: 0.8
  telegramTimeoutSeconds: 300

agent:
  maxTurnsPerAgent: 50
  maxBudgetPerAgent: 5.00
  consecutiveDenialLimit: 5
```

## Project structure

```
src/
  index.ts                  # CLI entry point
  orchestrator.ts           # Single/parallel/pipeline execution
  rule-engine/
    types.ts                # Zod schemas for rules
    parser.ts               # YAML loader + validation
    engine.ts               # Deny-first rule evaluator
  hooks/
    permission-hook.ts      # PreToolUse → RuleEngine → allow/deny/escalate
    audit-hook.ts           # PostToolUse → structured JSONL logging
  agents/
    manager.ts              # Spawn, drive, abort, resume agents via SDK
  telegram/
    bot.ts                  # Telegraf bot + command handlers
    approval.ts             # Inline keyboard approval flow
    notifications.ts        # Status updates and alerts
  escalation/
    handler.ts              # LLM evaluator + Telegram fallback
    llm-evaluator.ts        # Haiku-based safety evaluation
  config/
    loader.ts               # YAML config loader
    types.ts                # Config Zod schemas
  util/
    logger.ts               # Structured logging
config/
  rules.yaml                # Safety rules (edit this)
  orchestrator.yaml         # Orchestrator settings (edit this)
```
