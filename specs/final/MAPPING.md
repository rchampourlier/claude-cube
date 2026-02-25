# Exploration-to-Final Specification Mapping

This document maps each exploration specification to its location(s) in the final specification.

## Source File to Final Section

| Source File | Exploration Spec | Final Section(s) |
|---|---|---|
| `src/util/logger.ts` | `exploration/util/logger.md` | [10.5 Logging System](10-infrastructure.md#105-logging-system) |
| `src/config/types.ts` | `exploration/config/types.md` | [9.1 Orchestrator Configuration](09-configuration.md#91-orchestrator-configuration) |
| `src/config/loader.ts` | `exploration/config/loader.md` | [9.1 Orchestrator Configuration](09-configuration.md#91-orchestrator-configuration) |
| `src/rule-engine/types.ts` | `exploration/rule-engine/types.md` | [2.1 Rule Definition Language](02-safety-rules.md#21-rule-definition-language) |
| `src/rule-engine/parser.ts` | `exploration/rule-engine/parser.md` | [2.3 Rule Loading and Validation](02-safety-rules.md#23-rule-loading-and-validation) |
| `src/rule-engine/engine.ts` | `exploration/rule-engine/engine.md` | [2.4 Rule Evaluation Engine](02-safety-rules.md#24-rule-evaluation-engine) |
| `src/policies/types.ts` | `exploration/policies/types.md` | [8.1 Policy Schema and Storage](08-policy-learning.md#81-policy-schema-and-storage) |
| `src/policies/store.ts` | `exploration/policies/store.md` | [8.1 Policy Schema and Storage](08-policy-learning.md#81-policy-schema-and-storage) |
| `src/escalation/llm-evaluator.ts` | `exploration/escalation/llm-evaluator.md` | [4.1 LLM Evaluator](04-llm-evaluation.md#41-llm-evaluator) |
| `src/escalation/handler.ts` | `exploration/escalation/handler.md` | [4.2 Escalation Handler](04-llm-evaluation.md#42-escalation-handler) |
| `src/hooks/pre-tool-use.ts` | `exploration/hooks/pre-tool-use.md` | [3.1 PreToolUse Handler](03-permission-evaluation.md#31-pretooluse-handler) |
| `src/hooks/stop.ts` | `exploration/hooks/stop.md` | [5 Stop Handling](05-stop-handling.md) |
| `src/hooks/lifecycle.ts` | `exploration/hooks/lifecycle.md` | [7.3 Session Lifecycle Hooks](07-session-management.md#73-session-lifecycle-hooks) |
| `src/hooks/audit-hook.ts` | `exploration/hooks/audit-hook.md` | [3.3 Audit Logging](03-permission-evaluation.md#33-audit-logging) |
| `src/telegram/bot.ts` | `exploration/telegram/bot.md` | [6.1 Bot Setup and Lifecycle](06-telegram.md#61-bot-setup-and-lifecycle) |
| `src/telegram/approval.ts` | `exploration/telegram/approval.md` | [6.3 Permission Approval Flow](06-telegram.md#63-permission-approval-flow), [6.5 Stop Decision Flow](06-telegram.md#65-stop-decision-flow) |
| `src/telegram/notifications.ts` | `exploration/telegram/notifications.md` | [6.6 Session Notifications](06-telegram.md#66-session-notifications) |
| `src/session-tracker.ts` | `exploration/infrastructure/session-tracker.md` | [7.1 Session Tracker](07-session-management.md#71-session-tracker) |
| `src/tmux.ts` | `exploration/infrastructure/tmux.md` | [7.2 Tmux Integration](07-session-management.md#72-tmux-integration) |
| `src/installer.ts` | `exploration/infrastructure/installer.md` | [10.2 Hook Installation](10-infrastructure.md#102-hook-installation) |
| `src/server.ts` | `exploration/infrastructure/server.md` | [10.1 HTTP Server](10-infrastructure.md#101-http-server) |
| `src/index.ts` | `exploration/infrastructure/index.md` | [10.4 CLI Entry Point](10-infrastructure.md#104-cli-entry-point-and-bootstrap) |
| `config/orchestrator.yaml` | `exploration/infrastructure/orchestrator-yaml.md` | [9.1 Orchestrator Configuration](09-configuration.md#91-orchestrator-configuration) |
| `config/rules.yaml` | `exploration/infrastructure/rules-yaml.md` | [2.2 Default Rules](02-safety-rules.md#22-default-rules) |
| `hooks/claudecube-hook.sh` | `exploration/infrastructure/hook-script.md` | [10.3 Shell Script Bridge](10-infrastructure.md#103-shell-script-bridge) |
| Various config files | `exploration/infrastructure/project-config.md` | [10.6 Project Configuration](10-infrastructure.md#106-project-configuration) |
| Barrel exports | `exploration/infrastructure/barrel-exports.md` | Not separately documented; covered within their respective sections |

## Final Section to Exploration Specs

| Final Section | Exploration Specs Used |
|---|---|
| [02 Safety Rules](02-safety-rules.md) | rule-engine/types.md, rule-engine/parser.md, rule-engine/engine.md, infrastructure/rules-yaml.md |
| [03 Permission Evaluation](03-permission-evaluation.md) | hooks/pre-tool-use.md, hooks/audit-hook.md |
| [04 LLM Evaluation](04-llm-evaluation.md) | escalation/llm-evaluator.md, escalation/handler.md |
| [05 Stop Handling](05-stop-handling.md) | hooks/stop.md |
| [06 Telegram](06-telegram.md) | telegram/bot.md, telegram/approval.md, telegram/notifications.md |
| [07 Session Management](07-session-management.md) | infrastructure/session-tracker.md, infrastructure/tmux.md, hooks/lifecycle.md |
| [08 Policy Learning](08-policy-learning.md) | policies/types.md, policies/store.md |
| [09 Configuration](09-configuration.md) | config/types.md, config/loader.md, infrastructure/orchestrator-yaml.md, infrastructure/rules-yaml.md (brief) |
| [10 Infrastructure](10-infrastructure.md) | infrastructure/server.md, infrastructure/index.md, infrastructure/installer.md, infrastructure/hook-script.md, util/logger.md, infrastructure/project-config.md |

## Observations Document

The [exploration/notes.md](../exploration/notes.md) findings are incorporated throughout the final specs as inline notes (e.g., "NOT ENFORCED", "vestigial", "never called"). The notes document remains the canonical reference for all observations.
