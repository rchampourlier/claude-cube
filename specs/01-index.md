# ClaudeCube Technical Specification

## Executive Summary

**ClaudeCube** is a hooks-based orchestrator for Claude Code sessions. It monitors Claude CLI sessions running in tmux panes via Claude Code's hooks system, auto-approving safe operations, blocking dangerous ones, and escalating uncertain decisions through a two-tier pipeline: first to an LLM evaluator (Claude Haiku), then to a human via Telegram.

**Key characteristics:**
- Hooks-based architecture: does not spawn agents, monitors existing Claude sessions
- Deny-first rule engine with configurable safety rules and hot-reload support
- LLM evaluator that can auto-approve but never auto-deny
- Telegram bot for human-in-the-loop permission decisions and remote session control
- LLM-evaluated text replies: human replies are classified by intent (approve, deny, forward to session, add rule)
- Policy learning: human decisions are saved and fed back to the LLM evaluator
- Startup session discovery: scans tmux for existing Claude sessions on startup
- Fail-open design: if ClaudeCube is unreachable, Claude Code continues normally

**Version:** 0.1.0 | **Runtime:** Node.js >= 22 (ESM) | **Language:** TypeScript (strict)

## Architecture Diagram

```
Claude Code session (in tmux)
  |
  | fires hook event (PreToolUse, Stop, SessionStart, SessionEnd, Notification)
  v
hooks/claudecube-hook.sh  (reads JSON stdin, POSTs to ClaudeCube, outputs response)
  |
  | HTTP POST localhost:7080/hooks/<event>    [fails open if server is down]
  v
HTTP Server (server.ts)
  |
  |-- PreToolUse -----> Rule Engine (deny/allow/escalate)
  |                       |-- deny ----> BLOCK (immediate)
  |                       |-- allow ---> APPROVE (immediate)
  |                       |-- escalate -> LLM Evaluator (Haiku)
  |                                        |-- confident allow -> APPROVE
  |                                        |-- uncertain/deny --> Telegram approval
  |                                                                |-- button approve -> APPROVE
  |                                                                |-- button deny/timeout -> BLOCK
  |                                                                |-- details button -> Transcript analysis
  |                                                                |                     + LLM summary (non-resolving)
  |                                                                |-- text reply -> LLM classifies intent:
  |                                                                      |-- approve -> APPROVE
  |                                                                      |-- deny -> BLOCK
  |                                                                      |-- forward -> APPROVE + send to session
  |                                                                      |-- add rule -> APPROVE + write rule
  |
  |-- Stop -----------> Heuristics (error? question? normal?)
  |                       |-- error -> force retry (up to N times)
  |                       |   (after retries exhausted, falls through to analysis)
  |                       |-- ALL stops (after retries) -> Transcript analysis
  |                           + LLM summary + Telegram (continue/let stop)
  |
  |-- SessionStart ----> Register session + Telegram notification
  |-- SessionEnd ------> Deregister session + Telegram notification
  |-- Notification ----> Update activity timestamp
  |
  |-- GET /status -----> List active sessions (JSON)
  v
JSON response -> hook script -> Claude Code

On startup:
  tmux scan -------> Pre-register existing Claude sessions
  fs.watch --------> Watch config/rules.yaml for hot-reload
```

## Table of Contents

| # | Section | Description |
|---|---|---|
| 1 | [Executive Summary](#executive-summary) | This section |
| 2 | [Safety Rule System](02-safety-rules.md) | Rule definition language, default rules, evaluation engine, hot-reload |
| 3 | [Permission Evaluation](03-permission-evaluation.md) | PreToolUse handler, audit logging, the complete decision flow |
| 4 | [LLM-Based Evaluation](04-llm-evaluation.md) | Haiku evaluator, escalation pipeline, policy integration |
| 5 | [Stop Handling](05-stop-handling.md) | Error retry, question escalation, loop prevention |
| 6 | [Telegram Integration](06-telegram.md) | Bot, approval flow, text reply evaluation, notifications, remote control |
| 7 | [Session Management](07-session-management.md) | Session tracker, startup discovery, tmux integration, lifecycle hooks |
| 8 | [Policy Learning](08-policy-learning.md) | Policy creation, storage, LLM feedback loop, policy-to-rule promotion |
| 9 | [Configuration](09-configuration.md) | Orchestrator config, rules config, environment variables |
| 10 | [Infrastructure & Deployment](10-infrastructure.md) | HTTP server, CLI, installer, logging, project setup |
| 11 | [Transcript Analysis](11-transcript-analysis.md) | Transcript reader, LLM summarizer, integration with approval and stop flows |

## Supplementary Documents

- [MAPPING.md](MAPPING.md) -- Maps exploration specs to final spec sections
- [exploration/notes.md](exploration/notes.md) -- Raw observations, inconsistencies, and technical debt
- [exploration/REVIEW.md](exploration/REVIEW.md) -- Consistency review findings
