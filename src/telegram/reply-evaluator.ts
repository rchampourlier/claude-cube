import Anthropic from "@anthropic-ai/sdk";
import { createLogger } from "../util/logger.js";

const log = createLogger("reply-evaluator");

export type ReplyIntent = "approve" | "deny" | "forward" | "add_rule";

export interface ReplyEvaluation {
  intent: ReplyIntent;
  /** For "forward" intent: the text to forward to the agent */
  forwardText?: string;
  /** For "add_rule" intent: YAML snippet to append to rules file */
  ruleYaml?: string;
}

const SYSTEM_PROMPT = `You classify the intent of a human's text reply to a tool approval request from an automated coding agent.

The human replied to a Telegram notification asking whether to approve or deny a tool call. Based on their text, determine what they want:

1. "approve" — the reply indicates approval (e.g., "yes", "ok", "go ahead", "approved", "sure")
2. "deny" — the reply indicates denial (e.g., "no", "deny", "don't do that", "block", "stop")
3. "forward" — the reply contains instructions or context to send to the agent (e.g., "use X instead", "try a different approach", any substantive instruction)
4. "add_rule" — the reply explicitly asks to add a rule. Must contain a directive like "add rule:", "new rule:", or "- add rule:". Extract the rule and generate YAML.

For "forward", set forwardText to the relevant text to send to the agent.

For "add_rule", generate a YAML rule snippet compatible with this format:
  - name: "Rule name"
    action: allow|deny
    tool: ToolName
    match:
      field_name:
        - pattern: "regex_pattern"
          type: regex
    reason: "Why"

Respond with JSON only:
{
  "intent": "approve" | "deny" | "forward" | "add_rule",
  "forwardText": "...",   // only for "forward"
  "ruleYaml": "..."       // only for "add_rule"
}`;

export class ReplyEvaluator {
  private client: Anthropic;

  constructor(private model: string = "claude-haiku-4-5-20251001") {
    this.client = new Anthropic();
  }

  async evaluateReply(
    replyText: string,
    context: { toolName: string; label: string },
  ): Promise<ReplyEvaluation> {
    const userMessage = [
      `The human replied to an approval request for tool "${context.toolName}" in session "${context.label}".`,
      ``,
      `Their reply:`,
      `"${replyText}"`,
    ].join("\n");

    try {
      log.info("Evaluating reply intent", { toolName: context.toolName, text: replyText.slice(0, 100) });

      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 512,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userMessage }],
      });

      const text =
        response.content[0]?.type === "text" ? response.content[0].text : "";

      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        log.warn("Reply evaluator response did not contain JSON", { text });
        return { intent: "approve" };
      }

      const parsed = JSON.parse(jsonMatch[0]) as {
        intent?: string;
        forwardText?: string;
        ruleYaml?: string;
      };

      const intent = (["approve", "deny", "forward", "add_rule"].includes(parsed.intent ?? "")
        ? parsed.intent
        : "approve") as ReplyIntent;

      return {
        intent,
        forwardText: parsed.forwardText,
        ruleYaml: parsed.ruleYaml,
      };
    } catch (e) {
      log.error("Reply evaluation failed", { error: String(e) });
      return { intent: "approve" };
    }
  }
}
