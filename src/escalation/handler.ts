import { LlmEvaluator } from "./llm-evaluator.js";
import type { ApprovalManager, ApprovalResult } from "../telegram/approval.js";
import type { EscalationConfig } from "../config/types.js";
import { createLogger } from "../util/logger.js";

const log = createLogger("escalation-handler");

export interface EscalationDecision {
  allowed: boolean;
  reason: string;
  decidedBy: "llm" | "telegram" | "timeout";
}

export class EscalationHandler {
  private evaluator: LlmEvaluator;

  constructor(
    private config: EscalationConfig,
    private approvalManager: ApprovalManager | null,
  ) {
    this.evaluator = new LlmEvaluator(
      config.evaluatorModel,
      config.confidenceThreshold,
    );
  }

  async evaluate(
    toolName: string,
    toolInput: Record<string, unknown>,
    context: {
      agentId: string;
      rulesContext: string;
      escalationReason: string;
    },
  ): Promise<EscalationDecision> {
    // Step 1: Try LLM evaluator
    log.info("Running LLM evaluation", { toolName, agentId: context.agentId });
    const llmResult = await this.evaluator.evaluate(
      toolName,
      toolInput,
      context.rulesContext,
      context.escalationReason,
    );

    if (llmResult.confident) {
      log.info("LLM confident decision", {
        toolName,
        allowed: llmResult.allowed,
        reason: llmResult.reason,
      });
      return {
        allowed: llmResult.allowed,
        reason: `LLM: ${llmResult.reason}`,
        decidedBy: "llm",
      };
    }

    // Step 2: LLM uncertain → escalate to Telegram
    if (!this.approvalManager) {
      log.warn("No Telegram approval manager; denying by default", { toolName });
      return {
        allowed: false,
        reason: "LLM uncertain and no Telegram available; denied by default",
        decidedBy: "timeout",
      };
    }

    log.info("LLM uncertain, escalating to Telegram", { toolName, agentId: context.agentId });
    const telegramResult: ApprovalResult = await this.approvalManager.requestApproval(
      toolName,
      toolInput,
      {
        agentId: context.agentId,
        reason: `LLM uncertain: ${llmResult.reason}`,
      },
    );

    return {
      allowed: telegramResult.approved,
      reason: telegramResult.reason,
      decidedBy: telegramResult.reason.includes("timed out") ? "timeout" : "telegram",
    };
  }
}
