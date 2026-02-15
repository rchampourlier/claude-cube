import micromatch from "micromatch";
import type { Rule, RulesConfig, EvaluationResult, MatchPattern } from "./types.js";
import { createLogger } from "../util/logger.js";

const log = createLogger("rule-engine");

export class RuleEngine {
  private denyRules: Rule[];
  private allowRules: Rule[];
  private escalateRules: Rule[];
  private defaultAction: "deny" | "allow" | "escalate";

  constructor(private config: RulesConfig) {
    this.denyRules = config.rules.filter((r) => r.action === "deny");
    this.allowRules = config.rules.filter((r) => r.action === "allow");
    this.escalateRules = config.rules.filter((r) => r.action === "escalate");
    this.defaultAction = config.defaults.unmatched;
  }

  evaluate(toolName: string, toolInput: Record<string, unknown>): EvaluationResult {
    // Deny rules checked first
    for (const rule of this.denyRules) {
      if (this.ruleMatches(rule, toolName, toolInput)) {
        log.info("Rule DENY", { rule: rule.name, toolName });
        return { action: "deny", rule, reason: rule.reason ?? `Denied by rule: ${rule.name}` };
      }
    }

    // Allow rules checked second
    for (const rule of this.allowRules) {
      if (this.ruleMatches(rule, toolName, toolInput)) {
        log.debug("Rule ALLOW", { rule: rule.name, toolName });
        return { action: "allow", rule, reason: rule.reason ?? `Allowed by rule: ${rule.name}` };
      }
    }

    // Escalate rules checked third
    for (const rule of this.escalateRules) {
      if (this.ruleMatches(rule, toolName, toolInput)) {
        log.info("Rule ESCALATE", { rule: rule.name, toolName });
        return { action: "escalate", rule, reason: rule.reason ?? `Escalated by rule: ${rule.name}` };
      }
    }

    // Default action for unmatched
    log.info("No rule matched, using default", { toolName, defaultAction: this.defaultAction });
    return {
      action: this.defaultAction,
      rule: null,
      reason: `No matching rule; default action: ${this.defaultAction}`,
    };
  }

  private ruleMatches(rule: Rule, toolName: string, toolInput: Record<string, unknown>): boolean {
    // Check tool name (supports pipe-separated alternatives)
    const toolPatterns = rule.tool.split("|");
    if (!toolPatterns.some((p) => p === toolName)) {
      return false;
    }

    // If no match conditions, tool name match is sufficient
    if (!rule.match) {
      return true;
    }

    // Check each field condition — ANY field's patterns matching is sufficient
    // (within a field, ANY pattern matching is sufficient)
    for (const [field, patterns] of Object.entries(rule.match)) {
      const fieldValue = this.extractFieldValue(toolInput, field);
      if (fieldValue === undefined) continue;

      const stringValue = String(fieldValue);
      if (patterns.some((p) => this.patternMatches(p, stringValue))) {
        return true;
      }
    }

    // If match conditions exist but none matched, the rule doesn't match
    return false;
  }

  private extractFieldValue(toolInput: Record<string, unknown>, field: string): unknown {
    // Support dotted paths like "nested.field"
    const parts = field.split(".");
    let current: unknown = toolInput;
    for (const part of parts) {
      if (current == null || typeof current !== "object") return undefined;
      current = (current as Record<string, unknown>)[part];
    }
    return current;
  }

  private patternMatches(pattern: MatchPattern, value: string): boolean {
    switch (pattern.type) {
      case "literal":
        return value === pattern.pattern;
      case "regex":
        return new RegExp(pattern.pattern).test(value);
      case "glob":
        return micromatch.isMatch(value, pattern.pattern);
      default:
        return false;
    }
  }
}
