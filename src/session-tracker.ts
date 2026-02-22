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
}

export class SessionTracker {
  private sessions = new Map<string, SessionInfo>();

  register(sessionId: string, cwd: string): void {
    this.sessions.set(sessionId, {
      sessionId,
      cwd,
      startedAt: new Date().toISOString(),
      state: "active",
      lastToolName: null,
      lastActivity: Date.now(),
      denialCount: 0,
    });
    log.info("Session registered", { sessionId, cwd });
  }

  deregister(sessionId: string): void {
    this.sessions.delete(sessionId);
    log.info("Session deregistered", { sessionId });
  }

  get(sessionId: string): SessionInfo | undefined {
    return this.sessions.get(sessionId);
  }

  getAll(): SessionInfo[] {
    return Array.from(this.sessions.values());
  }

  /** Auto-register a session if it's not already tracked (e.g. after server restart). */
  ensureRegistered(sessionId: string, cwd: string): void {
    if (!this.sessions.has(sessionId)) {
      this.register(sessionId, cwd);
      log.info("Auto-registered unknown session", { sessionId });
    }
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
