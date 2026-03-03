import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { SessionTracker } from "./session-tracker.js";

describe("SessionTracker", () => {
  let tracker: SessionTracker;

  describe("when tmux resolution fails", () => {
    beforeEach(() => {
      tracker = new SessionTracker({
        resolveLabel: () => null,
        findPaneForCwd: () => null,
        listClaudePanes: () => [],
      });
    });

    it("register uses cwd basename as label fallback, not truncated session ID", () => {
      const sessionId = "a04caae5-86f4-1e8c-9abc-def012345678";
      const cwd = "/Users/romain/dev/claude-cube";
      tracker.register(sessionId, cwd);

      const label = tracker.getLabel(sessionId);
      assert.equal(label, "claude-cube", "label should be the cwd basename, not a truncated session ID");
      assert.notEqual(label, sessionId.slice(0, 12), "label must not be the truncated session ID");
    });

    it("ensureRegistered uses cwd basename as label fallback", () => {
      const sessionId = "b15ddf96-7e3a-2f9d-0123-abcdef987654";
      const cwd = "/home/user/projects/my-app";
      tracker.ensureRegistered(sessionId, cwd);

      const label = tracker.getLabel(sessionId);
      assert.equal(label, "my-app");
    });

    it("getLabel returns truncated ID only for completely unknown sessions", () => {
      const sessionId = "c26eeg07-8f4b-3a0e-1234-bcdef0123456";
      // Session never registered — no cwd available, fallback to truncated ID is acceptable
      const label = tracker.getLabel(sessionId);
      assert.equal(label, sessionId.slice(0, 12));
    });
  });

  describe("when tmux resolution succeeds", () => {
    beforeEach(() => {
      tracker = new SessionTracker({
        resolveLabel: (cwd: string) =>
          cwd === "/Users/romain/dev/claude-cube" ? "main:claude-cube" : null,
        findPaneForCwd: () => "%42",
        listClaudePanes: () => [],
      });
    });

    it("register uses the tmux label", () => {
      const sessionId = "d37ffh18-9g5c-4b1f-2345-cdef01234567";
      tracker.register(sessionId, "/Users/romain/dev/claude-cube");

      assert.equal(tracker.getLabel(sessionId), "main:claude-cube");
    });

    it("refreshLabel picks up a newly available tmux label", () => {
      let tmuxAvailable = false;
      const dynamicTracker = new SessionTracker({
        resolveLabel: () => (tmuxAvailable ? "main:my-project" : null),
        findPaneForCwd: () => null,
        listClaudePanes: () => [],
      });

      dynamicTracker.register("sess-1", "/path/to/my-project");
      assert.equal(dynamicTracker.getLabel("sess-1"), "my-project"); // cwd basename fallback

      tmuxAvailable = true;
      dynamicTracker.refreshLabel("sess-1");
      assert.equal(dynamicTracker.getLabel("sess-1"), "main:my-project"); // tmux label
    });
  });

  describe("label propagation to escalation context", () => {
    beforeEach(() => {
      tracker = new SessionTracker({
        resolveLabel: () => null,
        findPaneForCwd: () => null,
        listClaudePanes: () => [],
      });
    });

    it("getLabel after ensureRegistered returns a human-readable name, not a session ID", () => {
      const sessionId = "e48ggi29-0h6d-5c2g-3456-def012345678";
      const cwd = "/Users/romain/dev/awesome-project";
      tracker.ensureRegistered(sessionId, cwd, "/tmp/transcript.jsonl");
      tracker.updateToolUse(sessionId, "Bash");

      const label = tracker.getLabel(sessionId);
      // The label must be meaningful — either tmux name or cwd basename
      // It must NOT be a truncated session ID
      assert.equal(label, "awesome-project");
      assert.ok(
        !label.match(/^[0-9a-f-]{8,}$/i),
        `label "${label}" looks like a session ID fragment — should be a human-readable name`,
      );
    });
  });
});
