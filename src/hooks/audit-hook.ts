import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createLogger } from "../util/logger.js";

const log = createLogger("audit");

export interface AuditEntry {
  timestamp: string;
  sessionId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  decision: "allow" | "deny";
  reason: string;
  decidedBy: "rule" | "llm" | "telegram" | "timeout";
  ruleName?: string;
}

export class AuditLog {
  private filePath: string;

  constructor(logDir: string) {
    mkdirSync(logDir, { recursive: true });
    this.filePath = join(logDir, `audit-${new Date().toISOString().slice(0, 10)}.jsonl`);
    log.info("Audit log initialized", { filePath: this.filePath });
  }

  log(entry: Omit<AuditEntry, "timestamp">): void {
    const full: AuditEntry = {
      timestamp: new Date().toISOString(),
      ...entry,
    };
    try {
      appendFileSync(this.filePath, JSON.stringify(full) + "\n");
    } catch (e) {
      log.error("Failed to write audit entry", { error: String(e) });
    }
  }
}
