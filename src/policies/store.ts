import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { PoliciesFileSchema, type Policy } from "./types.js";
import { createLogger } from "../util/logger.js";

const log = createLogger("policy-store");

function loadPoliciesFromFile(filePath: string): Policy[] {
  try {
    const raw = readFileSync(filePath, "utf-8");
    const parsed = parseYaml(raw);
    const file = PoliciesFileSchema.parse(parsed);
    log.info("Loaded policies", { path: filePath, count: file.policies.length });
    return file.policies;
  } catch {
    log.info("No policies file found, skipping", { filePath });
    return [];
  }
}

export class PolicyStore {
  private policies: Policy[] = [];
  private counter = 0;

  constructor(
    private sharedPath: string,
    private localPath: string,
  ) {
    this.load();
  }

  private load(): void {
    const shared = loadPoliciesFromFile(this.sharedPath);
    const local = loadPoliciesFromFile(this.localPath);
    this.policies = [...shared, ...local];

    // Set counter past existing IDs
    for (const p of this.policies) {
      const num = parseInt(p.id.replace("pol_", ""), 10);
      if (!isNaN(num) && num >= this.counter) {
        this.counter = num + 1;
      }
    }
  }

  private save(): void {
    try {
      mkdirSync(dirname(this.localPath), { recursive: true });
      // Only save local policies (exclude shared ones)
      const sharedIds = new Set(loadPoliciesFromFile(this.sharedPath).map((p) => p.id));
      const localPolicies = this.policies.filter((p) => !sharedIds.has(p.id));
      writeFileSync(this.localPath, stringifyYaml({ policies: localPolicies }));
      log.info("Saved local policies", { count: localPolicies.length });
    } catch (e) {
      log.error("Failed to save policies", { error: String(e) });
    }
  }

  add(description: string, tool?: string): Policy {
    const policy: Policy = {
      id: `pol_${this.counter++}`,
      description,
      tool,
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
