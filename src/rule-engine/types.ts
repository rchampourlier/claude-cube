import { z } from "zod";

export const MatchPatternSchema = z.object({
  pattern: z.string(),
  type: z.enum(["regex", "glob", "literal"]).default("literal"),
});

export const RuleMatchSchema = z.record(
  z.string(),
  z.array(MatchPatternSchema),
);

export const RuleSchema = z.object({
  name: z.string(),
  action: z.enum(["deny", "allow", "escalate"]),
  tool: z.string(),
  match: RuleMatchSchema.optional(),
  reason: z.string().optional(),
});

export const RulesDefaultsSchema = z.object({
  unmatched: z.enum(["deny", "allow", "escalate"]).default("escalate"),
  max_budget_per_agent: z.number().positive().default(5.0),
  max_turns_per_agent: z.number().int().positive().default(50),
});

export const RulesConfigSchema = z.object({
  version: z.string(),
  defaults: RulesDefaultsSchema,
  rules: z.array(RuleSchema),
});

export type MatchPattern = z.infer<typeof MatchPatternSchema>;
export type RuleMatch = z.infer<typeof RuleMatchSchema>;
export type Rule = z.infer<typeof RuleSchema>;
export type RulesDefaults = z.infer<typeof RulesDefaultsSchema>;
export type RulesConfig = z.infer<typeof RulesConfigSchema>;

export type RuleAction = "deny" | "allow" | "escalate";

export interface EvaluationResult {
  action: RuleAction;
  rule: Rule | null;
  reason: string;
}
