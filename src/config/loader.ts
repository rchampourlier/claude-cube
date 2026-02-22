import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import { OrchestratorConfigSchema, type OrchestratorConfig } from "./types.js";
import { createLogger } from "../util/logger.js";

const log = createLogger("config-loader");

export function loadOrchestratorConfig(filePath: string): OrchestratorConfig {
  log.info("Loading orchestrator config", { filePath });
  const raw = readFileSync(filePath, "utf-8");
  const parsed = parseYaml(raw);
  const config = OrchestratorConfigSchema.parse(parsed);
  log.info("Loaded orchestrator config", { port: config.server.port });
  return config;
}
