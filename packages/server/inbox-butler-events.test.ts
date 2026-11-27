/**
 * 管家事件机制（doc/管家-事件机制设计.md，M1 观察面）：the projector's deterministic
 * output per fact, the ledger's todos/next step, the merge and dedupe rules, the
 * cursor (a restart replays only what it missed), and the brief.
 *
 * Everything is sandboxed under a temp folder: the requirements store writes in
 * its own data dir and the butler folder is a temp `dir` of this test.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { InboxLine, InboxMessage, InboxQuestionRecord } from "@plannotator/core/inbox-types";
import { createBunRequirementRoutes } from "./requirements";
import {
  createButlerEvents,
  projectInboxLine,
  projectRequirementEvent,
  projectSessionChanges,
  type ButlerEvent,
  type ButlerSessionNow,
} from "./inbox-butler-events";

let root = "";
let dataDir = "";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "plannotator-butler-events-"));
  dataDir = join(root, "data");
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const at = (ms: number) => new Date(ms).toISOString();

function requirements() {
  return createBunRequirementRoutes({ dataDir });
}

/** The newest history line recorded for a requirement (events are append-ordered). */
function lastEventOf(routes: ReturnType<typeof requirements>, req: string) {
  const events = routes.store.get(req)!.events;
  return events[events.length - 1]!;
}

describe("the semantic projector", () => {
  test("a requirement's facts project to the same event every time (id and dedupe derive from the fact)", () => {
    const routes = requirements();
    const requirement = routes.store.create({ title: "登录页改版" });
    const created = projectRequirementEvent(routes.store.eventsAfter!(null)[0]!, requirement);
    expect(created).toMatchObject({ domain: "requirement", kind: "requirement.created", level: "record", actor: "person" });
    expect(created.summary).toContain("登录页改版");
    expect(created.dedupe).toBe(`req:${routes.store.eventsAfter!(null)[0]!.id}`);
    // The same fact, projected again: the same event (not a fresh one), so a replay can be a no-op.
    expect(projectRequirementEvent(routes.store.eventsAfter!(null)[0]!, requirement).id).toBe(created.id);
    expect(created.source).toBe(routes.store.eventsAfter!(null)[0]!.id);
  });

  test("stage, delivery, verdict and notes read as the person's words, with their levels", () => {
    const routes = requirements();
    const requirement = routes.store.create({ title: "登录页改版" });
    routes.store.patch(requirement.id, { stage: "design-review" });
    const stage = projectRequirementEvent(lastEventOf(routes, requirement.id), routes.store.get(requirement.id)!.requirement);
    expect(stage).toMatchObject({ kind: "requirement.stage", level: "notify" });
    expect(stage.summary).toContain("设计评审");

    const deliverable = routes.store.deliver(requirement.id, { kind: "design-doc", ref: "/tmp/登录页设计.md", title: "登录页设计" });
    const delivered = projectRequirementEvent(lastEventOf(routes, requirement.id), routes.store.get(requirement.id)!.requirement);
    expect(delivered).toMatchObject({ kind: "requirement.delivered", level: "notify" });
    expect(delivered.summary).toContain("登录页设计");
    expect(delivered.ref).toEqual({ kind: "deliverable", id: deliverable.id });

    routes.store.reviewVerdict(requirement.id, deliverable.id, "approved", null);
    const verdict = projectRequirementEvent(lastEventOf(routes, requirement.id), routes.store.get(requirement.id)!.requirement);
    expect(verdict).toMatchObject({ kind: "requirement.verdict", level: "notify", actor: "person" });
    expect(verdict.summary).toContain("已批准");

    routes.store.say(requirement.id, "做完了登录页骨架", "助手", null, deliverable.id);
    const note = projectRequirementEvent(lastEventOf(routes, requirement.id), routes.store.get(requirement.id)!.requirement);
    expect(note).toMatchObject({ kind: "requirement.note", level: "record" });
    expect(note.summary).toContain("登录页骨架");
  });

  test("a message line, a failed turn and a standing question each carry their one event; answers ask nothing", () => {
    const base = { v: 1 as const, seq: 1, at: at(1_000) };
    const person = { id: "msg_1", thread_id: "msg_1", project_id: "p", subject: "登录页", body: "帮我看看", created_at: at(900), author: { kind: "person" }, reply_to: null, resolved_at: null, idempotency_key: null } as unknown as InboxMessage;
    const personEvents = projectInboxLine({ ...base, kind: "message", id: "msg_1", record: person }, () => null, () => "登录页");
    expect(personEvents).toHaveLength(1);
    expect(personEvents[0]).toMatchObject({ kind: "thread.person_message", actor: "person", subject: { thread: "msg_1" } });

    const agent = { ...person, id: "msg_2", thread_id: "msg_1", body: "额度用完了", author: { kind: "agent", host: "opencode", session: "ses_1", name: "助手" }, turn_error: true } as unknown as InboxMessage;
    const failed = projectInboxLine({ ...base, seq: 2, kind: "message", id: "msg_2", record: agent }, () => agent);
    expect(failed[0]).toMatchObject({ kind: "session.failed", level: "notify", subject: { session: "ses_1", thread: "msg_1" } });
    expect(failed[0]!.summary).toContain("额度用完了");

    // 一次正常的执行会话回复：要叫醒管家，不是只落账（现场 2026-11-27 的 08:02）。
    const report = { ...agent, id: "msg_report", turn_error: undefined, body: "方案已经出好了" } as unknown as InboxMessage;
    const reported = projectInboxLine({ ...base, seq: 5, kind: "message", id: report.id, record: report }, () => report);
    expect(reported[0]).toMatchObject({ kind: "thread.agent_message", level: "notify" });
    expect(reported[0]!.summary).toContain("方案已经出好了");

    const question: InboxQuestionRecord = {
      id: "msg_2/q1",
      project_id: "p",
      message_id: "msg_2",
      key: "q1",
      position: 0,
      kind: "single",
      prompt: "用哪个配色？",
      parsed: {} as InboxQuestionRecord["parsed"],
      stopped: null,
      holds_up: [],
      asked_by_agent_id: null,
      answer: null,
      revision: 0,
      sent_revision: 0,
      picked_by: null,
      picked_at: null,
      sent_reply_id: null,
    };
    const asked = projectInboxLine({ ...base, seq: 3, kind: "question", id: question.id, record: question }, () => agent);
    expect(asked[0]).toMatchObject({ kind: "thread.agent_question", level: "notify", subject: { thread: "msg_1", session: "ses_1" } });
    expect(asked[0]!.summary).toContain("用哪个配色？");
    expect(projectInboxLine({ ...base, seq: 4, kind: "question", id: question.id, record: { ...question, answer: { kind: "single", value: "深色" } as never } }, () => agent)).toEqual([]);
  });

  test("live sessions project started/working/ended on their transitions only", () => {
    const idle: ButlerSessionNow = { session: "ses_1", host: "claude-code", busy: false, label: "设计助手", startedAt: 10, root: null };
    const busy = { ...idle, busy: true };
    expect(projectSessionChanges(new Map(), [idle], at(1_000))).toMatchObject([{ kind: "session.started", summary: "设计助手 开始了一个会话" }]);
    expect(projectSessionChanges(new Map([["ses_1", idle]]), [busy], at(2_000))).toMatchObject([{ kind: "session.working", summary: "设计助手 在干活" }]);
    expect(projectSessionChanges(new Map([["ses_1", busy]]), [busy], at(3_000))).toEqual([]);
    expect(projectSessionChanges(new Map([["ses_1", busy]]), [], at(4_000))).toMatchObject([{ kind: "session.ended", summary: "设计助手 结束了" }]);
  });
});

describe("the ledger and the brief", () => {
  test("a delivery lands in 等你; a verdict clears it; short bursts of notes fold into one line", () => {
    const routes = requirements();
    const events = createButlerEvents({ dir: join(root, "butler"), requirements: { store: routes.store, watch: routes.watch }, pollMs: 10 });
    events.start();
    const requirement = routes.store.create({ title: "登录页改版" });
    routes.store.patch(requirement.id, { stage: "design-review" });
    routes.store.deliver(requirement.id, { kind: "design-doc", ref: "/tmp/a.md", title: "登录页设计" });
    let ledger = events.ledger(requirement.id)!;
    // The source is the one truth: a history line recorded before the write still reads the new stage.
    expect(ledger.stage).toBe("design-review");
    expect(ledger.todos.on_person.join("\n")).toContain("审阅");
    expect(ledger.next_action?.level).toBe("notify");
    expect(events.brief().text).toContain("今天等你 1 件");
    expect(events.brief().waiting[0]).toMatchObject({ req: requirement.id, title: "登录页改版" });

    const deliverable = routes.store.get(requirement.id)!.requirement.deliverables[0]!;
    routes.store.reviewVerdict(requirement.id, deliverable.id, "approved", null);
    ledger = events.ledger(requirement.id)!;
    expect(ledger.todos.on_person.join("\n")).not.toContain("审阅");
    expect(ledger.todos.on_session.join("\n")).toContain("继续");

    for (let index = 0; index < 5; index++) routes.store.say(requirement.id, `进度 ${index}`, "助手");
    ledger = events.ledger(requirement.id)!;
    const folded = ledger.timeline.filter((line) => line.summary.includes("进度"));
    expect(folded).toHaveLength(1);
    expect(folded[0]).toMatchObject({ merged: 5 });
    expect(folded[0]!.summary).toContain("进度 4");
    // The md is the butler's view of the same facts.
    expect(events.ledgerMarkdown(requirement.id)).toContain("## 进展");
    expect(events.ledgerMarkdown(requirement.id)).toContain("合并 5 条");
    events.stop();
  });

  test("a session fact finds its requirement through the thread the session owns", async () => {
    const routes = requirements();
    let sessions: ButlerSessionNow[] = [];
    const events = createButlerEvents({
      dir: join(root, "butler"),
      requirements: { store: routes.store, watch: routes.watch },
      sessions: () => sessions,
      pollMs: 10,
      inbox: {
        cursor: () => 0,
        changesSince: () => [],
        subscribe: () => () => {},
        message: () => null,
        threadOfSession: (session) => (session === "ses_1" ? "msg_1" : null),
      },
    });
    events.start();
    const requirement = routes.store.create({ title: "登录页改版" });
    routes.store.link(requirement.id, "msg_1");
    sessions = [{ session: "ses_1", host: "opencode", busy: false, label: "设计助手", startedAt: 10, root: null }];
    await Bun.sleep(60);
    const timeline = events.ledger(requirement.id)!.timeline.map((line) => line.summary);
    expect(timeline.some((summary) => summary.includes("开始了一个会话"))).toBe(true);
    events.stop();
  });

  test("a deleted requirement becomes a read-only tombstone that stops asking", () => {
    const routes = requirements();
    const events = createButlerEvents({ dir: join(root, "butler"), requirements: { store: routes.store, watch: routes.watch }, pollMs: 10 });
    events.start();
    const requirement = routes.store.create({ title: "登录页改版" });
    routes.store.deliver(requirement.id, { kind: "design-doc", ref: "/tmp/a.md", title: "登录页设计" });
    expect(events.brief().waiting).toHaveLength(1);
    routes.store.remove(requirement.id);
    const ledger = events.ledger(requirement.id)!;
    expect(ledger.tombstone).toBe(true);
    expect(ledger.todos.on_person).toEqual([]);
    expect(events.brief().waiting).toEqual([]);
    expect(events.ledgerMarkdown(requirement.id)).toContain("已删除");
    events.stop();
  });

  test("the same fact is handled once even when it arrives twice", () => {
    const routes = requirements();
    const events = createButlerEvents({ dir: join(root, "butler"), requirements: { store: routes.store, watch: routes.watch }, pollMs: 10 });
    events.start();
    const requirement = routes.store.create({ title: "登录页改版" });
    const before = events.ledger(requirement.id)!.timeline.length;
    const created = events.recent().find((event) => event.kind === "requirement.created")!;
    events.record(created);
    expect(events.ledger(requirement.id)!.timeline).toHaveLength(before);
    events.stop();
  });

  test("the brief lists at most five waiting items and says how many more", () => {
    const routes = requirements();
    const events = createButlerEvents({ dir: join(root, "butler"), requirements: { store: routes.store, watch: routes.watch }, pollMs: 10 });
    events.start();
    for (let index = 0; index < 7; index++) {
      const requirement = routes.store.create({ title: `需求 ${index}` });
      routes.store.deliver(requirement.id, { kind: "design-doc", ref: `/tmp/${index}.md`, title: `设计 ${index}` });
    }
    const brief = events.brief();
    expect(brief.waiting).toHaveLength(5);
    expect(brief.more).toBe(2);
    expect(brief.text).toContain("今天等你 7 件");
    events.stop();
  });
});

describe("the cursor", () => {
  test("a restart replays only what it missed, and the ledgers keep what they had", () => {
    const routes = requirements();
    const dir = join(root, "butler");
    const first = createButlerEvents({ dir, requirements: { store: routes.store, watch: routes.watch }, pollMs: 10 });
    first.start();
    const one = routes.store.create({ title: "一" });
    routes.store.deliver(one.id, { kind: "design-doc", ref: "/tmp/one.md", title: "一号设计" });
    const timelineBefore = first.ledger(one.id)!.timeline.length;
    first.stop();

    // While the butler was away: a new requirement and a note on the old one.
    const two = routes.store.create({ title: "二" });
    routes.store.say(one.id, "偷偷摸摸的进展", "助手");

    const second = createButlerEvents({ dir, requirements: { store: routes.store, watch: routes.watch }, pollMs: 10 });
    second.start();
    // The old requirement kept its lines and took only the missed note (dedupe by source id).
    const oneLedger = second.ledger(one.id)!;
    expect(oneLedger.timeline.length).toBe(timelineBefore + 1);
    expect(oneLedger.timeline.at(-1)!.summary).toContain("偷偷摸摸的进展");
    // The requirement made while away is not invisible: its own history replays into a new ledger.
    expect(second.ledger(two.id)?.timeline.some((line) => line.summary.includes("新需求"))).toBe(true);
    second.stop();
  });

  test("the cursor file is written under the butler folder (0600-friendly, JSON)", () => {
    const routes = requirements();
    const dir = join(root, "butler");
    const events = createButlerEvents({ dir, requirements: { store: routes.store, watch: routes.watch }, pollMs: 10 });
    events.start();
    routes.store.create({ title: "登录页改版" });
    expect(existsSync(join(dir, "events.cursor.json"))).toBe(true);
    const cursor = JSON.parse(readFileSync(join(dir, "events.cursor.json"), "utf8")) as { requirement: string; thread: number };
    expect(cursor.requirement).toStartWith("evt_");
    events.stop();
  });
});

describe("the Inbox journal and the digest", () => {
  test("messages and questions land once and reach the brief/digest", () => {
    const lines: InboxLine[] = [];
    const messages = new Map<string, InboxMessage>();
    const listeners = new Set<(line: InboxLine) => void>();
    let seq = 0;
    const inbox = {
      cursor: () => seq,
      changesSince: (from: number) => lines.filter((line) => line.seq > from),
      subscribe: (listener: (line: InboxLine) => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      message: (id: string) => messages.get(id) ?? null,
      threadSubject: (threadId: string) => messages.get(threadId)?.subject ?? null,
    };
    const events = createButlerEvents({ dir: join(root, "butler"), inbox, pollMs: 10, now: () => 10_000 });
    events.start();

    const rootMessage = { id: "msg_1", thread_id: "msg_1", project_id: "p", subject: "登录页", body: "帮我看看", created_at: at(9_000), author: { kind: "person" }, reply_to: null, resolved_at: null, idempotency_key: null } as unknown as InboxMessage;
    const push = (line: InboxLine) => {
      lines.push(line);
      seq = Math.max(seq, line.seq);
      for (const listener of listeners) listener(line);
    };
    messages.set(rootMessage.id, rootMessage);
    push({ v: 1, seq: 1, at: at(9_100), kind: "message", id: rootMessage.id, record: rootMessage });
    const agent = { ...rootMessage, id: "msg_2", reply_to: "msg_1", body: "遇到一个问题", author: { kind: "agent", host: "opencode", session: "ses_1", name: "助手" } } as unknown as InboxMessage;
    messages.set(agent.id, agent);
    push({ v: 1, seq: 2, at: at(9_200), kind: "message", id: agent.id, record: agent });
    const question = { id: "msg_2/q1", project_id: "p", message_id: "msg_2", key: "q1", position: 0, kind: "single", prompt: "用哪个配色？", parsed: {}, stopped: null, holds_up: [], asked_by_agent_id: null, answer: null, revision: 0, sent_revision: 0, picked_by: null, picked_at: null, sent_reply_id: null } as unknown as InboxQuestionRecord;
    push({ v: 1, seq: 3, at: at(9_300), kind: "question", id: question.id, record: question });

    expect(events.recent().map((event) => event.kind).filter((kind) => kind !== "system.first_attach")).toEqual(["thread.person_message", "thread.agent_message", "thread.agent_question"]);
    const digest = events.takeDigest();
    expect(digest).toContain("【动态】");
    // The execution session's reply is in the wake, not only its question.
    expect(digest).toContain("遇到一个问题");
    expect(digest).toContain("用哪个配色？");
    // Said once: the next look has nothing new.
    expect(events.takeDigest()).toBe("");

    // 同一线程不到 30 分钟又来一条真回复：内容类事件不被静默吞掉。
    const later = { ...agent, id: "msg_3", body: "新的方案也出好了" } as unknown as InboxMessage;
    messages.set(later.id, later);
    push({ v: 1, seq: 4, at: at(11_000), kind: "message", id: later.id, record: later });
    const next = events.takeDigest();
    expect(next).toContain("新的方案也出好了");
    events.stop();
  });

  test("a question in a requirement's thread reaches that requirement's 等你", () => {
    const routes = requirements();
    const lines: InboxLine[] = [];
    const messages = new Map<string, InboxMessage>();
    const listeners = new Set<(line: InboxLine) => void>();
    let seq = 0;
    const inbox = {
      cursor: () => seq,
      changesSince: (from: number) => lines.filter((line) => line.seq > from),
      subscribe: (listener: (line: InboxLine) => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      message: (id: string) => messages.get(id) ?? null,
      threadSubject: (threadId: string) => messages.get(threadId)?.subject ?? null,
    };
    const events = createButlerEvents({ dir: join(root, "butler"), requirements: { store: routes.store, watch: routes.watch }, inbox, pollMs: 10 });
    events.start();
    const requirement = routes.store.create({ title: "登录页改版" });
    routes.store.link(requirement.id, "msg_1");
    const rootMessage = { id: "msg_1", thread_id: "msg_1", project_id: "p", subject: "登录页", body: "帮我看看", created_at: at(9_000), author: { kind: "person" }, reply_to: null, resolved_at: null, idempotency_key: null } as unknown as InboxMessage;
    messages.set(rootMessage.id, rootMessage);
    const agent = { ...rootMessage, id: "msg_2", reply_to: "msg_1", author: { kind: "agent", host: "opencode", session: "ses_1", name: "助手" } } as unknown as InboxMessage;
    messages.set(agent.id, agent);
    const question = { id: "msg_2/q1", project_id: "p", message_id: "msg_2", key: "q1", position: 0, kind: "single", prompt: "用哪个配色？", parsed: {}, stopped: null, holds_up: [], asked_by_agent_id: null, answer: null, revision: 0, sent_revision: 0, picked_by: null, picked_at: null, sent_reply_id: null } as unknown as InboxQuestionRecord;
    const push = (line: InboxLine) => {
      lines.push(line);
      seq = Math.max(seq, line.seq);
      for (const listener of listeners) listener(line);
    };
    push({ v: 1, seq: 1, at: at(9_100), kind: "message", id: rootMessage.id, record: rootMessage });
    push({ v: 1, seq: 2, at: at(9_200), kind: "message", id: agent.id, record: agent });
    push({ v: 1, seq: 3, at: at(9_300), kind: "question", id: question.id, record: question });
    expect(events.ledger(requirement.id)!.todos.on_person.join("\n")).toContain("用哪个配色");
    expect(events.brief().waiting.some((item) => item.req === requirement.id)).toBe(true);
    // A failed turn's todo names the reason once, not "处理失败的会话：…会话失败：…".
    const failed = { ...agent, id: "msg_3", body: "额度用完", turn_error: true } as unknown as InboxMessage;
    messages.set(failed.id, failed);
    push({ v: 1, seq: 4, at: at(9_400), kind: "message", id: failed.id, record: failed });
    const todos = events.ledger(requirement.id)!.todos.on_person.join("\n");
    expect(todos).toContain("处理失败的会话：额度用完");
    expect(todos).not.toContain("会话失败：额度用完");
    events.stop();
  });

  test("a digest is never more than its line budget and a wake is debounced", async () => {
    const routes = requirements();
    const wakes: string[] = [];
    const dir = join(root, "butler");
    const events = createButlerEvents({
      dir,
      requirements: { store: routes.store, watch: routes.watch },
      pollMs: 10,
      wakeDelayMs: 10,
      now: () => Date.now(),
      onWake: (digest) => wakes.push(digest),
    });
    events.start();
    for (let index = 0; index < 14; index++) {
      const requirement = routes.store.create({ title: `需求 ${index}` });
      routes.store.deliver(requirement.id, { kind: "design-doc", ref: `/tmp/${index}.md`, title: `设计 ${index}` });
    }
    await Bun.sleep(40);
    // Many deliveries, one wake (merged by the delay), and its lines stay within the budget.
    expect(wakes.length).toBe(1);
    expect(wakes[0]!.split("\n").length).toBeLessThanOrEqual(12);
    expect(wakes[0]).toContain("还有");
    events.stop();
  });

  test("the brief route answers the window only (same origin)", async () => {
    const routes = requirements();
    const events = createButlerEvents({ dir: join(root, "butler"), requirements: { store: routes.store, watch: routes.watch }, pollMs: 10 });
    events.start();
    const requirement = routes.store.create({ title: "登录页改版" });
    const request = (site: string) => new Request("http://127.0.0.1/api/inbox/butler/brief", { headers: { "sec-fetch-site": site } });
    const url = new URL("http://127.0.0.1/api/inbox/butler/brief");
    expect(await events.route(request("cross-site"), url)).toBeNull();
    const answer = await events.route(request("same-origin"), url);
    expect(answer!.status).toBe(200);
    const body = (await answer!.json()) as { brief: { waiting: unknown[] } };
    expect(Array.isArray(body.brief.waiting)).toBe(true);
    const ledgerAnswer = await events.route(new Request(`http://127.0.0.1/api/inbox/butler/ledger/${requirement.id}`, { headers: { "sec-fetch-site": "same-origin" } }), new URL(`http://127.0.0.1/api/inbox/butler/ledger/${requirement.id}`));
    expect(((await ledgerAnswer!.json()) as { markdown: string }).markdown).toContain("登录页改版");
    events.stop();
  });
});

// A type-level guard: the envelope keeps the fields the design names.
const _shape: ButlerEvent = {
  id: "be_x",
  at: at(0),
  domain: "system",
  kind: "system.first_attach",
  subject: {},
  actor: "system",
  summary: "",
  dedupe: "x",
  level: "record",
};
void _shape;
