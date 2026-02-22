import type { TelegramBot } from "./bot.js";
import type { SessionTracker } from "../session-tracker.js";
import { createLogger } from "../util/logger.js";

const log = createLogger("telegram-notifications");

export class NotificationManager {
  constructor(
    private bot: TelegramBot,
    private sessionTracker: SessionTracker,
    private config: {
      notifyOnStart: boolean;
      notifyOnComplete: boolean;
      notifyOnError: boolean;
      denialAlertThreshold: number;
    },
  ) {}

  async sessionStarted(sessionId: string, cwd: string): Promise<void> {
    if (!this.config.notifyOnStart) return;
    const label = this.sessionTracker.getLabel(sessionId);
    await this.send(
      `*Session started*\n\`${label}\`\nCWD: \`${escapeMarkdown(cwd)}\``,
    );
  }

  async sessionEnded(sessionId: string): Promise<void> {
    if (!this.config.notifyOnComplete) return;
    const label = this.sessionTracker.getLabel(sessionId);
    await this.send(`*Session ended*\n\`${label}\``);
  }

  async denialAlert(sessionId: string, denialCount: number, lastTool: string): Promise<void> {
    if (denialCount < this.config.denialAlertThreshold) return;
    const label = this.sessionTracker.getLabel(sessionId);
    await this.send(
      `*Denial alert*\n\`${label}\` has been denied ${denialCount} times\\.\nLast tool: \`${lastTool}\`\nThe session may be stuck\\.`,
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
