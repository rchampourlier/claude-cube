import type { HookInput, HookJSONOutput } from "@anthropic-ai/claude-code";
import type { RuleEngine } from "../rule-engine/engine.js";
import type { EscalationHandler } from "../escalation/handler.js";
import type { AuditLog } from "./audit-hook.js";
import { createLogger } from "../util/logger.js";

const log = createLogger("permission-hook");

export function createPermissionHook(
  ruleEngine: RuleEngine,
  escalationHandler: EscalationHandler,
  auditLog: AuditLog,
  agentId: string,
) {
  return async (
    input: HookInput,
    _toolUseId: string | undefined,
    _options: { signal: AbortSignal },
  ): Promise<HookJSONOutput> => {
    // Only handle PreToolUse events
    if (input.hook_event_name !== "PreToolUse") {
      return {};
    }

    const toolName = input.tool_name;
    const toolInput = (input.tool_input ?? {}) as Record<string, unknown>;

    log.info("PreToolUse hook fired", { toolName, agentId });

    // Step 1: Rule engine evaluation
    const result = ruleEngine.evaluate(toolName, toolInput);

    if (result.action === "allow") {
      auditLog.log({
        agentId,
        toolName,
        toolInput,
        decision: "allow",
        reason: result.reason,
        decidedBy: "rule",
        ruleName: result.rule?.name,
      });
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
        agentId,
        toolName,
        toolInput,
        decision: "deny",
        reason: result.reason,
        decidedBy: "rule",
        ruleName: result.rule?.name,
      });
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

    // Step 2: Escalation (LLM → Telegram)
    const rulesContext = result.rule
      ? `Matched rule: ${result.rule.name} (${result.rule.action})`
      : "No rule matched";

    const escalationResult = await escalationHandler.evaluate(
      toolName,
      toolInput,
      {
        agentId,
        rulesContext,
        escalationReason: result.reason,
      },
    );

    const decision = escalationResult.allowed ? "allow" : "deny";
    auditLog.log({
      agentId,
      toolName,
      toolInput,
      decision,
      reason: escalationResult.reason,
      decidedBy: escalationResult.decidedBy,
      ruleName: result.rule?.name,
    });

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
