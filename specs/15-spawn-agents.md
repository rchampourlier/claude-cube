# 15. Spawn Agents

ClaudeCube can spawn new Claude Code agents from Telegram via the `/new` command. This enables remote users to start new work in specific directories without SSH or terminal access.

## 15.1 The `/new` Command

### Syntax

```
/new <path> [initial prompt]
```

### Examples

```
/new myproject                        → interactive claude in ~/dev/myproject
/new myproject fix the login bug      → claude with prompt in ~/dev/myproject
/new my-org/api-server add tests      → claude in ~/dev/my-org/api-server
```

### Parameters

| Parameter | Required | Description |
|---|---|---|
| `path` | Yes | Directory name or relative subpath to resolve against configured search paths |
| `initial prompt` | No | Text to send to Claude as its first instruction |

### Parsing Rules

The first whitespace-delimited token is the path candidate. Everything after is the initial prompt.

Exception: if the first token doesn't resolve to a directory, try progressively longer prefixes (2 tokens, 3 tokens...) to handle directory names with spaces. If no prefix resolves, report an error with suggestions.

## 15.2 Path Resolution

All paths are resolved against a whitelist of configured search directories (`spawn.searchPaths` in `orchestrator.yaml`). Arbitrary filesystem access is explicitly prevented.

### Resolution Algorithm

```
resolvePath(input: string): string | string[] | null

1. Sanitize: reject if input contains "..", starts with "/" or "~",
   or contains environment variable references ($VAR, ${VAR}).
2. For each searchPath in config.spawn.searchPaths:
   a. Expand ~ in the searchPath to the user's home directory.
   b. Join: candidate = path.join(expandedSearchPath, input)
   c. Normalize with path.normalize() and verify the result
      still starts with the expandedSearchPath (defense-in-depth
      against traversal after normalization).
   d. If candidate is a directory: add to matches.
3. If exactly one match: return it.
4. If multiple matches: return all (for disambiguation).
5. If no match and input has no path separators:
   glob for */input and input* in each searchPath (shallow fuzzy).
   Return fuzzy matches (may be empty).
6. If no matches at all: return null.
```

### Security Constraints

The following inputs are **rejected** before any filesystem access:

| Pattern | Reason |
|---|---|
| Contains `..` | Path traversal |
| Starts with `/` | Absolute path bypass |
| Starts with `~` | Home directory bypass |
| Contains `$` | Environment variable expansion |

These checks ensure that the resolved path is always a subdirectory of a configured search path. The post-normalization prefix check (step 2c) provides defense-in-depth against edge cases like symlinks or encoding tricks.

### Disambiguation

When multiple directories match, an inline keyboard is shown:

```
📂 Multiple matches for "api":

[~/dev/api-server]
[~/dev+rc10r/api-gateway]
```

Each button's callback data encodes the full resolved path and the original prompt. Tapping a button proceeds with the spawn.

When fuzzy matches are returned (no exact match), they're shown the same way but with a different header:

```
📂 No exact match for "api". Did you mean:

[~/dev/api-server]
[~/dev+rc10r/api-gateway]
```

## 15.3 Tmux Window Creation

### Spawn Sequence

```typescript
async function spawnAgent(resolvedPath: string, prompt?: string): Promise<SpawnResult>
```

1. **Create tmux window**: `tmux new-window -c <resolvedPath> -n <basename> -P -F '#{pane_id}'`
   - `-c` sets the working directory
   - `-n` sets the window name to the directory basename
   - `-P -F '#{pane_id}'` prints the new pane ID
2. **Brief delay** (500ms) for shell initialization.
3. **Start Claude**: `sendKeys(paneId, command)` where command is:
   - `claude` if no prompt
   - `claude "<escaped prompt>"` if a prompt is provided
4. **Return** the pane ID and window name.

### Prompt Escaping

The initial prompt is shell-escaped before being passed to `sendKeys`:
- Double quotes are escaped as `\"`
- Backslashes are escaped as `\\`
- Backticks are escaped as `` \` ``
- Dollar signs are escaped as `\$`

### Error Handling

| Failure | Response |
|---|---|
| tmux not running | "tmux is not running. Cannot spawn agent." |
| Directory doesn't exist | "Directory not found: \<path\>" |
| `tmux new-window` fails | "Failed to create tmux window: \<error\>" |
| `sendKeys` fails | "Window created but failed to start Claude: \<error\>" |

## 15.4 Session Lifecycle

Once Claude starts in the new tmux pane, the existing hook infrastructure takes over automatically:

1. **SessionStart** hook fires → session registered in `SessionTracker` → Telegram notification (if enabled).
2. **PreToolUse** hooks fire → permissions evaluated normally (rules → LLM → Telegram escalation).
3. **Stop** hook fires → transcript summary sent to Telegram with Continue/Let stop buttons.
4. User replies to the stop message → text forwarded to the agent's pane via `sendKeys()`.
5. **SessionEnd** hook fires → session deregistered → Telegram notification.

No new session management code is needed. The `$TMUX_PANE` injection in the hook shell script ensures the new pane is correctly tracked.

### Confirmation Message

After spawning, the bot replies:

```
🚀 Agent started — <window-name>
CWD: <resolved-path>
[Prompt: <initial prompt>]

Use /send <window-name> <text> to send messages.
```

## 15.5 Conversation Flow

Conversation with spawned agents uses existing Telegram features:

| Action | Mechanism |
|---|---|
| Send a message to the agent | `/send <window-name> <text>` or reply to agent's stop/approval message |
| See agent status | `/status` → tap session button |
| Approve/deny permissions | Normal approval flow (buttons or text reply) |
| See agent output | Stop hook summary (sent automatically when agent pauses) |
| Continue after stop | Tap "Continue" or reply with instructions |

Free-text messages (not replies, not commands) still go to the first Claude pane. To target a specific spawned agent, use `/send` or reply to one of its messages.

## 15.6 Configuration

### `orchestrator.yaml` — `spawn` section

```yaml
spawn:
  searchPaths:
    - ~/dev
    - ~/projects
```

### Schema

| Field | Type | Default | Description |
|---|---|---|---|
| `searchPaths` | string[] | `[]` | Directories to search when resolving path arguments. Each path may use `~` for home directory. Only subdirectories of these paths can be targeted. |

If `searchPaths` is empty, the `/new` command replies with "Spawn not configured. Add searchPaths to orchestrator.yaml."

## 15.7 Implementation Scope

### New files

| File | Purpose |
|---|---|
| `src/spawn.ts` | Path resolution logic (`resolvePath`, `spawnAgent`) |

### Modified files

| File | Change |
|---|---|
| `src/telegram/bot.ts` | Add `/new` command handler + disambiguation callback |
| `src/tmux.ts` | Add `createWindow(path, name)` function |
| `src/config/types.ts` | Add `SpawnConfigSchema` to orchestrator config |
| `config/orchestrator.yaml` | Add `spawn` section |

### Not in scope (v1)

- Live output streaming (agent output only visible via stop hook summaries)
- Agent-to-agent communication
- Automatically killing spawned agents
- `/kill` command to stop a specific agent

## Cross-References

- Tmux functions: [Session Management](07-session-management.md)
- Stop flow and conversation: [Stop Handling](05-stop-handling.md), [Telegram Integration](06-telegram.md)
- Configuration schema: [Configuration](09-configuration.md)
- Session lifecycle hooks: [Session Management](07-session-management.md)
