#!/usr/bin/env node

import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { Orchestrator } from "./orchestrator.js";
import { setLogLevel } from "./util/logger.js";
import { createLogger } from "./util/logger.js";

const log = createLogger("cli");

function printUsage(): void {
  console.log(`
ClaudeCube — Orchestrate Claude Code agents with Telegram remote control

Usage:
  claudecube --prompt "Fix the bug in src/auth.ts"
  claudecube --prompt "Task 1" --prompt "Task 2" --mode parallel
  claudecube --prompt "Analyze" --prompt "Fix" --mode pipeline

Options:
  --prompt, -p     Agent prompt (repeatable for parallel/pipeline mode)
  --mode, -m       Execution mode: single, parallel, pipeline (default: single)
  --config, -c     Path to orchestrator.yaml (default: config/orchestrator.yaml)
  --rules, -r      Path to rules.yaml (default: config/rules.yaml)
  --cwd            Working directory for agents (default: current directory)
  --verbose, -v    Enable debug logging
  --help, -h       Show this help
`);
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    options: {
      prompt: { type: "string", short: "p", multiple: true },
      mode: { type: "string", short: "m", default: "single" },
      config: { type: "string", short: "c" },
      rules: { type: "string", short: "r" },
      cwd: { type: "string" },
      verbose: { type: "boolean", short: "v", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
    allowPositionals: true,
  });

  if (values.help) {
    printUsage();
    process.exit(0);
  }

  if (values.verbose) {
    setLogLevel("debug");
  }

  // Collect prompts from --prompt flags and positional args
  const prompts = [...(values.prompt ?? []), ...positionals].filter(Boolean);

  if (prompts.length === 0) {
    console.error("Error: at least one --prompt is required");
    printUsage();
    process.exit(1);
  }

  const mode = values.mode ?? "single";
  const cwd = resolve(values.cwd ?? process.cwd());
  const configPath = resolve(values.config ?? "config/orchestrator.yaml");
  const rulesPath = resolve(values.rules ?? "config/rules.yaml");

  log.info("Starting ClaudeCube", { mode, cwd, prompts: prompts.length });

  const orchestrator = new Orchestrator({
    configPath,
    rulesPath,
    cwd,
  });

  await orchestrator.start();

  try {
    let results;

    switch (mode) {
      case "single":
        results = [await orchestrator.runSingle(prompts[0])];
        break;
      case "parallel":
        results = await orchestrator.runParallel(
          prompts.map((p) => ({ prompt: p })),
        );
        break;
      case "pipeline":
        results = await orchestrator.runPipeline(
          prompts.map((p) => ({ prompt: p })),
        );
        break;
      default:
        console.error(`Unknown mode: ${mode}`);
        process.exit(1);
    }

    // Print results summary
    console.log("\n--- Results ---");
    for (const r of results) {
      console.log(`\n[${r.id}] Status: ${r.status} | Turns: ${r.turns} | Cost: $${r.costUsd.toFixed(2)}`);
      if (r.result) {
        console.log(r.result.length > 500 ? r.result.slice(0, 497) + "..." : r.result);
      }
    }

    const totalCost = results.reduce((sum, r) => sum + r.costUsd, 0);
    console.log(`\nTotal cost: $${totalCost.toFixed(2)}`);
  } finally {
    await orchestrator.stop();
  }
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
