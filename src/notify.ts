import { execSync } from "node:child_process";
import { createLogger } from "./util/logger.js";

const log = createLogger("notify");

/**
 * Show a macOS native notification via osascript.
 * Fire-and-forget — never throws.
 */
export function showMacNotification(title: string, message: string): void {
  try {
    const escaped = (s: string) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    execSync(
      `osascript -e 'display notification "${escaped(message)}" with title "${escaped(title)}" sound name "Glass"'`,
      { encoding: "utf-8", timeout: 5000 },
    );
  } catch (e) {
    log.debug("Failed to show macOS notification", { error: String(e) });
  }
}

/**
 * Prepend 🔔 to the tmux window name for the given pane, and disable automatic-rename.
 * Fire-and-forget — never throws.
 */
export function addTmuxAlert(paneId: string): void {
  try {
    const windowName = execSync(
      `tmux display-message -t ${JSON.stringify(paneId)} -p '#{window_name}'`,
      { encoding: "utf-8", timeout: 5000 },
    ).trim();

    if (windowName.startsWith("🔔")) return; // already has alert

    execSync(
      `tmux rename-window -t ${JSON.stringify(paneId)} ${JSON.stringify(`🔔 ${windowName}`)}`,
      { encoding: "utf-8", timeout: 5000 },
    );
    execSync(
      `tmux set-option -w -t ${JSON.stringify(paneId)} automatic-rename off`,
      { encoding: "utf-8", timeout: 5000 },
    );
  } catch (e) {
    log.debug("Failed to add tmux alert", { paneId, error: String(e) });
  }
}

/**
 * Strip 🔔 prefix from the tmux window name for the given pane.
 * Fire-and-forget — never throws.
 */
export function clearTmuxAlert(paneId: string): void {
  try {
    const windowName = execSync(
      `tmux display-message -t ${JSON.stringify(paneId)} -p '#{window_name}'`,
      { encoding: "utf-8", timeout: 5000 },
    ).trim();

    if (!windowName.startsWith("🔔")) return; // no alert to clear

    const cleaned = windowName.replace(/^🔔\s*/, "");
    execSync(
      `tmux rename-window -t ${JSON.stringify(paneId)} ${JSON.stringify(cleaned)}`,
      { encoding: "utf-8", timeout: 5000 },
    );
    execSync(
      `tmux set-option -w -t ${JSON.stringify(paneId)} automatic-rename on`,
      { encoding: "utf-8", timeout: 5000 },
    );
  } catch (e) {
    log.debug("Failed to clear tmux alert", { paneId, error: String(e) });
  }
}

/**
 * Alert the user: macOS notification + tmux 🔔 emoji.
 * Both are fire-and-forget. If paneId is not available, only the macOS notification fires.
 */
export function alertUser({ title, message, paneId }: { title: string; message: string; paneId?: string | null }): void {
  showMacNotification(title, message);
  if (paneId) addTmuxAlert(paneId);
}

/**
 * Clear the tmux 🔔 alert. No-op if paneId is not available.
 */
export function clearAlert(paneId?: string | null): void {
  if (paneId) clearTmuxAlert(paneId);
}
