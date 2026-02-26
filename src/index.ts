#!/usr/bin/env node

import { resolve, join } from "node:path";
import { watch } from "node:fs";
import { parseArgs } from "node:util";
import { setLogLevel, createLogger } from "./util/logger.js";
import { loadOrchestratorConfig } from "./config/loader.js";
import { loadRules } from "./rule-engine/index.js";
import { RuleEngine } from "./rule-engine/engine.js";
import { EscalationHandler } from "./escalation/handler.js";
import { AuditLog } from "./hooks/audit-hook.js";
import { createPreToolUseHandler } from "./hooks/pre-tool-use.js";
import { createStopHandler } from "./hooks/stop.js";
import {
  createSessionStartHandler,
  createSessionEndHandler,
  createNotificationHandler,
} from "./hooks/lifecycle.js";
import { SessionTracker } from "./session-tracker.js";
import { createHttpServer } from "./server.js";
import { TelegramBot, ApprovalManager, NotificationManager, ReplyEvaluator } from "./telegram/index.js";
import { PolicyStore } from "./policies/index.js";
import { install, uninstall } from "./installer.js";

const log = createLogger("cli");

function printUsage(): void {
  console.log(`
ClaudeCube — Hooks-based orchestrator for Claude Code sessions

Usage:
  claudecube                 Start server (port 7080) + Telegram bot
  claudecube --install       Patch ~/.claude/settings.json with hooks
  claudecube --uninstall     Remove ClaudeCube hooks from settings
  claudecube --status        Query server status and print

Options:
  --install          Install hooks into ~/.claude/settings.json
  --uninstall        Remove hooks from ~/.claude/settings.json
  --status           Query GET /status and print active sessions
  --port             Custom server port (default: from config or 7080)
  --config, -c       Path to orchestrator.yaml (default: config/orchestrator.yaml)
  --rules, -r        Path to rules.yaml (default: config/rules.yaml)
  --verbose, -v      Enable debug logging
  --help, -h         Show this help
`);
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      install: { type: "boolean", default: false },
      uninstall: { type: "boolean", default: false },
      status: { type: "boolean", default: false },
      port: { type: "string" },
      config: { type: "string", short: "c" },
      rules: { type: "string", short: "r" },
      verbose: { type: "boolean", short: "v", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
    allowPositionals: false,
  });

  if (values.help) {
    printUsage();
    process.exit(0);
  }

  if (values.verbose) {
    setLogLevel("debug");
  }

  // --install / --uninstall are standalone commands
  if (values.install) {
    install();
    return;
  }
  if (values.uninstall) {
    uninstall();
    return;
  }

  const configPath = resolve(values.config ?? "config/orchestrator.yaml");
  const rulesPath = resolve(values.rules ?? "config/rules.yaml");

  // --status queries the running server
  if (values.status) {
    const config = loadOrchestratorConfig(configPath);
    const port = values.port ? parseInt(values.port, 10) : config.server.port;
    try {
      const res = await fetch(`http://localhost:${port}/status`);
      const data = await res.json();
      console.log(JSON.stringify(data, null, 2));
    } catch {
      console.error(`Could not connect to ClaudeCube on port ${port}. Is it running?`);
      process.exit(1);
    }
    return;
  }

  // Default: start server + Telegram bot
  const config = loadOrchestratorConfig(configPath);
  const rulesConfig = loadRules(rulesPath);
  const port = values.port ? parseInt(values.port, 10) : config.server.port;

  let ruleEngine = new RuleEngine(rulesConfig);
  const auditLog = new AuditLog(join(process.cwd(), ".claudecube", "audit"));
  const policyStore = new PolicyStore(resolve("config/policies.yaml"));
  const sessionTracker = new SessionTracker();

  // Telegram setup
  let telegramBot: TelegramBot | null = null;
  let approvalManager: ApprovalManager | null = null;
  let notifications: NotificationManager | null = null;
  const botToken = process.env["TELEGRAM_BOT_TOKEN"];
  const chatId = process.env["TELEGRAM_CHAT_ID"];

  if (config.telegram.enabled && botToken && chatId) {
    telegramBot = new TelegramBot(botToken, chatId, {
      sessionTracker,
    });
    approvalManager = new ApprovalManager(
      telegramBot,
      chatId,
      config.escalation.telegramTimeoutSeconds * 1000,
    );
    const replyEvaluator = new ReplyEvaluator(config.escalation.evaluatorModel);
    approvalManager.setReplyEvaluator(replyEvaluator);
    notifications = new NotificationManager(telegramBot, sessionTracker, config.telegram);
    log.info("Telegram bot configured");
  } else {
    log.warn("Telegram not configured (missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID)");
  }

  const escalationHandler = new EscalationHandler(config.escalation, approvalManager, policyStore);

  // Watch rules file for hot-reload
  let rulesReloadTimer: ReturnType<typeof setTimeout> | null = null;
  watch(rulesPath, () => {
    if (rulesReloadTimer) clearTimeout(rulesReloadTimer);
    rulesReloadTimer = setTimeout(() => {
      try {
        const newConfig = loadRules(rulesPath);
        ruleEngine = new RuleEngine(newConfig);
        log.info("Rules reloaded", { path: rulesPath });
      } catch (e) {
        log.warn("Failed to reload rules, keeping previous", { error: String(e) });
      }
    }, 500);
  });

  // Build hook handlers
  const preToolUse = createPreToolUseHandler(() => ruleEngine, escalationHandler, auditLog, sessionTracker);
  const stop = createStopHandler(config.stop, sessionTracker, approvalManager);
  const sessionStart = createSessionStartHandler(sessionTracker, notifications);
  const sessionEnd = createSessionEndHandler(sessionTracker, notifications);
  const notification = createNotificationHandler(sessionTracker);

  // Create and start HTTP server
  const httpServer = createHttpServer(
    port,
    {
      PreToolUse: preToolUse,
      Stop: stop,
      SessionStart: sessionStart,
      SessionEnd: sessionEnd,
      Notification: notification,
    },
    sessionTracker,
  );

  await httpServer.start();
  log.info("ClaudeCube server started", { port });

  if (telegramBot) {
    await telegramBot.start();
    log.info("Telegram bot started");
  }

  // Discover existing Claude tmux sessions
  sessionTracker.registerFromTmux();

  console.log(`ClaudeCube listening on http://localhost:${port}`);
  console.log("Press Ctrl+C to stop.");

  // Graceful shutdown
  const shutdown = async () => {
    log.info("Shutting down...");
    await httpServer.stop();
    await telegramBot?.stop();
    process.exit(0);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
