import { execSync } from "node:child_process";
import { createLogger } from "./util/logger.js";

const log = createLogger("tmux");

export interface TmuxPane {
  sessionName: string;
  windowIndex: string;
  windowName: string;
  paneIndex: string;
  paneId: string;
  paneCwd: string;
  command: string;
}

export function listClaudePanes(): TmuxPane[] {
  try {
    const output = execSync(
      "tmux list-panes -a -F '#{session_name}|#{window_index}|#{window_name}|#{pane_index}|#{pane_id}|#{pane_current_path}|#{pane_current_command}'",
      { encoding: "utf-8", timeout: 5000 },
    );
    return output
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [sessionName, windowIndex, windowName, paneIndex, paneId, paneCwd, command] = line.split("|");
        return { sessionName, windowIndex, windowName, paneIndex, paneId, paneCwd, command };
      })
      .filter((p) => p.command === "claude" || p.command.includes("claude"));
  } catch (e) {
    log.warn("Failed to list tmux panes", { error: String(e) });
    return [];
  }
}

/**
 * Find the tmux pane running claude in the given cwd.
 * Returns a human-readable label like "session:window" or null.
 */
export function resolveLabel(cwd: string): string | null {
  const panes = listClaudePanes();
  const match = panes.find((p) => p.paneCwd === cwd);
  if (!match) return null;
  return match.windowName;
}

export function sendKeys(paneTarget: string, text: string): void {
  try {
    execSync(`tmux send-keys -t ${JSON.stringify(paneTarget)} ${JSON.stringify(text)} Enter`, {
      encoding: "utf-8",
      timeout: 5000,
    });
    log.info("Sent keys to pane", { paneTarget, text: text.slice(0, 100) });
  } catch (e) {
    log.error("Failed to send keys", { paneTarget, error: String(e) });
    throw new Error(`Failed to send keys to pane ${paneTarget}: ${e}`);
  }
}
