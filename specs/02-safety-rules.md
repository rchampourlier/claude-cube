# 2. Safety Rule System

The safety rule system is the first line of defense in ClaudeCube's permission decision pipeline. Every tool call from a monitored Claude Code session is evaluated against a set of configurable rules before any other evaluation occurs.

## 2.1 Rule Definition Language

Rules are defined in YAML (`config/rules.yaml`) and validated at load time using Zod schemas.

### Rule Schema

Each rule has the following fields:

```yaml
- name: "Human-readable rule name"
  action: deny | allow | escalate
  tool: "ToolName"              # supports pipe-separated: "Write|Edit"
  match:                        # optional -- omit to match all uses of the tool
    field_name:                 # matches against tool input fields
      - pattern: "^src/.*"
        type: regex             # regex, glob, or literal (default: literal)
  reason: "Why this rule exists"  # optional
```

### Match Pattern Types

| Type | Matching Strategy | Example |
|---|---|---|
| `literal` (default) | Exact string equality | `pattern: "npm test"` |
| `regex` | JavaScript RegExp test | `pattern: "^git\\s+push"` |
| `glob` | Micromatch glob | `pattern: "src/**/*.ts"` |

### Tool Name Matching

The `tool` field supports pipe-separated alternatives. For example, `"Write|Edit"` matches tool calls for either `Write` or `Edit`. Tool name matching is exact string comparison (not regex or glob).

### Field Matching Semantics

When `match` is present:
- **OR across fields**: If any field's patterns match, the rule matches.
- **OR within a field**: If any pattern in a field's array matches, that field matches.
- **Missing fields**: If a field specified in `match` is not present in the tool input, that field is skipped.
- **No match block**: If `match` is omitted entirely, the rule matches all uses of the specified tool(s).

Field names support dot-notation for nested access (e.g., `"nested.field"` resolves `toolInput.nested.field`).

### Top-Level Configuration

```yaml
version: "1"
defaults:
  unmatched: "escalate"           # action when no rule matches
  max_budget_per_agent: 5.00      # NOT ENFORCED (placeholder)
  max_turns_per_agent: 50         # NOT ENFORCED (placeholder)
rules:
  - ...
```

### Zod Schemas (from `src/rule-engine/types.ts`)

```typescript
const MatchPatternSchema = z.object({
  pattern: z.string(),
  type: z.enum(["regex", "glob", "literal"]).default("literal"),
});

const RuleMatchSchema = z.record(z.string(), z.array(MatchPatternSchema));

const RuleSchema = z.object({
  name: z.string(),
  action: z.enum(["deny", "allow", "escalate"]),
  tool: z.string(),
  match: RuleMatchSchema.optional(),
  reason: z.string().optional(),
});

const RulesDefaultsSchema = z.object({
  unmatched: z.enum(["deny", "allow", "escalate"]).default("escalate"),
  max_budget_per_agent: z.number().positive().default(5.0),
  max_turns_per_agent: z.number().int().positive().default(50),
});

const RulesConfigSchema = z.object({
  version: z.string(),
  defaults: RulesDefaultsSchema,
  rules: z.array(RuleSchema),
});
```

**Exported types**: `MatchPattern`, `RuleMatch`, `Rule`, `RulesDefaults`, `RulesConfig`, `RuleAction`, `EvaluationResult`.

## 2.2 Default Rules

The shipped `config/rules.yaml` includes the following rules:

### Deny Rules (Checked First)

| Name | Tool | Match | Reason |
|---|---|---|---|
| Block destructive commands | `Bash` | `command` matches `rm\s+(-[a-zA-Z]*f[a-zA-Z]*\s+)?/` (regex) | Destructive filesystem command blocked |
| Block force push | `Bash` | `command` matches `git\s+push\s+.*--force` (regex) | Force push blocked |
| Block sensitive file edits | `Write\|Edit` | `file_path` matches `\.(env\|pem)$\|credentials\|secrets?` (regex) | Sensitive file modification blocked |

### Allow Rules (Checked Second)

| Name | Tool | Match | Reason |
|---|---|---|---|
| Allow read-only tools | `Read\|Glob\|Grep` | (none -- matches all) | -- |
| Allow edits within src/ | `Write\|Edit` | `file_path` matches `^.*/src/.*` (regex) | -- |
| Allow safe dev commands | `Bash` | `command` matches `^(npm\|npx\|yarn\|pnpm)\s+(test\|lint\|build\|run\|check\|tsc)` or `^git\s+(status\|log\|diff\|branch\|show\|add\|commit)` (regex) | -- |

### Default Action

Unmatched tool calls: **escalate** (sends to LLM evaluator, then potentially Telegram).

## 2.3 Rule Loading and Validation

Rules are loaded by `loadRules()` in `src/rule-engine/parser.ts`:

1. Read YAML file synchronously (`readFileSync`).
2. Parse YAML to JavaScript object (`yaml.parse`).
3. Validate against `RulesConfigSchema` (Zod).
4. **Regex pre-validation**: All regex patterns are compiled (`new RegExp(...)`) at load time. Invalid regex throws an error with the rule name, field, and pattern.
5. Log summary: total rule count and breakdown by action.

This function is called once at startup. It is synchronous and throws on any validation error, ensuring the server does not start with invalid rules.

## 2.4 Rule Evaluation Engine

The `RuleEngine` class (`src/rule-engine/engine.ts`) evaluates tool calls against the loaded rules.

### Construction

```typescript
const engine = new RuleEngine(rulesConfig);
```

Rules are partitioned at construction time into three arrays:
- `denyRules` -- all rules with `action: "deny"`
- `allowRules` -- all rules with `action: "allow"`
- `escalateRules` -- all rules with `action: "escalate"`

### Evaluation Method

```typescript
evaluate(toolName: string, toolInput: Record<string, unknown>): EvaluationResult
```

**Evaluation order (deny-first)**:
1. Check all deny rules. First match returns `{ action: "deny", rule, reason }`.
2. Check all allow rules. First match returns `{ action: "allow", rule, reason }`.
3. Check all escalate rules. First match returns `{ action: "escalate", rule, reason }`.
4. If no rule matches, returns `{ action: defaultAction, rule: null, reason }`.

Within each category, rules are evaluated in array order (the order they appear in the YAML file). **First match wins**.

### Pattern Matching Implementation

| Pattern Type | Implementation |
|---|---|
| `literal` | `value === pattern.pattern` |
| `regex` | `new RegExp(pattern.pattern).test(value)` |
| `glob` | `micromatch.isMatch(value, pattern.pattern)` |

Note: Regex patterns are compiled fresh on each match check. There is no regex caching.

### Dependencies

- `micromatch` (external) -- glob pattern matching
- `src/rule-engine/types.ts` -- type definitions
- `src/util/logger.ts` -- structured logging

### Design Properties

- **Stateless**: The engine has no side effects. The same input always produces the same output.
- **Thread-safe**: Can evaluate multiple tool calls concurrently.
- **Deny-first**: Safety-critical operations are blocked before any allow rules are considered.

## 2.5 Hot-Reload Support

The rule engine supports runtime reloading of `config/rules.yaml` when the file is modified. This enables humans to add or modify rules (e.g., via Telegram escalation feedback) without restarting ClaudeCube.

### Mechanism

1. At startup, a `fs.watch()` watcher is set on the rules YAML file.
2. On file change, the file is re-read, re-parsed, and re-validated (same pipeline as initial load).
3. If validation succeeds, the `RuleEngine` instance is replaced atomically (swap the reference used by the PreToolUse handler).
4. If validation fails (bad YAML, invalid regex, schema error), the change is rejected and a warning is logged. The previous valid rule engine remains active.

### Design Properties

- **Atomic swap**: The PreToolUse handler always sees either the old or the new rule engine, never a partially-constructed one.
- **Fail-safe**: Invalid edits to `rules.yaml` are logged and ignored — they never break the running system.
- **Debounced**: File change events are debounced (e.g., 500ms) to handle editors that write files in multiple steps.

### Integration with Telegram Feedback

When a human replies to an escalation with a rule directive (e.g., `- add rule: allow npm install`), the system can write the new rule to `config/rules.yaml`. The file watcher picks up the change and reloads automatically. This closes the loop between human feedback and rule enforcement.

## Cross-References

- The rule engine is invoked by the [PreToolUse handler](03-permission-evaluation.md) as the first step in permission evaluation.
- When the rule engine returns `"escalate"`, the [Escalation pipeline](04-llm-evaluation.md) takes over.
- Rules configuration is covered in [Configuration](09-configuration.md).
- Hot-reload is triggered when rules are created via [Telegram text reply evaluation](06-telegram.md).
