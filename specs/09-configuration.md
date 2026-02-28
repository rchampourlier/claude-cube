# 9. Configuration

ClaudeCube is configured through two YAML files, environment variables, and CLI flags.

## 9.1 Orchestrator Configuration

### File: `config/orchestrator.yaml`

Controls the server port, escalation behavior, Telegram settings, and stop handler.

```yaml
server:
  port: 7080

escalation:
  evaluatorModel: "claude-haiku-4-5-20251001"
  confidenceThreshold: 0.8
  telegramTimeoutSeconds: 300

telegram:
  enabled: true
  notifyOnStart: true
  notifyOnComplete: true
  notifyOnError: true
  denialAlertThreshold: 5

stop:
  retryOnError: true
  maxRetries: 2
  escalateToTelegram: true
```

### Schema (from `src/config/types.ts`)

All fields have `.default()` values, making every field optional in the YAML.

#### `ServerConfigSchema`

| Field | Type | Default | Description |
|---|---|---|---|
| `port` | positive integer | `7080` | TCP port for the HTTP hook server |

#### `EscalationConfigSchema`

| Field | Type | Default | Description |
|---|---|---|---|
| `evaluatorModel` | string | `"claude-haiku-4-5-20251001"` | Anthropic model ID for the LLM evaluator |
| `confidenceThreshold` | float [0,1] | `0.8` | Stored but not used (vestigial) |
| `telegramTimeoutSeconds` | positive number | `300` | Seconds before a Telegram approval request times out |

#### `TelegramConfigSchema`

| Field | Type | Default | Description |
|---|---|---|---|
| `enabled` | boolean | `true` | Master switch for Telegram integration |
| `notifyOnStart` | boolean | `true` | Send notification when a session starts |
| `notifyOnComplete` | boolean | `true` | Send notification when a session ends |
| `notifyOnError` | boolean | `true` | Accepted but not currently wired to any notification path |
| `denialAlertThreshold` | positive integer | `5` | Denial count threshold for alerts (method exists but is not called) |

#### `StopConfigSchema`

| Field | Type | Default | Description |
|---|---|---|---|
| `retryOnError` | boolean | `true` | Auto-retry when agent stops with an error |
| `maxRetries` | integer >= 0 | `2` | Max consecutive retries before allowing stop |
| `escalateToTelegram` | boolean | `true` | Escalate all stops to Telegram with transcript analysis (questions, errors after retries, normal completions) |

### Loading (from `src/config/loader.ts`)

```typescript
function loadOrchestratorConfig(filePath: string): OrchestratorConfig
```

Synchronous: reads YAML, parses, validates with Zod (applying defaults for missing fields). Called once at startup. Throws on validation errors.

## 9.2 Safety Rules Configuration

### File: `config/rules.yaml`

See [Safety Rule System](02-safety-rules.md) for the complete rule definition language and default rules.

### Loading (from `src/rule-engine/parser.ts`)

```typescript
function loadRules(filePath: string): RulesConfig
```

Synchronous: reads YAML, parses, validates with Zod, pre-validates all regex patterns. Called once at startup.

## 9.3 Environment Variables

| Variable | Required | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | Yes (for LLM evaluation) | Anthropic API key for the Haiku evaluator |
| `TELEGRAM_BOT_TOKEN` | No (optional) | Telegram bot token from BotFather |
| `TELEGRAM_CHAT_ID` | No (optional) | Authorized Telegram chat ID |
| `CLAUDECUBE_PORT` | No | Override server port in the hook script (default: 7080) |

Telegram is optional. Without both `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`, the Telegram bot, approval manager, and notification manager are all `null`. The LLM evaluator makes all escalation decisions autonomously (and denials default to blocked since there is no Telegram fallback).

The `.env` file in the project root contains 1Password secret references (`op://...`) that are resolved at runtime via the 1Password CLI.

## 9.4 CLI Flags

| Flag | Short | Type | Default | Description |
|---|---|---|---|---|
| `--port` | | string | from config | Override server port |
| `--config` | `-c` | string | `config/orchestrator.yaml` | Path to orchestrator config |
| `--rules` | `-r` | string | `config/rules.yaml` | Path to safety rules |
| `--verbose` | `-v` | boolean | false | Set log level to "debug" |
| `--install` | | boolean | | Install hooks (standalone command) |
| `--uninstall` | | boolean | | Remove hooks (standalone command) |
| `--status` | | boolean | | Query server status (standalone command) |
| `--help` | `-h` | boolean | | Print usage |

CLI flags are parsed using Node.js `parseArgs` from `node:util`.

## Configuration Precedence

For the server port:
1. `--port` CLI flag (highest priority)
2. `server.port` in `config/orchestrator.yaml`
3. Default value: `7080`

## Cross-References

- Orchestrator config is used throughout: [LLM Evaluation](04-llm-evaluation.md), [Stop Handling](05-stop-handling.md), [Telegram Integration](06-telegram.md).
- Rules config is described in detail in [Safety Rule System](02-safety-rules.md).
- CLI entry point and bootstrap are described in [Infrastructure](10-infrastructure.md).
