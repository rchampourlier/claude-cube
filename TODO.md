# TODO

## WIP

## Backlog

- question: is it possible to update the session name when the tmux window is renamed?
  - this could be helpful to have policies that authorize modifications in ~/.config if the tmux session is named "config"
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

