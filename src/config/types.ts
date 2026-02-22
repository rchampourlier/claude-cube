import { z } from "zod";

export const ServerConfigSchema = z.object({
  port: z.number().int().positive().default(7080),
});

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

export const StopConfigSchema = z.object({
  retryOnError: z.boolean().default(true),
  maxRetries: z.number().int().min(0).default(2),
  escalateToTelegram: z.boolean().default(true),
});

export const OrchestratorConfigSchema = z.object({
  server: ServerConfigSchema,
  escalation: EscalationConfigSchema,
  telegram: TelegramConfigSchema,
  stop: StopConfigSchema,
});

export type ServerConfig = z.infer<typeof ServerConfigSchema>;
export type EscalationConfig = z.infer<typeof EscalationConfigSchema>;
export type TelegramConfig = z.infer<typeof TelegramConfigSchema>;
export type StopConfig = z.infer<typeof StopConfigSchema>;
export type OrchestratorConfig = z.infer<typeof OrchestratorConfigSchema>;
