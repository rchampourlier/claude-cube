import type { StopConfig } from "../config/types.js";
import type { SessionTracker } from "../session-tracker.js";
import type { ApprovalManager } from "../telegram/approval.js";
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

    // Prevent infinite loops — if this stop was triggered by a previous block, let it stop
    if (stopHookActive) {
      log.info("Stop hook active flag set, letting stop through", { sessionId });
      return {};
    }

    log.info("Stop hook fired", { sessionId });

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
        log.info("Agent appears to have errored, forcing continue", { sessionId, retry: count + 1 });
        return {
          decision: "block",
          reason: "The previous approach hit an error. Try a different approach to accomplish the task.",
        };
      }
      log.info("Max retries reached, letting stop through", { sessionId, maxRetries: config.maxRetries });
      retryCount.delete(sessionId);
      return {};
    }

    // Heuristic: did the agent ask a question (but not finish)?
    const looksLikeQuestion = /\?$|\bshould I\b|\bwould you like\b|\bdo you want/i.test(lastMessage.trim());

    if (looksLikeQuestion && config.escalateToTelegram && approvalManager) {
      log.info("Agent stopped with a question, forwarding to Telegram", { sessionId });

      // Send the actual question to Telegram and wait for a reply
      const result = await approvalManager.requestStopDecision(sessionId, lastMessage);

      if (result.approved) {
        // If the human replied with text, use that as the answer
        if (result.policyText) {
          return {
            decision: "block",
            reason: `The user answered your question: ${result.policyText}`,
          };
        }
        // Simple "Continue" button press
        return {
          decision: "block",
          reason: "The user wants you to continue with the task.",
        };
      }
      return {};
    }

    // Otherwise let the agent stop normally
    retryCount.delete(sessionId);
    return {};
  };
}
