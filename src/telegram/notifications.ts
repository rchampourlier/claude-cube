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
      `<b>Session started</b>\n<code>${escapeHtml(label)}</code>\nCWD: <code>${escapeHtml(cwd)}</code>`,
    );
  }

  async sessionEnded(sessionId: string): Promise<void> {
    if (!this.config.notifyOnComplete) return;
    const label = this.sessionTracker.getLabel(sessionId);
    await this.send(`<b>Session ended</b>\n<code>${escapeHtml(label)}</code>`);
  }

  async denialAlert(sessionId: string, denialCount: number, lastTool: string): Promise<void> {
    if (denialCount < this.config.denialAlertThreshold) return;
    const label = this.sessionTracker.getLabel(sessionId);
    await this.send(
      `<b>Denial alert</b>\n<code>${escapeHtml(label)}</code> has been denied ${denialCount} times.\nLast tool: <code>${escapeHtml(lastTool)}</code>\nThe session may be stuck.`,
    );
  }

  private async send(text: string): Promise<void> {
    try {
      await this.bot.sendMessage(text, "HTML");
    } catch (e) {
      log.error("Failed to send notification", { error: String(e) });
    }
  }
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
