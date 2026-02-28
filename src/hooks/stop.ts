import type { StopConfig } from "../config/types.js";
import type { SessionTracker } from "../session-tracker.js";
import type { ApprovalManager } from "../telegram/approval.js";
import { readTranscript, extractRecentTools, summarizeTranscript } from "../transcript/index.js";
import { createLogger } from "../util/logger.js";

const log = createLogger("stop-hook");

export interface StopInput {
  hook_event_name: "Stop";
  session_id: string;
  cwd: string;
  transcript_path: string;
  stop_hook_active?: boolean;
  last_assistant_message?: string;
}

export interface StopResponse {
  decision?: "block";
  reason?: string;
}

// Track retries per session to enforce maxRetries
const retryCount = new Map<string, number>();

export function createStopHandler(
  config: StopConfig,
  sessionTracker: SessionTracker,
  approvalManager: ApprovalManager | null,
) {
  return async (input: StopInput): Promise<StopResponse> => {
    const { session_id: sessionId, stop_hook_active: stopHookActive, last_assistant_message: lastMessage } = input;

    sessionTracker.ensureRegistered(sessionId, input.cwd, input.transcript_path);
    const label = sessionTracker.getLabel(sessionId);

    // Prevent infinite loops — if this stop was triggered by a previous block, let it stop
    if (stopHookActive) {
      log.info("Stop hook active flag set, letting stop through", undefined, label);
      return {};
    }

    log.info("Stop hook fired", undefined, label);

    if (!lastMessage) {
      return {};
    }

    // Heuristic: did the agent give up on an error?
    const looksLikeError = /error|failed|cannot|unable|exception|traceback/i.test(lastMessage)
      && !/successfully|completed|fixed|resolved/i.test(lastMessage);

    if (looksLikeError && config.retryOnError) {
      const count = retryCount.get(sessionId) ?? 0;
      if (count < config.maxRetries) {
        retryCount.set(sessionId, count + 1);
        log.info("Agent errored, forcing continue", { retry: count + 1 }, label);
        return {
          decision: "block",
          reason: "The previous approach hit an error. Try a different approach to accomplish the task.",
        };
      }
      log.info("Max retries reached, falling through to transcript analysis", undefined, label);
      retryCount.delete(sessionId);
      // Fall through to transcript analysis + Telegram below
    }

    // All stops (after retry exhaustion, questions, normal) go through transcript analysis + Telegram
    if (config.escalateToTelegram && approvalManager) {
      log.info("Escalating stop to Telegram with transcript analysis", undefined, label);

      // Attempt transcript analysis — graceful degradation on failure
      let summary: string | undefined;
      let recentTools: string | undefined;
      const transcriptPath = sessionTracker.getTranscriptPath(sessionId);

      if (transcriptPath) {
        try {
          const excerpt = readTranscript(transcriptPath, 15);
          recentTools = extractRecentTools(excerpt) || undefined;
          try {
            summary = await summarizeTranscript(excerpt);
          } catch (e) {
            log.warn("Transcript summarization failed, continuing without summary", { error: String(e) });
          }
        } catch (e) {
          log.warn("Transcript reading failed, continuing without analysis", { error: String(e) });
        }
      }

      const result = await approvalManager.requestStopDecision(
        sessionId,
        lastMessage,
        label,
        input.cwd,
        sessionTracker.getPaneId(sessionId),
        { summary, recentTools },
      );

      if (result.approved) {
        if (result.policyText) {
          return {
            decision: "block",
            reason: `The user answered your question: ${result.policyText}`,
          };
        }
        return {
          decision: "block",
          reason: "The user wants you to continue with the task.",
        };
      }
      return {};
    }

    // No Telegram — let the agent stop normally
    retryCount.delete(sessionId);
    return {};
  };
}
