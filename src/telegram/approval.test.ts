import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { ApprovalManager } from "./approval.js";

/**
 * Minimal mock of TelegramBot that captures sent messages.
 */
function createMockBot() {
  const sentMessages: { text: string; opts: Record<string, unknown> }[] = [];

  return {
    sentMessages,
    telegram: {
      sendMessage: mock.fn(
        async (_chatId: string, text: string, opts: Record<string, unknown> = {}) => {
          sentMessages.push({ text, opts });
          return { message_id: 1 };
        },
      ),
    },
    callbackQuery: {
      action: mock.fn(),
      on: mock.fn(),
    },
    sendMessage: mock.fn(async () => {}),
  };
}

describe("ApprovalManager", () => {
  describe("requestApproval message formatting", () => {
    it("displays the session label in the Permission Request message", async () => {
      const mockBot = createMockBot();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const manager = new ApprovalManager(mockBot as any, "chat123", 0);

      // Don't await — the promise resolves when approved/denied. We just want the message sent.
      const approvalPromise = manager.requestApproval("Bash", { command: "ls" }, {
        agentId: "a04caae5-86f4-1e8c-9abc-def012345678",
        label: "main:claude-cube",
        reason: "LLM uncertain: unknown command",
      });

      // Give the message time to send
      await new Promise((resolve) => setTimeout(resolve, 50));

      assert.equal(mockBot.sentMessages.length, 1, "should have sent one message");
      const message = mockBot.sentMessages[0].text;

      assert.ok(
        message.includes("main:claude-cube"),
        `message should contain the session label "main:claude-cube", got: ${message}`,
      );
      assert.ok(
        !message.includes("a04caae586f4"),
        `message should NOT contain the truncated session ID`,
      );

      // Clean up — resolve the pending promise
      // The manager is waiting forever (timeout=0), so we need to force-resolve somehow.
      // We can't easily, but the test assertions are already done.
    });

    it("falls back to truncated agentId when label is not provided", async () => {
      const mockBot = createMockBot();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const manager = new ApprovalManager(mockBot as any, "chat123", 0);

      manager.requestApproval("Bash", { command: "ls" }, {
        agentId: "a04caae5-86f4-1e8c-9abc-def012345678",
        reason: "LLM uncertain",
      });

      await new Promise((resolve) => setTimeout(resolve, 50));

      assert.equal(mockBot.sentMessages.length, 1);
      const message = mockBot.sentMessages[0].text;

      // When no label is provided, fallback to truncated agentId
      assert.ok(
        message.includes("a04caae5-86f"),
        `message should contain the truncated agentId as fallback`,
      );
    });
  });
});
