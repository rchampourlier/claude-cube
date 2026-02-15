import { query } from "@anthropic-ai/claude-code";
import type { RuleEngine } from "../rule-engine/engine.js";
import type { EscalationHandler } from "../escalation/handler.js";
import { AuditLog } from "../hooks/audit-hook.js";
import { createPermissionHook } from "../hooks/permission-hook.js";
import type { NotificationManager } from "../telegram/notifications.js";
import type { AgentConfig } from "../config/types.js";
import { createLogger } from "../util/logger.js";

const log = createLogger("agent-manager");

export interface AgentTask {
  id: string;
  prompt: string;
  cwd?: string;
}

export interface AgentState {
  id: string;
  task: string;
  status: "running" | "completed" | "errored" | "aborted";
  sessionId: string | null;
  turns: number;
  costUsd: number;
  denials: number;
  consecutiveDenials: number;
  result: string | null;
  abortController: AbortController;
}

export class AgentManager {
  private agents = new Map<string, AgentState>();

  constructor(
    private model: string,
    private ruleEngine: RuleEngine,
    private escalationHandler: EscalationHandler,
    private auditLog: AuditLog,
    private notifications: NotificationManager | null,
    private agentConfig: AgentConfig,
  ) {}

  getAgent(id: string): AgentState | undefined {
    return this.agents.get(id);
  }

  getAllAgents(): AgentState[] {
    return Array.from(this.agents.values());
  }

  abortAgent(id: string): void {
    const agent = this.agents.get(id);
    if (!agent) throw new Error(`Agent ${id} not found`);
    if (agent.status !== "running") throw new Error(`Agent ${id} is not running (${agent.status})`);
    log.info("Aborting agent", { id });
    agent.abortController.abort();
    agent.status = "aborted";
    this.notifications?.agentAborted(id);
  }

  getTotalCost(): number {
    let total = 0;
    for (const agent of this.agents.values()) {
      total += agent.costUsd;
    }
    return total;
  }

  async spawnAndDrive(task: AgentTask, cwd?: string): Promise<AgentState> {
    const abortController = new AbortController();
    const state: AgentState = {
      id: task.id,
      task: task.prompt.slice(0, 100),
      status: "running",
      sessionId: null,
      turns: 0,
      costUsd: 0,
      denials: 0,
      consecutiveDenials: 0,
      result: null,
      abortController,
    };
    this.agents.set(task.id, state);

    log.info("Spawning agent", { id: task.id, prompt: task.prompt.slice(0, 100) });
    await this.notifications?.agentStarted(task.id, task.prompt.slice(0, 100));

    const permissionHook = createPermissionHook(
      this.ruleEngine,
      this.escalationHandler,
      this.auditLog,
      task.id,
    );

    const postToolHook = this.auditLog.createPostToolUseHook(task.id);

    try {
      const conversation = query({
        prompt: task.prompt,
        options: {
          model: this.model,
          cwd: task.cwd ?? cwd,
          abortController,
          maxTurns: this.agentConfig.maxTurnsPerAgent,
          permissionMode: "default",
          hooks: {
            PreToolUse: [{ hooks: [permissionHook] }],
            PostToolUse: [{ hooks: [postToolHook] }],
          },
        },
      });

      for await (const message of conversation) {
        if (message.type === "system" && message.subtype === "init") {
          state.sessionId = message.session_id;
          log.info("Agent session started", { id: task.id, sessionId: message.session_id });
        }

        if (message.type === "result") {
          state.costUsd = message.total_cost_usd;
          state.turns = message.num_turns;

          if (message.subtype === "success") {
            state.status = "completed";
            state.result = message.result;
            log.info("Agent completed", { id: task.id, cost: state.costUsd, turns: state.turns });
            await this.notifications?.agentCompleted(
              task.id,
              message.result,
              state.costUsd,
              state.turns,
            );
          } else {
            state.status = "errored";
            state.result = `Error: ${message.subtype}`;
            log.error("Agent errored", { id: task.id, subtype: message.subtype });
            await this.notifications?.agentErrored(task.id, message.subtype, state.costUsd);
          }

          // Track denials from result
          if (message.permission_denials) {
            state.denials = message.permission_denials.length;
          }
        }
      }
    } catch (e) {
      if (state.status === "running") {
        state.status = "errored";
        state.result = `Exception: ${e}`;
        log.error("Agent threw exception", { id: task.id, error: String(e) });
        await this.notifications?.agentErrored(task.id, String(e), state.costUsd);
      }
    }

    return state;
  }

  async resumeAgent(
    agentId: string,
    additionalPrompt?: string,
  ): Promise<AgentState> {
    const existing = this.agents.get(agentId);
    if (!existing?.sessionId) {
      throw new Error(`No session to resume for agent ${agentId}`);
    }

    const abortController = new AbortController();
    existing.status = "running";
    existing.abortController = abortController;

    const permissionHook = createPermissionHook(
      this.ruleEngine,
      this.escalationHandler,
      this.auditLog,
      agentId,
    );
    const postToolHook = this.auditLog.createPostToolUseHook(agentId);

    try {
      const conversation = query({
        prompt: additionalPrompt ?? "Continue where you left off.",
        options: {
          model: this.model,
          resume: existing.sessionId,
          abortController,
          maxTurns: this.agentConfig.maxTurnsPerAgent,
          permissionMode: "default",
          hooks: {
            PreToolUse: [{ hooks: [permissionHook] }],
            PostToolUse: [{ hooks: [postToolHook] }],
          },
        },
      });

      for await (const message of conversation) {
        if (message.type === "result") {
          existing.costUsd += message.total_cost_usd;
          existing.turns += message.num_turns;

          if (message.subtype === "success") {
            existing.status = "completed";
            existing.result = message.result;
            await this.notifications?.agentCompleted(
              agentId,
              message.result,
              existing.costUsd,
              existing.turns,
            );
          } else {
            existing.status = "errored";
            existing.result = `Error: ${message.subtype}`;
            await this.notifications?.agentErrored(agentId, message.subtype, existing.costUsd);
          }
        }
      }
    } catch (e) {
      if (existing.status === "running") {
        existing.status = "errored";
        existing.result = `Exception: ${e}`;
        await this.notifications?.agentErrored(agentId, String(e), existing.costUsd);
      }
    }

    return existing;
  }
}
