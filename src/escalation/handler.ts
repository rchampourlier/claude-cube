import { LlmEvaluator } from "./llm-evaluator.js";
import type { ApprovalManager, ApprovalResult } from "../telegram/approval.js";
import type { PolicyStore } from "../policies/store.js";
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
    private policyStore: PolicyStore | null = null,
  ) {
    this.evaluator = new LlmEvaluator(
      config.evaluatorModel,
      config.confidenceThreshold,
      policyStore,
    );
  }

  async evaluate(
    toolName: string,
    toolInput: Record<string, unknown>,
    context: {
      agentId: string;
      label?: string;
      rulesContext: string;
      escalationReason: string;
    },
  ): Promise<EscalationDecision> {
    // Step 1: Try LLM evaluator
    const label = context.label ?? context.agentId.slice(0, 12);
    log.info(`[${label}] Running LLM evaluation`, { toolName });
    const llmResult = await this.evaluator.evaluate(
      toolName,
      toolInput,
      context.rulesContext,
      context.escalationReason,
    );

    if (llmResult.confident) {
      log.info(`[${label}] LLM confident decision`, {
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

    log.info(`[${label}] LLM uncertain, escalating to Telegram`, { toolName });
    const telegramResult: ApprovalResult = await this.approvalManager.requestApproval(
      toolName,
      toolInput,
      {
        agentId: context.agentId,
        label: context.label,
        reason: `LLM uncertain: ${llmResult.reason}`,
      },
    );

    // If the human replied with policy text, save it
    if (telegramResult.policyText && this.policyStore) {
      const policy = this.policyStore.add(telegramResult.policyText, toolName);
      log.info("Policy created from Telegram reply", {
        policyId: policy.id,
        tool: toolName,
        description: telegramResult.policyText.slice(0, 80),
      });
    }

    return {
      allowed: telegramResult.approved,
      reason: telegramResult.reason,
      decidedBy: telegramResult.reason.includes("timed out") ? "timeout" : "telegram",
    };
  }
}
