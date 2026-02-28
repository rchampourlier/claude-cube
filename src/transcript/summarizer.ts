import Anthropic from "@anthropic-ai/sdk";
import type { TranscriptExcerpt } from "./reader.js";
import { createLogger } from "../util/logger.js";

const log = createLogger("transcript-summarizer");

const SYSTEM_PROMPT = `You summarize the activity of an automated coding agent session based on its conversation transcript.

Produce a concise summary (3-5 sentences) covering:
1. What is the user's goal or task?
2. What has the agent accomplished so far?
3. What is the current status — working, stuck, waiting for input, or finished?

Be factual and specific. Mention file names, tool names, or error messages when relevant. Do not speculate. Write in plain text, no markdown.`;

const MAX_CHARS_PER_MESSAGE = 600;
const MAX_TOTAL_CHARS = 8000;

/**
 * Use an LLM to produce a concise summary of a transcript excerpt.
 */
export async function summarizeTranscript(
  excerpt: TranscriptExcerpt,
  model = "claude-haiku-4-5-20251001",
): Promise<string> {
  if (excerpt.messages.length === 0) {
    return "No transcript messages available.";
  }

  const conversationText = buildConversationText(excerpt);

  try {
    const client = new Anthropic();

    log.info("Summarizing transcript", { messageCount: excerpt.messages.length, model });

    const response = await client.messages.create({
      model,
      max_tokens: 300,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Here is the conversation transcript (${excerpt.totalMessages} total messages, showing last ${excerpt.messages.length}):\n\n${conversationText}`,
        },
      ],
    });

    const text = response.content[0]?.type === "text" ? response.content[0].text : "";
    return text.trim() || "Unable to generate summary.";
  } catch (e) {
    log.error("Transcript summarization failed", { error: String(e) });
    throw e;
  }
}

function buildConversationText(excerpt: TranscriptExcerpt): string {
  const parts: string[] = [];
  let totalChars = 0;

  for (const msg of excerpt.messages) {
    const role = msg.role === "user" ? "User" : "Agent";
    let text = msg.text;
    if (text.length > MAX_CHARS_PER_MESSAGE) {
      text = text.slice(0, MAX_CHARS_PER_MESSAGE) + "... [truncated]";
    }

    let entry = `[${role}]: ${text}`;
    if (msg.toolUses.length > 0) {
      const tools = msg.toolUses.map((t) => `${t.name}(${t.inputSummary})`).join(", ");
      entry += `\n  Tools used: ${tools}`;
    }

    if (totalChars + entry.length > MAX_TOTAL_CHARS) break;
    parts.push(entry);
    totalChars += entry.length;
  }

  return parts.join("\n\n");
}
