import { Telegraf } from "telegraf";
import type { SessionTracker } from "../session-tracker.js";
import type { CostTracker } from "../costs/tracker.js";
import { listClaudePanes, sendKeys } from "../tmux.js";
import { createLogger } from "../util/logger.js";

const log = createLogger("telegram-bot");

const COMMANDS = [
  { command: "start", description: "Verify bot connection and show chat ID" },
  { command: "status", description: "List all active Claude sessions" },
  { command: "send", description: "Send text to a tmux pane", usage: "/send <window> <text>" },
  { command: "cost", description: "Show ClaudeCube's own LLM costs (today + month)" },
  { command: "help", description: "Show this help message" },
];

export interface TelegramBotDeps {
  sessionTracker: SessionTracker;
  costTracker?: CostTracker;
  onFreeText?: (chatId: number, text: string) => void;
}

export class TelegramBot {
  private bot: Telegraf;
  private chatId: string;
  private started = false;

  constructor(
    token: string,
    chatId: string,
    private deps: TelegramBotDeps,
  ) {
    this.bot = new Telegraf(token);
    this.chatId = chatId;
    this.setupCommands();
  }

  private setupCommands(): void {
    // Reject messages from unauthorized chats
    this.bot.use((ctx, next) => {
      const chatId = String(ctx.chat?.id);
      if (chatId !== this.chatId) {
        log.warn("Rejected message from unauthorized chat", { chatId });
        ctx.reply("Unauthorized.");
        return;
      }
      return next();
    });

    this.bot.command("start", (ctx) => {
      const id = String(ctx.chat.id);
      log.info("Received /start", { chatId: id });
      ctx.reply(`ClaudeCube connected. Chat ID: ${id}`);
    });

    this.bot.command("status", (ctx) => {
      const sessions = this.deps.sessionTracker.getAll();
      if (sessions.length === 0) {
        ctx.reply("No active sessions.");
        return;
      }
      const lines = sessions.map((s) => {
        const age = Math.round((Date.now() - new Date(s.startedAt).getTime()) / 60000);
        return [
          `<b>${escapeHtml(s.label)}</b>`,
          `  State: ${s.state} | Denials: ${s.denialCount}`,
          `  CWD: <code>${escapeHtml(s.cwd)}</code>`,
          `  Last tool: ${s.lastToolName ?? "—"} | Age: ${age}m`,
        ].join("\n");
      });
      ctx.reply(lines.join("\n\n"), { parse_mode: "HTML" });
    });

    this.bot.command("send", (ctx) => {
      const args = ctx.message.text.split(/\s+/).slice(1);
      const windowTarget = args[0];
      const text = args.slice(1).join(" ");
      if (!windowTarget || !text) {
        ctx.reply("Usage: /send <window-name> <text>");
        return;
      }
      const panes = listClaudePanes();
      const matches = panes.filter((p) => p.windowName === windowTarget);
      if (matches.length === 0) {
        // Fall back to direct pane ID matching
        const byId = panes.find((p) => p.paneId === windowTarget);
        if (byId) {
          try {
            sendKeys(byId.paneId, text);
            ctx.reply(`Sent to ${escapeHtml(byId.windowName)} (<code>${escapeHtml(byId.paneId)}</code>).`, { parse_mode: "HTML" });
          } catch (e) {
            ctx.reply(`Failed: ${e}`);
          }
          return;
        }
        const available = panes.map((p) => p.windowName).join(", ");
        ctx.reply(`No pane found for "${windowTarget}". Available: ${available || "none"}`);
        return;
      }
      if (matches.length > 1) {
        const list = matches.map((p) => `${escapeHtml(p.windowName)} — <code>${escapeHtml(p.paneId)}</code>`).join("\n");
        ctx.reply(`Multiple panes match "${escapeHtml(windowTarget)}":\n${list}\nUse the pane ID instead.`, { parse_mode: "HTML" });
        return;
      }
      try {
        sendKeys(matches[0].paneId, text);
        ctx.reply(`Sent to ${escapeHtml(matches[0].windowName)} (<code>${escapeHtml(matches[0].paneId)}</code>).`, { parse_mode: "HTML" });
      } catch (e) {
        ctx.reply(`Failed: ${e}`);
      }
    });

    this.bot.command("cost", (ctx) => {
      const tracker = this.deps.costTracker;
      if (!tracker) {
        ctx.reply("Cost tracking is not configured.");
        return;
      }
      const totals = tracker.getTotals();
      const fmtCents = (c: number) => `$${(c / 100).toFixed(4)}`;
      ctx.reply(
        `<b>Today:</b> ${fmtCents(totals.today.costCents)} (${totals.today.calls} calls)\n` +
          `<b>Month to date:</b> ${fmtCents(totals.month.costCents)} (${totals.month.calls} calls)`,
        { parse_mode: "HTML" },
      );
    });

    this.bot.command("help", (ctx) => {
      const lines = COMMANDS.map((c) => {
        const usage = c.usage ?? `/${c.command}`;
        return `<b>${escapeHtml(usage)}</b> — ${escapeHtml(c.description)}`;
      });
      lines.push("");
      lines.push("Any other text is forwarded to the first Claude pane.");
      ctx.reply(lines.join("\n"), { parse_mode: "HTML" });
    });

    // Free-text messages — inject into first Claude pane
    // Replies to existing messages are handled by ApprovalManager's reply handler
    this.bot.on("text", (ctx, next) => {
      const text = ctx.message.text;
      if (text.startsWith("/")) return;

      // If this is a reply to a message, let the approval reply handler process it
      if (ctx.message.reply_to_message) return next();

      log.info("Received free text", { text: text.slice(0, 100) });

      const panes = listClaudePanes();
      if (panes.length === 0) {
        ctx.reply("No Claude panes found to forward message to.");
        return;
      }

      try {
        sendKeys(panes[0].paneId, text);
        ctx.reply(`Forwarded to pane ${panes[0].paneId}.`);
      } catch (e) {
        ctx.reply(`Failed to forward: ${e}`);
      }

      this.deps.onFreeText?.(ctx.chat.id, text);
    });
  }

  async start(): Promise<void> {
    if (this.started) return;
    log.info("Starting Telegram bot (long-polling)");
    this.bot.launch();
    this.started = true;

    const stop = () => {
      log.info("Stopping Telegram bot");
      this.bot.stop();
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  }

  async stop(): Promise<void> {
    if (!this.started) return;
    this.bot.stop();
    this.started = false;
  }

  async sendMessage(text: string, parseMode?: "HTML"): Promise<void> {
    await this.bot.telegram.sendMessage(this.chatId, text, {
      parse_mode: parseMode,
    });
  }

  get telegram() {
    return this.bot.telegram;
  }

  get callbackQuery() {
    return this.bot;
  }
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
