import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { PoliciesFileSchema, type Policy } from "./types.js";
import { createLogger } from "../util/logger.js";

const log = createLogger("policy-store");

export class PolicyStore {
  private policies: Policy[] = [];
  private counter = 0;

  constructor(private filePath: string) {
    this.load();
  }

  private load(): void {
    try {
      const raw = readFileSync(this.filePath, "utf-8");
      const parsed = parseYaml(raw);
      const file = PoliciesFileSchema.parse(parsed);
      this.policies = file.policies;
      // Set counter past existing IDs
      for (const p of this.policies) {
        const num = parseInt(p.id.replace("pol_", ""), 10);
        if (!isNaN(num) && num >= this.counter) {
          this.counter = num + 1;
        }
      }
      log.info("Loaded policies", { count: this.policies.length });
    } catch {
      this.policies = [];
      log.info("No existing policies file, starting fresh", { filePath: this.filePath });
    }
  }

  private save(): void {
    try {
      mkdirSync(dirname(this.filePath), { recursive: true });
      writeFileSync(this.filePath, stringifyYaml({ policies: this.policies }));
      log.info("Saved policies", { count: this.policies.length });
    } catch (e) {
      log.error("Failed to save policies", { error: String(e) });
    }
  }

  add(description: string, tool?: string): Policy {
    const policy: Policy = {
      id: `pol_${this.counter++}`,
      description,
      tool,
      createdAt: new Date().toISOString(),
    };
    this.policies.push(policy);
    this.save();
    log.info("Policy added", { id: policy.id, description: description.slice(0, 80) });
    return policy;
  }

  remove(id: string): boolean {
    const idx = this.policies.findIndex((p) => p.id === id);
    if (idx === -1) return false;
    this.policies.splice(idx, 1);
    this.save();
    log.info("Policy removed", { id });
    return true;
  }

  getAll(): Policy[] {
    return [...this.policies];
  }

  getForTool(toolName: string): Policy[] {
    return this.policies.filter((p) => !p.tool || p.tool.split("|").includes(toolName));
  }

  formatForLlm(toolName?: string): string {
    const relevant = toolName ? this.getForTool(toolName) : this.policies;
    if (relevant.length === 0) return "";
    const lines = relevant.map((p) => `- [${p.id}] ${p.description}${p.tool ? ` (applies to: ${p.tool})` : ""}`);
    return `Human-defined policies:\n${lines.join("\n")}`;
  }
}
