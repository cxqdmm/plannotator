/**
 * The butler's action channel through a real Inbox (M2, doc/管家-事件机制设计.md §7.3):
 * a card made by the butler, then a session started from it — the document's acceptance
 * ("说「把 X 建卡并开工」→ 卡片出现、会话开跑、历史两条"). The launch engine is its fake
 * host; everything else (the action endpoint, the requirement store, compose's write path,
 * the audit notes) is the product's.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { InboxMessageWire } from "@plannotator/core/inbox-types";
import type { TailscaleRunner } from "@plannotator/shared/tailscale";
import { FAKE, fakeLaunchHost } from "../../tests/helpers/fake-launch-host";
import { startInboxServer, type InboxServer } from "./inbox";

const restore: (() => void)[] = [];
afterEach(() => {
  for (const undo of restore.splice(0).reverse()) undo();
});

function setEnv(name: string, value: string | undefined) {
  const before = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  restore.push(() => {
    if (before === undefined) delete process.env[name];
    else process.env[name] = before;
  });
}

const tailscale: TailscaleRunner = (args) => ({ status: 0, stdout: args[1] === "status" ? "{}" : "", stderr: "" });

async function setup() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "plannotator-butler-act-")));
  restore.push(() => rmSync(root, { recursive: true, force: true }));
  const dataDir = join(root, "data");
  const folder = join(root, "web");
  const butler = join(root, "butler");
  mkdirSync(dataDir);
  mkdirSync(folder);
  writeFileSync(join(dataDir, "config.json"), JSON.stringify({ inboxLaunch: { enabled: true } }));
  setEnv("PLANNOTATOR_DATA_DIR", dataDir);
  setEnv("PLANNOTATOR_TEST_SANDBOX", dataDir);
  setEnv("PLANNOTATOR_BUTLER_DIR", butler);
  setEnv("HOME", join(root, "home"));
  setEnv("PLANNOTATOR_RELAY_URL", "http://127.0.0.1:9");
  const fake = fakeLaunchHost();
  const server: InboxServer = await startInboxServer({ dataDir, binaryPath: null, phones: false, tailscale, readProjectRepo: async () => null, launchHosts: () => [fake.host] });
  restore.push(() => server.stop());
  const project = server.store.ensureProject({ name: "web", root: folder });
  const base = `http://127.0.0.1:${server.port}`;
  const act = (body: Record<string, unknown>) =>
    fetch(`${base}/api/inbox/butler/act`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const approvals = async () =>
    (await (await fetch(`${base}/api/inbox/butler/approvals`, { headers: { "sec-fetch-site": "same-origin" } })).json()) as {
      approvals: { pending: { id: string; status: string; action: string; detail: { card?: string; contexts?: { kind: string; name: string }[]; agent?: string; project_id?: string; words?: string } }[]; decided: { id: string; status: string; result: { requirement_id?: string } | null }[] };
      auto: Record<string, boolean>;
    };
  const approvalWrite = (path: string, body: Record<string, unknown>) =>
    fetch(`${base}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" },
      body: JSON.stringify({ serverSession: server.serverSession, ...body }),
    });
  const decide = (id: string, body: Record<string, unknown>) => approvalWrite(`/api/inbox/butler/approvals/${id}/decide`, body);
  const settings = (action: string, mode: string) => approvalWrite("/api/inbox/butler/approvals/settings", { action, mode });
  const requirement = async (id: string) => (await (await fetch(`${base}/api/requirements/${id}`)).json()) as {
    requirement: { id: string; threads: string[]; title: string; archived_at?: string | null };
    events: { kind: string; note?: string }[];
  };
  const message = async (threadId: string) => ((await (await fetch(`${base}/api/inbox/threads/${threadId}`)).json()) as { thread: { messages: InboxMessageWire[] } }).thread.messages[0]!;
  return { root, server, fake, project, base, act, approvals, decide, settings, requirement, message, butler };
}

async function until(check: () => boolean) {
  for (let i = 0; i < 400 && !check(); i++) await Bun.sleep(5);
  expect(check()).toBe(true);
}

describe("the butler's action channel in a running Inbox", () => {
  test("建卡并开工: the card waits in the approval tab, the owner approves, then the session starts", async () => {
    const { root, server, base, fake, project, act, approvals, decide, requirement, message } = await setup();
    const source = join(root, "note.txt");
    writeFileSync(source, "附件内容");

    const made = await act({
      action: "create-requirement",
      title: "登录页改版",
      notes: "## 背景 / 为什么\n旧版太慢\n\n## 目标\n- 首屏更快\n\n## 验收\n- [ ] 1 秒内可交互",
      project_id: project.id,
      contexts: [
        { kind: "link", name: "PRD", ref: "https://example.com/prd" },
        { kind: "file", name: "说明.txt", path: source },
      ],
      idempotency_key: "live-card",
    });
    expect(made.status).toBe(202);
    const pending = (await made.json()) as { code: string; approval_id: string };
    expect(pending.code).toBe("pending_approval");

    // The approval tab sees the complete document and the context list, not the raw payload.
    const before = await approvals();
    expect(before.approvals.pending).toHaveLength(1);
    expect(before.approvals.pending[0]!.detail.card).toContain("需求卡：登录页改版");
    expect(before.approvals.pending[0]!.detail.card).toContain("## 目标");
    expect(before.approvals.pending[0]!.detail.contexts).toEqual([
      { kind: "link", name: "PRD" },
      { kind: "file", name: "说明.txt" },
    ]);
    expect(before.auto["create-requirement"]).toBe(false);

    // Another site's page cannot decide; the owner's window can.
    const foreign = await fetch(`${base}/api/inbox/butler/approvals/${pending.approval_id}/decide`, {
      method: "POST",
      headers: { "content-type": "application/json", "sec-fetch-site": "cross-site" },
      body: JSON.stringify({ serverSession: server.serverSession, decision: "approve" }),
    });
    expect(foreign.status).toBe(403);
    const approved = await decide(pending.approval_id, { decision: "approve" });
    expect(approved.status).toBe(200);
    const approvedBody = (await approved.json()) as { approval: { status: string; result: { requirement_id: string } } };
    expect(approvedBody.approval.status).toBe("approved");
    const id = approvedBody.approval.result.requirement_id;
    const detail = await requirement(id);
    expect(detail.requirement.title).toBe("登录页改版");
    expect((detail.requirement as { project: { id: string; root: string } }).project).toMatchObject({ id: project.id, root: project.root });
    // The contexts came with the card; the file was copied into the requirement's own folder.
    const copied = (await (await fetch(`${base}/api/requirements/${id}`)).json() as { requirement: { contexts: { kind: string; name: string; ref: string }[] } }).requirement.contexts;
    expect(copied).toHaveLength(2);
    expect(copied.find((context) => context.kind === "link")).toMatchObject({ name: "PRD", ref: "https://example.com/prd" });
    expect(copied.find((context) => context.kind === "file")).toMatchObject({ name: "说明.txt" });
    const fileRef = copied.find((context) => context.kind === "file")!.ref;
    expect(fileRef).toContain("requirements/contexts/");
    expect(readFileSync(fileRef, "utf8")).toBe("附件内容");

    // Launching is just another approval: the card waits, the owner approves, the agent starts.
    // No project in the launch: the card's own project is used.
    const launched = await act({ action: "launch-session", agent: FAKE, requirement: id, idempotency_key: "live-launch" });
    expect(launched.status).toBe(202);
    const launchPending = (await launched.json()) as { approval_id: string; code: string };
    expect(launchPending.code).toBe("pending_approval");
    const launchApproval = (await approvals()).approvals.pending.find((approval) => approval.id === launchPending.approval_id)!;
    expect(launchApproval.detail).toMatchObject({ agent: FAKE, project_id: project.id });
    expect(launchApproval.detail.card).toContain("需求卡：登录页改版");
    const approvedLaunch = await decide(launchApproval.id, { decision: "approve" });
    expect(approvedLaunch.status).toBe(200);
    const answer = ((await approvedLaunch.json()) as { approval: { result: { ok: boolean; thread_id: string } } }).approval.result;
    expect(answer.ok).toBe(true);
    expect(answer.thread_id).toStartWith("msg_");

    // The card is on the new thread, and the agent was started once.
    const threadRoot = await message(answer.thread_id);
    expect(threadRoot.body).toContain("需求卡：登录页改版");
    expect(threadRoot.body).toContain(id);
    await until(() => fake.calls.some((call) => call.startsWith("start ")));
    expect(fake.calls.filter((call) => call.startsWith("start "))).toHaveLength(1);

    // The requirement took the thread, and both butler actions are in its history.
    const after = await requirement(id);
    expect(after.requirement.threads).toContain(answer.thread_id);
    const notes = after.events.filter((event) => event.kind === "say").map((event) => event.note ?? "");
    expect(notes.some((note) => note.startsWith("管家:") && note.includes("建了这张卡（主人批准）"))).toBe(true);
    expect(notes.some((note) => note.startsWith("管家:") && note.includes("开好了执行会话"))).toBe(true);

    // The endpoint's hint is where the butler reads it.
    const hint = JSON.parse(await Bun.file(join(process.env.PLANNOTATOR_BUTLER_DIR!, "action.json")).text()) as { url: string };
    expect(hint.url).toEndWith("/api/inbox/butler/act");

    // Archiving is an approval too; approving releases the card's sessions and stops the Inbox-started one.
    const archiveAsked = await act({ action: "archive-requirement", requirement: id, idempotency_key: "live-archive" });
    expect(archiveAsked.status).toBe(202);
    const archiveApprovalId = ((await archiveAsked.json()) as { approval_id: string }).approval_id;
    const archiveApproval = (await approvals()).approvals.pending.find((approval) => approval.id === archiveApprovalId)!;
    expect(archiveApproval.action).toBe("archive-requirement");
    const approvedArchive = await decide(archiveApprovalId, { decision: "approve" });
    expect(approvedArchive.status).toBe(200);
    const archived = await requirement(id);
    expect(archived.requirement.archived_at).toBeTruthy();
    expect(archived.requirement.threads).toEqual([]);
    await until(() => fake.calls.some((call) => call.startsWith("stop ")));
  });

  test("a repeated key answers the card it made and starts nothing more; a denied card never appears", async () => {
    const { fake, project, act, approvals, decide, settings } = await setup();
    const auto = await settings("create-requirement", "auto");
    expect(auto.status).toBe(200);
    const once = await act({ action: "create-requirement", title: "登录页改版", idempotency_key: "same-key" });
    expect(once.status).toBe(200);
    const id = ((await once.json()) as { requirement: { id: string } }).requirement.id;
    const twice = await act({ action: "create-requirement", title: "另一个标题", idempotency_key: "same-key" });
    expect(twice.status).toBe(200);
    const body = (await twice.json()) as { replayed: boolean; requirement: { id: string } };
    expect(body.replayed).toBe(true);
    expect(body.requirement.id).toBe(id);

    // Switch back to ask: a denied card is not created, and a retry says so.
    await settings("create-requirement", "ask");
    const asked = await act({ action: "create-requirement", title: "被拒的卡", idempotency_key: "deny-key" });
    expect(asked.status).toBe(202);
    const approvalId = ((await asked.json()) as { approval_id: string }).approval_id;
    const denied = await decide(approvalId, { decision: "deny" });
    expect(denied.status).toBe(200);
    expect((await approvals()).approvals.decided[0]?.status).toBe("denied");
    const retried = await act({ action: "create-requirement", title: "被拒的卡", idempotency_key: "deny-key" });
    expect(retried.status).toBe(403);
    expect(((await retried.json()) as { code: string }).code).toBe("approval_denied");

    // Launch is gated the same way: ask, approve, start; the switch then allows the next one.
    const first = await act({ action: "launch-session", agent: FAKE, project_id: project.id, requirement: id, idempotency_key: "ask-key" });
    expect(first.status).toBe(202);
    const launchApprovalId = ((await first.json()) as { approval_id: string }).approval_id;
    const approvedLaunch = await decide(launchApprovalId, { decision: "approve" });
    expect(approvedLaunch.status).toBe(200);
    await until(() => fake.calls.filter((call) => call.startsWith("start ")).length === 1);
    await settings("launch-session", "auto");
    const second = await act({ action: "launch-session", agent: FAKE, project_id: project.id, requirement: id, idempotency_key: "after-auto" });
    expect(second.status).toBe(200);
    await until(() => fake.calls.filter((call) => call.startsWith("start ")).length === 2);
  });
});
