# `src/policies/types.ts` -- Policy Type Definitions

## Purpose

Defines Zod schemas and TypeScript types for the human-defined policy system. Policies are created at runtime when a user replies to a Telegram approval request with text, allowing the user to teach the LLM evaluator custom policies over time.

## Public Interface

### Zod Schemas

#### `PolicySchema`

```typescript
z.object({
  id: z.string(),
  description: z.string(),
  tool: z.string().optional(),
  createdAt: z.string(),
})
```

A single policy record. `id` is an auto-generated identifier (e.g., `"pol_0"`, `"pol_1"`). `description` is the free-text policy instruction provided by the human. `tool` optionally scopes the policy to specific tool names (supports pipe-separated format like `"Write|Edit"`). `createdAt` is an ISO 8601 timestamp string.

#### `PoliciesFileSchema`

```typescript
z.object({
  policies: z.array(PolicySchema).default([]),
})
```

The top-level schema for the `config/policies.yaml` persistence file.

### Inferred Types

| Type Name | Schema Source |
|---|---|
| `Policy` | `z.infer<typeof PolicySchema>` |
| `PoliciesFile` | `z.infer<typeof PoliciesFileSchema>` |

## Dependencies

- `zod` (external) -- runtime schema validation and type inference.

## Constraints & Invariants

- `id` and `description` are required strings.
- `tool` is optional, allowing a policy to apply globally or to specific tools.
- `policies` defaults to an empty array if absent in the YAML file.
