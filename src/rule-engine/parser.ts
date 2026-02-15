import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import { RulesConfigSchema, type RulesConfig } from "./types.js";
import { createLogger } from "../util/logger.js";

const log = createLogger("rule-parser");

export function loadRules(filePath: string): RulesConfig {
  log.info("Loading rules", { filePath });
  const raw = readFileSync(filePath, "utf-8");
  const parsed = parseYaml(raw);
  const config = RulesConfigSchema.parse(parsed);

  // Validate regex patterns at load time
  for (const rule of config.rules) {
    if (!rule.match) continue;
    for (const [field, patterns] of Object.entries(rule.match)) {
      for (const p of patterns) {
        if (p.type === "regex") {
          try {
            new RegExp(p.pattern);
          } catch (e) {
            throw new Error(
              `Invalid regex in rule "${rule.name}", field "${field}": ${p.pattern} — ${e}`,
            );
          }
        }
      }
    }
  }

  log.info("Loaded rules", {
    ruleCount: config.rules.length,
    deny: config.rules.filter((r) => r.action === "deny").length,
    allow: config.rules.filter((r) => r.action === "allow").length,
    escalate: config.rules.filter((r) => r.action === "escalate").length,
  });

  return config;
}
