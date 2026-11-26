/**
 * 管家审批（doc/管家审批与需求卡-方案.html）：the switch, the pending record, the owner's
 * decision, the executor and the event that closes the loop. The executor is faked; the
 * files and the window checks are the product's.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readButlerPreferences } from "./inbox-butler-preferences";
import { createInboxApprovals, type InboxApprovalOptions, type InboxApprovalResult } from "./inbox-approvals";
import type { ButlerEvent } from "./inbox-butler-events";

let root = "";
let dataDir = "";
let butlerDir = "";
let executes: { action: string; payload: Record<string, unknown>; meta: { approved: boolean } }[];
let events: ButlerEvent[];

const SERVER_SESSION = "ses_server";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "plannotator-approvals-"));
  dataDir = join(root, "data");
  butlerDir = join(root, "butler");
  executes = [];
  events = [];
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function make(execute?: (action: string, payload: Record<string, unknown>) => InboxApprovalResult) {
  const options: InboxApprovalOptions = {
    dataDir,
    butlerDir,
    serverSession: SERVER_SESSION,
    execute: async (action, payload, meta) => {
      executes.push({ action, payload, meta });
      return execute ? execute(action, payload) : { ok: true, requirement_id: "req_created" };
    },
    recordEvent: (event) => events.push(event),
    now: () => 1_700_000_000_000,
  };
  return createInboxApprovals(options);
}

function requestCard(api: ReturnType<typeof make>, key = "k-1", title = "登录页改版") {
  return api.request({
    action: "create-requirement",
    title: `建需求卡《${title}》`,
    summary: "旧版太慢 · 1 个上下文",
    detail: { card: "# 需求卡：登录页改版\n\n## 背景 / 为什么\n旧版太慢", contexts: [{ kind: "link", name: "PRD" }] },
    payload: { title, notes: "## 背景 / 为什么\n旧版太慢", contexts: [], idempotency_key: key },
    idempotency_key: key,
    event_id: "be_evt_1",
  });
}

const APPROVALS_URL = "http://127.0.0.1:53998/api/inbox/butler/approvals";

function getApprovals(api: ReturnType<typeof make>, headers: Record<string, string> = { "sec-fetch-site": "same-origin" }) {
  return api.route(new Request(APPROVALS_URL, { headers }), new URL(APPROVALS_URL));
}

function postDecide(api: ReturnType<typeof make>, id: string, body: Record<string, unknown>, headers: Record<string, string> = {}) {
  const url = `${APPROVALS_URL}/${id}/decide`;
  return api.route(
    new Request(url, {
      method: "POST",
      headers: { "content-type": "application/json", "sec-fetch-site": "same-origin", ...headers },
      body: JSON.stringify({ serverSession: SERVER_SESSION, ...body }),
    }),
    new URL(url),
  );
}

describe("the approval records", () => {
  test("a request is pending, deduped by key, and the window's list never carries the payload", async () => {
    const api = make();
    const first = requestCard(api);
    const again = requestCard(api);
    expect(again.id).toBe(first.id);
    expect(api.byKey("k-1")?.id).toBe(first.id);
    expect(api.list().pending).toHaveLength(1);
    const response = await getApprovals(api);
    expect(response!.status).toBe(200);
    const body = (await response!.json()) as { approvals: { pending: Record<string, unknown>[] }; auto: Record<string, boolean> };
    expect(body.auto["create-requirement"]).toBe(false);
    expect(body.approvals.pending[0]).toMatchObject({ id: first.id, status: "pending", title: "建需求卡《登录页改版》" });
    expect(body.approvals.pending[0]).not.toHaveProperty("payload");
  });

  test("the switch is in preferences.json and the window can flip it", async () => {
    const api = make();
    expect(api.auto("create-requirement")).toBe(false);
    api.setAuto("create-requirement", true);
    expect(readButlerPreferences(butlerDir).auto["create-requirement"]).toBe(true);
    const url = `${APPROVALS_URL}/settings`;
    const response = await api.route(
      new Request(url, {
        method: "POST",
        headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" },
        body: JSON.stringify({ serverSession: SERVER_SESSION, action: "create-requirement", mode: "ask" }),
      }),
      new URL(url),
    );
    expect(response!.status).toBe(200);
    expect(api.auto("create-requirement")).toBe(false);
  });
});

describe("the owner's decision", () => {
  test("approving executes once, records the result and sends the butler the closing event", async () => {
    const api = make();
    const approval = requestCard(api);
    const response = await postDecide(api, approval.id, { decision: "approve" });
    expect(response!.status).toBe(200);
    const body = (await response!.json()) as { approval: { status: string; result: { requirement_id: string } } };
    expect(body.approval.status).toBe("approved");
    expect(body.approval.result.requirement_id).toBe("req_created");
    expect(executes).toHaveLength(1);
    expect(executes[0]).toMatchObject({ action: "create-requirement", meta: { approved: true } });
    expect(events.some((event) => event.kind === "butler.action.approved" && event.actor === "butler" && event.summary.includes("登录页改版"))).toBe(true);
    const list = api.list();
    expect(list.pending).toHaveLength(0);
    expect(list.decided[0]?.status).toBe("approved");
  });

  test("denying never executes and tells the butler", async () => {
    const api = make();
    const approval = requestCard(api);
    const response = await postDecide(api, approval.id, { decision: "deny", note: "先不做" });
    expect(response!.status).toBe(200);
    expect(executes).toHaveLength(0);
    expect(api.list().decided[0]).toMatchObject({ status: "denied", note: "先不做" });
    expect(events.some((event) => event.kind === "butler.action.denied")).toBe(true);
  });

  test("the owner can choose the card's project at approval", async () => {
    const api = make();
    const approval = requestCard(api, "k-project");
    const response = await postDecide(api, approval.id, { decision: "approve", project_id: "prj_9" });
    expect(response!.status).toBe(200);
    expect(executes).toHaveLength(1);
    expect(executes[0]!.payload.project_id).toBe("prj_9");
  });

  test("always flips the switch; a second decision is refused", async () => {
    const api = make();
    const approval = requestCard(api);
    const response = await postDecide(api, approval.id, { decision: "approve", always: true });
    expect(response!.status).toBe(200);
    expect(api.auto("create-requirement")).toBe(true);
    const again = await postDecide(api, approval.id, { decision: "deny" });
    expect(again!.status).toBe(409);
    expect(executes).toHaveLength(1);
  });

  test("an execution failure is failed, with the reason, and still reports to the butler", async () => {
    const api = make(() => ({ ok: false, code: "folder_missing", error: "需求文件夹不在" }));
    const approval = requestCard(api);
    const response = await postDecide(api, approval.id, { decision: "approve" });
    expect(response!.status).toBe(200);
    const body = (await response!.json()) as { approval: { status: string; result: { error: string } } };
    expect(body.approval.status).toBe("failed");
    expect(body.approval.result.error).toContain("需求文件夹不在");
    expect(events.some((event) => event.kind === "butler.action.failed" && event.summary.includes("需求文件夹不在"))).toBe(true);
  });
});

describe("the window only", () => {
  test("reads and writes refuse another site and a stale page session", async () => {
    const api = make();
    const approval = requestCard(api);
    expect((await getApprovals(api, { "sec-fetch-site": "cross-site" }))!.status).toBe(403);
    expect((await postDecide(api, approval.id, { decision: "approve" }, { "sec-fetch-site": "cross-site" }))!.status).toBe(403);
    const url = `${APPROVALS_URL}/${approval.id}/decide`;
    const stale = await api.route(
      new Request(url, {
        method: "POST",
        headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" },
        body: JSON.stringify({ serverSession: "old", decision: "approve" }),
      }),
      new URL(url),
    );
    expect(stale!.status).toBe(409);
    expect(executes).toHaveLength(0);
  });

  test("a missing approval and a malformed decision are refused", async () => {
    const api = make();
    expect((await postDecide(api, "apr_missing", { decision: "approve" }))!.status).toBe(404);
    const approval = requestCard(api);
    expect((await postDecide(api, approval.id, { decision: "maybe" }))!.status).toBe(422);
    expect(executes).toHaveLength(0);
  });
});

describe("recovery", () => {
  test("an approval marked approved but never executed runs on resume", async () => {
    const approval = {
      id: "apr_crash",
      kind: "butler-action",
      action: "create-requirement",
      status: "approved",
      title: "建需求卡《崩溃前》",
      summary: "s",
      detail: { card: "# 需求卡：崩溃前" },
      payload: { title: "崩溃前", notes: "", contexts: [], idempotency_key: "k-crash" },
      idempotency_key: "k-crash",
      requested_at: "2026-11-26T00:00:00.000Z",
      decided_at: "2026-11-26T00:00:01.000Z",
      result: null,
      note: null,
    };
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, "approvals.json"), JSON.stringify({ v: 1, approvals: [approval] }));
    const api = make();
    await api.resume();
    expect(executes).toHaveLength(1);
    expect(api.list().decided[0]).toMatchObject({ id: "apr_crash", status: "approved" });
  });

  test("the approvals file is private", () => {
    const api = make();
    requestCard(api);
    expect(statSync(join(dataDir, "approvals.json")).mode & 0o777).toBe(0o600);
    expect(readFileSync(join(dataDir, "approvals.json"), "utf8")).toContain("k-1");
  });
});
