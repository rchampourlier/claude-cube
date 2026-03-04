import { Markup } from "telegraf";
import type { TelegramBot } from "./bot.js";
import { createLogger } from "../util/logger.js";

const log = createLogger("telegram-question");

interface QuestionOption {
  label: string;
  description: string;
}

interface Question {
  question: string;
  header: string;
  options: QuestionOption[];
  multiSelect: boolean;
}

interface PendingQuestion {
  resolve: (answer: string) => void;
  messageId?: number;
  multiSelectState?: boolean[]; // tracks toggled options for multi-select
  options: QuestionOption[];
}

export interface QuestionContext {
  sessionId: string;
  label: string;
}

export class QuestionHandler {
  private pending = new Map<string, PendingQuestion>();
  /** Map from Telegram message ID → pending question ID */
  private questionMessages = new Map<number, string>();
  private counter = 0;

  constructor(
    private bot: TelegramBot,
    private chatId: string,
  ) {
    this.setupCallbackHandlers();
  }

  /**
   * Handle an AskUserQuestion tool call.
   * Sends each question to Telegram sequentially, collects answers,
   * and returns a formatted block reason.
   */
  async handleQuestion(
    toolInput: Record<string, unknown>,
    context: QuestionContext,
  ): Promise<string> {
    const questions = toolInput.questions as Question[] | undefined;
    if (!questions || questions.length === 0) {
      return "User answered via Telegram: (no questions provided)";
    }

    const answers: { header: string; answer: string }[] = [];

    for (let i = 0; i < questions.length; i++) {
      const answer = await this.sendQuestion(questions[i], i, questions.length, context);
      answers.push({ header: questions[i].header, answer });
    }

    if (answers.length === 1) {
      return `User answered via Telegram: ${answers[0].answer}`;
    }

    const lines = answers.map((a) => `- ${a.header}: ${a.answer}`);
    return `User answered via Telegram:\n${lines.join("\n")}`;
  }

  /**
   * Send a single question to Telegram and wait for the user's answer.
   */
  private sendQuestion(
    question: Question,
    index: number,
    total: number,
    context: QuestionContext,
  ): Promise<string> {
    const id = `q_${++this.counter}_${Date.now()}`;

    const headerLabel = question.header || `Q${index + 1}`;
    const counterSuffix = total > 1 ? ` (${index + 1}/${total})` : "";

    const messageParts = [
      `❓ <b>Question</b> — ${escapeHtml(headerLabel)}${counterSuffix}`,
      ``,
      escapeHtml(question.question),
      ``,
    ];

    if (question.multiSelect) {
      messageParts.push(`<i>Toggle options, then tap Done. Reply with text for a custom answer.</i>`);
    } else {
      messageParts.push(`<i>Tap an option or reply with text for a custom answer.</i>`);
    }

    if (context.label) {
      messageParts.push(``, `<b>Session:</b> <code>${escapeHtml(context.label)}</code>`);
    }

    const message = messageParts.join("\n");
    const keyboard = this.buildKeyboard(id, question);

    return new Promise<string>(async (resolve) => {
      const pendingEntry: PendingQuestion = {
        resolve,
        options: question.options,
      };

      if (question.multiSelect) {
        pendingEntry.multiSelectState = new Array(question.options.length).fill(false);
      }

      this.pending.set(id, pendingEntry);

      try {
        const sent = await this.bot.telegram.sendMessage(
          this.chatId,
          message,
          { parse_mode: "HTML", ...keyboard },
        );
        pendingEntry.messageId = sent.message_id;
        this.questionMessages.set(sent.message_id, id);
      } catch (e) {
        log.error("Failed to send question to Telegram", { error: String(e) });
        this.cleanup(id);
        resolve("(Telegram send failed — no answer collected)");
      }
    });
  }

  private buildKeyboard(id: string, question: Question) {
    const buttons = question.options.map((opt, i) => {
      const label = truncate(question.multiSelect ? `⬜ ${opt.label}` : opt.label, 40);
      return [Markup.button.callback(label, `qopt:${id}:${i}`)];
    });

    if (question.multiSelect) {
      buttons.push([Markup.button.callback("✅ Done", `qdone:${id}`)]);
    }

    return Markup.inlineKeyboard(buttons);
  }

  private setupCallbackHandlers(): void {
    // Single-select option or multi-select toggle
    this.bot.callbackQuery.action(/^qopt:(.+):(\d+)$/, async (ctx) => {
      const id = ctx.match[1];
      const optIndex = parseInt(ctx.match[2], 10);
      const pending = this.pending.get(id);
      if (!pending) {
        await ctx.answerCbQuery("Question expired or already answered.");
        return;
      }

      const option = pending.options[optIndex];
      if (!option) {
        await ctx.answerCbQuery("Invalid option.");
        return;
      }

      if (pending.multiSelectState) {
        // Multi-select: toggle
        pending.multiSelectState[optIndex] = !pending.multiSelectState[optIndex];
        await ctx.answerCbQuery(
          pending.multiSelectState[optIndex] ? `Selected: ${option.label}` : `Deselected: ${option.label}`,
        );

        // Rebuild keyboard with updated toggle state
        const buttons = pending.options.map((opt, i) => {
          const prefix = pending.multiSelectState![i] ? "✅" : "⬜";
          const label = truncate(`${prefix} ${opt.label}`, 40);
          return [Markup.button.callback(label, `qopt:${id}:${i}`)];
        });
        buttons.push([Markup.button.callback("✅ Done", `qdone:${id}`)]);

        await ctx.editMessageReplyMarkup(Markup.inlineKeyboard(buttons).reply_markup);
      } else {
        // Single-select: resolve immediately
        log.info("Question answered (single-select)", { id, answer: option.label });
        await ctx.answerCbQuery(`Selected: ${option.label}`);
        this.resolveAndEdit(id, option.label, ctx);
      }
    });

    // Multi-select "Done"
    this.bot.callbackQuery.action(/^qdone:(.+)$/, async (ctx) => {
      const id = ctx.match[1];
      const pending = this.pending.get(id);
      if (!pending) {
        await ctx.answerCbQuery("Question expired or already answered.");
        return;
      }

      const selected = pending.options
        .filter((_, i) => pending.multiSelectState?.[i])
        .map((opt) => opt.label);

      const answer = selected.length > 0 ? selected.join(", ") : "(no selection)";
      log.info("Question answered (multi-select)", { id, answer });
      await ctx.answerCbQuery("Done");
      this.resolveAndEdit(id, answer, ctx);
    });
  }

  /**
   * Try to handle a text reply to a question message.
   * Returns true if the reply was for a question, false otherwise.
   */
  tryHandleReply(messageId: number, text: string): boolean {
    const pendingId = this.questionMessages.get(messageId);
    if (!pendingId) return false;

    const pending = this.pending.get(pendingId);
    if (!pending) {
      this.questionMessages.delete(messageId);
      return false;
    }

    log.info("Question answered (text reply)", { id: pendingId, answer: text.slice(0, 100) });
    this.cleanup(pendingId);
    pending.resolve(text);
    return true;
  }

  // biome-ignore lint/suspicious/noExplicitAny: telegraf context type is complex
  private resolveAndEdit(id: string, answer: string, ctx: any): void {
    const pending = this.pending.get(id);
    if (!pending) return;

    this.cleanup(id);
    pending.resolve(answer);

    const timestamp = new Date().toLocaleTimeString();
    const originalText =
      ctx.callbackQuery?.message && "text" in ctx.callbackQuery.message
        ? ctx.callbackQuery.message.text
        : "";

    ctx.editMessageText(`${originalText}\n\n✅ Answered: ${answer} (${timestamp})`).catch(() => {});
  }

  private cleanup(id: string): void {
    const pending = this.pending.get(id);
    if (pending?.messageId) {
      this.questionMessages.delete(pending.messageId);
    }
    this.pending.delete(id);
  }
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function truncate(text: string, maxLen: number): string {
  return text.length > maxLen ? text.slice(0, maxLen - 1) + "…" : text;
}
