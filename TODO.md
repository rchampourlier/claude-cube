# TODO

## WIP

- specs
  - index.md
    - in uncertain/deny scenario / telegram approval
      - text reply should be evaluated by a LLM
      - depending on the reply it 
        - should approve/deny or send the reply back to the claude session (via tmux)
        - there should be a clear pattern, e.g. after the main reply, "- add rule..." to trigger the addition of a safety rule. for now it's not clear what should get sent to the claude session, and what's the discussion with the evaluator for adding a new safety rule vs creating a policy.
  - 02-safety-rules.md
    - we want claude-cube to be able to modify the rules during runtime, based on human input (when escalated), so the rules system must supporting reloading the config/rules.yaml file when it has been modified.
  - 04-llm-evaluation.md
    - where are the policies created by the human feedback loop stored?
    - we should have a way to promote policies into safety rules when applicable? (could be just a claude skill)
  - 05-telegram.md
    - /panes: display the name of each tmux window with a claude session, then the pane ID. for now it displays a useless:
    ```
    %1 — base:1.1 (claude)
    %28 — base:1.2 (claude)
    %13 — base:2.1 (claude)
    %24 — base:3.3 (claude)
    %44 — base:4.1 (claude)
    ```
    - /send: should use the tmux window name (`/send <tmux-window-name> <text>`) to forward the message to the proper claude session, so the user doesn't have to know the session id
    - can the system keep track of which message is responded to from telegram, so that the text reply is forwarded to the correct pane?
    - does the claude hook when handling a stop includes the suggested follow-up action (which can be auto-completed with tab in the claude session)? if so, could it be added to the message and it's what gets replied if clicking the "continue" button?
    - the 06-stop-handling.md doc should come before the 05-telegram.md one, since this one handles both llm-evaluation's escalation path, and the stop-handling.
    - I'm not sure 5.4 is correctly implemented. When replying to an approval request, I tend to see claude-cube send the text back to a tmux session instead of evaluating it to create a policy (or a safety rule via `- add rule:`).
  - 07-session-management.md
    - can claude-cube detect the active claude session by exploring the different tmux windows, panes and processes, and map them to tmux windows/panes, without having to wait for a hook to be triggered? this way, as claude-cube is started, it's immediately possible to list active sessions and interact with them.
  

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
- fix: some errors when sending messages to Telegram that prevents the orchestrator to manage the agent
  ```
  [2026-02-23T14:33:47.411Z] [ERROR] [telegram-approval] Failed to send approval request {"error":"Error: 400: Bad Request: can't parse entities: Can't find end of the entity starting at byte offset 817"}

    ⏺ Update(bin/compare-with-ts.rs)
      ⎿  PreToolUse:Edit hook returned blocking error
      ⎿  Telegram send failed: Error: 400: Bad Request: can't parse entities: Can't find end of the entity starting at byte offset 427

      ⎿  Error: Telegram send failed: Error: 400: Bad Request: can't parse entities: Can't find end of the entity starting at byte offset 427


    ⏺ The hook's Telegram markdown parser chokes on special characters. Let me try a minimal edit.

    ⏺ Update(bin/compare-with-ts.rs)
      ⎿  PreToolUse:Edit hook returned blocking error
      ⎿  Telegram send failed: Error: 400: Bad Request: can't parse entities: Can't find end of the entity starting at byte offset 427
      ⎿  Error: Telegram send failed: Error: 400: Bad Request: can't parse entities: Can't find end of the entity starting at byte offset 427

    ⏺ The hook blocks all Edit calls (the error is at a fixed byte offset, suggesting the file path with @ breaks Telegram's parser). Let me try
      Write instead.

    ⏺ Write(/tmp/compare-fix.patch)
      ⎿  PreToolUse:Write hook returned blocking error
      ⎿  Telegram send failed: Error: 400: Bad Request: can't parse entities: Can't find end of the entity starting at byte offset 333
      ⎿  Error: Telegram send failed: Error: 400: Bad Request: can't parse entities: Can't find end of the entity starting at byte offset 333

    ⏺ The Telegram hook is blocking all tool calls except Read. The hook at /Users/romain.c8t/dev+rc10r/claude-cube/hooks/claudecube-hook.sh fails
       because the Telegram API can't parse special characters (likely @ in the file path or code characters like &, <, >).

      I can't make any edits, writes, or run any commands until this is resolved. Could you either:
      ⎿  PreToolUse:AskUserQuestion hook returned blocking error
      ⎿  Telegram send failed: Error: 400: Bad Request: can't parse entities: Can't find end of the entity starting at byte offset 817

    ⏺ The Telegram notification hook is blocking every tool call (Edit, Write, Bash, Task, AskUserQuestion, Glob, Grep). Only Read seems to work
      intermittently.

      You need to fix or disable the hook at:
      /Users/romain.c8t/dev+rc10r/claude-cube/hooks/claudecube-hook.sh

      The issue is that the Telegram API's parse_mode (likely MarkdownV2 or HTML) chokes on special characters in tool call metadata (the @ in
      file paths, </> in code, etc.).

      Quick fix options:

      1. Disable the hook temporarily - remove or rename the hook file
      2. Fix the script - escape special characters before sending to Telegram, or switch to parse_mode: "" (plaintext)

      Once you've done that, I can continue with:
      - Cleaning up debug prints in bin/compare-with-ts.rs (lines 280-299)
      - Building and running the comparison
      - Investigating the systematic ~0.5% GHG gap (which I've confirmed is NOT from production waste treatment - the TS reference is generated
      with enabledFeatureFlags: [])
  ```

- feat: can the telegram escalation submit w/ further approval (when claude offers the option)?
- fix: replies from telegram are not sent to the correct pane, should map session/tmux window name
- feat: make it possible to spawn new agents and start working in new directories
  - open a new tmux window/panes
  - start claude

