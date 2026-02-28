import { readFileSync } from "node:fs";
import { createLogger } from "../util/logger.js";

const log = createLogger("transcript-reader");

export interface TranscriptMessage {
  role: "user" | "assistant";
  text: string;
  toolUses: { name: string; inputSummary: string }[];
}

export interface TranscriptExcerpt {
  messages: TranscriptMessage[];
  totalMessages: number;
}

/** Types we care about when scanning transcript JSONL */
const RELEVANT_TYPES = new Set(["user", "assistant"]);

/**
 * Read a Claude Code JSONL transcript and extract user/assistant messages.
 * @param transcriptPath Absolute path to the .jsonl file
 * @param lastN If provided, return only the last N messages
 */
export function readTranscript(transcriptPath: string, lastN?: number): TranscriptExcerpt {
  let lines: string[];
  try {
    const raw = readFileSync(transcriptPath, "utf-8");
    lines = raw.split("\n").filter((l) => l.trim().length > 0);
  } catch (e) {
    log.warn("Failed to read transcript file", { path: transcriptPath, error: String(e) });
    return { messages: [], totalMessages: 0 };
  }

  const messages: TranscriptMessage[] = [];

  for (const line of lines) {
    try {
      const entry = JSON.parse(line) as {
        type?: string;
        message?: {
          role?: string;
          content?: string | Array<{ type: string; text?: string; name?: string; input?: unknown }>;
        };
      };

      if (!entry.type || !RELEVANT_TYPES.has(entry.type) || !entry.message) continue;

      const role = entry.message.role as "user" | "assistant";
      if (role !== "user" && role !== "assistant") continue;

      const content = entry.message.content;
      let text = "";
      const toolUses: { name: string; inputSummary: string }[] = [];

      if (typeof content === "string") {
        text = content;
      } else if (Array.isArray(content)) {
        const textParts: string[] = [];
        for (const block of content) {
          if (block.type === "text" && block.text) {
            textParts.push(block.text);
          } else if (block.type === "tool_use" && block.name) {
            const inputStr = block.input ? JSON.stringify(block.input) : "";
            toolUses.push({
              name: block.name,
              inputSummary: inputStr.length > 120 ? inputStr.slice(0, 117) + "..." : inputStr,
            });
          }
        }
        text = textParts.join("\n");
      }

      messages.push({ role, text, toolUses });
    } catch {
      // Skip unparseable lines
    }
  }

  const totalMessages = messages.length;
  const result = lastN && lastN < messages.length ? messages.slice(-lastN) : messages;

  return { messages: result, totalMessages };
}

/**
 * Format an excerpt's recent activity for display in Telegram messages.
 * Shows the last few messages with role, truncated text, and tool names.
 */
export function formatRecentActivity(excerpt: TranscriptExcerpt, maxMessages = 5): string {
  const recent = excerpt.messages.slice(-maxMessages);
  const lines: string[] = [];

  for (const msg of recent) {
    const label = msg.role === "user" ? "User" : "Agent";
    const truncatedText = msg.text.length > 150 ? msg.text.slice(0, 147) + "..." : msg.text;

    if (truncatedText) {
      lines.push(`  ${label}: ${truncatedText}`);
    }
    if (msg.toolUses.length > 0) {
      const tools = msg.toolUses.map((t) => t.name).join(", ");
      lines.push(`    Tools: ${tools}`);
    }
  }

  return lines.join("\n");
}

/**
 * Extract recent tool names from the last few assistant messages.
 * Returns a compact string like "Edit(src/foo.ts), Bash(npm test), Read(package.json)"
 */
export function extractRecentTools(excerpt: TranscriptExcerpt, maxTools = 6): string {
  const tools: string[] = [];
  // Walk backwards through messages to collect tools
  for (let i = excerpt.messages.length - 1; i >= 0 && tools.length < maxTools; i--) {
    const msg = excerpt.messages[i];
    if (msg.role !== "assistant") continue;
    for (const tu of msg.toolUses) {
      if (tools.length >= maxTools) break;
      const summary = tu.inputSummary.length > 30 ? tu.inputSummary.slice(0, 27) + "..." : tu.inputSummary;
      tools.push(`${tu.name}(${summary})`);
    }
  }
  return tools.join(", ");
}
