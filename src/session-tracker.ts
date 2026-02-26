import { resolveLabel, listClaudePanes, findPaneForCwd } from "./tmux.js";
import { createLogger } from "./util/logger.js";

const log = createLogger("session-tracker");

export type SessionState = "active" | "idle" | "permission_pending";

export interface SessionInfo {
  sessionId: string;
  cwd: string;
  startedAt: string;
  state: SessionState;
  lastToolName: string | null;
  lastActivity: number;
  denialCount: number;
  /** Human-readable label, e.g. "main:claude-cube" from tmux window name */
  label: string;
  /** tmux pane ID (e.g. "%73"), captured at registration time */
  paneId: string | null;
}

export class SessionTracker {
  private sessions = new Map<string, SessionInfo>();

  register(sessionId: string, cwd: string): void {
    const tmuxLabel = resolveLabel(cwd);
    const label = tmuxLabel ?? sessionId.slice(0, 12);
    this.sessions.set(sessionId, {
      sessionId,
      cwd,
      startedAt: new Date().toISOString(),
      state: "active",
      lastToolName: null,
      lastActivity: Date.now(),
      denialCount: 0,
      label,
      paneId: findPaneForCwd(cwd),
    });
    log.info("Session registered", { sessionId, label, cwd });
  }

  deregister(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    log.info("Session deregistered", { sessionId, label: session?.label });
    this.sessions.delete(sessionId);
  }

  get(sessionId: string): SessionInfo | undefined {
    return this.sessions.get(sessionId);
  }

  getAll(): SessionInfo[] {
    return Array.from(this.sessions.values());
  }

  /** Get the human-readable label for a session, falling back to truncated ID. */
  getLabel(sessionId: string): string {
    return this.sessions.get(sessionId)?.label ?? sessionId.slice(0, 12);
  }

  /** Get the tmux pane ID for a session, if known. */
  getPaneId(sessionId: string): string | null {
    return this.sessions.get(sessionId)?.paneId ?? null;
  }

  /**
   * Discover existing Claude tmux panes and register them as synthetic sessions.
   * Called at startup so /status and /panes reflect existing sessions immediately.
   */
  registerFromTmux(): void {
    const panes = listClaudePanes();
    for (const pane of panes) {
      const syntheticId = `tmux_${pane.paneId}`;
      if (!this.findByCwd(pane.paneCwd)) {
        this.sessions.set(syntheticId, {
          sessionId: syntheticId,
          cwd: pane.paneCwd,
          startedAt: new Date().toISOString(),
          state: "active",
          lastToolName: null,
          lastActivity: Date.now(),
          denialCount: 0,
          label: pane.windowName,
          paneId: pane.paneId,
        });
        log.info("Registered tmux pane as synthetic session", { paneId: pane.paneId, label: pane.windowName });
      }
    }
  }

  /** Find a session by its cwd. */
  findByCwd(cwd: string): SessionInfo | undefined {
    for (const session of this.sessions.values()) {
      if (session.cwd === cwd) return session;
    }
    return undefined;
  }

  /**
   * Auto-register a session if it's not already tracked.
   * If a synthetic tmux session exists with the same cwd, merge into the real session.
   */
  ensureRegistered(sessionId: string, cwd: string): void {
    if (this.sessions.has(sessionId)) return;

    // Check for a synthetic session with the same cwd to merge
    const existing = this.findByCwd(cwd);
    if (existing && existing.sessionId.startsWith("tmux_")) {
      // Merge: transfer label, startedAt, denialCount from synthetic
      this.sessions.delete(existing.sessionId);
      this.sessions.set(sessionId, {
        ...existing,
        sessionId,
      });
      log.info("Merged synthetic session into real", { sessionId, syntheticId: existing.sessionId, label: existing.label });
      return;
    }

    this.register(sessionId, cwd);
    log.info("Auto-registered unknown session", { sessionId });
  }

  updateState(sessionId: string, state: SessionState): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.state = state;
      session.lastActivity = Date.now();
    }
  }

  updateToolUse(sessionId: string, toolName: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.lastToolName = toolName;
      session.lastActivity = Date.now();
      session.state = "active";
    }
  }

  recordDenial(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.denialCount++;
    }
  }

  get count(): number {
    return this.sessions.size;
  }
}
