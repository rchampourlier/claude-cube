import { execSync } from "node:child_process";
import { createLogger } from "./util/logger.js";

const log = createLogger("tmux");

export interface TmuxPane {
  sessionName: string;
  windowIndex: string;
  paneIndex: string;
  paneId: string;
  command: string;
}

export function listClaudePanes(): TmuxPane[] {
  try {
    const output = execSync(
      "tmux list-panes -a -F '#{session_name}|#{window_index}|#{pane_index}|#{pane_id}|#{pane_current_command}'",
      { encoding: "utf-8", timeout: 5000 },
    );
    return output
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [sessionName, windowIndex, paneIndex, paneId, command] = line.split("|");
        return { sessionName, windowIndex, paneIndex, paneId, command };
      })
      .filter((p) => p.command === "claude" || p.command.includes("claude"));
  } catch (e) {
    log.warn("Failed to list tmux panes", { error: String(e) });
    return [];
  }
}

export function sendKeys(paneTarget: string, text: string): void {
  try {
    // Use tmux send-keys to inject text into a pane
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
