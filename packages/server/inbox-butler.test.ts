/**
 * The butler's streaming chat route (v3, owner 2026-11-25「像 web 版一样」):
 * the reply streams as SSE deltas and a final done frame; the conversation
 * continues across daemon restarts (state.json's opencode session id is
 * resumed, not re-created). The provider is faked; the bootstrap CLI is a
 * fake binary that records its arguments; PLANNOTATOR_BUTLER_DIR isolates
 * the butler folder per test.
 */
import { beforeEach, afterEach, describe, expect, test, mock } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const created: string[] = [];
const resumed: string[] = [];

mock.module("@plannotator/ai", () => ({
  buildButlerPrompt: () => "你是管家（测试 persona）。",
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

function fakeSession(id: string) {
  return {
    id,
    parentSessionId: null,
    abort() {},
    // 回声回合：把提示原样带回来，方便断言注入的正是原话。
    query: async function* (prompt: string, options?: { files?: { name: string; mime: string; dataUrl: string }[] }) {
      const inline = (options?.files ?? []).map((file) => `[file ${file.name}]`).join(",");
      yield { type: "text", text: `回复：${prompt}${inline ? ` | 内联:${inline}` : ""}` };
    },
  };
}

let home = "";
let fakeBin = "";
let butlerModule: typeof import("./inbox-butler");

beforeEach(async () => {
  created.length = 0;
  resumed.length = 0;
  home = mkdtempSync(join(tmpdir(), "plannotator-butler-home-"));
  process.env.PLANNOTATOR_BUTLER_DIR = join(home, "plannotator-butler");
  const binDir = mkdtempSync(join(tmpdir(), "plannotator-butler-bin-"));
  fakeBin = join(binDir, "fake-opencode");
  writeFileSync(fakeBin, `#!/bin/sh\necho "args: $*"\necho "cwd: $(pwd)"\necho "tag: $PLANNOTATOR_SESSION_TAG"\nexit 0\n`);
  chmodSync(fakeBin, 0o755);
  butlerModule = await import("./inbox-butler");
});
afterEach(() => {
  delete process.env.PLANNOTATOR_BUTLER_DIR;
  rmSync(home, { recursive: true, force: true });
  rmSync(fakeBin, { force: true });
});

async function loadButler(bootstrapBin: string) {
  butlerModule = await import("./inbox-butler");
  return new butlerModule.Butler({ bootstrapBin, model: 'glm/glm-5.3-flash' });
}

async function chat(
  butler: { init(): void; route(req: Request, url: URL): Promise<Response | null> },
  message: string,
  files?: unknown[],
): Promise<{ frames: Record<string, unknown>[]; status: number }> {
  butler.init();
  const response = await butler.route(
    new Request("http://127.0.0.1:53998/api/inbox/butler/chat", {
      method: "POST",
      headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" },
      body: JSON.stringify({ message, ...(files ? { files } : {}) }),
    }),
    new URL("http://127.0.0.1:53998/api/inbox/butler/chat"),
  );
  expect(response).not.toBeNull();
  const status = response!.status;
  const text = await response!.text();
  console.error("[debug] 原始SSE:", JSON.stringify(text).slice(0, 260), "| status:", status);
  const frames = text
    .split("\n\n")
    .filter((frame) => frame.startsWith("data: "))
    .map((frame) => JSON.parse(frame.slice(6)) as Record<string, unknown>);
  return { frames, status };
}

describe("the butler streaming chat", () => {
  test("the reply streams as deltas plus a done frame, and the turn lands in history", async () => {
    const butler = await loadButler(fakeBin);
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

  test("a fixed session id is bootstrapped once, then resumed across restarts (never createSession)", async () => {
    const first = await loadButler(fakeBin);
    await chat(first, "第一句");
    // 建会话走 CLI bootstrap（provider.createSession 从不调用）。
    expect(created.length).toBe(0);
    const state = JSON.parse(readFileSync(join(home, "plannotator-butler", "state.json"), "utf8")) as { sessionId: string };
    expect(state.sessionId).toStartWith("ses_butler");
    expect(resumed).toEqual([state.sessionId]);
    // 重启（新实例）：state.json 的同一 id 再续接，不再 bootstrap。
    const second = await loadButler(fakeBin);
    await chat(second, "第二句");
    expect(resumed).toEqual([state.sessionId, state.sessionId]);
  });

  test("the session route hands out the id and a paste-ready terminal command", async () => {
    const butler = await loadButler(fakeBin);
    butler.init();
    const response = await butler.route(
      new Request("http://127.0.0.1:53998/api/inbox/butler/session", {
        headers: { "sec-fetch-site": "same-origin" },
      }),
      new URL("http://127.0.0.1:53998/api/inbox/butler/session"),
    );
    expect(response).not.toBeNull();
    const body = (await response!.json()) as { sessionId: string; dir: string; command: string };
    expect(body.sessionId).toStartWith("ses_butler");
    expect(body.command).toBe(`cd '${body.dir}' && opencode -s '${body.sessionId}'`);
    const state = JSON.parse(readFileSync(join(home, "plannotator-butler", "state.json"), "utf8")) as { sessionId: string };
    expect(state.sessionId).toBe(body.sessionId);
  });

  test("a non-same-origin call is not answered", async () => {
    const butler = await loadButler(fakeBin);
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
    const butler = await loadButler(fakeBin);
    butler.init();
    const { status } = await chat(butler, "");
    expect(status).toBe(422);
  });
});

describe("the butler's skill whitelist (owner 2026-11-25「管家要有技能白名单」)", () => {
  test("init writes the deny-all/allow-butler-* config and only butler-* skills of its own", () => {
    const dir = butlerModule.ensureButlerDir();
    // 项目级白名单：环境里的技能（主人的 ~/.claude/skills 等）全拒，只放行 butler-*。
    const config = JSON.parse(readFileSync(join(dir, "opencode.json"), "utf8")) as {
      permissions?: { action: string; resource: string; effect: string }[];
    };
    const skillRules = (config.permissions ?? []).filter((rule) => rule.action === "skill");
    expect(skillRules).toEqual([
      { action: "skill", resource: "*", effect: "deny" },
      { action: "skill", resource: "butler-*", effect: "allow" },
    ]);
    // 独有技能落盘：ID 一律 butler-*，带 name/description（有 description 才会被发现）。
    const skills = dir.split("/").pop();
    expect(skills).not.toBe("");
    const listing = readFileSync(join(dir, ".opencode", "skills", "butler-intake", "SKILL.md"), "utf8");
    expect(listing).toContain("name: 需求受理");
    expect(listing).toContain("description: ");
    expect(readFileSync(join(dir, ".opencode", "skills", "butler-inbox-guide", "SKILL.md"), "utf8")).toContain("name: 收件箱向导");
  });

  test("the persona disowns ambient skills: only butler-* is its own（真模块的文本；本文件的 @plannotator/ai 是 mock）", async () => {
    const real = (await import("@plannotator/ai/context")) as typeof import("@plannotator/ai/context");
    const persona = real.buildButlerPrompt();
    expect(persona).toContain("butler-*");
    expect(persona).toContain("NOT yours");
  });
});

describe("管家的附件（owner 2026-11-25「关键的输入框的基础功能…图片文件等等」)", () => {
  const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex").toString("base64");

  test("小图片：落盘 + 提示词给路径 + 原生 file parts 内联，历史记附件名", async () => {
    const butler = await loadButler(fakeBin);
    const { frames, status } = await chat(butler, "看这张截图", [{ name: "截图.png", mime: "image/png", data: PNG }]);
    expect(status).toBe(200);
    const done = frames.find((f) => f.done === true)!;
    const reply = String(done.reply);
    // 提示词带落盘路径（会话工具可再读）与文件名。
    expect(reply).toContain("截图.png");
    expect(reply).toMatch(/files[/\\].*截图\.png/);
    // 够小的图片内联为原生 file parts（视觉模型当场看得见）。
    expect(reply).toContain("[file 截图.png]");
    // 落盘字节与原文件一致（base64 解回）。
    const dir = join(home, "plannotator-butler", "files");
    const saved = readdirSync(dir)[0]!;
    expect(readFileSync(join(dir, saved)).toString("base64")).toBe(PNG);
    // 历史的 you 侧记了附件名。
    const history = butlerModule.Butler;
    const raw = readFileSync(join(home, "plannotator-butler", "history.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line) as { role: string; files?: string[] });
    expect(raw.find((turn) => turn.role === "you")?.files).toEqual(["截图.png"]);
  });

  test("非图片不内联（只走落盘路径）；纯附件无文字也能发；超限 413", async () => {
    const butler = await loadButler(fakeBin);
    const doc = Buffer.from("附件内容").toString("base64");
    const { frames } = await chat(butler, "", [{ name: "说明.pdf", mime: "application/pdf", data: doc }]);
    const reply = String(frames.find((f) => f.done === true)!.reply);
    expect(reply).toContain("说明.pdf");
    expect(reply).not.toContain("[file"); // 非图片不内联
    expect(reply).toContain("发来了 1 个附件"); // 无文字的占位话
    // 超过 6 个 → 413（JSON 错误，不是流），不落盘不进历史。
    const many = Array.from({ length: 7 }, (_, index) => ({ name: `f${index}.txt`, mime: "text/plain", data: doc }));
    const refused = await chat(butler, "太多", many);
    expect(refused.status).toBe(413);
    const dir = join(home, "plannotator-butler", "files");
    expect(readdirSync(dir).length).toBe(1); // 只有前一条消息的说明.pdf
  });
});
