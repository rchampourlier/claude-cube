import type { SessionTracker } from "../session-tracker.js";
import type { NotificationManager } from "../telegram/notifications.js";
import { createLogger } from "../util/logger.js";

const log = createLogger("lifecycle-hook");

export interface SessionStartInput {
  hook_event_name: "SessionStart";
  session_id: string;
  cwd: string;
  transcript_path: string;
}

export interface SessionEndInput {
  hook_event_name: "SessionEnd";
  session_id: string;
  cwd: string;
  transcript_path: string;
}

export interface NotificationInput {
  hook_event_name: "Notification";
  session_id: string;
  cwd: string;
  message?: string;
  title?: string;
}

export function createSessionStartHandler(
  sessionTracker: SessionTracker,
  notifications: NotificationManager | null,
) {
  return async (input: SessionStartInput): Promise<Record<string, never>> => {
    const { session_id: sessionId, cwd, transcript_path: transcriptPath } = input;
    log.info("SessionStart", { sessionId, cwd });
    sessionTracker.register(sessionId, cwd, transcriptPath);
    await notifications?.sessionStarted(sessionId, cwd);
    return {};
  };
}

export function createSessionEndHandler(
  sessionTracker: SessionTracker,
  notifications: NotificationManager | null,
) {
  return async (input: SessionEndInput): Promise<Record<string, never>> => {
    const { session_id: sessionId } = input;
    log.info("SessionEnd", { sessionId });
    sessionTracker.deregister(sessionId);
    await notifications?.sessionEnded(sessionId);
    return {};
  };
}

export function createNotificationHandler(
  sessionTracker: SessionTracker,
) {
  return async (input: NotificationInput): Promise<Record<string, never>> => {
    const { session_id: sessionId, message } = input;
    log.debug("Notification", { sessionId, message: message?.slice(0, 100) });
    // Update activity timestamp
    sessionTracker.updateState(sessionId, "active");
    return {};
  };
}
