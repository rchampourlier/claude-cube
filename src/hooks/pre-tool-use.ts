import type { RuleEngine } from "../rule-engine/engine.js";
import type { EscalationHandler } from "../escalation/handler.js";
import type { AuditLog } from "./audit-hook.js";
import type { SessionTracker } from "../session-tracker.js";
import { createLogger } from "../util/logger.js";

const log = createLogger("pre-tool-use");

export interface PreToolUseInput {
  hook_event_name: "PreToolUse";
  tool_name: string;
  tool_input: Record<string, unknown>;
  session_id: string;
  cwd: string;
  transcript_path: string;
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
  ruleEngine: RuleEngine,
  escalationHandler: EscalationHandler,
  auditLog: AuditLog,
  sessionTracker: SessionTracker,
) {
  return async (input: PreToolUseInput): Promise<PreToolUseResponse> => {
    const { tool_name: toolName, tool_input: toolInput, session_id: sessionId } = input;

    const label = sessionTracker.getLabel(sessionId);
    log.info(`[${label}] PreToolUse`, { toolName });

    sessionTracker.ensureRegistered(sessionId, input.cwd);
    sessionTracker.updateToolUse(sessionId, toolName);
    sessionTracker.updateState(sessionId, "permission_pending");

    // Step 1: Rule engine evaluation
    const result = ruleEngine.evaluate(toolName, toolInput);

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
        label: sessionTracker.getLabel(sessionId),
        rulesContext,
        escalationReason: result.reason,
      },
    );

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
