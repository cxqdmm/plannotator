/**
 * One reply tags any number of sessions (through 0.28.61, at most 8, refused
 * with a validation error), and a tag keeps a long agent name whole, as the
 * Inbox now stores names (a name over 80 characters was refused).
 */
import { expect, test } from "bun:test";
import { normalizeInboxTags } from "./store";

test("twelve tags arrive whole, in the order typed, with a long name kept", () => {
  const long = `Claude Code (worktree agent-a0316994da8440ab5) ${"x".repeat(120)}`;
  const tags = Array.from({ length: 12 }, (_, i) => ({ host: "claude-code", session: `ses_${i}`, wakes: true, ...(i === 0 ? { name: long } : {}) }));
  const out = normalizeInboxTags(tags, "ses_owner");
  expect(out.map((t) => t.session)).toEqual(tags.map((t) => t.session));
  expect(out[0]!.name).toBe(long);
});

test("an id no host's session may be is refused, whatever the host", () => {
  // `%` and `()` (a shape another product's thread ids use), or over 200 characters: not a session id of any host.
  for (const host of ["cursor", "codex", "claude-code", null]) {
    for (const session of ["mcp:launch:a%2Fb(task)", `a${"b".repeat(4096)}`, "import:provider:ses-1"]) {
      expect(() => normalizeInboxTags([{ host, session, wakes: true }], null)).toThrow("tags: each session an id.");
    }
  }
  for (const session of ["", " ", "a/../b", "thread/../x", "t\nx", ":ses-1", 42, null]) {
    expect(() => normalizeInboxTags([{ host: "cursor", session, wakes: true }], null)).toThrow("tags: each session an id.");
  }
});
