# 11. Transcript Analysis

ClaudeCube can read and summarize Claude Code session transcripts to provide richer context in Telegram interactions. This capability powers the "Details" button on approval requests and the enriched stop messages.

## 11.1 Transcript Path Tracking

Claude Code provides a `transcript_path` field in all hook event payloads (`PreToolUseInput`, `StopInput`, `SessionStartInput`, `SessionEndInput`). ClaudeCube stores this path in the `SessionTracker` so it can be accessed later for on-demand analysis.

### Storage

The `SessionInfo` model includes a `transcriptPath` field:

```typescript
interface SessionInfo {
  // ... existing fields ...
  transcriptPath: string | null;
}
```

### Wiring

All hook handlers pass `transcript_path` through to the session tracker:

- `SessionStart` handler: `sessionTracker.register(sessionId, cwd, transcriptPath)`
- `PreToolUse` handler: `sessionTracker.ensureRegistered(sessionId, cwd, transcriptPath)`
- `Stop` handler: `sessionTracker.ensureRegistered(sessionId, cwd, transcriptPath)`

`ensureRegistered()` stores the transcript path when first provided, even if the session was already registered. Synthetic sessions discovered via tmux scanning have `transcriptPath: null` (unavailable until the first hook event provides it).

## 11.2 Transcript Reader

The reader (`src/transcript/reader.ts`) parses Claude Code's JSONL transcript files.

### Data Model

```typescript
interface TranscriptMessage {
  role: "user" | "assistant";
  text: string;
  toolUses: { name: string; inputSummary: string }[];
}

interface TranscriptExcerpt {
  messages: TranscriptMessage[];
  totalMessages: number;
}
```

### Parsing Logic

Each line in the transcript file is a JSON object. The reader:

1. Reads the file synchronously via `readFileSync`.
2. Parses each line as JSON.
3. Filters for entries with `type: "user"` or `type: "assistant"` (skipping `progress`, `file-history-snapshot`, `queue-operation`, and other meta types).
4. For each relevant entry, extracts:
   - **Text content**: from `message.content` (string or array of text blocks)
   - **Tool uses** (assistant only): `tool_use` blocks with name and truncated input summary (max 120 chars)

### API

```typescript
function readTranscript(transcriptPath: string, lastN?: number): TranscriptExcerpt;
```

If `lastN` is provided, returns only the last N messages. The `totalMessages` field always reflects the full count.

On file read errors, returns `{ messages: [], totalMessages: 0 }` (never throws).

### Formatting Helpers

```typescript
function formatRecentActivity(excerpt: TranscriptExcerpt, maxMessages?: number): string;
```

Formats the last few messages for display in Telegram, showing role, truncated text (max 150 chars), and tool names. Default `maxMessages` is 5.

```typescript
function extractRecentTools(excerpt: TranscriptExcerpt, maxTools?: number): string;
```

Extracts recent tool names from assistant messages, returning a compact string like `Edit(src/foo.ts), Bash(npm test), Read(package.json)`. Default `maxTools` is 6.

## 11.3 Transcript Summarizer

The summarizer (`src/transcript/summarizer.ts`) uses an LLM to produce a concise session summary from a transcript excerpt. It follows the same Anthropic SDK pattern as `LlmEvaluator` and `ReplyEvaluator`.

### API

```typescript
async function summarizeTranscript(
  excerpt: TranscriptExcerpt,
  model?: string,
): Promise<string>;
```

Default model: `claude-haiku-4-5-20251001`.

### System Prompt

The LLM is instructed to produce 3-5 sentences covering:
1. What is the user's goal or task?
2. What has the agent accomplished so far?
3. What is the current status (working, stuck, waiting for input, or finished)?

### Token Management

- Each message is truncated to 600 characters before being sent to the LLM.
- Total conversation text is capped at 8000 characters.
- Max output tokens: 300.

### Error Handling

- Empty excerpt: returns `"No transcript messages available."` without calling the LLM.
- LLM API errors: throws (callers are expected to handle gracefully).

## 11.4 Integration Points

### Approval Details (Use Case 1)

When the user taps the "Details" button on an approval request (see [Telegram Integration](06-telegram.md)):
1. Look up `transcriptPath` via `sessionTracker.getTranscriptPath(sessionId)`.
2. Read the last 15 messages via `readTranscript()`.
3. Generate an LLM summary via `summarizeTranscript()`.
4. Send the summary as a reply to the approval message.

### Stop Analysis (Use Case 2)

When a session stops and is escalated to Telegram (see [Stop Handling](05-stop-handling.md)):
1. Read the last 15 messages from the transcript.
2. Extract recent tool names via `extractRecentTools()`.
3. Generate an LLM summary via `summarizeTranscript()`.
4. Include the summary and recent tools in the stop decision message.

### Graceful Degradation

Both integration points degrade gracefully:
- No transcript path available: skip analysis, fall back to current behavior.
- Transcript file unreadable: skip analysis.
- LLM summarization fails: include the message without a summary.

The stop and approval flows never fail because of transcript analysis errors.

## File Listing

| File | Purpose |
|------|---------|
| `src/transcript/reader.ts` | JSONL parser, formatting helpers |
| `src/transcript/summarizer.ts` | LLM-based summary generation |
| `src/transcript/index.ts` | Barrel export |

## Cross-References

- Transcript path is stored in the [Session Tracker](07-session-management.md).
- The "Details" button is part of the [Telegram approval flow](06-telegram.md).
- Stop analysis is part of the [Stop Handling](05-stop-handling.md) flow.
- The summarizer uses the same Anthropic SDK pattern as the [LLM Evaluator](04-llm-evaluation.md).
