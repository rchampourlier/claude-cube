import { existsSync, copyFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { createLogger } from "../util/logger.js";

const log = createLogger("config-paths");

/** Runtime config lives in ~/.config/claude-cube/ */
export function configDir(): string {
  return join(homedir(), ".config", "claude-cube");
}

/** Directory containing template configs shipped with the package */
function templateDir(): string {
  return resolve(join(import.meta.dirname, "..", "..", "config"));
}

const TEMPLATE_FILES = ["orchestrator.yaml", "rules.yaml", "policies.yaml"];

/**
 * Ensure ~/.config/claude-cube/ exists and contains config files.
 * Missing files are copied from the shipped templates; existing files are never overwritten.
 */
export function ensureConfigDir(): void {
  const dir = configDir();
  mkdirSync(dir, { recursive: true });

  const tplDir = templateDir();
  for (const file of TEMPLATE_FILES) {
    const dest = join(dir, file);
    if (!existsSync(dest)) {
      const src = join(tplDir, file);
      if (existsSync(src)) {
        copyFileSync(src, dest);
        log.info("Copied template config", { file, dest });
      }
    }
  }
}

/** Resolve a config filename to its path inside the user config dir */
export function resolveConfigPath(filename: string): string {
  return join(configDir(), filename);
}
