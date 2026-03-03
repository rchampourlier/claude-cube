# TODO

## WIP

- ~~remove timeouts~~ → telegram timeout set to infinite (0)

## Backlog

### Orchestration layer

- Before ending a session, always ask the agent to update the project's documentation, AGENTS.md and memory based on learnings and decisions taken during the session.

### Misc

- /details: list all active sessions with a button for each to show more details about the current status of the session
- interactions: can all interactions be done via telegram?
  - how to handle agent's questions?
  - support "Approach" agent inquiries via telegram
      - sometimes the agent asks several questions to guide its approach, how could we manage those interactions from the c3 console?
- feat: make it possible to spawn new agents and start working in new directories
  - open a new tmux window/panes
  - start claude
- feat: have claude-cube autonomously supervise at a higher level the progress of the agent to monitor the completion of the project and run different phases (e.g. make a plan, challenge it, ask human feedback and confirmation, move to implementation when the plan is validated, switch to review mode when implementation is complete).
- feat: is there a way to get a summary of a claude's session? the messages logged in the claude session's pane?

