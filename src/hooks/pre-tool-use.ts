import type { RuleEngine } from "../rule-engine/engine.js";
import type { EscalationHandler } from "../escalation/handler.js";
import type { AuditLog } from "./audit-hook.js";
import type { SessionTracker } from "../session-tracker.js";
import type { QuestionHandler } from "../telegram/question-handler.js";
import type { ModeManager } from "../mode.js";
import { alertUser, clearAlert } from "../notify.js";
import { createLogger } from "../util/logger.js";

const log = createLogger("pre-tool-use");

export interface PreToolUseInput {
  hook_event_name: "PreToolUse";
  tool_name: string;
  tool_input: Record<string, unknown>;
  session_id: string;
  cwd: string;
  transcript_path: string;
  tmux_pane?: string;
}

export interface PreToolUseResponse {
  decision?: "block" | "approve";
  reason?: string;
  hookSpecificOutput?: {
    hookEventName: "PreToolUse";
    permissionDecision: "allow" | "deny";
    permissionDecisionReason?: string;
  };
}

export function createPreToolUseHandler(
  getRuleEngine: () => RuleEngine,
  escalationHandler: EscalationHandler,
  auditLog: AuditLog,
  sessionTracker: SessionTracker,
  questionHandler: QuestionHandler | null = null,
  modeManager: ModeManager | null = null,
) {
  return async (input: PreToolUseInput): Promise<PreToolUseResponse> => {
    const { tool_name: toolName, tool_input: toolInput, session_id: sessionId } = input;

    const label = sessionTracker.getLabel(sessionId);
    log.info("PreToolUse", { toolName }, label);

    sessionTracker.ensureRegistered(sessionId, input.cwd, input.transcript_path, input.tmux_pane);
    sessionTracker.updateToolUse(sessionId, toolName);
    clearAlert(sessionTracker.getPaneId(sessionId));
    sessionTracker.updateState(sessionId, "permission_pending");

    // Step 0: AskUserQuestion early intercept (before rule engine)
    if (toolName === "AskUserQuestion") {
      if (modeManager?.isLocal()) {
        log.info("AskUserQuestion passthrough (local mode)", {}, label);
        sessionTracker.updateState(sessionId, "active");
        return {};
      }

      if (!questionHandler) {
        // No Telegram — passthrough to let the terminal handle it
        log.info("AskUserQuestion passthrough (no Telegram)", {}, label);
        sessionTracker.updateState(sessionId, "active");
        return {};
      }

      try {
        alertUser({ title: "Question from Claude", message: (toolInput.question as string)?.slice(0, 100) ?? "Question", paneId: sessionTracker.getPaneId(sessionId) });
        const answer = await questionHandler.handleQuestion(toolInput, {
          sessionId,
          label: label ?? sessionId.slice(0, 12),
        });
        clearAlert(sessionTracker.getPaneId(sessionId));

        auditLog.log({
          sessionId,
          toolName,
          toolInput,
          decision: "deny",
          reason: answer,
          decidedBy: "telegram-question",
        });

        sessionTracker.updateState(sessionId, "active");
        return {
          decision: "block",
          reason: answer,
        };
      } catch (e) {
        log.error("AskUserQuestion handler failed, passing through", { error: String(e) });
        sessionTracker.updateState(sessionId, "active");
        return {};
      }
    }

    // Step 1: Rule engine evaluation
    const result = getRuleEngine().evaluate(toolName, toolInput);

    if (result.action === "allow") {
      auditLog.log({
        sessionId,
        toolName,
        toolInput,
        decision: "allow",
        reason: result.reason,
        decidedBy: "rule",
        ruleName: result.rule?.name,
      });
      sessionTracker.updateState(sessionId, "active");
      return {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "allow",
          permissionDecisionReason: result.reason,
        },
      };
    }

    if (result.action === "deny") {
      auditLog.log({
        sessionId,
        toolName,
        toolInput,
        decision: "deny",
        reason: result.reason,
        decidedBy: "rule",
        ruleName: result.rule?.name,
      });
      sessionTracker.recordDenial(sessionId);
      sessionTracker.updateState(sessionId, "active");
      return {
        decision: "block",
        reason: result.reason,
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: result.reason,
        },
      };
    }

    // Step 2: Escalation (LLM -> Telegram)
    sessionTracker.updateState(sessionId, "permission_pending");

    const rulesContext = result.rule
      ? `Matched rule: ${result.rule.name} (${result.rule.action})`
      : "No rule matched";

    const escalationResult = await escalationHandler.evaluate(
      toolName,
      toolInput,
      {
        agentId: sessionId,
        cwd: input.cwd,
        paneId: sessionTracker.getPaneId(sessionId),
        label: sessionTracker.getLabel(sessionId),
        rulesContext,
        escalationReason: result.reason,
      },
    );

    // Passthrough: local mode — return {} to let terminal handle it
    if (escalationResult.decidedBy === "passthrough") {
      auditLog.log({
        sessionId,
        toolName,
        toolInput,
        decision: "allow",
        reason: escalationResult.reason,
        decidedBy: "passthrough",
        ruleName: result.rule?.name,
      });
      sessionTracker.updateState(sessionId, "active");
      return {};
    }

    const decision = escalationResult.allowed ? "allow" : "deny";
    auditLog.log({
      sessionId,
      toolName,
      toolInput,
      decision,
      reason: escalationResult.reason,
      decidedBy: escalationResult.decidedBy,
      ruleName: result.rule?.name,
    });

    if (!escalationResult.allowed) {
      sessionTracker.recordDenial(sessionId);
    }
    sessionTracker.updateState(sessionId, "active");

    return {
      decision: escalationResult.allowed ? "approve" : "block",
      reason: escalationResult.reason,
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: escalationResult.allowed ? "allow" : "deny",
        permissionDecisionReason: escalationResult.reason,
      },
    };
  };
}
