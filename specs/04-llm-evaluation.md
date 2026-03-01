# 4. LLM-Based Evaluation

When the rule engine escalates a tool call, the escalation pipeline takes over. It implements a two-tier evaluation: the LLM evaluator (Claude Haiku) runs first, and Telegram serves as the human fallback.

## 4.1 LLM Evaluator

The `LlmEvaluator` class (`src/escalation/llm-evaluator.ts`) uses the Anthropic API to assess whether an escalated tool call should be allowed or denied. It accepts an optional `CostTracker` and records token usage after each API call.

### Interface

```typescript
interface LlmEvaluationResult {
  allowed: boolean;
  confident: boolean;
  reason: string;
}

class LlmEvaluator {
  constructor(model: string, confidenceThreshold: number, policyStore: PolicyStore | null = null,
              costTracker: CostTracker | null = null);
  async evaluate(toolName: string, toolInput: Record<string, unknown>,
                 rulesContext: string, escalationReason: string): Promise<LlmEvaluationResult>;
}
```

### System Prompt

The LLM receives a system prompt establishing it as a security evaluator:

> You are a security evaluator for an automated coding agent. You evaluate whether a tool call should be allowed or denied based on safety rules and human-defined policies.

Key instructions in the prompt:
- Respond with JSON: `{ "allowed": boolean, "confident": boolean, "reason": string }`
- Read-only operations are generally safe
- File edits within `src/` are generally safe
- System-modifying commands should be treated cautiously
- **Human-defined policies take precedence** over the LLM's own judgment
- When in doubt, set `confident: false` to escalate to a human

### User Message Format

```
Tool: <toolName>
Input: <JSON-formatted toolInput>

Rules context:
<description of rule engine assessment>

Escalation reason: <why this was escalated>

Human-defined policies:
- [pol_0] <policy description>
- [pol_1] <policy description>
```

### Response Parsing

1. Extract the first text content block from the Anthropic response.
2. Match the first JSON object using regex: `/\{[\s\S]*\}/`.
3. Parse JSON and extract `allowed`, `confident`, `reason`.
4. Defaults: `allowed = false`, `confident = false`, `reason = "No reason provided"`.

### Error Handling

Any error (API failure, network timeout, JSON parse failure) returns `{ allowed: false, confident: false, reason: "LLM evaluation error: ..." }`. This always triggers the Telegram fallback.

### API Configuration

- **Model**: Configurable, default `"claude-haiku-4-5-20251001"`
- **Max tokens**: 256
- **API key**: Read from `ANTHROPIC_API_KEY` environment variable

### Note on `confidenceThreshold`

The `confidenceThreshold` parameter is accepted by the constructor but is **not used** in the current evaluation logic. The LLM's own `confident` boolean from its JSON response is used directly. This parameter is vestigial.

## 4.2 Escalation Handler

The `EscalationHandler` class (`src/escalation/handler.ts`) orchestrates the two-tier pipeline. It accepts an optional `CostTracker` and passes it through to `LlmEvaluator`.

### Interface

```typescript
interface EscalationDecision {
  allowed: boolean;
  reason: string;
  decidedBy: "llm" | "telegram" | "timeout";
}

class EscalationHandler {
  constructor(config: EscalationConfig, approvalManager: ApprovalManager | null,
              policyStore: PolicyStore | null = null,
              costTracker: CostTracker | null = null);
  async evaluate(toolName: string, toolInput: Record<string, unknown>,
                 context: { agentId: string; label?: string; rulesContext: string;
                           escalationReason: string }): Promise<EscalationDecision>;
}
```

### Two-Tier Escalation Flow

```
Step 1: LLM Evaluation
  |
  |-- LLM confident AND allowed
  |     --> return { allowed: true, decidedBy: "llm" }
  |
  |-- LLM confident AND denied
  |     --> escalate to Telegram (LLM never auto-denies)
  |
  |-- LLM uncertain (confident = false)
        --> escalate to Telegram

Step 2: Telegram Escalation
  |
  |-- ApprovalManager is null
  |     --> return { allowed: false, decidedBy: "timeout" }
  |
  |-- ApprovalManager.requestApproval()
        |-- User taps Approve --> return { allowed: true, decidedBy: "telegram" }
        |-- User taps Deny ----> return { allowed: false, decidedBy: "telegram" }
        |-- Timeout ------------> return { allowed: false, decidedBy: "timeout" }
        |-- User replies text --> save policy + return { allowed: true, decidedBy: "telegram" }
```

### Key Design Decision: LLM Never Auto-Denies

The LLM can auto-approve tool calls (when `confident = true` and `allowed = true`) but **never auto-denies**. Even when the LLM is confident in a denial, the decision is escalated to Telegram for human review. This is logged as "LLM confident deny, escalating to Telegram anyway."

**Rationale**: False positives (blocking safe operations) are more disruptive to developer workflow than asking the human to confirm a denial. The LLM may misjudge legitimate operations as unsafe.

### Policy Creation

When the Telegram text reply evaluation produces a policy directive (see [Telegram text reply evaluation](06-telegram.md#64-text-reply-evaluation)):
1. Save the policy: `policyStore.add(policyText, toolName)`.
2. Future LLM evaluations for the same tool will include this policy in their context.

This creates a **feedback loop**: human decisions are encoded as policies that improve future automated decisions. See [Policy Learning](08-policy-learning.md) for details.

### Policy-to-Rule Promotion

Policies are "soft" guidance for the LLM evaluator. For frequently-used policies, they can be promoted to "hard" rules in `config/rules.yaml`. This can be done:
- Via a Claude skill that reads `config/policies.yaml`, presents policies for review, and writes matching rule entries to `config/rules.yaml` (picked up by [hot-reload](02-safety-rules.md#25-hot-reload-support)).
- Manually by the user editing `config/rules.yaml`.

See [Policy Learning](08-policy-learning.md#85-policy-to-rule-promotion) for details.

## 4.3 Policy Integration

The LLM evaluator integrates with the policy store to include human-defined policies in its evaluation context.

### How Policies Reach the LLM

```
PolicyStore.formatForLlm(toolName)
  --> filters policies to those matching the tool (or global policies)
  --> formats as:
      "Human-defined policies:
       - [pol_0] Always allow npm install in this project (applies to: Bash)
       - [pol_1] Deny any edits to database schema"
  --> appended to the user message sent to the LLM
```

The system prompt instructs the LLM: "Human-defined policies take precedence over your own judgment -- if a policy clearly covers this case, follow it and set `confident=true`."

## 4.4 Configuration

The escalation pipeline is configured via `config/orchestrator.yaml`:

```yaml
escalation:
  evaluatorModel: "claude-haiku-4-5-20251001"   # Anthropic model ID
  confidenceThreshold: 0.8                       # NOT USED (vestigial)
  telegramTimeoutSeconds: 300                    # Telegram approval timeout
```

See [Configuration](09-configuration.md) for the full schema.

## 4.5 Cost Tracking

The `CostTracker` class (`src/costs/tracker.ts`) records token usage after every LLM call made by ClaudeCube (both tool evaluation and reply evaluation).

### Storage

Cost entries are stored as JSONL in `.claudecube/audit/costs-YYYY-MM-DD.jsonl` (same directory as audit logs, daily rotation).

### Entry Format

```typescript
interface CostEntry {
  timestamp: string;
  model: string;
  purpose: string;       // "tool-eval" or "reply-eval"
  inputTokens: number;
  outputTokens: number;
  costCents: number;
}
```

### Pricing

A static pricing map converts token counts to cost in cents:

| Model | Input (per 1M tokens) | Output (per 1M tokens) |
|---|---|---|
| `claude-haiku-4-5-20251001` | $1.00 (100¢) | $5.00 (500¢) |

Unknown models fall back to Haiku pricing with a warning.

### API

- `record(model, purpose, usage)` — calculates cost from the pricing map and appends a JSONL line.
- `getTotals()` — reads JSONL files for the current month, returns `{ today: { calls, costCents }, month: { calls, costCents } }`.

### Integration

- `LlmEvaluator` calls `costTracker.record(model, "tool-eval", response.usage)` after each API call.
- `ReplyEvaluator` calls `costTracker.record(model, "reply-eval", response.usage)` after each API call.
- The Telegram `/cost` command reads from `CostTracker.getTotals()` (no admin API key needed).

## Cross-References

- The escalation handler is invoked by the [PreToolUse handler](03-permission-evaluation.md) when the rule engine returns `"escalate"`.
- The Telegram approval flow is described in [Telegram Integration](06-telegram.md).
- Policy creation and storage are described in [Policy Learning](08-policy-learning.md).
- The rule engine that precedes escalation is described in [Safety Rule System](02-safety-rules.md).
