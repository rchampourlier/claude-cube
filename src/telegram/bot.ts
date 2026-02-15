import { Telegraf, type Context } from "telegraf";
import { createLogger } from "../util/logger.js";

const log = createLogger("telegram-bot");

export interface AgentStatusInfo {
  id: string;
  task: string;
  status: "running" | "completed" | "errored" | "aborted";
  turns: number;
  costUsd: number;
  denials: number;
}

export interface TelegramBotDeps {
  getAgents: () => AgentStatusInfo[];
  abortAgent: (id: string) => void;
  getTotalCost: () => number;
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
    this.bot.command("start", (ctx) => {
      const id = String(ctx.chat.id);
      log.info("Received /start", { chatId: id });
      ctx.reply(`ClaudeCube connected. Chat ID: ${id}`);
    });

    this.bot.command("status", (ctx) => {
      const agents = this.deps.getAgents();
      if (agents.length === 0) {
        ctx.reply("No active agents.");
        return;
      }
      const lines = agents.map(
        (a) =>
          `*${a.id}* — ${escapeMarkdown(a.task)}\n  Status: ${a.status} | Turns: ${a.turns} | Cost: $${a.costUsd.toFixed(2)} | Denials: ${a.denials}`,
      );
      ctx.reply(lines.join("\n\n"), { parse_mode: "Markdown" });
    });

    this.bot.command("abort", (ctx) => {
      const args = ctx.message.text.split(/\s+/).slice(1);
      const agentId = args[0];
      if (!agentId) {
        ctx.reply("Usage: /abort <agent-id>");
        return;
      }
      try {
        this.deps.abortAgent(agentId);
        ctx.reply(`Abort signal sent to agent ${agentId}.`);
      } catch (e) {
        ctx.reply(`Failed to abort: ${e}`);
      }
    });

    this.bot.command("budget", (ctx) => {
      const total = this.deps.getTotalCost();
      const agents = this.deps.getAgents();
      const lines = [
        `*Total cost:* $${total.toFixed(2)}`,
        ...agents.map((a) => `  ${a.id}: $${a.costUsd.toFixed(2)} (${a.status})`),
      ];
      ctx.reply(lines.join("\n"), { parse_mode: "Markdown" });
    });

    // Free-text messages forwarded as context
    this.bot.on("text", (ctx) => {
      const text = ctx.message.text;
      if (text.startsWith("/")) return; // ignore unknown commands
      log.info("Received free text", { text: text.slice(0, 100) });
      this.deps.onFreeText?.(ctx.chat.id, text);
      ctx.reply("Message forwarded to active agent.");
    });
  }

  async start(): Promise<void> {
    if (this.started) return;
    log.info("Starting Telegram bot (long-polling)");
    this.bot.launch();
    this.started = true;

    // Graceful shutdown
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

  async sendMessage(text: string, parseMode?: "Markdown" | "HTML"): Promise<void> {
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

function escapeMarkdown(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, "\\$&");
}
