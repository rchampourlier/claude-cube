# 7. Session Management

ClaudeCube tracks all active Claude Code sessions in memory, providing state management, human-readable labeling via tmux, and lifecycle event handling.

## 7.1 Session Tracker

The `SessionTracker` class (`src/session-tracker.ts`) is an in-memory registry of active sessions.

### Session Model

```typescript
type SessionState = "active" | "idle" | "permission_pending";

interface SessionInfo {
  sessionId: string;
  cwd: string;
  startedAt: string;           // ISO 8601
  state: SessionState;
  lastToolName: string | null;
  lastActivity: number;        // Date.now() timestamp
  denialCount: number;
  label: string;               // e.g., tmux window name or truncated session ID
}
```

### API

```typescript
class SessionTracker {
  register(sessionId: string, cwd: string): void;
  deregister(sessionId: string): void;
  get(sessionId: string): SessionInfo | undefined;
  getAll(): SessionInfo[];
  getLabel(sessionId: string): string;
  ensureRegistered(sessionId: string, cwd: string): void;
  updateState(sessionId: string, state: SessionState): void;
  updateToolUse(sessionId: string, toolName: string): void;
  recordDenial(sessionId: string): void;
  get count(): number;
}
```

### Registration

`register()` calls `resolveLabel(cwd)` from the tmux module to find the tmux window name for the session's working directory. If no tmux match is found, falls back to the first 12 characters of the session ID.

### Auto-Registration

`ensureRegistered()` is called by the PreToolUse and Stop handlers on every invocation. If the session is not already tracked (e.g., after a server restart where the `SessionStart` event was missed), it automatically registers the session. This provides resilience against missed lifecycle events.

### State Machine

| State | Meaning |
|---|---|
| `active` | Session is operating normally |
| `idle` | Session is not actively using tools (not currently set anywhere) |
| `permission_pending` | A tool call is waiting for a permission decision |

### Design Pattern

**Registry Pattern** -- an in-memory store keyed by session ID with CRUD operations and query capabilities.

### Constraints

- All state is in-memory. Session data is lost on server restart.
- The `label` is resolved once at registration time and never updated.
- `updateState`, `updateToolUse`, and `recordDenial` silently no-op if the session ID is not found.

## 7.2 Tmux Integration

The `src/tmux.ts` module bridges Claude Code sessions with the tmux terminal multiplexer.

### Types

```typescript
interface TmuxPane {
  sessionName: string;
  windowIndex: string;
  windowName: string;
  paneIndex: string;
  paneId: string;
  paneCwd: string;
  command: string;
}
```

### Functions

#### `listClaudePanes(): TmuxPane[]`

Lists all tmux panes running a `claude` command across all sessions.

**Implementation**: Executes `tmux list-panes -a -F '...'` via `execSync` (5-second timeout), parses the pipe-delimited output, and filters to panes where `command` matches `"claude"`.

**Error handling**: Returns `[]` on any error (tmux not running, timeout, etc.).

#### `resolveLabel(cwd: string): string | null`

Finds the tmux window name for a pane running Claude in the given working directory.

**Implementation**: Calls `listClaudePanes()` and finds the first pane where `paneCwd === cwd` (exact match).

**Returns**: The `windowName` string, or `null` if no match.

#### `sendKeys(paneTarget: string, text: string): void`

Sends text to a specific tmux pane, simulating keyboard input followed by Enter.

**Implementation**: Executes `tmux send-keys -t <target> <text> Enter` via `execSync`.

**Throws**: `Error` if the tmux command fails.

### Constraints

- All tmux operations are synchronous (`execSync` with 5-second timeout).
- `resolveLabel` uses exact string matching on `paneCwd`. Symlinks or trailing slashes cause mismatches.
- If multiple Claude panes share the same `paneCwd`, `resolveLabel` returns the first match.
- If tmux is not installed or not running, all functions fail gracefully.

## 7.3 Startup Session Discovery

At startup, ClaudeCube scans tmux for already-running Claude sessions, so it can immediately list and interact with them without waiting for hook events.

### Mechanism

1. On server start (after HTTP server + Telegram bot are ready), call `listClaudePanes()` to find all tmux panes running `claude`.
2. For each discovered pane, register a session in the `SessionTracker` using the pane's `paneCwd` as the working directory.
3. The label is resolved from the tmux window name (same as hook-based registration).
4. These pre-registered sessions appear in `/status` and `/panes` immediately.

### Enrichment on First Hook

When a discovered session fires its first hook event (e.g., `PreToolUse`), the `ensureRegistered()` call updates the session with the actual `session_id` from Claude Code, replacing the synthetic one created at scan time.

### Design Properties

- **Idempotent**: If a session is already registered (e.g., from a hook event that raced with startup scanning), the scan does not duplicate it. Matching is by `paneCwd`.
- **Best-effort**: If tmux is not running or no Claude panes exist, the scan completes silently with zero registrations.
- **Synthetic session IDs**: Sessions discovered via scanning use a synthetic ID (e.g., `tmux_<paneId>`) until their first hook event provides the real Claude Code session ID.

## 7.4 Session Lifecycle Hooks

Three lifecycle hook handlers are created via factory functions in `src/hooks/lifecycle.ts`.

### SessionStart Handler

```typescript
createSessionStartHandler(sessionTracker, notifications)
  --> register session in tracker
  --> send Telegram notification (if configured)
  --> return {}
```

### SessionEnd Handler

```typescript
createSessionEndHandler(sessionTracker, notifications)
  --> deregister session from tracker
  --> send Telegram notification (if configured)
  --> return {}
```

### Notification Handler

```typescript
createNotificationHandler(sessionTracker)
  --> update session activity timestamp
  --> return {}
```

Note: The Notification handler does NOT use a `NotificationManager`. Claude Code's Notification events are used purely as heartbeats to keep the `lastActivity` timestamp current.

All lifecycle handlers return empty objects -- they never instruct Claude Code to change behavior.

## Cross-References

- The session tracker is used by the [PreToolUse handler](03-permission-evaluation.md) for state management and label resolution.
- The session tracker is used by the [Stop handler](05-stop-handling.md) for auto-registration.
- Tmux integration is used by the [Telegram bot](06-telegram.md) for pane listing and remote control.
- Session notifications are sent via the [Notification Manager](06-telegram.md).
- Session state is exposed via the `GET /status` endpoint (see [Infrastructure](10-infrastructure.md)).
