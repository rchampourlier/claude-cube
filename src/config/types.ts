import { z } from "zod";

export const EscalationConfigSchema = z.object({
  evaluatorModel: z.string().default("claude-haiku-4-5-20251001"),
  confidenceThreshold: z.number().min(0).max(1).default(0.8),
  telegramTimeoutSeconds: z.number().positive().default(300),
});

export const TelegramConfigSchema = z.object({
  enabled: z.boolean().default(true),
  notifyOnStart: z.boolean().default(true),
  notifyOnComplete: z.boolean().default(true),
  notifyOnError: z.boolean().default(true),
  denialAlertThreshold: z.number().int().positive().default(5),
});

export const AgentConfigSchema = z.object({
  maxTurnsPerAgent: z.number().int().positive().default(50),
  maxBudgetPerAgent: z.number().positive().default(5.0),
  consecutiveDenialLimit: z.number().int().positive().default(5),
});

export const OrchestratorConfigSchema = z.object({
  model: z.string().default("claude-sonnet-4-5-20250929"),
  maxTotalBudgetUsd: z.number().positive().default(20.0),
  maxAgents: z.number().int().positive().default(5),
  escalation: EscalationConfigSchema,
  telegram: TelegramConfigSchema,
  agent: AgentConfigSchema,
});

export type EscalationConfig = z.infer<typeof EscalationConfigSchema>;
export type TelegramConfig = z.infer<typeof TelegramConfigSchema>;
export type AgentConfig = z.infer<typeof AgentConfigSchema>;
export type OrchestratorConfig = z.infer<typeof OrchestratorConfigSchema>;
