/**
 * The butler's streaming chat route (v3, owner 2026-11-25「像 web 版一样」):
 * the reply streams as SSE deltas and a final done frame; the conversation
 * continues across daemon restarts (state.json's opencode session id is
 * resumed, not re-created). The provider is faked; HOME is isolated so the
 * butler folder is a temp one.
 */
import { beforeEach, afterEach, describe, expect, test, mock } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const roots: string[] = [];
let home: string;

const created: string[] = [];
const resumed: string[] = [];

mock.module("@plannotator/ai", () => ({
  createProvider: async () => ({
    createSession: async () => {
      const id = `ses_new${created.length + 1}`;
      created.push(id);
      return fakeSession(id);
    },
    resumeSession: async (id: string) => {
      resumed.push(id);
      return fakeSession(id);
    },
  }),
}));
mock.module("@plannotator/ai/providers/opencode-sdk", () => ({}));

function fakeSession(id: string) {
  return {
    id,
    parentSessionId: null,
    abort() {},
    // 回声回合：把提示原样带回来，方便断言注入的正是原话。
    query: async function* (prompt: string) {
      yield { type: "text", text: `回复：${prompt}` };
    },
  };
}

let butlerModule: typeof import("./inbox-butler");
beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), "plannotator-butler-home-"));
  roots.push(home);
  process.env.PLANNOTATOR_BUTLER_DIR = join(home, "plannotator-butler");
  butlerModule = await import("./inbox-butler");
});
afterEach(() => {
  delete process.env.PLANNOTATOR_BUTLER_DIR;
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const Butler = () => butlerModule.Butler;

async function chat(
  butler: { init(): void; route(req: Request, url: URL): Promise<Response | null> },
  message: string,
): Promise<{ frames: Record<string, unknown>[]; status: number }> {
  butler.init();
  const response = await butler.route(
    new Request("http://127.0.0.1:53998/api/inbox/butler/chat", {
      method: "POST",
      headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" },
      body: JSON.stringify({ message }),
    }),
    new URL("http://127.0.0.1:53998/api/inbox/butler/chat"),
  );
  expect(response).not.toBeNull();
  const status = response!.status;
  const text = await response!.text();
  const frames = text
    .split("\n\n")
    .filter((frame) => frame.startsWith("data: "))
    .map((frame) => JSON.parse(frame.slice(6)) as Record<string, unknown>);
  return { frames, status };
}

describe("the butler streaming chat", () => {
  afterEach(() => {
    created.length = 0;
    resumed.length = 0;
  });

  test("the reply streams as deltas plus a done frame, and the turn lands in history", async () => {
    const butler = new (Butler())();
    const { frames, status } = await chat(butler, "早安，管家");
    expect(status).toBe(200);
    const deltas = frames.filter((f) => typeof f.delta === "string");
    const done = frames.find((f) => f.done === true);
    expect(deltas.length).toBeGreaterThan(0);
    expect(done).toBeDefined();
    expect(String(done!.reply)).toContain("早安，管家");
    const raw = readFileSync(join(home, "plannotator-butler", "history.jsonl"), "utf8");
    if (!raw.trim().endsWith("}")) throw new Error(`history.jsonl 尾行损坏：${JSON.stringify(raw.slice(-120))}`);
    const history = raw.trim().split("\n").map((line) => JSON.parse(line) as { role: string });
    expect(history.map((t) => t.role)).toEqual(["you", "butler"]);
  });

  test("restart resumes the persisted opencode session instead of creating a new one", async () => {
    const first = new (Butler())();
    await chat(first, "第一句");
    expect(created.length).toBe(1);
    // state.json 记下了会话 id。
    const state = JSON.parse(readFileSync(join(home, "plannotator-butler", "state.json"), "utf8")) as { sessionId: string };
    expect(state.sessionId).toContain("ses_new");
    // 重启（新 Butler 实例）：续接，不新建。
    const second = new (Butler())();
    await chat(second, "第二句");
    expect(created.length).toBe(1);
    expect(resumed).toEqual([state.sessionId]);
  });

  test("a non-same-origin call is not answered", async () => {
    const butler = new (Butler())();
    butler.init();
    const response = await butler.route(
      new Request("http://127.0.0.1:53998/api/inbox/butler/chat", {
        method: "POST",
        headers: { "content-type": "application/json", "sec-fetch-site": "cross-origin" },
        body: JSON.stringify({ message: "越权" }),
      }),
      new URL("http://127.0.0.1:53998/api/inbox/butler/chat"),
    );
    expect(response).toBeNull();
  });

  test("an empty message refuses with 422", async () => {
    const butler = new (Butler())();
    butler.init();
    const { status } = await chat(butler, "");
    expect(status).toBe(422);
  });
});
