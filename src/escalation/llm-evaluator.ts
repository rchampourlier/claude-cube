import Anthropic from "@anthropic-ai/sdk";
import type { PolicyStore } from "../policies/store.js";
import type { CostTracker } from "../costs/tracker.js";
import { createLogger } from "../util/logger.js";

const log = createLogger("llm-evaluator");

export interface LlmEvaluationResult {
  allowed: boolean;
  confident: boolean;
  reason: string;
}

const SYSTEM_PROMPT = `You are a security evaluator for an automated coding agent. You evaluate whether a tool call should be allowed or denied based on safety rules and human-defined policies.

You will receive:
- The tool name and its input
- The safety rules context
- The reason this was escalated
- Any human-defined policies that apply

Respond with a JSON object:
{
  "allowed": boolean,      // true if the tool call should be allowed
  "confident": boolean,    // true if you are confident in your decision (>80% sure)
  "reason": string         // brief explanation
}

Guidelines:
- Read-only operations are generally safe
- File edits within the project's src/ directory are generally safe
- Commands that could modify system state, delete files, or affect git history should be treated cautiously
- Human-defined policies take precedence over your own judgment — if a policy clearly covers this case, follow it and set confident=true
- When in doubt, set confident=false to escalate to a human`;

export class LlmEvaluator {
  private client: Anthropic;

  constructor(
    private model: string,
    private confidenceThreshold: number,
    private policyStore: PolicyStore | null = null,
    private costTracker: CostTracker | null = null,
  ) {
    this.client = new Anthropic();
  }

  async evaluate(
    toolName: string,
    toolInput: Record<string, unknown>,
    rulesContext: string,
    escalationReason: string,
  ): Promise<LlmEvaluationResult> {
    const policiesContext = this.policyStore?.formatForLlm(toolName) ?? "";

    const userMessage = [
      `Tool: ${toolName}`,
      `Input: ${JSON.stringify(toolInput, null, 2)}`,
      ``,
      `Rules context:`,
      rulesContext,
      ``,
      `Escalation reason: ${escalationReason}`,
      ...(policiesContext ? [``, policiesContext] : []),
    ].join("\n");

    try {
      log.info("Evaluating with LLM", { toolName, model: this.model, policyCount: this.policyStore?.getAll().length ?? 0 });

      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 256,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userMessage }],
      });

      this.costTracker?.record(this.model, "tool-eval", response.usage);

      const text =
        response.content[0]?.type === "text" ? response.content[0].text : "";

      // Parse JSON from response
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        log.warn("LLM response did not contain JSON", { text });
        return { allowed: false, confident: false, reason: "LLM response unparseable" };
      }

      const parsed = JSON.parse(jsonMatch[0]) as {
        allowed?: boolean;
        confident?: boolean;
        reason?: string;
      };

      return {
        allowed: parsed.allowed === true,
        confident: parsed.confident === true,
        reason: parsed.reason ?? "No reason provided",
      };
    } catch (e) {
      log.error("LLM evaluation failed", { error: String(e) });
      return { allowed: false, confident: false, reason: `LLM evaluation error: ${e}` };
    }
  }
}
