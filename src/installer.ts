import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { createLogger } from "./util/logger.js";

const log = createLogger("installer");

const SETTINGS_PATH = join(homedir(), ".claude", "settings.json");
const HOOK_MARKER = "claudecube-hook.sh";

interface HookEntry {
  type: "command";
  command: string;
  timeout: number;
}

interface HookMatcher {
  hooks: HookEntry[];
}

type HookEventName = "PreToolUse" | "Stop" | "SessionStart" | "SessionEnd" | "Notification";

function getHookCommand(): string {
  // Resolve the absolute path to the hook script
  return resolve(join(import.meta.dirname, "..", "hooks", "claudecube-hook.sh"));
}

function buildHookEntries(): Record<HookEventName, HookMatcher> {
  const command = getHookCommand();
  return {
    PreToolUse: { hooks: [{ type: "command", command, timeout: 120 }] },
    Stop: { hooks: [{ type: "command", command, timeout: 30 }] },
    SessionStart: { hooks: [{ type: "command", command, timeout: 5 }] },
    SessionEnd: { hooks: [{ type: "command", command, timeout: 5 }] },
    Notification: { hooks: [{ type: "command", command, timeout: 5 }] },
  };
}

function loadSettings(): Record<string, unknown> {
  try {
    const raw = readFileSync(SETTINGS_PATH, "utf-8");
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function saveSettings(settings: Record<string, unknown>): void {
  mkdirSync(join(homedir(), ".claude"), { recursive: true });
  writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2) + "\n");
}

function isClaudeCubeHook(entry: unknown): boolean {
  if (typeof entry !== "object" || entry === null) return false;
  const hooks = (entry as Record<string, unknown>).hooks;
  if (!Array.isArray(hooks)) return false;
  return hooks.some(
    (h: unknown) =>
      typeof h === "object" && h !== null && typeof (h as Record<string, unknown>).command === "string"
      && ((h as Record<string, unknown>).command as string).includes(HOOK_MARKER),
  );
}

export function install(): void {
  const settings = loadSettings();
  const hooks = (settings.hooks ?? {}) as Record<string, unknown>;
  const hookEntries = buildHookEntries();

  for (const [event, matcher] of Object.entries(hookEntries)) {
    const existing = (hooks[event] ?? []) as unknown[];
    // Remove any existing ClaudeCube hooks
    const filtered = existing.filter((e) => !isClaudeCubeHook(e));
    // Append our hook
    filtered.push(matcher);
    hooks[event] = filtered;
  }

  settings.hooks = hooks;

  // Clean up any stale top-level hook keys from a previous buggy install
  const events: HookEventName[] = ["PreToolUse", "Stop", "SessionStart", "SessionEnd", "Notification"];
  for (const event of events) {
    if (event in settings) {
      delete settings[event];
    }
  }

  saveSettings(settings);
  log.info("Hooks installed", { settingsPath: SETTINGS_PATH });
  console.log(`ClaudeCube hooks installed in ${SETTINGS_PATH}`);
  console.log(`Hook script: ${getHookCommand()}`);
}

export function uninstall(): void {
  const settings = loadSettings();
  const hooks = (settings.hooks ?? {}) as Record<string, unknown>;

  const events: HookEventName[] = ["PreToolUse", "Stop", "SessionStart", "SessionEnd", "Notification"];
  for (const event of events) {
    const existing = (hooks[event] ?? []) as unknown[];
    const filtered = existing.filter((e) => !isClaudeCubeHook(e));
    if (filtered.length > 0) {
      hooks[event] = filtered;
    } else {
      delete hooks[event];
    }
    // Also clean up stale top-level keys
    delete settings[event];
  }

  settings.hooks = hooks;
  saveSettings(settings);
  log.info("Hooks uninstalled", { settingsPath: SETTINGS_PATH });
  console.log(`ClaudeCube hooks removed from ${SETTINGS_PATH}`);
}
