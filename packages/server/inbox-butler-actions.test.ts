/**
 * 管家的行动面（doc/管家-事件机制设计.md，M2）：the action channel's protocol — the same
 * fact once (idempotency), the approval gate (ask / auto), the requirement history
 * line (`by: 管家`), and the audit for actions with no requirement.
 *
 * The heavy work is faked (launch/tell/stop); the requirement store is the real module,
 * under a temp data dir, so the card, its threads and its history are the product's.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ButlerEvent } from "./inbox-butler-events";
import {
  createButlerActions,
  type ButlerActionLaunchInput,
  type ButlerActionStopInput,
  type ButlerActionTellInput,
  type ButlerActions,
  type ButlerApprovalGate,
} from "./inbox-butler-actions";
import { createBunRequirementRoutes } from "./requirements";

let root = "";
let dataDir = "";
let butlerDir = "";
let routes: ReturnType<typeof createBunRequirementRoutes>;
let launchCalls: ButlerActionLaunchInput[];
let tellCalls: ButlerActionTellInput[];
let stopCalls: ButlerActionStopInput[];
let events: ButlerEvent[];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "plannotator-butler-actions-"));
  dataDir = join(root, "data");
  butlerDir = join(root, "butler");
  routes = createBunRequirementRoutes({ dataDir });
  launchCalls = [];
  tellCalls = [];
  stopCalls = [];
  events = [];
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function actions(options: { requirementsOn?: boolean; approvals?: ButlerApprovalGate | null } = {}): ButlerActions {
  return createButlerActions({
    dir: butlerDir,
    requirementsOn: options.requirementsOn ?? true,
    requirements: routes.store,
    ...(options.approvals !== undefined ? { approvals: options.approvals } : {}),
    recordEvent: (event) => events.push(event),
    launch: async (input) => {
      launchCalls.push(input);
      return { ok: true, thread_id: "msg_launch", launch_id: "lch_1" };
    },
    tell: async (input) => {
      tellCalls.push(input);
      return { ok: true, thread_id: input.thread ?? "msg_thread", message_id: "msg_reply", session: "ses_1" };
    },
    stop: async (input) => {
      stopCalls.push(input);
      return { ok: true, thread_id: input.thread ?? "msg_thread", session: "ses_1" };
    },
    projectOf: (id) => (id === "prj_1" ? { id: "prj_1", name: "web", root: "/work/web" } : null),
    projectOfThread: () => null,
  });
}

const URL_ACT = new URL("http://127.0.0.1:53998/api/inbox/butler/act");

async function act(api: ButlerActions, body: Record<string, unknown>, headers: Record<string, string> = {}): Promise<{ status: number; data: Record<string, unknown> }> {
  const response = await api.route(
    new Request(URL_ACT, {
      method: "POST",
      headers: { "content-type": "application/json", "sec-fetch-site": "same-origin", ...headers },
      body: JSON.stringify(body),
    }),
    URL_ACT,
  );
  expect(response).not.toBeNull();
  return { status: response!.status, data: (await response!.json()) as Record<string, unknown> };
}

const sayNotes = (id: string) => routes.store.get(id)!.events.filter((event) => event.kind === "say").map((event) => event.note ?? "");

describe("create-requirement", () => {
  test("the card lands, the history says the butler made it, and the same key never makes two", async () => {
    const api = actions();
    const first = await act(api, { action: "create-requirement", title: "登录页改版", notes: "背景：旧版太慢", idempotency_key: "k-create", event_id: "evt_source" });
    expect(first.status).toBe(200);
    const requirement = first.data.requirement as { id: string; title: string; notes: string };
    expect(requirement.title).toBe("登录页改版");
    expect(routes.store.get(requirement.id)!.requirement.notes).toBe("背景：旧版太慢");
    expect(sayNotes(requirement.id).some((note) => note.startsWith("管家:") && note.includes("建了这张卡"))).toBe(true);

    const again = await act(api, { action: "create-requirement", title: "登录页改版", idempotency_key: "k-create" });
    expect(again.status).toBe(200);
    expect(again.data.replayed).toBe(true);
    expect((again.data.requirement as { id: string }).id).toBe(requirement.id);
    expect(routes.store.list(false).requirements).toHaveLength(1);
  });

  test("a key needs to be on the call; another site's page is refused; the Workshop off means no card", async () => {
    const api = actions();
    expect((await act(api, { action: "create-requirement", title: "x" })).status).toBe(422);
    expect((await act(api, { action: "create-requirement", title: "x", idempotency_key: "k1" }, { "sec-fetch-site": "cross-site" })).status).toBe(403);
    // The butler's own curl sends no browser headers: local trust passes.
    expect((await act(api, { action: "create-requirement", title: "本机建卡", idempotency_key: "k-local" }, { "sec-fetch-site": "" })).status).toBe(200);
    const off = actions({ requirementsOn: false });
    expect((await act(off, { action: "create-requirement", title: "x", idempotency_key: "k-off" })).status).toBe(409);
  });

  test("the same key used for another action is a conflict, not a replay", async () => {
    const api = actions();
    await act(api, { action: "create-requirement", title: "x", idempotency_key: "k-conflict" });
    const other = await act(api, { action: "remind", text: "提醒", idempotency_key: "k-conflict" });
    expect(other.status).toBe(409);
    expect(other.data.code).toBe("idempotency_conflict");
  });
});

describe("meetings with a requirement and the audit", () => {
  test("launch links the card to the new thread and writes the second history line", async () => {
    const api = actions();
    const made = await act(api, { action: "create-requirement", title: "登录页改版", idempotency_key: "k-card" });
    const id = (made.data.requirement as { id: string }).id;
    const launched = await act(api, { action: "launch-session", agent: "claude-code", project_id: "prj_1", requirement: id, idempotency_key: "k-launch", authorized: true });
    expect(launched.status).toBe(200);
    expect(launchCalls[0]).toMatchObject({ agent: "claude-code", project_id: "prj_1", requirement: id });
    expect(routes.store.get(id)!.requirement.threads).toContain("msg_launch");
    expect(sayNotes(id).some((note) => note.startsWith("管家:") && note.includes("开好了执行会话"))).toBe(true);
  });

  test("tell and stop resolve a requirement's newest thread and write their lines", async () => {
    const api = actions();
    const made = await act(api, { action: "create-requirement", title: "登录页改版", idempotency_key: "k-card-2" });
    const id = (made.data.requirement as { id: string }).id;
    routes.store.link(id, "msg_thread");
    const told = await act(api, { action: "tell-session", requirement: id, words: "批注已补上，按这个改", idempotency_key: "k-tell" });
    expect(told.status).toBe(200);
    expect(tellCalls[0]).toMatchObject({ requirement: id, words: "批注已补上，按这个改" });
    expect(sayNotes(id).some((note) => note.startsWith("管家:") && note.includes("转达"))).toBe(true);
    const stopped = await act(api, { action: "stop-session", requirement: id, idempotency_key: "k-stop", authorized: true });
    expect(stopped.status).toBe(200);
    expect(stopCalls[0]).toMatchObject({ requirement: id });
    expect(sayNotes(id).some((note) => note.startsWith("管家:") && note.includes("打断已送出"))).toBe(true);
  });

  test("an action with no requirement is a butler event in the audit, not lost", async () => {
    const api = actions();
    const stopped = await act(api, { action: "stop-session", session: "ses_1", idempotency_key: "k-stop-bare", authorized: true });
    expect(stopped.status).toBe(200);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "butler.action", actor: "butler", subject: { session: "ses_1" } });
    expect(events[0]!.summary).toContain("停下了");
  });

  test("remind puts a note on the requirement", async () => {
    const api = actions();
    const made = await act(api, { action: "create-requirement", title: "登录页改版", idempotency_key: "k-card-3" });
    const id = (made.data.requirement as { id: string }).id;
    const reminded = await act(api, { action: "remind", requirement: id, text: "今天下午记得看设计稿", idempotency_key: "k-remind" });
    expect(reminded.status).toBe(200);
    expect(sayNotes(id).some((note) => note.startsWith("管家:") && note.includes("今天下午记得看设计稿"))).toBe(true);
  });
});

/** The approval tab as the action channel sees it, in memory. */
function fakeGate() {
  const auto: Record<string, boolean> = { "create-requirement": false, "launch-session": false, "stop-session": false };
  const records = new Map<string, { id: string; status: string; result: { ok: boolean; requirement_id?: string; thread_id?: string; error?: string; code?: string } | null }>();
  const requests: { action: string; title: string; summary: string; detail: Record<string, unknown>; payload: Record<string, unknown>; key: string }[] = [];
  let seq = 0;
  const gate: ButlerApprovalGate = {
    auto: (action) => auto[action] === true,
    byKey: (key) => records.get(key) ?? null,
    request: (input) => {
      const record = { id: `apr_${++seq}`, status: "pending", result: null as { ok: boolean } | null };
      records.set(input.idempotency_key, record);
      requests.push({ action: input.action, title: input.title, summary: input.summary, detail: input.detail, payload: input.payload, key: input.idempotency_key });
      return record;
    },
  };
  return {
    gate,
    auto,
    requests,
    approve(key: string, result: { ok: boolean; requirement_id?: string; thread_id?: string; error?: string; code?: string }) {
      const record = records.get(key)!;
      record.status = "approved";
      record.result = result;
    },
    deny(key: string) {
      const record = records.get(key)!;
      record.status = "denied";
      record.result = { ok: false, code: "denied", error: "主人拒绝了。" };
    },
  };
}

describe("the approval gate", () => {
  test("a card waits when the switch is ask; a decision answers the retry; auto creates directly", async () => {
    const fake = fakeGate();
    const api = actions({ approvals: fake.gate });
    const asked = await act(api, { action: "create-requirement", title: "登录页改版", notes: "## 背景 / 为什么\n旧版太慢", idempotency_key: "k-gate" });
    expect(asked.status).toBe(202);
    expect(asked.data.code).toBe("pending_approval");
    expect(fake.requests).toHaveLength(1);
    expect(fake.requests[0]).toMatchObject({ action: "create-requirement", title: "建需求卡《登录页改版》", key: "k-gate" });
    expect(String(fake.requests[0]!.detail.card)).toContain("需求卡：登录页改版");
    expect(routes.store.list(false).requirements).toHaveLength(0);

    fake.approve("k-gate", { ok: true, requirement_id: "req_approved" });
    const replayed = await act(api, { action: "create-requirement", title: "登录页改版", idempotency_key: "k-gate" });
    expect(replayed.status).toBe(200);
    expect(replayed.data.requirement_id).toBe("req_approved");

    fake.auto["create-requirement"] = true;
    const direct = await act(api, { action: "create-requirement", title: "直接建", idempotency_key: "k-auto" });
    expect(direct.status).toBe(200);
    expect(routes.store.list(false).requirements.some((r) => r.title === "直接建")).toBe(true);
  });

  test("launch and stop wait for the owner too, with their details", async () => {
    const fake = fakeGate();
    const api = actions({ approvals: fake.gate });
    const launch = await act(api, { action: "launch-session", agent: "claude-code", project_id: "prj_1", words: "开工", idempotency_key: "k-launch-gate" });
    expect(launch.status).toBe(202);
    expect(fake.requests[0]).toMatchObject({ action: "launch-session", title: "启动执行会话（claude-code）" });
    expect(fake.requests[0]!.detail).toMatchObject({ agent: "claude-code", project_id: "prj_1", words: "开工" });
    expect(launchCalls).toHaveLength(0);
    fake.approve("k-launch-gate", { ok: true, thread_id: "msg_launch" });
    expect((await act(api, { action: "launch-session", agent: "claude-code", project_id: "prj_1", words: "开工", idempotency_key: "k-launch-gate" })).status).toBe(200);
    expect(launchCalls).toHaveLength(0); // the approval's executor runs it, not the action retry

    const stop = await act(api, { action: "stop-session", session: "ses_1", idempotency_key: "k-stop-gate" });
    expect(stop.status).toBe(202);
    expect(fake.requests[1]).toMatchObject({ action: "stop-session", title: "停止会话" });
    fake.approve("k-stop-gate", { ok: true, thread_id: "msg_thread" });
    expect((await act(api, { action: "stop-session", session: "ses_1", idempotency_key: "k-stop-gate" })).status).toBe(200);
    expect(stopCalls).toHaveLength(0);
  });

  test("archive waits for approval and releases the card's sessions", async () => {
    const fake = fakeGate();
    fake.auto["create-requirement"] = true;
    const api = actions({ approvals: fake.gate });
    const made = await act(api, { action: "create-requirement", title: "旧需求", idempotency_key: "k-archive-card" });
    const id = (made.data.requirement as { id: string }).id;
    routes.store.link(id, "msg_thread");
    const asked = await act(api, { action: "archive-requirement", requirement: id, idempotency_key: "k-archive" });
    expect(asked.status).toBe(202);
    expect(fake.requests.at(-1)).toMatchObject({ action: "archive-requirement", title: "归档需求《旧需求》" });
    expect(fake.requests.at(-1)!.detail).toMatchObject({ requirement: id, released: 1 });

    const executed = await api.execute("archive-requirement", { requirement: id, idempotency_key: "k-archive-exec" }, { approved: true, eventId: "evt_archive", idempotencyKey: "k-archive-exec" });
    expect(executed.ok).toBe(true);
    expect(routes.store.get(id)!.requirement.archived_at).not.toBeNull();
    expect(routes.store.get(id)!.requirement.threads).toEqual([]);
    expect(sayNotes(id).some((note) => note.includes("替主人归档了需求") && note.includes("主人批准"))).toBe(true);
    const again = await act(api, { action: "archive-requirement", requirement: id, idempotency_key: "k-archive-again" });
    expect(again.status).toBe(409);
    expect(again.data.code).toBe("already_archived");
  });

  test("a denied action says so on retry; the approved executor writes the audit", async () => {
    const fake = fakeGate();
    const api = actions({ approvals: fake.gate });
    await act(api, { action: "launch-session", agent: "claude-code", project_id: "prj_1", words: "开工", idempotency_key: "k-deny" });
    fake.deny("k-deny");
    const denied = await act(api, { action: "launch-session", agent: "claude-code", project_id: "prj_1", words: "开工", idempotency_key: "k-deny" });
    expect(denied.status).toBe(403);
    expect(denied.data.code).toBe("approval_denied");

    fake.auto["create-requirement"] = true;
    const made = await act(api, { action: "create-requirement", title: "登录页改版", idempotency_key: "k-exec-card" });
    const id = (made.data.requirement as { id: string }).id;
    routes.store.link(id, "msg_thread");
    const executed = await api.execute("stop-session", { requirement: id, idempotency_key: "k-exec-stop" }, { approved: true, eventId: "evt_approval", idempotencyKey: "k-exec-stop" });
    expect(executed.ok).toBe(true);
    expect(stopCalls).toHaveLength(1);
    expect(sayNotes(id).some((note) => note.includes("打断已送出") && note.includes("主人批准"))).toBe(true);
  });
});

describe("the endpoint and its files", () => {
  test("publish writes the URL for this run; stop removes it; the action log keeps the answer", async () => {
    const api = actions();
    api.publish(53998);
    const hintPath = join(butlerDir, "action.json");
    expect(JSON.parse(readFileSync(hintPath, "utf8"))).toMatchObject({ url: "http://127.0.0.1:53998/api/inbox/butler/act" });
    await act(api, { action: "create-requirement", title: "x", idempotency_key: "k-log" });
    const log = JSON.parse(readFileSync(join(butlerDir, "actions.json"), "utf8")) as { results: Record<string, { action: string }> };
    expect(log.results["k-log"]?.action).toBe("create-requirement");
    api.stop();
    expect(existsSync(hintPath)).toBe(false);
  });

  test("another path is not this endpoint", async () => {
    const api = actions();
    const response = await api.route(new Request("http://127.0.0.1:53998/api/inbox/butler/brief"), new URL("http://127.0.0.1:53998/api/inbox/butler/brief"));
    expect(response).toBeNull();
  });
});
