# TODO

## Backlog

### Orchestration layer

- Before ending a session, always ask the agent to update the project's documentation, AGENTS.md and memory based on learnings and decisions taken during the session.

### Misc

- interactions: support "Approach" agent inquiries via telegram
- agent: create a skill to review policies and replace with rules when applicable, or consolidate them
- enh: rules
  - forbid curl/wget and other internet accesses to arbitrary websites
- enh: llm evaluator
  - give it more context: 
    - what's the current claude's session path?
    - provide through configuration a list of "safe" working directories
  - have the llm evaluator use that to determine what's safe or not
- feat: can the telegram escalation submit w/ further approval (when claude offers the option)?
- fix: replies from telegram are not sent to the correct pane, should map session/tmux window name
- feat: make it possible to spawn new agents and start working in new directories
  - open a new tmux window/panes
  - start claude
- feat: have claude-cube autonomously supervise at a higher level the progress of the agent to monitor the completion of the project and run different phases (e.g. make a plan, challenge it, ask human feedback and confirmation, move to implementation when the plan is validated, switch to review mode when implementation is complete).
- feat: is there a way to get a summary of a claude's session? the messages logged in the claude session's pane?

