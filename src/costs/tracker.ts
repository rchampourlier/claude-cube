import { appendFileSync, readFileSync, readdirSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createLogger } from "../util/logger.js";

const log = createLogger("cost-tracker");

export interface CostEntry {
  timestamp: string;
  model: string;
  purpose: string;
  inputTokens: number;
  outputTokens: number;
  costCents: number;
}

export interface CostTotals {
  today: { calls: number; costCents: number };
  month: { calls: number; costCents: number };
}

// Pricing per million tokens (in cents)
const MODEL_PRICING: Record<string, { inputCentsPerM: number; outputCentsPerM: number }> = {
  "claude-haiku-4-5-20251001": { inputCentsPerM: 100, outputCentsPerM: 500 },
};

function calculateCostCents(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const pricing = MODEL_PRICING[model];
  if (!pricing) {
    log.warn("Unknown model pricing, using Haiku defaults", { model });
    return (inputTokens * 100 + outputTokens * 500) / 1_000_000;
  }
  return (inputTokens * pricing.inputCentsPerM + outputTokens * pricing.outputCentsPerM) / 1_000_000;
}

export class CostTracker {
  private logDir: string;

  constructor(auditDir: string) {
    this.logDir = auditDir;
    mkdirSync(this.logDir, { recursive: true });
    log.info("Cost tracker initialized", { logDir: this.logDir });
  }

  private filePath(date: string): string {
    return join(this.logDir, `costs-${date}.jsonl`);
  }

  record(
    model: string,
    purpose: string,
    usage: { input_tokens: number; output_tokens: number },
  ): void {
    const costCents = calculateCostCents(model, usage.input_tokens, usage.output_tokens);
    const entry: CostEntry = {
      timestamp: new Date().toISOString(),
      model,
      purpose,
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
      costCents,
    };
    const date = entry.timestamp.slice(0, 10);
    try {
      appendFileSync(this.filePath(date), JSON.stringify(entry) + "\n");
    } catch (e) {
      log.error("Failed to write cost entry", { error: String(e) });
    }
  }

  getTotals(): CostTotals {
    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);
    const year = now.getUTCFullYear();
    const month = String(now.getUTCMonth() + 1).padStart(2, "0");
    const prefix = `${year}-${month}`;

    let todayCalls = 0;
    let todayCost = 0;
    let monthCalls = 0;
    let monthCost = 0;

    // Read all cost files for this month
    try {
      const files = readdirSync(this.logDir).filter(
        (f) => f.startsWith(`costs-${prefix}`) && f.endsWith(".jsonl"),
      );
      for (const file of files) {
        const date = file.replace("costs-", "").replace(".jsonl", "");
        const isToday = date === todayStr;
        try {
          const content = readFileSync(join(this.logDir, file), "utf-8");
          for (const line of content.split("\n")) {
            if (!line.trim()) continue;
            try {
              const entry = JSON.parse(line) as CostEntry;
              monthCalls++;
              monthCost += entry.costCents;
              if (isToday) {
                todayCalls++;
                todayCost += entry.costCents;
              }
            } catch {
              // skip malformed lines
            }
          }
        } catch {
          // skip unreadable files
        }
      }
    } catch {
      // directory doesn't exist yet
    }

    return {
      today: { calls: todayCalls, costCents: todayCost },
      month: { calls: monthCalls, costCents: monthCost },
    };
  }
}
