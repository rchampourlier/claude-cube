# TODO

## WIP

## Backlog

- enh: working remotely, when starting a session, explore resumable sessions and offer resuming a previous session; after resume, provide a summary of the session's state (by asking it automatically to the claude session).
- feat: is there a way to get a summary of a claude's session? the messages logged in the claude session's pane?

### Orchestration layer

- Before ending a session, always ask the agent to update the project's documentation, AGENTS.md and memory based on learnings and decisions taken during the session.
- feat: have claude-cube autonomously supervise at a higher level the progress of the agent to monitor the completion of the project and run different phases (e.g. make a plan, challenge it, ask human feedback and confirmation, move to implementation when the plan is validated, switch to review mode when implementation is complete).
