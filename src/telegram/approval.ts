import { Markup } from "telegraf";
import type { TelegramBot } from "./bot.js";
import { createLogger } from "../util/logger.js";

const log = createLogger("telegram-approval");

interface PendingApproval {
  resolve: (result: ApprovalResult) => void;
  messageId?: number;
  toolName: string;
  createdAt: number;
}

export interface ApprovalResult {
  approved: boolean;
  reason: string;
}

export class ApprovalManager {
  private pending = new Map<string, PendingApproval>();
  private counter = 0;

  constructor(
    private bot: TelegramBot,
    private chatId: string,
    private timeoutMs: number = 300_000,
  ) {
    this.setupCallbackHandler();
  }

  private setupCallbackHandler(): void {
    this.bot.callbackQuery.action(/^approve:(.+)$/, async (ctx) => {
      const id = ctx.match[1];
      const pending = this.pending.get(id);
      if (!pending) {
        await ctx.answerCbQuery("Request expired or already handled.");
        return;
      }
      log.info("Approval received", { id, toolName: pending.toolName });
      this.pending.delete(id);

      pending.resolve({ approved: true, reason: "Approved via Telegram" });
      await ctx.answerCbQuery("Approved");

      // Edit message to show outcome
      if (pending.messageId) {
        const timestamp = new Date().toLocaleTimeString();
        await ctx.editMessageText(
          `${ctx.callbackQuery.message && "text" in ctx.callbackQuery.message ? ctx.callbackQuery.message.text : ""}\n\n✅ Approved at ${timestamp}`,
        );
      }
    });

    this.bot.callbackQuery.action(/^deny:(.+)$/, async (ctx) => {
      const id = ctx.match[1];
      const pending = this.pending.get(id);
      if (!pending) {
        await ctx.answerCbQuery("Request expired or already handled.");
        return;
      }
      log.info("Denial received", { id, toolName: pending.toolName });
      this.pending.delete(id);

      pending.resolve({ approved: false, reason: "Denied via Telegram" });
      await ctx.answerCbQuery("Denied");

      if (pending.messageId) {
        const timestamp = new Date().toLocaleTimeString();
        await ctx.editMessageText(
          `${ctx.callbackQuery.message && "text" in ctx.callbackQuery.message ? ctx.callbackQuery.message.text : ""}\n\n❌ Denied at ${timestamp}`,
        );
      }
    });
  }

  async requestApproval(
    toolName: string,
    toolInput: Record<string, unknown>,
    context: { agentId: string; reason: string },
  ): Promise<ApprovalResult> {
    const id = `req_${++this.counter}_${Date.now()}`;

    // Format the approval message
    const inputSummary = formatToolInput(toolName, toolInput);
    const message = [
      `🔔 *Permission Request*`,
      ``,
      `*Agent:* ${context.agentId}`,
      `*Tool:* \`${toolName}\``,
      `*Reason:* ${context.reason}`,
      ``,
      `\`\`\``,
      inputSummary,
      `\`\`\``,
    ].join("\n");

    const keyboard = Markup.inlineKeyboard([
      Markup.button.callback("✅ Approve", `approve:${id}`),
      Markup.button.callback("❌ Deny", `deny:${id}`),
    ]);

    const promise = new Promise<ApprovalResult>((resolve) => {
      this.pending.set(id, {
        resolve,
        toolName,
        createdAt: Date.now(),
      });
    });

    // Send message with inline keyboard
    try {
      const sent = await this.bot.telegram.sendMessage(
        this.chatId,
        message,
        { parse_mode: "Markdown", ...keyboard },
      );
      const entry = this.pending.get(id);
      if (entry) entry.messageId = sent.message_id;
    } catch (e) {
      log.error("Failed to send approval request", { error: String(e) });
      this.pending.delete(id);
      return { approved: false, reason: `Telegram send failed: ${e}` };
    }

    // Timeout handling
    const timeout = new Promise<ApprovalResult>((resolve) => {
      setTimeout(() => {
        if (this.pending.has(id)) {
          log.warn("Approval request timed out", { id, toolName });
          this.pending.delete(id);
          resolve({ approved: false, reason: "Telegram approval timed out" });

          // Notify user about timeout
          this.bot
            .sendMessage(`⏰ Approval request for \`${toolName}\` timed out (denied).`, "Markdown")
            .catch(() => {});
        }
      }, this.timeoutMs);
    });

    return Promise.race([promise, timeout]);
  }

  get pendingCount(): number {
    return this.pending.size;
  }
}

function formatToolInput(toolName: string, input: Record<string, unknown>): string {
  switch (toolName) {
    case "Bash":
      return String(input.command ?? JSON.stringify(input));
    case "Write":
    case "Edit":
    case "Read":
      return String(input.file_path ?? input.filePath ?? JSON.stringify(input));
    default: {
      const str = JSON.stringify(input, null, 2);
      return str.length > 500 ? str.slice(0, 497) + "..." : str;
    }
  }
}
