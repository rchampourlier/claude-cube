import { join } from "node:path";
import { RuleEngine, loadRules } from "./rule-engine/index.js";
import { EscalationHandler } from "./escalation/handler.js";
import { AuditLog } from "./hooks/audit-hook.js";
import { AgentManager, type AgentState } from "./agents/manager.js";
import { TelegramBot, ApprovalManager, NotificationManager, type AgentStatusInfo } from "./telegram/index.js";
import { loadOrchestratorConfig } from "./config/loader.js";
import type { OrchestratorConfig } from "./config/types.js";
import { createLogger } from "./util/logger.js";

const log = createLogger("orchestrator");

export interface OrchestratorOptions {
  configPath: string;
  rulesPath: string;
  cwd: string;
  auditDir?: string;
}

export class Orchestrator {
  private config: OrchestratorConfig;
  private ruleEngine: RuleEngine;
  private agentManager: AgentManager;
  private telegramBot: TelegramBot | null = null;
  private approvalManager: ApprovalManager | null = null;
  private notifications: NotificationManager | null = null;
  private escalationHandler: EscalationHandler;
  private auditLog: AuditLog;

  constructor(private opts: OrchestratorOptions) {
    // Load configs
    this.config = loadOrchestratorConfig(opts.configPath);
    const rulesConfig = loadRules(opts.rulesPath);
    this.ruleEngine = new RuleEngine(rulesConfig);
    this.auditLog = new AuditLog(opts.auditDir ?? join(opts.cwd, ".claudecube", "audit"));

    // Telegram setup
    const botToken = process.env["TELEGRAM_BOT_TOKEN"];
    const chatId = process.env["TELEGRAM_CHAT_ID"];

    if (this.config.telegram.enabled && botToken && chatId) {
      this.telegramBot = new TelegramBot(botToken, chatId, {
        getAgents: () => this.getAgentStatusList(),
        abortAgent: (id) => this.agentManager.abortAgent(id),
        getTotalCost: () => this.agentManager.getTotalCost(),
        onFreeText: (_, text) => {
          log.info("Received free text from Telegram", { text: text.slice(0, 100) });
        },
      });
      this.approvalManager = new ApprovalManager(
        this.telegramBot,
        chatId,
        this.config.escalation.telegramTimeoutSeconds * 1000,
      );
      this.notifications = new NotificationManager(this.telegramBot, this.config.telegram);
      log.info("Telegram bot configured");
    } else {
      log.warn("Telegram not configured (missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID)");
    }

    // Escalation handler
    this.escalationHandler = new EscalationHandler(
      this.config.escalation,
      this.approvalManager,
    );

    // Agent manager
    this.agentManager = new AgentManager(
      this.config.model,
      this.ruleEngine,
      this.escalationHandler,
      this.auditLog,
      this.notifications,
      this.config.agent,
    );
  }

  async start(): Promise<void> {
    if (this.telegramBot) {
      await this.telegramBot.start();
      log.info("Orchestrator started with Telegram bot");
    } else {
      log.info("Orchestrator started (no Telegram)");
    }
  }

  async stop(): Promise<void> {
    if (this.telegramBot) {
      await this.telegramBot.stop();
    }
    log.info("Orchestrator stopped");
  }

  async runSingle(prompt: string, cwd?: string): Promise<AgentState> {
    this.checkBudget();
    const id = `agent-${Date.now().toString(36)}`;
    return this.agentManager.spawnAndDrive({ id, prompt, cwd: cwd ?? this.opts.cwd });
  }

  async runParallel(
    tasks: Array<{ prompt: string; cwd?: string }>,
  ): Promise<AgentState[]> {
    this.checkBudget();
    if (tasks.length > this.config.maxAgents) {
      throw new Error(`Too many tasks (${tasks.length}), max is ${this.config.maxAgents}`);
    }

    const promises = tasks.map((task, i) => {
      const id = `agent-${Date.now().toString(36)}-${i}`;
      return this.agentManager.spawnAndDrive({
        id,
        prompt: task.prompt,
        cwd: task.cwd ?? this.opts.cwd,
      });
    });

    return Promise.all(promises);
  }

  async runPipeline(
    tasks: Array<{ prompt: string; cwd?: string }>,
  ): Promise<AgentState[]> {
    const results: AgentState[] = [];
    let previousResult = "";

    for (let i = 0; i < tasks.length; i++) {
      this.checkBudget();
      const task = tasks[i];
      const prompt = previousResult
        ? `Previous agent result:\n${previousResult}\n\n---\n\n${task.prompt}`
        : task.prompt;

      const id = `agent-${Date.now().toString(36)}-pipe-${i}`;
      const state = await this.agentManager.spawnAndDrive({
        id,
        prompt,
        cwd: task.cwd ?? this.opts.cwd,
      });
      results.push(state);

      if (state.status !== "completed") {
        log.warn("Pipeline agent did not complete, stopping pipeline", {
          id,
          status: state.status,
        });
        break;
      }
      previousResult = state.result ?? "";
    }

    return results;
  }

  private checkBudget(): void {
    const totalCost = this.agentManager.getTotalCost();
    if (totalCost >= this.config.maxTotalBudgetUsd) {
      throw new Error(
        `Budget exceeded: $${totalCost.toFixed(2)} >= $${this.config.maxTotalBudgetUsd.toFixed(2)}`,
      );
    }
    // Alert at 80% of budget
    if (totalCost >= this.config.maxTotalBudgetUsd * 0.8) {
      this.notifications?.budgetAlert(totalCost, this.config.maxTotalBudgetUsd);
    }
  }

  private getAgentStatusList(): AgentStatusInfo[] {
    return this.agentManager.getAllAgents().map((a) => ({
      id: a.id,
      task: a.task,
      status: a.status,
      turns: a.turns,
      costUsd: a.costUsd,
      denials: a.denials,
    }));
  }
}
