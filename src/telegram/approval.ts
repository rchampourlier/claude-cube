import { Markup } from "telegraf";
import type { TelegramBot } from "./bot.js";
import type { ReplyEvaluator } from "./reply-evaluator.js";
import type { SessionTracker } from "../session-tracker.js";
import { readTranscript, formatRecentActivity, summarizeTranscript } from "../transcript/index.js";
import { findPaneForCwd, sendKeys } from "../tmux.js";
import { createLogger } from "../util/logger.js";

const log = createLogger("telegram-approval");

interface PendingApproval {
  resolve: (result: ApprovalResult) => void;
  messageId?: number;
  toolName: string;
  createdAt: number;
}

export interface MessageContext {
  approvalId: string;
  sessionId: string;
  paneId: string | null;
  label: string;
  /** Whether this is a stop decision (vs tool approval) */
  isStop: boolean;
}

export interface ApprovalResult {
  approved: boolean;
  reason: string;
  /** When the human replies with text, this is their policy instruction */
  policyText?: string;
}

export class ApprovalManager {
  private pending = new Map<string, PendingApproval>();
  /** Map from Telegram message ID → rich context for session routing */
  private messageContext = new Map<number, MessageContext>();
  private counter = 0;
  private replyEvaluator: ReplyEvaluator | null = null;

  constructor(
    private bot: TelegramBot,
    private chatId: string,
    private timeoutMs: number = 300_000,
    private sessionTracker: SessionTracker | null = null,
  ) {
    this.setupCallbackHandler();
    this.setupReplyHandler();
  }

  setReplyEvaluator(evaluator: ReplyEvaluator): void {
    this.replyEvaluator = evaluator;
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
      this.cleanup(id);

      pending.resolve({ approved: true, reason: "Approved via Telegram" });
      await ctx.answerCbQuery("Approved");

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
      this.cleanup(id);

      pending.resolve({ approved: false, reason: "Denied via Telegram" });
      await ctx.answerCbQuery("Denied");

      if (pending.messageId) {
        const timestamp = new Date().toLocaleTimeString();
        await ctx.editMessageText(
          `${ctx.callbackQuery.message && "text" in ctx.callbackQuery.message ? ctx.callbackQuery.message.text : ""}\n\n❌ Denied at ${timestamp}`,
        );
      }
    });

    // Details button — fetch transcript summary without resolving the approval
    this.bot.callbackQuery.action(/^details:(.+)$/, async (ctx) => {
      const id = ctx.match[1];
      const pending = this.pending.get(id);
      if (!pending) {
        await ctx.answerCbQuery("Request expired or already handled.");
        return;
      }

      await ctx.answerCbQuery("Fetching details...");

      // Find session context from messageContext
      const msgCtx = pending.messageId ? this.messageContext.get(pending.messageId) : null;
      if (!msgCtx || !this.sessionTracker) {
        await ctx.reply("No session context available.", {
          reply_parameters: { message_id: ctx.callbackQuery.message?.message_id ?? 0 },
        });
        return;
      }

      const transcriptPath = this.sessionTracker.getTranscriptPath(msgCtx.sessionId);
      if (!transcriptPath) {
        await ctx.reply("No transcript available for this session.", {
          reply_parameters: { message_id: ctx.callbackQuery.message?.message_id ?? 0 },
        });
        return;
      }

      try {
        const excerpt = readTranscript(transcriptPath, 15);
        let summary: string;
        try {
          summary = await summarizeTranscript(excerpt);
        } catch {
          summary = "(Summary unavailable)";
        }
        const recentActivity = formatRecentActivity(excerpt);

        const detailsMsg = [
          `📋 <b>Session context:</b> <code>${escapeHtml(msgCtx.label)}</code>`,
          ``,
          escapeHtml(summary),
          ``,
          `<b>Recent activity:</b>`,
          `<pre>${escapeHtml(recentActivity || "(no activity)")}</pre>`,
        ].join("\n");

        await ctx.reply(detailsMsg, {
          parse_mode: "HTML",
          reply_parameters: { message_id: ctx.callbackQuery.message?.message_id ?? 0 },
        });
      } catch (e) {
        log.error("Failed to fetch session details", { error: String(e) });
        await ctx.reply("Failed to fetch session details.", {
          reply_parameters: { message_id: ctx.callbackQuery.message?.message_id ?? 0 },
        });
      }
    });
  }

  private setupReplyHandler(): void {
    // When the user replies to an approval/stop message with text, evaluate intent via LLM
    this.bot.callbackQuery.on("text", async (ctx) => {
      const replyTo = ctx.message.reply_to_message;
      if (!replyTo) return;

      const msgCtx = this.messageContext.get(replyTo.message_id);
      if (!msgCtx) return;

      const pending = this.pending.get(msgCtx.approvalId);
      if (!pending) return;

      const replyText = ctx.message.text;

      // Stop decisions: always forward the user's text as an answer to the agent
      if (msgCtx.isStop) {
        log.info("Text reply to stop decision — forwarding to agent", {
          id: msgCtx.approvalId,
          sessionId: msgCtx.sessionId,
          text: replyText.slice(0, 100),
        });
        this.cleanup(msgCtx.approvalId);
        pending.resolve({
          approved: true,
          reason: `User replied to agent question`,
          policyText: replyText,
        });
        ctx.reply(`➡️ Forwarded to ${msgCtx.label}`, {
          reply_parameters: { message_id: replyTo.message_id },
        });
        return;
      }

      // Tool approval replies: use LLM evaluator if available
      if (this.replyEvaluator) {
        try {
          const evaluation = await this.replyEvaluator.evaluateReply(replyText, {
            toolName: pending.toolName,
            label: msgCtx.label,
          });

          log.info("Reply evaluated", {
            id: msgCtx.approvalId,
            intent: evaluation.intent,
            text: replyText.slice(0, 100),
          });

          switch (evaluation.intent) {
            case "approve":
              this.cleanup(msgCtx.approvalId);
              pending.resolve({ approved: true, reason: "Approved via Telegram reply" });
              ctx.reply(`✅ Approved`, { reply_parameters: { message_id: replyTo.message_id } });
              return;

            case "deny":
              this.cleanup(msgCtx.approvalId);
              pending.resolve({ approved: false, reason: `Denied via Telegram: ${replyText}` });
              ctx.reply(`❌ Denied`, { reply_parameters: { message_id: replyTo.message_id } });
              return;

            case "forward":
              this.cleanup(msgCtx.approvalId);
              pending.resolve({ approved: true, reason: "Approved + forwarded text to agent" });
              if (msgCtx.paneId) {
                sendKeys(msgCtx.paneId, evaluation.forwardText ?? replyText);
                ctx.reply(`✅ Approved + forwarded to ${msgCtx.label}`, {
                  reply_parameters: { message_id: replyTo.message_id },
                });
              } else {
                ctx.reply(`✅ Approved (no pane found to forward to)`, {
                  reply_parameters: { message_id: replyTo.message_id },
                });
              }
              return;

            case "add_policy": {
              const policyText = evaluation.policyText ?? replyText;
              this.cleanup(msgCtx.approvalId);
              pending.resolve({
                approved: true,
                reason: `Approved via Telegram with policy: ${policyText}`,
                policyText,
              });
              ctx.reply(`✅ Approved + policy saved:\n"${policyText}"`, {
                reply_parameters: { message_id: replyTo.message_id },
              });
              return;
            }
          }
        } catch (e) {
          log.warn("Reply evaluation failed, falling back to approve+policy", { error: String(e) });
        }
      }

      // Fallback: treat as approval + policy (original behavior)
      log.info("Text reply to approval — treating as policy", {
        id: msgCtx.approvalId,
        toolName: pending.toolName,
        policyText: replyText.slice(0, 100),
      });
      this.cleanup(msgCtx.approvalId);
      pending.resolve({
        approved: true,
        reason: `Approved via Telegram with policy: ${replyText}`,
        policyText: replyText,
      });
      ctx.reply(`✅ Approved + policy saved:\n"${replyText}"`, {
        reply_parameters: { message_id: replyTo.message_id },
      });
    });
  }

  private cleanup(id: string): void {
    const pending = this.pending.get(id);
    if (pending?.messageId) {
      this.messageContext.delete(pending.messageId);
    }
    this.pending.delete(id);
  }

  async requestApproval(
    toolName: string,
    toolInput: Record<string, unknown>,
    context: { agentId: string; sessionId?: string; cwd?: string; paneId?: string | null; label?: string; reason: string },
  ): Promise<ApprovalResult> {
    const id = `req_${++this.counter}_${Date.now()}`;
    const sessionId = context.sessionId ?? context.agentId;

    const inputSummary = formatToolInput(toolName, toolInput);
    const displayName = context.label ?? context.agentId.slice(0, 12);
    const message = [
      `🔔 <b>Permission Request</b>`,
      ``,
      `<b>Session:</b> <code>${escapeHtml(displayName)}</code>`,
      `<b>Tool:</b> <code>${escapeHtml(toolName)}</code>`,
      `<b>Reason:</b> ${escapeHtml(context.reason)}`,
      ``,
      `<pre>${escapeHtml(inputSummary)}</pre>`,
      ``,
      `<i>Reply with text to approve + create a policy.</i>`,
    ].join("\n");

    const keyboard = Markup.inlineKeyboard([
      Markup.button.callback("✅ Approve", `approve:${id}`),
      Markup.button.callback("❌ Deny", `deny:${id}`),
      Markup.button.callback("🔍 Details", `details:${id}`),
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
        { parse_mode: "HTML", ...keyboard },
      );
      const entry = this.pending.get(id);
      if (entry) {
        entry.messageId = sent.message_id;
        this.messageContext.set(sent.message_id, {
          approvalId: id,
          sessionId,
          paneId: context.paneId ?? (context.cwd ? findPaneForCwd(context.cwd) : null),
          label: displayName,
          isStop: false,
        });
      }
    } catch (e) {
      log.error("Failed to send approval request", { error: String(e) });
      this.cleanup(id);
      return { approved: false, reason: `Telegram send failed: ${e}` };
    }

    // Timeout handling
    const timeout = new Promise<ApprovalResult>((resolve) => {
      setTimeout(() => {
        if (this.pending.has(id)) {
          log.warn("Approval request timed out", { id, toolName });
          this.cleanup(id);
          resolve({ approved: false, reason: "Telegram approval timed out" });

          this.bot
            .sendMessage(`⏰ Approval request for <code>${escapeHtml(toolName)}</code> timed out (denied).`, "HTML")
            .catch(() => {});
        }
      }, this.timeoutMs);
    });

    return Promise.race([promise, timeout]);
  }

  async requestStopDecision(
    sessionId: string,
    lastMessage: string,
    label?: string,
    cwd?: string,
    paneId?: string | null,
    options?: { summary?: string; recentTools?: string },
  ): Promise<ApprovalResult> {
    const id = `stop_${++this.counter}_${Date.now()}`;

    const truncated = lastMessage.length > 800 ? lastMessage.slice(-800) : lastMessage;
    const displayName = label ?? sessionId.slice(0, 12);
    const messageParts = [
      `🛑 <b>Agent stopped</b> — <code>${escapeHtml(displayName)}</code>`,
    ];

    if (options?.summary) {
      messageParts.push(
        ``,
        `📋 <b>Summary:</b>`,
        escapeHtml(options.summary),
      );
    }

    messageParts.push(
      ``,
      `<b>Last message:</b>`,
      `<pre>${escapeHtml(truncated)}</pre>`,
    );

    if (options?.recentTools) {
      messageParts.push(
        ``,
        `<b>Recent tools:</b> ${escapeHtml(options.recentTools)}`,
      );
    }

    messageParts.push(
      ``,
      `<i>Reply to send instructions. Buttons to continue or let stop.</i>`,
    );

    const message = messageParts.join("\n");

    const keyboard = Markup.inlineKeyboard([
      Markup.button.callback("▶️ Continue", `approve:${id}`),
      Markup.button.callback("⏹️ Let stop", `deny:${id}`),
    ]);

    const promise = new Promise<ApprovalResult>((resolve) => {
      this.pending.set(id, {
        resolve,
        toolName: "Stop",
        createdAt: Date.now(),
      });
    });

    try {
      const sent = await this.bot.telegram.sendMessage(
        this.chatId,
        message,
        { parse_mode: "HTML", ...keyboard },
      );
      const entry = this.pending.get(id);
      if (entry) {
        entry.messageId = sent.message_id;
        this.messageContext.set(sent.message_id, {
          approvalId: id,
          sessionId,
          paneId: paneId ?? (cwd ? findPaneForCwd(cwd) : null),
          label: displayName,
          isStop: true,
        });
      }
    } catch (e) {
      log.error("Failed to send stop decision request", { error: String(e) });
      this.cleanup(id);
      return { approved: false, reason: `Telegram send failed: ${e}` };
    }

    const timeout = new Promise<ApprovalResult>((resolve) => {
      setTimeout(() => {
        if (this.pending.has(id)) {
          log.warn("Stop decision timed out", { id, sessionId });
          this.cleanup(id);
          resolve({ approved: false, reason: "Telegram stop decision timed out" });
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

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
