/**
 * 工坊会话详情的「在终端打开」路由（owner 2026-11-25，工坊对话流回复报错线程）：
 * 按会话现在的宿主给命令——claude-code 全局 resume（mod 的 `claude-code:` 前缀剥成裸 id）、
 * opencode 用 v2 库里会话自己的目录（缺了落回项目根）、已启动的会话沿用运行线命令；
 * 别的宿主与不存在的线程答 no_session；只答收件箱自己的窗口。
 */
import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import type { InboxAuthor } from "@plannotator/core/inbox-types";
import { InboxStore } from "@plannotator/shared/inbox/store";
import { createInboxSessionTerminalRoute, sessionTerminalOf } from "./inbox-session-attach";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const scratch = (): string => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "plannotator-inbox-terminal-")));
  roots.push(root);
  return root;
};

const CLAUDE: Extract<InboxAuthor, { kind: "agent" }> = { kind: "agent", host: "claude-code", session: "ses_stream", name: null };
const CLAUDE_TAGGED: Extract<InboxAuthor, { kind: "agent" }> = { kind: "agent", host: "claude-code", session: "claude-code:ses_tag", name: null };
const OC: Extract<InboxAuthor, { kind: "agent" }> = { kind: "agent", host: "opencode", session: "ses_open1", name: null };
const PI: Extract<InboxAuthor, { kind: "agent" }> = { kind: "agent", host: "pi", session: "ses_pi", name: null };

interface World {
  route: ReturnType<typeof createInboxSessionTerminalRoute>["route"];
  store: InboxStore;
  claude: string;
  tagged: string;
  opencode: string;
  pi: string;
  setLaunched: (command: string | null) => void;
  /** scratch 里 opencode 数据目录的位置；opencode 用例请求时把 XDG 指过去，走完还原。 */
  xdg: string;
}

/** 一家 scratch Inbox：四个宿主各一条线程。oc：default＝库里有会话行；rowless＝库在但没有它的行；none＝没有库。 */
function setup(oc: "default" | "rowless" | "none" = "default"): World {
  const root = scratch();
  const store = InboxStore.open(join(root, "data"));
  const project = store.ensureProject({ name: "api", root: "/work/api" });
  const claude = store.sendMessage({ project_id: project.id, author: CLAUDE, body: "claude 开工。" }).message;
  const tagged = store.sendMessage({ project_id: project.id, author: CLAUDE_TAGGED, body: "mod 起的。" }).message;
  const opencode = store.sendMessage({ project_id: project.id, author: OC, body: "opencode 开工。" }).message;
  const pi = store.sendMessage({ project_id: project.id, author: PI, body: "pi 开工。" }).message;
  if (oc !== "none") {
    const previousXdg = process.env.XDG_DATA_HOME;
    process.env.XDG_DATA_HOME = root;
    mkdirSync(join(root, "opencode"), { recursive: true });
    const sql = new Database(join(root, "opencode", "opencode.db"));
    sql.exec("CREATE TABLE session (id TEXT PRIMARY KEY, directory TEXT)");
    if (oc === "default") sql.query("INSERT INTO session (id, directory) VALUES (?, ?)").run("ses_open1", "/work/oc-demo");
    sql.close();
    process.env.XDG_DATA_HOME = previousXdg;
  }
  let launched: string | null = null;
  return {
    route: createInboxSessionTerminalRoute({ store, attachOf: () => launched, json: (body, status) => new Response(JSON.stringify(body ?? null), { status: status ?? 200 }) }).route,
    store,
    claude: claude.id,
    tagged: tagged.id,
    opencode: opencode.id,
    pi: pi.id,
    setLaunched: (command: string | null) => { launched = command; },
    xdg: root,
  };
}

const WINDOW_HEADERS = { "sec-fetch-site": "same-origin" };
const call = async (route: World["route"], path: string, headers: Record<string, string> = WINDOW_HEADERS) => {
  const url = new URL(`http://x${path}`);
  const response = await route(new Request(url, { headers }), url);
  return { status: response!.status, data: (await response!.json()) as Record<string, unknown> };
};

/** opencode 的解析看 XDG 指到的数据目录：请求期间指到 scratch，走完还原（全局只在用例内动，测完即回）。 */
async function withXdg<T>(world: World, run: () => Promise<T> | T): Promise<T> {
  const previousXdg = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = world.xdg;
  try {
    return await run();
  } finally {
    if (previousXdg === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previousXdg;
  }
}

describe("sessionTerminalOf", () => {
  test("claude-code: 全局 resume，无需目录", () => {
    const { store, claude } = setup();
    expect(sessionTerminalOf(claude, store, () => null)).toEqual({ command: "claude --resume 'ses_stream'", dir: null });
  });

  test("mod 的 `claude-code:` 前缀剥成裸 id", () => {
    const { store, tagged } = setup();
    expect(sessionTerminalOf(tagged, store, () => null)).toEqual({ command: "claude --resume 'ses_tag'", dir: null });
  });

  test("opencode: 目录取 v2 库里会话自己的", async () => {
    const world = setup();
    await withXdg(world, () => {
      expect(sessionTerminalOf(world.opencode, world.store, () => null)).toEqual({
        command: "cd '/work/oc-demo' && opencode -s 'ses_open1'",
        dir: "/work/oc-demo",
      });
    });
  });

  test("opencode: 库里没有会话行，落回线程的项目根", async () => {
    const world = setup("rowless");
    await withXdg(world, () => {
      expect(sessionTerminalOf(world.opencode, world.store, () => null)).toEqual({
        command: "cd '/work/api' && opencode -s 'ses_open1'",
        dir: "/work/api",
      });
    });
  });

  test("opencode: 库整个不在，同样落回项目根", async () => {
    const world = setup("none");
    await withXdg(world, () => {
      expect(sessionTerminalOf(world.opencode, world.store, () => null)).toEqual({
        command: "cd '/work/api' && opencode -s 'ses_open1'",
        dir: "/work/api",
      });
    });
  });

  test("已启动会话的运行线命令优先（原样，工坊手动会话没有它）", () => {
    const { store, opencode } = setup();
    const launched = "cd '/work/api' && PLANNOTATOR_INBOX_TOOL=1 opencode2 --standalone --session 'ses_open1'";
    expect(sessionTerminalOf(opencode, store, () => launched)).toEqual({ command: launched, dir: null });
  });

  test("线程或归属会话不在 → thread；宿主给不出命令 → host", () => {
    const { store, pi } = setup();
    expect(sessionTerminalOf("none", store, () => null)).toEqual({ none: "thread" });
    expect(sessionTerminalOf(pi, store, () => null)).toEqual({ none: "host" });
  });
});

describe("the terminal route", () => {
  test("答窗口：claude/opencode 各得命令；curl 被拒；别的宿主与未知线程 no_session", async () => {
    const world = setup();
    await withXdg(world, async () => {
      const claude = await call(world.route, `/api/inbox/threads/${world.claude}/terminal`);
      expect(claude.status).toBe(200);
      expect(claude.data).toEqual({ command: "claude --resume 'ses_stream'", dir: null });
      const opencode = await call(world.route, `/api/inbox/threads/${world.opencode}/terminal`);
      expect(opencode.status).toBe(200);
      expect(opencode.data).toEqual({ command: "cd '/work/oc-demo' && opencode -s 'ses_open1'", dir: "/work/oc-demo" });
      // 浏览器自己的标记才放行；curl 没有它（服务端的 catch 把它变成 403）。
      expect(world.route(new Request(`http://x/api/inbox/threads/${world.claude}/terminal`), new URL(`http://x/api/inbox/threads/${world.claude}/terminal`))).rejects.toThrow("only the Inbox window");
      const pi = await call(world.route, `/api/inbox/threads/${world.pi}/terminal`);
      expect(pi.status).toBe(404);
      expect(pi.data.code).toBe("no_session");
      expect((await call(world.route, "/api/inbox/threads/none/terminal")).data.code).toBe("no_session");
    });
  });

  test("不是 GET 的不答；路径不是 /terminal 的不接", async () => {
    const world = setup();
    const post = await world.route(
      new Request(`http://x/api/inbox/threads/${world.claude}/terminal`, { method: "POST", headers: WINDOW_HEADERS }),
      new URL(`http://x/api/inbox/threads/${world.claude}/terminal`),
    );
    expect(post!.status).toBe(405);
    expect(await world.route(new Request("http://x/api/inbox/threads/x/stream", { headers: WINDOW_HEADERS }), new URL("http://x/api/inbox/threads/x/stream"))).toBeNull();
  });

  test("已启动会话沿用运行线命令；停了以后落回按宿主的命令", async () => {
    const world = setup();
    world.setLaunched("claude attach 4f1c9a2e");
    const answer = await call(world.route, `/api/inbox/threads/${world.claude}/terminal`);
    expect(answer.data).toEqual({ command: "claude attach 4f1c9a2e", dir: null });
    world.setLaunched(null);
    expect((await call(world.route, `/api/inbox/threads/${world.claude}/terminal`)).data).toEqual({ command: "claude --resume 'ses_stream'", dir: null });
  });
});
