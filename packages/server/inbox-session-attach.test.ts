/**
 * 按宿主的「在终端打开」命令（工坊会话详情页，owner 2026-11-25）：
 * Claude Code 全局 resume；opencode 按目录归属 cd 后 -s；已启动会话沿用运行线命令。
 */
import { describe, expect, test } from "bun:test";
import { sessionAttachCommand } from "./inbox-session-attach";

describe("sessionAttachCommand", () => {
  test("claude-code: global resume, no cd needed", () => {
    const result = sessionAttachCommand({ session: "f1ce850e-2e10-4b6b-a16f-b35819d6698f", host: "claude-code", folder: "/work/ledger" });
    expect(result?.command).toBe("claude --resume 'f1ce850e-2e10-4b6b-a16f-b35819d6698f'");
    expect(result?.dir).toBeNull();
  });

  test("opencode: cd into the session's own directory then -s", () => {
    const result = sessionAttachCommand({ session: "ses_df4d43a5bffeUGgI638abifplF", host: "opencode", folder: "/work/demo" });
    expect(result?.command).toBe("cd '/work/demo' && opencode -s 'ses_df4d43a5bffeUGgI638abifplF'");
    expect(result?.dir).toBe("/work/demo");
  });

  test("a launched session's own attach command wins verbatim", () => {
    const result = sessionAttachCommand({
      session: "ses_x",
      host: "opencode",
      folder: "/work/demo",
      launchedCommand: "cd '/work/demo' && PLANNOTATOR_INBOX_TOOL=1 opencode2 --standalone --session 'ses_x'",
    });
    expect(result?.command).toBe("cd '/work/demo' && PLANNOTATOR_INBOX_TOOL=1 opencode2 --standalone --session 'ses_x'");
  });

  test("unknown host refuses (null) rather than guessing a command", () => {
    expect(sessionAttachCommand({ session: "ses_x", host: "mystery", folder: "/work" })).toBeNull();
    expect(sessionAttachCommand({ session: "ses_x", host: null, folder: "/work" })).toBeNull();
  });

  test("quotes folder paths with single quotes safely", () => {
    const result = sessionAttachCommand({ session: "ses_y", host: "opencode", folder: "/work/it's" });
    expect(result?.command).toBe("cd '/work/it'\\''s' && opencode -s 'ses_y'");
  });
});
