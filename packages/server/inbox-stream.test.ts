/**
 * 会话「对话流」: the transcript parser and the route, on a scratch store and
 * a scratch Claude config dir. Guards the entries a pane draws (a tool call
 * one line, its result landing on the same line; a sidechain's words never),
 * the pages (tail, what grew, what came before), and that only the person's
 * own window is answered.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { InboxAuthor } from "@plannotator/core/inbox-types";
import { InboxStore } from "@plannotator/shared/inbox/store";
import { createAgentEnvironmentFor } from "./inbox-agents";
import { CLAUDE_STREAM_PAGE, createInboxStreamRoute, streamEntriesOf, toolBriefOf } from "./inbox-stream";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const scratch = (): string => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "plannotator-inbox-stream-")));
  roots.push(root);
  return root;
};

const AGENT: Extract<InboxAuthor, { kind: "agent" }> = { kind: "agent", host: "claude-code", session: "ses_stream", name: null };
const PI: Extract<InboxAuthor, { kind: "agent" }> = { kind: "agent", host: "pi", session: "ses_pi", name: null };

/** A store with one thread whose owner is a Claude Code session, and that session's transcript written. */
function setup(lines: string[]): { route: ReturnType<typeof createInboxStreamRoute>["route"]; threadId: string } {
  const root = scratch();
  const store = InboxStore.open(join(root, "data"));
  const project = store.ensureProject({ name: "api", root: "/work/api" });
  const thread = store.sendMessage({ project_id: project.id, author: AGENT, body: "设计文档好了。" }).message;
  const other = store.sendMessage({ project_id: project.id, author: PI, body: "hi" }).message;
  const config = join(root, "claude");
  mkdirSync(join(config, "projects", "-work-api"), { recursive: true });
  // No lines: the session has not written its transcript yet (Claude Code creates it on its first turn).
  if (lines.length > 0) writeFileSync(join(config, "projects", "-work-api", "ses_stream.jsonl"), lines.join("\n"));
  const environment = createAgentEnvironmentFor({ platform: process.platform, homeDir: root, env: { CLAUDE_CONFIG_DIR: config } });
  const stream = createInboxStreamRoute({ store, environment: () => environment, json: (body, status) => new Response(JSON.stringify(body ?? null), { status: status ?? 200 }) });
  return { route: stream.route, threadId: thread.id, otherThreadId: other.id };
}

const WINDOW_HEADERS = { "sec-fetch-site": "same-origin" };
const call = async (route: ReturnType<typeof createInboxStreamRoute>["route"], path: string, headers: Record<string, string> = WINDOW_HEADERS) => {
  const url = new URL(`http://x${path}`);
  const response = await route(new Request(url, { headers }), url);
  return { status: response!.status, data: (await response!.json()) as Record<string, unknown> };
};

const line = (body: unknown): string => JSON.stringify(body);

describe("the transcript parser", () => {
  test("a tool call is one entry; its result, a later line, lands on it (and only there)", () => {
    const lines = [
      line({ type: "user", message: { role: "user", content: "开始做「登录页改版」。" } }),
      line({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "git status --short", description: "看看工作区" } }] } }),
      line({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "工作区是干净的。" }] } }),
      line({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "M packages/a.ts" }] } }),
    ];
    const entries = streamEntriesOf(lines, 0, lines.length);
    expect(entries.map((entry) => entry.kind)).toEqual(["you", "tool", "text"]);
    const tool = entries[1]!;
    expect(tool.tool).toBe("Bash");
    expect(tool.brief).toBe("git status --short");
    expect(tool.result).toBe("M packages/a.ts");
    // The result line itself draws nothing.
    expect(entries.filter((entry) => entry.i === 3)).toHaveLength(0);
  });

  test("thoughts are their own quiet kind; a sidechain's and meta lines never show; a tool without its result stays running", () => {
    const lines = [
      line({ type: "assistant", isSidechain: true, message: { role: "assistant", content: [{ type: "text", text: "内部探索" }] } }),
      line({ type: "user", isMeta: true, message: { role: "user", content: "内部触发" } }),
      line({ type: "assistant", message: { role: "assistant", content: [{ type: "thinking", thinking: "先看表格布局那节。" }, { type: "tool_use", id: "t9", name: "Read", input: { file_path: "/work/SKILL.md" } }] } }),
    ];
    const entries = streamEntriesOf(lines, 0, lines.length);
    expect(entries.map((entry) => entry.kind)).toEqual(["think", "tool"]);
    expect(entries[0]!.text).toContain("表格布局");
    expect(entries[1]!.brief).toBe("/work/SKILL.md");
    expect(entries[1]!.result).toBeUndefined();
  });

  test("long words and results are cut with an ellipsis, never dropped", () => {
    const words = "长".repeat(5000);
    const lines = [
      line({ type: "user", message: { role: "user", content: words } }),
      line({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id: "t2", name: "Bash", input: { command: "cat 大文件" } }] } }),
      line({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t2", content: words }] } }),
    ];
    const entries = streamEntriesOf(lines, 0, lines.length);
    expect(entries[0]!.text!.length).toBeLessThanOrEqual(4001);
    expect(entries[0]!.text!.endsWith("…")).toBe(true);
    expect(entries[1]!.result!.length).toBeLessThanOrEqual(2001);
  });

  test("a tool's one-line brief names the call's subject, never a JSON dump", () => {
    expect(toolBriefOf("Bash", { command: "bun test x.test.ts" })).toBe("bun test x.test.ts");
    expect(toolBriefOf("Grep", { pattern: "表单弹窗", path: "scripts/" })).toBe("表单弹窗");
    expect(toolBriefOf("TodoWrite", { todos: [{}, {}, {}] })).toBe("3 项");
    expect(toolBriefOf("Something", { path: "/a", rest: "x".repeat(200) })).not.toContain("x".repeat(200));
  });
});

describe("the stream route", () => {
  test("answers the owner's window with the tail; another origin is refused; a session that is not Claude Code's is no_session", async () => {
    const many = Array.from({ length: CLAUDE_STREAM_PAGE + 9 }, (_, index) => line({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: `第 ${index} 行` }] } }));
    const { route, threadId, otherThreadId } = setup(many);
    const tail = await call(route, `/api/inbox/threads/${threadId}/stream`);
    expect(tail.status).toBe(200);
    const entries = tail.data.entries as { i: number; kind: string; text?: string }[];
    expect(entries).toHaveLength(CLAUDE_STREAM_PAGE);
    expect(entries.at(-1)!.text).toBe(`第 ${CLAUDE_STREAM_PAGE + 8} 行`);
    expect(tail.data.more).toBe(true);
    // The page before the tail's first line: the 9 that came before it, and then nothing more.
    const earlier = await call(route, `/api/inbox/threads/${threadId}/stream?before=${entries[0]!.i}`);
    expect((earlier.data.entries as unknown[]).map((entry) => (entry as { text: string }).text)).toEqual(Array.from({ length: 9 }, (_, index) => `第 ${index} 行`));
    expect(earlier.data.more).toBe(false);
    // What grew past the cursor: nothing, until the file does.
    const grown = await call(route, `/api/inbox/threads/${threadId}/stream?after=${tail.data.cursor}`);
    expect(grown.data.entries).toEqual([]);
    // The browser's own mark is what lets a window in; a curl has none (the server's catch turns it into the 403).
    expect(route(new Request(`http://x/api/inbox/threads/${threadId}/stream`), new URL(`http://x/api/inbox/threads/${threadId}/stream`))).rejects.toThrow("only the Inbox window");
    // A thread whose owner is not a Claude Code session has no stream.
    const pi = await call(route, `/api/inbox/threads/${otherThreadId}/stream`);
    expect(pi.status).toBe(404);
    expect(pi.data.code).toBe("no_session");
    // And a thread that is not this store's.
    expect((await call(route, "/api/inbox/threads/none/stream")).data.code).toBe("no_session");
  });

  test("a session with no transcript yet answers no_transcript, never an empty pane", async () => {
    const { route, threadId } = setup([]);
    const answer = await call(route, `/api/inbox/threads/${threadId}/stream`);
    expect(answer.status).toBe(404);
    expect(answer.data.code).toBe("no_transcript");
  });
});
