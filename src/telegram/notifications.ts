import type { TelegramBot } from "./bot.js";
import { createLogger } from "../util/logger.js";

const log = createLogger("telegram-notifications");

export class NotificationManager {
  constructor(
    private bot: TelegramBot,
    private config: {
      notifyOnStart: boolean;
      notifyOnComplete: boolean;
      notifyOnError: boolean;
      denialAlertThreshold: number;
    },
  ) {}

  async agentStarted(agentId: string, task: string): Promise<void> {
    if (!this.config.notifyOnStart) return;
    await this.send(`🚀 *Agent started*\nID: \`${agentId}\`\nTask: ${escapeMarkdown(task)}`);
  }

  async agentCompleted(agentId: string, result: string, costUsd: number, turns: number): Promise<void> {
    if (!this.config.notifyOnComplete) return;
    const summary = result.length > 300 ? result.slice(0, 297) + "..." : result;
    await this.send(
      [
        `✅ *Agent completed*`,
        `ID: \`${agentId}\``,
        `Turns: ${turns} | Cost: $${costUsd.toFixed(2)}`,
        ``,
        `Result: ${escapeMarkdown(summary)}`,
      ].join("\n"),
    );
  }

  async agentErrored(agentId: string, error: string, costUsd: number): Promise<void> {
    if (!this.config.notifyOnError) return;
    await this.send(
      `❗ *Agent errored*\nID: \`${agentId}\`\nCost: $${costUsd.toFixed(2)}\nError: ${escapeMarkdown(error)}`,
    );
  }

  async agentAborted(agentId: string): Promise<void> {
    await this.send(`🛑 *Agent aborted*\nID: \`${agentId}\``);
  }

  async denialAlert(agentId: string, denialCount: number, lastTool: string): Promise<void> {
    if (denialCount < this.config.denialAlertThreshold) return;
    await this.send(
      `⚠️ *Denial alert*\nAgent \`${agentId}\` has been denied ${denialCount} times.\nLast tool: \`${lastTool}\`\nThe agent may be stuck.`,
    );
  }

  async budgetAlert(totalCost: number, maxBudget: number): Promise<void> {
    await this.send(
      `💰 *Budget alert*\nTotal cost: $${totalCost.toFixed(2)} / $${maxBudget.toFixed(2)}\nApproaching budget limit.`,
    );
  }

  private async send(text: string): Promise<void> {
    try {
      await this.bot.sendMessage(text, "Markdown");
    } catch (e) {
      log.error("Failed to send notification", { error: String(e) });
    }
  }
}

function escapeMarkdown(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, "\\$&");
}
