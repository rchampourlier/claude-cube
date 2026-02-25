# 10. Infrastructure & Deployment

This section covers the HTTP server, CLI entry point, hook installation, logging system, and project configuration.

## 10.1 HTTP Server

The HTTP server (`src/server.ts`) is the network boundary between Claude Code (via the hook script) and ClaudeCube's processing pipeline.

### Factory Function

```typescript
function createHttpServer(
  port: number,
  routes: ServerRoutes,
  sessionTracker: SessionTracker,
): { start(): Promise<void>; stop(): Promise<void> }
```

### Routes

| Method | Path | Handler | Response |
|---|---|---|---|
| `POST` | `/hooks/PreToolUse` | PreToolUse handler | Permission decision JSON |
| `POST` | `/hooks/Stop` | Stop handler | Stop decision JSON |
| `POST` | `/hooks/SessionStart` | SessionStart handler | `{}` |
| `POST` | `/hooks/SessionEnd` | SessionEnd handler | `{}` |
| `POST` | `/hooks/Notification` | Notification handler | `{}` |
| `GET` | `/status` | Built-in | `{ sessions: [...], count: N }` |
| * | * | -- | `404 { error: "Not found" }` |

### Implementation Details

- Uses Node.js built-in `http` module (no Express or framework).
- Request body parsing: reads full stream, concatenates chunks, parses JSON.
- Error handling: all handler errors caught, returned as `500 { error: "..." }`.
- No body size limit, no CORS, no authentication, no rate limiting. Designed for localhost-only access.

### Lifecycle

- `start()`: Returns a promise that resolves when the server is listening.
- `stop()`: Returns a promise that resolves when all connections are closed.

## 10.2 Hook Installation

The installer (`src/installer.ts`) patches `~/.claude/settings.json` to register ClaudeCube's hook script for all supported events.

### Functions

```typescript
function install(): void;
function uninstall(): void;
```

### Hook Configuration

Each event gets a hook entry pointing to the absolute path of `hooks/claudecube-hook.sh`:

| Event | Timeout (seconds) |
|---|---|
| `PreToolUse` | 120 |
| `Stop` | 30 |
| `SessionStart` | 5 |
| `SessionEnd` | 5 |
| `Notification` | 5 |

### Settings File Structure

Claude Code expects hooks in the format:
```json
{
  "hooks": {
    "PreToolUse": [
      {
        "hooks": [
          { "type": "command", "command": "/absolute/path/to/claudecube-hook.sh", "timeout": 120 }
        ]
      }
    ]
  }
}
```

### Idempotency

The installer is idempotent:
- `install()` removes any existing ClaudeCube hooks (identified by `"claudecube-hook.sh"` substring) before adding the new one.
- Non-ClaudeCube hooks in the same events are preserved.
- Both `install()` and `uninstall()` clean up stale top-level keys from a previous buggy install.

### Path Resolution

The hook script path is resolved as `resolve(join(import.meta.dirname, "..", "hooks", "claudecube-hook.sh"))`. If the ClaudeCube installation is moved, hooks need to be reinstalled.

## 10.3 Shell Script Bridge

The shell script `hooks/claudecube-hook.sh` bridges Claude Code and the ClaudeCube server.

### Flow

1. Read JSON from stdin.
2. Extract event name using `jq`.
3. Stop loop guard: exit immediately if `stop_hook_active` is `true`.
4. POST JSON to `http://localhost:${CLAUDECUBE_PORT:-7080}/hooks/<event>` using `curl`.
5. Output response to stdout (consumed by Claude Code).

### Fail-Open Design

If the ClaudeCube server is not running:
- `curl` fails (non-zero exit code) or returns empty.
- The script exits with code 0 and produces no output.
- Claude Code continues normally without any hook interference.

This is a deliberate design choice: developer productivity is prioritized over enforcement. The orchestrator is advisory, not mandatory.

### Dependencies

- `jq` -- JSON parsing
- `curl` -- HTTP client
- `CLAUDECUBE_PORT` environment variable (optional, default 7080)

### Timeout

`curl --max-time 60` limits the HTTP request to 60 seconds. Note: this is shorter than the Telegram approval timeout (300s), meaning Telegram approvals for PreToolUse events cannot wait the full 5 minutes.

## 10.4 CLI Entry Point and Bootstrap

The CLI entry point (`src/index.ts`) handles argument parsing and application initialization.

### Standalone Commands

| Command | Action |
|---|---|
| `--install` | Call `install()`, exit |
| `--uninstall` | Call `uninstall()`, exit |
| `--status` | `fetch GET /status`, print JSON, exit |
| `--help` | Print usage, exit |

### Server Bootstrap Sequence

1. Load orchestrator config and rules.
2. Create core components: `RuleEngine`, `AuditLog`, `PolicyStore`, `SessionTracker`.
3. Conditional Telegram setup: if enabled and tokens are present, create `TelegramBot`, `ApprovalManager`, `NotificationManager`. Otherwise all three are `null`.
4. Create `EscalationHandler` (receives potentially-null `ApprovalManager`).
5. Create all five hook handlers via factory functions.
6. Create HTTP server with route map.
7. Start HTTP server.
8. Start Telegram bot (if configured).
9. Register SIGINT/SIGTERM handlers for graceful shutdown.

### Graceful Shutdown

On SIGINT or SIGTERM:
1. Stop HTTP server.
2. Stop Telegram bot (if running).
3. Exit with code 0.

### Error Handling

Fatal errors during startup (config loading, server binding) are caught by `main().catch()` and exit with code 1.

## 10.5 Logging System

The logging system (`src/util/logger.ts`) provides structured, leveled output.

### Usage

```typescript
const log = createLogger("component-name");
log.info("Message", { key: "value" }, "optional-context");
```

### Log Levels

| Level | Numeric | Console Method |
|---|---|---|
| `debug` | 0 | `console.debug` |
| `info` | 1 | `console.info` |
| `warn` | 2 | `console.warn` |
| `error` | 3 | `console.error` |

Default level: `info`. Changed to `debug` with `--verbose` flag.

### Output Format

```
[<ISO8601>] [<LEVEL>] [<context>] [<component>] <message> <JSON data>
```

The `context` field is used throughout the codebase for session labels (tmux window names or truncated session IDs), providing per-session log tracing.

### Design

- Module-level global log level (`currentLevel`). No per-component level control.
- No file output -- logs go to stdout/stderr only.
- No log rotation, size limits, or retention policies.

## 10.6 Project Configuration

### package.json

- **Name**: `claudecube`, **Version**: `0.1.0`
- **Type**: ESM (`"type": "module"`)
- **Entry**: `dist/index.js` (both `main` and `bin.claudecube`)
- **Node**: >= 22

### Dependencies

| Package | Version | Purpose |
|---|---|---|
| `@anthropic-ai/sdk` | `^0.39` | Anthropic API client |
| `micromatch` | `^4.0.8` | Glob matching in rule engine |
| `telegraf` | `^4.16` | Telegram bot framework |
| `yaml` | `^2.7` | YAML parsing |
| `zod` | `^4.3.6` | Runtime schema validation |

### TypeScript Configuration

- Target: ES2024, Module: Node16
- Strict mode enabled
- Outputs to `dist/` with declarations and source maps

### Build & Development

| Script | Command | Purpose |
|---|---|---|
| `build` | `tsc` | Compile to `dist/` |
| `start` | `tsx src/index.ts` | Run from source |
| `dev` | `tsx watch src/index.ts` | Dev mode with watch |
| `lint` | `tsc --noEmit` | Type-check only |
| `test` | `node --test ...` | Run tests (none exist yet) |

### Convention: ESM Imports

All local imports must use `.js` extensions for Node16 ESM resolution:
```typescript
import { RuleEngine } from "./engine.js";     // correct
import { RuleEngine } from "./engine";         // wrong
```

## Cross-References

- The HTTP server dispatches to hook handlers described in [Permission Evaluation](03-permission-evaluation.md), [Stop Handling](05-stop-handling.md), and [Session Management](07-session-management.md).
- Hook installation configures the shell script described in this section.
- CLI flags are described in [Configuration](09-configuration.md).
