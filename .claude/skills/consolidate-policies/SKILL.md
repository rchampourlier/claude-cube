---
name: consolidate-policies
description: This skill should be used when the user asks to "consolidate policies", "merge policies", "clean up policies", "deduplicate policies", "simplify policies", or /consolidate-policies. It analyzes accumulated policies and suggests merges to reduce token usage in the LLM evaluator prompt.
version: 1.1.0
---

# Policy Consolidation

This skill analyzes policies in the claude-cube permission orchestrator and suggests merges to keep the policy list lean. Policies are injected into the LLM evaluator prompt, so fewer entries means less token usage and better signal.

## Policy File Locations

- **Shared policies**: `~/.config/claude-cube/policies.yaml` — user-editable, persisted across sessions
- **Local policies**: `~/.config/claude-cube/policies.local.yaml` — machine-specific, grows organically via Telegram approvals

## Policy Format

Each policy has three fields:

```yaml
- id: pol_0
  description: human-readable description of what is allowed
  tool: ToolName          # optional; pipe-separated for multiple tools (e.g. Task|TaskCreate)
```

The `tool` field supports pipe-separated values (e.g. `Task|TaskCreate|TaskUpdate|TaskOutput`), matched in `PolicyStore.getForTool()`.

## Writing Style

All policy descriptions must follow a consistent style:

- **Imperative verb-first**: start with a lowercase verb describing the action (e.g. `read/write files in...`, `git push to remote...`, `use task-related tools...`)
- **No filler phrases**: avoid "it's ok to", "is always authorized", "can be authorized automatically" — the policy's existence already implies authorization
- **Repo-scoped policies** use the suffix `Authorized repos: repo1, repo2` so the repo list is easy to scan and extend

Examples of well-written descriptions:
```
git push to remote (no --force). Authorized repos: lca-rust, carbonfact
read/write files in ~/.config and ~/.claude, including git operations
use task-related tools (Task, TaskCreate, TaskUpdate, TaskOutput)
explore files and directories in ~/projects
```

## Consolidation Procedure

### Step 1 — Load policies

Read both policy files:
- `~/.config/claude-cube/policies.yaml`
- `~/.config/claude-cube/policies.local.yaml`

Present a numbered list of all current policies to the user, grouped by tool.

### Step 2 — Identify consolidation opportunities

Analyze for these patterns, in priority order:

1. **Repo-scoped patterns**: Look for the same action authorized across multiple repos as separate policies. Extract the common action and list all repos in a single policy with the `Authorized repos: ...` suffix. This is the most important pattern — it makes expanding permissions to new repos trivial (just append to the list). Examples of common repo-scoped actions:
   - git push
   - build/run project
   - read/write project files
   - run project tests or CI scripts

2. **Same-tool overlap**: Multiple policies for the same tool covering related concerns within one project or context can merge into a single broader policy.

3. **Subset policies**: A narrow policy already covered by a broader one — keep only the broader one.

4. **Tool family merging**: Separate policies for closely related tools that share the same intent. Merge into one policy with a pipe-separated `tool` field.

### Step 3 — Present suggestions

Display a markdown table with columns:

| Current policies | Proposed merged policy | Rationale |
|---|---|---|
| pol_X (push lca-rust), pol_Y (push carbonfact) | `git push to remote (no --force). Authorized repos: lca-rust, carbonfact` | Same action across repos; use repo list for easy expansion |
| pol_A, pol_B, pol_C, pol_D | `tool: Task\|TaskCreate\|TaskUpdate\|TaskOutput` — "use task-related tools" | Four policies with identical intent |

Include a summary line: "This would reduce N policies down to M."

### Step 4 — Normalize style

After merging, rewrite all descriptions (including untouched policies) to follow the writing style rules above. Present a before/after diff so the user can review wording changes.

### Step 5 — Apply changes

Ask the user to approve all suggestions, a subset, or none.

On approval:
1. Apply the approved merges and style rewrites
2. Re-number IDs sequentially (`pol_0`, `pol_1`, `pol_2`, ...)
3. Rewrite `config/policies.local.yaml` using the Write tool
4. Leave `~/.config/claude-cube/policies.yaml` unchanged (shared policies are managed separately)
5. Show the final policy list for confirmation

### Important constraints

- Never remove a policy without explicit user approval
- Never modify `~/.config/claude-cube/policies.yaml` — only touch `~/.config/claude-cube/policies.local.yaml`
- When merging, the new description must be at least as broad as the union of the originals
- Preserve the YAML structure: top-level `policies:` key containing a list
- After rewriting, verify the file parses correctly by reading it back
