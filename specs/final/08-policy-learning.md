# 8. Policy Learning

ClaudeCube implements a feedback loop where human decisions are encoded as persistent policies that inform future automated evaluations. When a user replies to a Telegram approval request with text, that text becomes a policy that the LLM evaluator considers in subsequent decisions.

## 8.1 Policy Schema and Storage

### Policy Model

```typescript
interface Policy {
  id: string;            // auto-generated, format "pol_<N>"
  description: string;   // human-written policy text
  tool?: string;         // optional tool scope (supports pipe-separated)
  createdAt: string;     // ISO 8601 timestamp
}
```

### Zod Schemas (from `src/policies/types.ts`)

```typescript
const PolicySchema = z.object({
  id: z.string(),
  description: z.string(),
  tool: z.string().optional(),
  createdAt: z.string(),
});

const PoliciesFileSchema = z.object({
  policies: z.array(PolicySchema).default([]),
});
```

### Storage (from `src/policies/store.ts`)

The `PolicyStore` class manages policies in memory with YAML file persistence.

```typescript
class PolicyStore {
  constructor(filePath: string);
  add(description: string, tool?: string): Policy;
  remove(id: string): boolean;
  getAll(): Policy[];
  getForTool(toolName: string): Policy[];
  formatForLlm(toolName?: string): string;
}
```

**File location**: `config/policies.yaml` (relative to the process working directory).

**Persistence**: The file is written synchronously on every `add()` and `remove()` call using `yaml.stringify()`.

**Loading**: On construction, attempts to read and parse the YAML file. If the file does not exist or is invalid, starts with an empty policy list.

**ID generation**: Auto-incrementing counter (`pol_0`, `pol_1`, ...). On load, the counter is set past any existing numeric IDs to avoid collisions.

## 8.2 Policy Creation Workflow

```
1. User receives a Telegram approval request for a tool call
2. Instead of tapping Approve/Deny, the user replies with text:
   "Always allow npm install in this project"
3. ApprovalManager resolves with:
   { approved: true, policyText: "Always allow npm install in this project" }
4. EscalationHandler detects policyText and calls:
   policyStore.add("Always allow npm install in this project", "Bash")
5. PolicyStore assigns ID "pol_0", saves to config/policies.yaml
6. Tool call is approved
```

## 8.3 Policy Retrieval and LLM Formatting

### Retrieval

`getForTool(toolName)` returns policies that apply to a given tool:
- Policies with no `tool` field (global policies) always match.
- Policies with a `tool` field match if the field, split on `"|"`, includes `toolName`.

### LLM Formatting

`formatForLlm(toolName?)` produces a text block included in the LLM evaluator's prompt:

```
Human-defined policies:
- [pol_0] Always allow npm install in this project (applies to: Bash)
- [pol_1] Deny any edits to the database schema
```

Returns empty string if no relevant policies exist.

## 8.4 Feedback Loop Design

```
                 +-------------------+
                 |  Human (Telegram) |
                 +-------------------+
                   |             ^
         text reply|             | approval request
                   v             |
           +---------------+    |
           |  PolicyStore  |    |
           +---------------+    |
                   |             |
       formatForLlm|             |
                   v             |
           +---------------+    |
           | LLM Evaluator |----+
           +---------------+    uncertain/deny
                   |
           confident allow
                   v
           [Tool call approved]
```

The feedback loop progressively reduces the number of decisions that need human input:
1. Initially, many tool calls escalate to Telegram because the LLM has no policy context.
2. As the human replies with policy text, policies accumulate.
3. The LLM evaluator includes these policies in future evaluations.
4. The system prompt tells the LLM to follow policies with `confident=true`.
5. Over time, more decisions are made autonomously by the LLM.

### Constraints

- Policies are scoped to the specific tool name used in the original approval request.
- There is no mechanism to edit policies via Telegram -- only add (via text reply) and the `remove()` API exists but is not exposed through any UI.
- Policy persistence is per-installation (stored in a local YAML file). Policies are not shared across ClaudeCube instances.
- No deduplication: identical policy text can be saved multiple times.

## 8.5 Policy-to-Rule Promotion

Policies are soft guidance for the LLM evaluator. Over time, stable policies should be promoted to hard rules in `config/rules.yaml` for faster evaluation (skips the LLM entirely) and deterministic behavior.

### Promotion Mechanism

A Claude skill (or manual process) can promote policies to rules:

1. Read `config/policies.yaml` and present the list of active policies.
2. For each policy the user wants to promote, determine:
   - The appropriate rule `action` (`allow` or `deny`)
   - The tool name scope
   - Any match patterns to extract from the policy description
3. Write the new rule entry to `config/rules.yaml`.
4. The [hot-reload mechanism](02-safety-rules.md#25-hot-reload-support) picks up the change automatically.
5. Optionally, remove the promoted policy from `config/policies.yaml` to avoid redundancy.

### Example

Policy: `"Always allow npm install in this project"` (tool: `Bash`)

Promoted rule:
```yaml
- name: Allow npm install
  action: allow
  tool: Bash
  match:
    command:
      - pattern: "^npm\\s+install"
        type: regex
```

## Cross-References

- Policy creation is triggered during [Escalation](04-llm-evaluation.md) when the user replies with text.
- The Telegram text reply mechanism is described in [Telegram Integration](06-telegram.md).
- The LLM evaluator's use of policies is described in [LLM-Based Evaluation](04-llm-evaluation.md).
