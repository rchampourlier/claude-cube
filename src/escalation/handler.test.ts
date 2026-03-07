import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { EscalationHandler } from "./handler.js";
import type { ApprovalResult } from "../telegram/approval.js";

describe("EscalationHandler", () => {
  describe("label propagation to Telegram", () => {
    it("passes session label (not session ID) to requestApproval", async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let capturedContext: any = null;

      // Minimal config
      const config = {
        evaluatorModel: "claude-haiku-4-5-20251001",
        confidenceThreshold: 0.8,
        telegramTimeoutSeconds: 300,
      };

      // Mock approval manager that captures the context
      const mockApprovalManager = {
        requestApproval: mock.fn(
          async (
            _toolName: string,
            _toolInput: Record<string, unknown>,
            context: Record<string, unknown>,
          ): Promise<ApprovalResult> => {
            capturedContext = context;
            return { approved: true, reason: "Approved via Telegram" };
          },
        ),
      };

      const handler = new EscalationHandler(
        config,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        mockApprovalManager as any,
        null, // policyStore
        null, // costTracker
      );

      // Monkey-patch the LLM evaluator to return uncertain result (forces Telegram escalation)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (handler as any).evaluator = {
        evaluate: async () => ({
          allowed: false,
          confident: false,
          reason: "uncertain about this tool call",
        }),
      };

      const sessionLabel = "main:claude-cube";
      const sessionId = "a04caae5-86f4-1e8c-9abc-def012345678";

      await handler.evaluate("Bash", { command: "ls" }, {
        agentId: sessionId,
        cwd: "/Users/testuser/dev/claude-cube",
        paneId: "%42",
        label: sessionLabel,
        rulesContext: "No rule matched",
        escalationReason: "default escalation",
      });

      assert.ok(capturedContext, "requestApproval should have been called");
      assert.equal(
        capturedContext!.label,
        sessionLabel,
        "requestApproval must receive the session label, not the session ID",
      );
      assert.notEqual(
        capturedContext!.label,
        sessionId.slice(0, 12),
        "label must not be the truncated session ID",
      );
    });
  });
});
