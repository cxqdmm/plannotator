/**
 * 管家的事件机制（doc/管家-事件机制设计.md，M1 观察面）：the Inbox is the one
 * source of truth; the butler keeps a **projection** of it — semantic events, a
 * per-requirement ledger, and a cursor — so it can answer "what is happening"
 * and be woken when something needs the person.
 *
 *   `requirement-events.json` ─┐
 *   store's message/journal ───┼─→ projector → ButlerEvent → ledger/<req>.json + .md
 *   live sessions (poll) ──────┘                 │
 *                                                └→ brief, wake digest, prompt
 *
 * The three faces of the design doc: the execution face (MCP tools) is untouched;
 * this module is the observation face (read-only, M1). The action face (M2) is not
 * built yet; when it is, it writes back through the stores, never through MCP.
 *
 * Nothing here is a second source of truth: every line in a ledger names the
 * event ids it came from, and a rebuild only needs the cursor plus the source.
 *
 * Storage, under the butler folder (`~/plannotator-butler/`):
 *   events.cursor.json      per-domain cursor + the digest's delivered_at
 *   ledger/<req>.json       machine view (fields, todos, handled dedupe keys)
 *   ledger/<req>.md         the butler's reading view
 * Tests sandbox with PLANNOTATOR_BUTLER_DIR (inbox-butler.ts).
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  inboxAgentName,
  isInboxNote,
  ulid,
  type InboxLine,
  type InboxMessage,
  type InboxQuestionRecord,
} from "@plannotator/core/inbox-types";
import { INBOX_PERMISSION_SESSION_PREFIX } from "@plannotator/core/inbox-permission";
import {
  DELIVERABLE_KIND_LABELS,
  requirementStageLabel,
  type DeliverableKind,
  type Requirement,
  type RequirementEvent,
  type RequirementStage,
} from "@plannotator/core/requirements-types";
import type { RequirementStore } from "./requirements";

// ─────────────────────────────── vocabulary ───────────────────────────────

/** A semantic event (the design doc's §5.1). `id` is derived from the fact it
 *  projects (not a fresh ULID): the same fact delivered twice has the same id,
 *  which is what makes replay idempotent as well as `dedupe`. */
export interface ButlerEvent {
  id: string;
  /** ISO time of the fact. */
  at: string;
  domain: "requirement" | "session" | "thread" | "system";
  kind: string;
  subject: {
    requirement?: string;
    thread?: string;
    session?: string;
    launch?: string;
  };
  actor: "person" | "agent" | "butler" | "system";
  /** One semantic line, usable as-is in a brief or a wake. */
  summary: string;
  /** The fact this came from, for tracing. */
  ref?: { kind: string; id: string };
  /** The source's id as its own log orders it (a requirement event's `evt_` ULID): the cursor's position. */
  source?: string;
  /** Idempotency key: the same fact arriving twice is handled once. */
  dedupe: string;
  level: "record" | "notify" | "act";
}

/** One line of a requirement's semantic timeline. */
export interface ButlerTimelineLine {
  at: string;
  summary: string;
  eventIds: string[];
  /** How many facts were folded into this line (absent: one). */
  merged?: number;
}

/** The per-requirement ledger (the design doc's §6.2). Machine view: the md is
 *  the butler's reading view of the same facts. */
export interface ButlerLedger {
  v: 1;
  req: string;
  title: string;
  stage: string;
  archived: boolean;
  /** The requirement was deleted: the ledger stays as a read-only record of it, and stops asking. */
  tombstone?: true;
  background: {
    why: string | null;
    constraints: string[];
    decisions: { at: string; text: string; by: "person" | "butler" }[];
    links: { kind: "thread" | "deliverable" | "context"; ref: string; title?: string }[];
  };
  timeline: ButlerTimelineLine[];
  todos: { on_person: string[]; on_session: string[]; on_butler: string[] };
  next_action: { text: string; why: string; level: "record" | "notify" | "act"; at: string } | null;
  cursor: { lastEventId: string | null };
  /** Dedupe keys this ledger has handled (the projection's own idempotency). */
  handled: string[];
  updated_at: string;
}

/** What the butler (and the window) reads as "现在什么情况" (§6.4, §9.1). */
export interface ButlerBrief {
  at: string;
  waiting: { req: string; title: string; text: string }[];
  running: { req: string; title: string; text: string }[];
  butler: string[];
  /** Waiting items the briefs did not list (at most 5 are listed). */
  more: number;
  /** The ready-to-say brief (≤ 5 lines of items). */
  text: string;
}

/** A live session as the projector sees it (live.allLive()). */
export interface ButlerSessionNow {
  session: string;
  host: string;
  busy: boolean | null;
  label: string | null;
  startedAt: number;
  root: string | null;
}

/** The requirements module, as far as this projector needs it. */
export interface ButlerRequirementSource {
  store: Pick<RequirementStore, "get" | "list"> & Pick<Partial<RequirementStore>, "eventsAfter">;
  watch: RequirementStore["watch"];
}

/** The Inbox store's journal, as far as message projection needs it. */
export interface ButlerInboxSource {
  cursor(): number;
  changesSince(cursor: number): InboxLine[];
  subscribe(listener: (line: InboxLine) => void): () => void;
  /** A message by id: the question projection reads the asking session from it. */
  message(id: string): InboxMessage | null | undefined;
  /** A thread's subject, for the person's own messages. */
  threadSubject?(threadId: string): string | null;
  /** An agent session's thread (the newest one it owns): a session fact's way into a requirement's ledger. */
  threadOfSession?(session: string): string | null;
}

export interface ButlerEventsOptions {
  /** The butler folder (`~/plannotator-butler/`). */
  dir: string;
  requirements?: ButlerRequirementSource | null;
  inbox?: ButlerInboxSource | null;
  /** Live sessions now (`live.allLive`); absent: no session events. */
  sessions?: (() => ButlerSessionNow[]) | null;
  now?: () => number;
  /** How long events settle before one wake (§5.5's merge). Default 2 s. */
  wakeDelayMs?: number;
  /** How often the live sessions are compared. Default 5 s. */
  pollMs?: number;
  /** The merged digest, when something needs the butler (§8.1). */
  onWake?: (digest: string, events: ButlerEvent[]) => void;
}

export const BUTLER_EVENT_MERGE_MS = 60_000;
export const BUTLER_NOTIFY_SILENCE_MS = 30 * 60_000;
export const BUTLER_WAKE_DELAY_MS = 2_000;
export const BUTLER_SESSION_POLL_MS = 5_000;
export const BUTLER_TIMELINE_KEEP = 60;
export const BUTLER_TIMELINE_SHOWN = 20;
export const BUTLER_HANDLED_KEEP = 500;
export const BUTLER_BRIEF_ITEMS_MAX = 5;
export const BUTLER_DIGEST_LINES_MAX = 12;

interface ButlerCursorFile {
  v: 1;
  /** Newest requirement event id projected (its `evt_` ULID order). */
  requirement: string | null;
  /** The store's seq the message journal was read through. */
  thread: number;
  /** Semantic events with `at` after this were not shown to the butler yet. */
  delivered_at: string | null;
  /** The dedupe keys already projected, whatever their domain (a replayed fact is never counted twice). */
  handled?: string[];
  /** When this file was last written. */
  at: string | null;
}

// ─────────────────────────────── projection ───────────────────────────────

const requirementEvent = (at: string, kind: string, summary: string, subject: ButlerEvent["subject"], extra: Partial<ButlerEvent> = {}): ButlerEvent => ({
  id: extra.id ?? `be_${kind}_${ulid()}`,
  at,
  domain: "requirement",
  kind,
  subject,
  actor: extra.actor ?? "person",
  summary,
  dedupe: extra.dedupe ?? `be:${kind}:${ulid()}`,
  level: extra.level ?? "record",
  ...(extra.ref ? { ref: extra.ref } : {}),
  ...(extra.source ? { source: extra.source } : {}),
});

/** A deliverable's name for a summary: its title, else the ref's last segment. */
function deliverableName(event: RequirementEvent): string {
  const note = event.note ?? event.field ?? "";
  return note.trim() || "交付物";
}

/**
 * One history line → one semantic event (§5.3). Deterministic: the id, dedupe
 * key and words are a pure function of the fact, so a replay is a no-op.
 * `record` is the requirement as it stands (null after a delete).
 */
export function projectRequirementEvent(event: RequirementEvent, record: Requirement | null, fallbackTitle?: string | null): ButlerEvent {
  const title = record?.title ?? (fallbackTitle || "(已删除的需求)");
  // A delivery or a verdict names a deliverable, whose own record carries the producing session
  // (the history line does not): read the thread back from it, as the Workshop does.
  const deliverable = event.from ? record?.deliverables.find((entry) => entry.id === event.from) : undefined;
  const subject: ButlerEvent["subject"] = { requirement: event.req };
  if (event.thread) subject.thread = event.thread;
  if (deliverable?.thread) subject.thread = deliverable.thread;
  const actor: ButlerEvent["actor"] = event.thread || deliverable?.by ? "agent" : "person";
  const base = { id: `be_${event.id}`, dedupe: `req:${event.id}`, actor, source: event.id };
  switch (event.kind) {
    case "created":
      return requirementEvent(event.at, "requirement.created", `新需求《${title}》`, subject, { ...base, level: "record" });
    case "deleted":
      return requirementEvent(event.at, "requirement.deleted", `需求《${title}》已删除`, subject, { ...base, level: "record" });
    case "stage": {
      const from = event.from ? requirementStageLabel(event.from as RequirementStage) : "—";
      const to = event.to ? requirementStageLabel(event.to as RequirementStage) : "—";
      const level: ButlerEvent["level"] = event.to === "design-review" || event.to === "done" ? "notify" : "record";
      return requirementEvent(event.at, "requirement.stage", `《${title}》阶段：${from} → ${to}`, subject, { ...base, level });
    }
    case "say": {
      // 审阅裁决: from = deliverable id, to = approved/annotated, note = the human words.
      if (event.field === "审阅裁决" && (event.to === "approved" || event.to === "annotated")) {
        return requirementEvent(event.at, "requirement.verdict", event.note ?? (event.to === "approved" ? `《${title}》已批准` : `《${title}》被退回`), subject, {
          ...base,
          level: "notify",
          actor: "person",
          ...(event.from ? { ref: { kind: "deliverable", id: event.from } } : {}),
        });
      }
      // A note written through the butler's action channel is the butler's own act (`say(id, …, "管家")`
      // prefixes the words): the ledger must show who did it, never borrow the person's voice.
      const actor: ButlerEvent["actor"] = event.note?.startsWith("管家:") ? "butler" : "agent";
      return requirementEvent(event.at, "requirement.note", event.note ?? `《${title}》有进展`, subject, { ...base, actor, level: "record" });
    }
    case "deliverable": {
      // Delivery: from = deliverable id, to = kind, note = title or ref (idempotent id = the deliverable).
      if (event.from && event.from.startsWith("dlv_")) {
        const kind = event.to && event.to in DELIVERABLE_KIND_LABELS ? DELIVERABLE_KIND_LABELS[event.to as DeliverableKind] : "交付物";
        return requirementEvent(event.at, "requirement.delivered", `交付${kind}《${deliverableName(event)}》，等主人裁决`, subject, {
          ...base,
          id: `be_${event.id}`,
          level: "notify",
          ref: { kind: "deliverable", id: event.from },
        });
      }
      return requirementEvent(event.at, "requirement.deliverable_removed", `撤下交付物：${(event.note ?? "").replace(/^removed:\s*/, "")}`, subject, { ...base, level: "record" });
    }
    case "context": {
      const note = event.note ?? "";
      if (note.startsWith("removed:")) return requirementEvent(event.at, "requirement.context_removed", `撤下上下文：${note.slice(8).trim()}`, subject, { ...base, level: "record" });
      if (note.startsWith("changed:")) return requirementEvent(event.at, "requirement.context_changed", `修改上下文：${note.slice(8).trim()}`, subject, { ...base, level: "record" });
      return requirementEvent(event.at, "requirement.context_added", `需求补了上下文：${note || "材料"}`, subject, { ...base, level: "record" });
    }
    case "field": {
      if (event.field === "archived") {
        const archived = !!event.to;
        return requirementEvent(event.at, archived ? "requirement.archived" : "requirement.unarchived", archived ? `需求《${title}》已归档` : `需求《${title}》已恢复`, subject, { ...base, level: archived ? "record" : "notify" });
      }
      if (event.field === "threads") {
        // The linked thread is the fact's subject too: the ledger must carry the link that lets
        // that thread's later messages and questions reach this requirement.
        if (event.to) subject.thread = event.to;
        return requirementEvent(event.at, "requirement.thread_linked", `《${title}》挂上了会话`, subject, { ...base, level: "record" });
      }
      if (event.field === "title") return requirementEvent(event.at, "requirement.renamed", `需求改名：《${title}》`, subject, { ...base, level: "record" });
      return requirementEvent(event.at, "requirement.updated", `《${title}》的${event.field ?? "内容"}有更新`, subject, { ...base, level: "record" });
    }
    case "suggestion":
      return requirementEvent(event.at, "requirement.suggestion", `《${title}》的提议：${event.note ?? ""}`, subject, { ...base, level: "record" });
    default:
      return requirementEvent(event.at, "requirement.updated", `《${title}》有更新`, subject, { ...base, level: "record" });
  }
}

/** A message's first line: the one-line gist of a report. */
function firstLine(text: string): string {
  return (text.split("\n").find((line) => line.trim()) ?? "").trim().slice(0, 120) || "（空）";
}

/** One journal line → the message/question events it carries. `messageOf` supplies
 *  the asking session for a question (the store owns the record). */
export function projectInboxLine(line: InboxLine, messageOf: (id: string) => InboxMessage | null | undefined, subjectOf?: (threadId: string) => string | null): ButlerEvent[] {
  if (line.kind === "message") {
    const message = line.record;
    if (isInboxNote(message)) return [];
    const subject = { thread: message.thread_id };
    const ref = { kind: "message", id: message.id };
    if (message.author.kind === "person") {
      const place = subjectOf?.(message.thread_id) ?? null;
      return [{
        id: `be_msg_${message.id}_person`,
        at: line.at,
        domain: "thread",
        kind: "thread.person_message",
        subject,
        actor: "person",
        summary: `${place ? `「${place}」` : "一个会话"}里主人在说话`,
        ref,
        source: message.id,
        dedupe: `msg:${message.id}:person`,
        level: "record",
      }];
    }
    const who = inboxAgentName(message.author);
    const events: ButlerEvent[] = [];
    if (message.turn_error) {
      events.push({
        id: `be_msg_${message.id}_failed`,
        at: line.at,
        domain: "session",
        kind: "session.failed",
        subject: { ...(message.author.session ? { session: message.author.session } : {}), thread: message.thread_id },
        actor: "agent",
        summary: `${who} 的会话失败：${firstLine(message.body)}`,
        ref,
        source: message.id,
        dedupe: `msg:${message.id}:failed`,
        level: "notify",
      });
    } else {
      events.push({
        id: `be_msg_${message.id}_agent`,
        at: line.at,
        domain: "thread",
        kind: "thread.agent_message",
        subject,
        actor: "agent",
        summary: `${who} 汇报了一条消息：${firstLine(message.body)}`,
        ref,
        source: message.id,
        dedupe: `msg:${message.id}:agent`,
        // 执行会话的回复是要人看的事情，不能只进账本不叫醒管家（现场 2026-11-27：
        // 08:02 的回复落了账，唤醒摘要却只有「现在等你 1 件」，正文没人捎）。
        level: "notify",
      });
    }
    return events;
  }
  if (line.kind === "question") {
    const question = line.record;
    // Only a standing question asks anything of the person: an answered, set-aside or superseded
    // one is history, and an action item is not a question (the person does it or says they can't).
    if (question.kind === "action" || question.answer || question.superseded_by || question.set_aside) return [];
    const asked = messageOf(question.message_id);
    const authorSession = asked?.author.kind === "agent" ? asked.author.session : null;
    const who = asked ? inboxAgentName(asked.author) : "一个会话";
    // A permission prompt is the Inbox's own card (`perm:<session>`): the session it stands for is
    // waiting on the person, not asking a question of its own.
    const permission = !!authorSession?.startsWith(INBOX_PERMISSION_SESSION_PREFIX);
    const session = permission ? authorSession!.slice(INBOX_PERMISSION_SESSION_PREFIX.length) : authorSession;
    return [{
      id: `be_question_${question.id}`,
      at: line.at,
      domain: "thread",
      kind: permission ? "session.waiting_person" : "thread.agent_question",
      subject: { thread: asked?.thread_id ?? question.message_id, ...(session ? { session } : {}) },
      actor: "agent",
      summary: permission ? `${who} 在等主人批准一个操作：${question.prompt.trim().slice(0, 120)}` : `${who} 在等主人回答：${question.prompt.trim().slice(0, 120)}`,
      ref: { kind: "question", id: question.id },
      source: question.id,
      dedupe: `question:${question.id}`,
      level: "notify",
    }];
  }
  return [];
}

/** Live sessions before/after a poll → started / working / ended (§5.2's session domain). */
export function projectSessionChanges(previous: ReadonlyMap<string, ButlerSessionNow>, now: readonly ButlerSessionNow[], at: string): ButlerEvent[] {
  const events: ButlerEvent[] = [];
  const seen = new Set<string>();
  for (const session of now) {
    seen.add(session.session);
    const name = session.label ?? `会话 ${session.session.slice(0, 8)}`;
    const before = previous.get(session.session);
    if (!before) {
      events.push({
        id: `be_sess_${session.session}_started_${session.startedAt}`,
        at,
        domain: "session",
        kind: "session.started",
        subject: { session: session.session },
        actor: "agent",
        summary: `${name} 开始了一个会话`,
        dedupe: `sess:${session.session}:started:${session.startedAt}`,
        level: "record",
      });
    }
    if (session.busy === true && before?.busy !== true) {
      events.push({
        id: `be_sess_${session.session}_working_${at}`,
        at,
        domain: "session",
        kind: "session.working",
        subject: { session: session.session },
        actor: "agent",
        summary: `${name} 在干活`,
        dedupe: `sess:${session.session}:working:${at}`,
        level: "record",
      });
    }
  }
  for (const [id, before] of previous) {
    if (seen.has(id)) continue;
    events.push({
      id: `be_sess_${id}_ended_${at}`,
      at,
      domain: "session",
      kind: "session.ended",
      subject: { session: id },
      actor: "agent",
      summary: `${before.label ?? `会话 ${id.slice(0, 8)}`} 结束了`,
      dedupe: `sess:${id}:ended:${at}`,
      level: "record",
    });
  }
  return events;
}

// ─────────────────────────────── ledger ───────────────────────────────────

/** Read a ledger's JSON, or null when there is none/unreadable. */
function readLedger(path: string): ButlerLedger | null {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<ButlerLedger>;
    if (!parsed || parsed.v !== 1 || typeof parsed.req !== "string") return null;
    // A file from an older shape reads as its empty parts, never as a crash on the next fact.
    return {
      ...parsed,
      v: 1,
      req: parsed.req,
      title: typeof parsed.title === "string" ? parsed.title : parsed.req,
      stage: typeof parsed.stage === "string" ? parsed.stage : "design",
      archived: parsed.archived === true,
      ...(parsed.tombstone === true ? { tombstone: true as const } : {}),
      background: {
        why: parsed.background?.why ?? null,
        constraints: Array.isArray(parsed.background?.constraints) ? parsed.background.constraints : [],
        decisions: Array.isArray(parsed.background?.decisions) ? parsed.background.decisions : [],
        links: Array.isArray(parsed.background?.links) ? parsed.background.links : [],
      },
      timeline: Array.isArray(parsed.timeline) ? parsed.timeline : [],
      todos: {
        on_person: Array.isArray(parsed.todos?.on_person) ? parsed.todos.on_person : [],
        on_session: Array.isArray(parsed.todos?.on_session) ? parsed.todos.on_session : [],
        on_butler: Array.isArray(parsed.todos?.on_butler) ? parsed.todos.on_butler : [],
      },
      next_action: parsed.next_action ?? null,
      cursor: { lastEventId: parsed.cursor?.lastEventId ?? null },
      handled: Array.isArray(parsed.handled) ? parsed.handled : [],
      updated_at: typeof parsed.updated_at === "string" ? parsed.updated_at : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

function writeFileAtomic(path: string, text: string): void {
  mkdirSync(join(path, ".."), { recursive: true, mode: 0o700 });
  const staged = `${path}.tmp`;
  writeFileSync(staged, text, { mode: 0o600 });
  renameSync(staged, path);
}

/** Push `item` unless it is there already (a projection rebuild must not double a todo). */
function addTodo(list: string[], item: string): void {
  if (item && !list.includes(item)) list.push(item);
}

function dropTodosStarting(list: string[], prefix: string): void {
  for (let i = list.length - 1; i >= 0; i--) if (list[i]!.startsWith(prefix)) list.splice(i, 1);
}

/** The deterministic rule table (§7.1), as far as M1 goes: what should happen next. */
function nextActionOf(event: ButlerEvent): ButlerLedger["next_action"] {
  switch (event.kind) {
    case "requirement.delivered":
      return { text: `提醒主人审阅：${event.summary}`, why: "交付物在等主人裁决", level: "notify", at: event.at };
    case "requirement.verdict":
      return event.ref && event.summary.includes("退回")
        ? { text: "把批注转达给产出会话；会话不在就提醒主人重开", why: "主人退回了，需要按批注修改", level: "notify", at: event.at }
        : { text: "记录裁决，会话已可继续", why: "主人给了结论", level: "notify", at: event.at };
    case "session.failed":
      return { text: "说明失败原因，并给出重试或改配置的下一步", why: "会话失败了，主人在等解释", level: "notify", at: event.at };
    case "thread.agent_question":
      return { text: "提醒主人回答", why: "会话停在一个问题上", level: "notify", at: event.at };
    case "session.waiting_person":
      return { text: "提醒主人批准这个操作", why: "会话停在一次授权上", level: "notify", at: event.at };
    case "requirement.stage":
      return event.summary.includes("设计评审") ? { text: "看看设计稿是否已交付；没有就提醒产出会话补上", why: "需求进入设计评审", level: "notify", at: event.at } : null;
    default:
      return null;
  }
}

/** One semantic event → its ledger (§6.3). Pure enough to test without files. */
export function applyEventToLedger(ledger: ButlerLedger, event: ButlerEvent, merged = false): void {
  // Links the timeline does not carry in words (the facts behind it).
  if (event.subject.thread) {
    const known = ledger.background.links.some((link) => link.kind === "thread" && link.ref === event.subject.thread);
    if (!known) ledger.background.links.push({ kind: "thread", ref: event.subject.thread });
  }
  if (event.ref?.kind === "deliverable") {
    const known = ledger.background.links.some((link) => link.kind === "deliverable" && link.ref === event.ref!.id);
    if (!known) ledger.background.links.push({ kind: "deliverable", ref: event.ref.id });
  }

  // Timeline: append, folding short bursts of record-level facts (§5.5).
  const last = ledger.timeline[ledger.timeline.length - 1];
  if (merged && last) {
    last.summary = event.summary;
    last.eventIds.push(event.id);
    last.merged = (last.merged ?? 1) + 1;
  } else {
    ledger.timeline.push({ at: event.at, summary: event.summary, eventIds: [event.id] });
  }
  if (ledger.timeline.length > BUTLER_TIMELINE_KEEP) ledger.timeline.splice(0, ledger.timeline.length - BUTLER_TIMELINE_KEEP);

  // Todos (§6.4) and the next action.
  const title = ledger.title;
  switch (event.kind) {
    case "requirement.delivered":
      addTodo(ledger.todos.on_person, `审阅：${event.summary.replace(/^交付/, "").replace(/，等主人裁决$/, "")}`);
      addTodo(ledger.todos.on_butler, "盯着这份交付物的裁决；30 分钟没动静就提醒一次");
      break;
    case "requirement.verdict":
      dropTodosStarting(ledger.todos.on_person, "审阅：");
      if (event.summary.includes("退回")) addTodo(ledger.todos.on_person, `看批注并决定下一步：${title}`);
      else addTodo(ledger.todos.on_session, `${title}：按批准的方向继续`);
      break;
    case "requirement.archived":
      ledger.todos.on_person = [];
      ledger.todos.on_session = [];
      ledger.todos.on_butler = [];
      break;
    case "requirement.deleted":
      // A tombstone: the history stays readable, but nothing about it may ever ask again (§10).
      ledger.tombstone = true;
      ledger.todos.on_person = [];
      ledger.todos.on_session = [];
      ledger.todos.on_butler = [];
      ledger.next_action = null;
      break;
    case "session.failed": {
      // The reason alone: the todo must not read "处理失败的会话：…会话失败：…".
      const reason = event.summary.replace(/^.*?的会话失败：/, "");
      addTodo(ledger.todos.on_person, `处理失败的会话：${reason}`);
      break;
    }
    case "thread.agent_question":
    case "session.waiting_person":
      addTodo(ledger.todos.on_person, `回答：${event.summary.replace(/^.*?在等主人(?:回答|批准一个操作)：/, "")}`);
      break;
    case "session.ended":
      addTodo(ledger.todos.on_butler, "看看会话结束时，手上的事有没有交代清楚");
      break;
    case "requirement.stage":
      if (event.summary.includes("已完成")) ledger.todos.on_session = [];
      break;
    default:
      break;
  }

  const next = nextActionOf(event);
  if (next) ledger.next_action = next;
  ledger.cursor.lastEventId = event.id;
  ledger.updated_at = new Date().toISOString();
  if (event.kind === "requirement.archived") ledger.archived = true;
  if (event.kind === "requirement.unarchived") ledger.archived = false;
}

/** The human-readable view of a ledger (§6.1): the butler reads this one. */
export function renderLedger(ledger: ButlerLedger): string {
  const lines: string[] = [
    `# 《${ledger.title}》`,
    "",
    `> 需求 \`${ledger.req}\` · 阶段：${requirementStageLabel(ledger.stage as RequirementStage)}${ledger.tombstone ? " · 已删除（只读）" : ""} · 更新：${ledger.updated_at}`,
    "",
  ];
  const timeline = ledger.timeline.length > BUTLER_TIMELINE_SHOWN ? ledger.timeline.slice(-BUTLER_TIMELINE_SHOWN) : ledger.timeline;
  const older = ledger.timeline.length - timeline.length;
  lines.push("## 进展", "");
  if (older > 0) lines.push(`（更早 ${older} 条见同名 .json）`, "");
  if (timeline.length === 0) lines.push("（还没有动态）", "");
  for (const entry of timeline) lines.push(`- ${entry.at}　${entry.summary}${entry.merged && entry.merged > 1 ? `（合并 ${entry.merged} 条）` : ""}`);
  lines.push("");
  const section = (heading: string, items: readonly string[]) => {
    if (items.length === 0) return;
    lines.push(`## ${heading}`, "");
    for (const item of items) lines.push(`- ${item}`);
    lines.push("");
  };
  section("等你", ledger.todos.on_person);
  section("等会话", ledger.todos.on_session);
  section("等管家", ledger.todos.on_butler);
  if (ledger.background.why) lines.push("## 背景", "", ledger.background.why, "");
  if (ledger.background.constraints.length > 0) {
    lines.push("## 约束", "");
    for (const item of ledger.background.constraints) lines.push(`- ${item}`);
    lines.push("");
  }
  if (ledger.background.decisions.length > 0) {
    lines.push("## 决策", "");
    for (const decision of ledger.background.decisions) lines.push(`- ${decision.at}　${decision.by === "person" ? "主人" : "管家"}：${decision.text}`);
    lines.push("");
  }
  if (ledger.next_action) lines.push("## 下一步", "", `${ledger.next_action.text}`, `（因为：${ledger.next_action.why}）`, "");
  return lines.join("\n").trimEnd() + "\n";
}

// ─────────────────────────────── brief ────────────────────────────────────

/** The brief from the ledgers (§6.4: the three columns are its only source). */
export function buildBrief(ledgers: readonly ButlerLedger[], at: string): ButlerBrief {
  const waiting: ButlerBrief["waiting"] = [];
  const running: ButlerBrief["running"] = [];
  const butler: string[] = [];
  for (const ledger of ledgers) {
    if (ledger.archived || ledger.tombstone) continue;
    for (const item of ledger.todos.on_person) waiting.push({ req: ledger.req, title: ledger.title, text: item });
    for (const item of ledger.todos.on_session) running.push({ req: ledger.req, title: ledger.title, text: item });
  }
  const shownWaiting = waiting.slice(0, BUTLER_BRIEF_ITEMS_MAX);
  const shownRunning = running.slice(0, BUTLER_BRIEF_ITEMS_MAX);
  const lines: string[] = [];
  if (shownWaiting.length > 0) {
    lines.push(`今天等你 ${waiting.length} 件`);
    shownWaiting.forEach((item, index) => lines.push(`${index + 1}) 「${item.title}」${item.text}`));
  }
  if (shownRunning.length > 0) lines.push(`在跑 ${running.length} 件：${shownRunning.map((item) => `「${item.title}」${item.text}`).join("；")}`);
  for (const ledger of ledgers) if (ledger.next_action && !ledger.archived && !ledger.tombstone) butler.push(`${ledger.title}：${ledger.next_action.text}`);
  if (lines.length === 0) lines.push("今天没有等你的事。");
  return {
    at,
    waiting: shownWaiting,
    running: shownRunning,
    butler,
    more: Math.max(0, waiting.length - shownWaiting.length) + Math.max(0, running.length - shownRunning.length),
    text: lines.join("\n"),
  };
}

// ─────────────────────────────── service ──────────────────────────────────

export interface ButlerEvents {
  start(): void;
  stop(): void;
  /** 现在什么情况. */
  brief(): ButlerBrief;
  ledger(requirement: string): ButlerLedger | null;
  ledgers(): ButlerLedger[];
  /** The ledger's reading view (md), for the window's read route. */
  ledgerMarkdown(requirement: string): string | null;
  /** The pending wake text (≤ 12 lines, notify-level facts since the last look), and mark it seen. */
  takeDigest(maxLines?: number): string;
  /** Recent semantic events, newest last (the brief, and a debug read). */
  recent(limit?: number): ButlerEvent[];
  /** A fact from the action face (a butler action): projected and recorded like any other. */
  record(event: ButlerEvent): void;
  /** The routes the butler's window reads (same origin only): brief and ledgers. */
  route(req: Request, url: URL): Promise<Response | null>;
}

export function createButlerEvents(options: ButlerEventsOptions): ButlerEvents {
  const now = options.now ?? Date.now;
  const dir = options.dir;
  const ledgerDir = join(dir, "ledger");
  const cursorPath = join(dir, "events.cursor.json");
  const wakeDelayMs = options.wakeDelayMs ?? BUTLER_WAKE_DELAY_MS;
  const pollMs = options.pollMs ?? BUTLER_SESSION_POLL_MS;

  const ledgers = new Map<string, ButlerLedger>();
  /** Recent semantic events (memory only): the wake digest's window. */
  const recent: ButlerEvent[] = [];
  const lastMerge = new Map<string, { at: number; domain: string }>();
  const lastNotified = new Map<string, number>();
  const systemNotes: { at: string; text: string }[] = [];
  const cleanups: (() => void)[] = [];
  let cursor: ButlerCursorFile = { v: 1, requirement: null, thread: 0, delivered_at: null, at: null };
  let started = false;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let wakeTimer: ReturnType<typeof setTimeout> | null = null;
  let previousSessions = new Map<string, ButlerSessionNow>();

  const iso = () => new Date(now()).toISOString();

  const persistCursor = () => {
    cursor.at = iso();
    try {
      writeFileAtomic(cursorPath, `${JSON.stringify(cursor, null, 2)}\n`);
    } catch {
      // A cursor that cannot be written still moves in memory: the session keeps working.
    }
  };

  const ledgerPathOf = (req: string) => join(ledgerDir, `${req.replace(/[^A-Za-z0-9_-]/g, "_")}.json`);

  const saveLedger = (ledger: ButlerLedger) => {
    try {
      writeFileAtomic(ledgerPathOf(ledger.req), `${JSON.stringify(ledger, null, 2)}\n`);
      writeFileAtomic(join(ledgerDir, `${ledger.req.replace(/[^A-Za-z0-9_-]/g, "_")}.md`), renderLedger(ledger));
    } catch {
      // Ledger writes are a projection: the next event tries again.
    }
  };

  const loadLedgers = () => {
    if (!existsSync(ledgerDir)) return;
    for (const name of readdirSync(ledgerDir)) {
      if (!name.endsWith(".json")) continue;
      const ledger = readLedger(join(ledgerDir, name));
      if (ledger) ledgers.set(ledger.req, ledger);
    }
  };

  const loadCursor = () => {
    try {
      const parsed = JSON.parse(readFileSync(cursorPath, "utf8")) as Partial<ButlerCursorFile>;
      cursor = {
        v: 1,
        requirement: typeof parsed.requirement === "string" ? parsed.requirement : null,
        thread: typeof parsed.thread === "number" && Number.isFinite(parsed.thread) ? parsed.thread : 0,
        delivered_at: typeof parsed.delivered_at === "string" ? parsed.delivered_at : null,
        handled: Array.isArray(parsed.handled) ? parsed.handled.filter((key): key is string => typeof key === "string") : [],
        at: typeof parsed.at === "string" ? parsed.at : null,
      };
    } catch {
      // No cursor: a first attach.
    }
  };

  /** The ledger for a requirement, made on first sight (title/stage from the record). */
  const ledgerOf = (req: string, record: Requirement | null): ButlerLedger => {
    let ledger = ledgers.get(req);
    if (!ledger) {
      ledger = {
        v: 1,
        req,
        title: record?.title ?? "(已删除的需求)",
        stage: record?.stage ?? "design",
        archived: record?.archived_at != null,
        background: { why: null, constraints: [], decisions: [], links: [] },
        timeline: [],
        todos: { on_person: [], on_session: [], on_butler: [] },
        next_action: null,
        cursor: { lastEventId: null },
        handled: [],
        updated_at: iso(),
      };
      ledgers.set(req, ledger);
    }
    if (record) {
      ledger.title = record.title;
      ledger.stage = record.stage;
      ledger.archived = record.archived_at != null;
    }
    return ledger;
  };

  /** A ledger from the requirement as it stands, for a first attach (no history replayed). */
  const seedLedger = (record: Requirement) => {
    const ledger = ledgerOf(record.id, record);
    // Its sessions now running: the link that lets their later facts reach this ledger.
    for (const threadId of record.threads) {
      if (!ledger.background.links.some((link) => link.kind === "thread" && link.ref === threadId)) ledger.background.links.push({ kind: "thread", ref: threadId });
    }
    for (const deliverable of record.deliverables) {
      if (deliverable.verdict) continue;
      if (deliverable.thread && !ledger.background.links.some((link) => link.kind === "thread" && link.ref === deliverable.thread)) {
        ledger.background.links.push({ kind: "thread", ref: deliverable.thread });
      }
      addTodo(ledger.todos.on_person, `审阅：${deliverable.title ?? deliverable.ref}`);
    }
    if (record.waiting) addTodo(ledger.todos.on_person, `回话：${record.title} 的会话在等主人`);
    ledger.updated_at = iso();
    saveLedger(ledger);
  };

  /** The requirement whose ledger carries this thread, when a fact names only the thread. */
  const requirementOfThread = (threadId: string | undefined): string | null => {
    if (!threadId) return null;
    for (const ledger of ledgers.values()) {
      if (ledger.archived) continue;
      if (ledger.background.links.some((link) => link.kind === "thread" && link.ref === threadId)) return ledger.req;
    }
    return null;
  };

  /** Ingest one semantic event: dedupe, fold, ledger, wake. */
  const ingest = (incoming: ButlerEvent) => {
    // A session or message fact names its thread; the ledger that thread belongs to is the one
    // that must carry it (a question in a requirement's session is the requirement's waiting).
    // A bare session fact (started/working/ended) finds its thread through the store.
    const thread = incoming.subject.thread ?? (incoming.subject.session ? options.inbox?.threadOfSession?.(incoming.subject.session) ?? undefined : undefined);
    const owner = incoming.subject.requirement ? null : requirementOfThread(thread);
    const event: ButlerEvent = owner ? { ...incoming, subject: { ...incoming.subject, thread, requirement: owner } } : incoming;
    // One fact, once: the same dedupe key (a replay, a double delivery) is handled a single time,
    // whichever domain it belongs to. The list lives in the cursor file so a restart keeps it.
    const handled = cursor.handled ?? (cursor.handled = []);
    if (handled.includes(event.dedupe)) return;
    handled.push(event.dedupe);
    if (handled.length > BUTLER_HANDLED_KEEP) handled.splice(0, handled.length - BUTLER_HANDLED_KEEP);
    const req = event.subject.requirement;
    let ledger: ButlerLedger | null = null;
    if (req) {
      ledger = ledgers.get(req) ?? ledgerOf(req, options.requirements?.store.get(req)?.requirement ?? null);
      if (ledger.handled.includes(event.dedupe)) return;
      ledger.handled.push(event.dedupe);
      if (ledger.handled.length > BUTLER_HANDLED_KEEP) ledger.handled.splice(0, ledger.handled.length - BUTLER_HANDLED_KEEP);
    }
    const key = req ?? `${event.domain}:${event.subject.session ?? event.subject.thread ?? "system"}`;
    const at = Date.parse(event.at) || now();
    const mergeable = event.level === "record" && (event.kind === "requirement.note" || event.kind === "session.working" || event.kind === "thread.agent_message");
    const last = lastMerge.get(key);
    const merged = mergeable && !!last && last.domain === event.domain && at - last.at <= BUTLER_EVENT_MERGE_MS;
    if (ledger) applyEventToLedger(ledger, event, merged);
    if (mergeable) {
      if (merged && last) last.at = Math.max(last.at, at);
      else lastMerge.set(key, { at, domain: event.domain });
    }
    if (ledger) saveLedger(ledger);
    // The cursor holds the source's own id (`evt_` + ULID), so a replay asks the requirements log for
    // exactly the lines after it; a semantic id is derived and would not order against the source.
    if (event.source && event.domain === "requirement" && (cursor.requirement === null || event.source > cursor.requirement)) {
      cursor.requirement = event.source;
    }
    recent.push(event);
    if (recent.length > 500) recent.splice(0, recent.length - 500);
    persistCursor();
    if (event.level !== "record") scheduleWake(event);
  };

  const scheduleWake = (event: ButlerEvent) => {
    if (!options.onWake) return;
    if (wakeTimer) return;
    wakeTimer = setTimeout(() => {
      wakeTimer = null;
      const digest = takeDigest();
      if (!digest) return;
      try {
        options.onWake!(digest, recent.filter((entry) => entry.level !== "record"));
      } catch {
        // A wake handler's failure never breaks the projector; the facts stay in the ledgers.
      }
    }, wakeDelayMs);
    // Bun keeps a timer's process alive; the daemon is long-lived anyway, and Stop clears it.
    (wakeTimer as { unref?: () => void }).unref?.();
  };

  const takeDigest = (maxLines = BUTLER_DIGEST_LINES_MAX): string => {
    const from = cursor.delivered_at ? Date.parse(cursor.delivered_at) : 0;
    const pending = recent.filter((event) => event.level !== "record" && (Date.parse(event.at) || 0) > from);
    const lines: string[] = [];
    let hidden = 0;
    for (const event of pending) {
      const silenceKey = `${event.subject.requirement ?? event.subject.session ?? event.domain}|${event.kind}`;
      const last = lastNotified.get(silenceKey);
      const at = Date.parse(event.at) || now();
      // 内容类事件（执行会话的回复、提问、失败、交付、管家动作结果）每次都算数：
      // 同一需求两次真实回复相隔不到 30 分钟，不能把后一次当重复吞掉。
      const alwaysSay = event.kind === "thread.agent_message" || event.kind === "thread.agent_question" || event.kind === "session.failed" || event.kind === "requirement.delivered" || event.kind === "requirement.verdict" || event.kind.startsWith("butler.action.");
      if (!alwaysSay && last !== undefined && at - last < BUTLER_NOTIFY_SILENCE_MS) continue;
      lastNotified.set(silenceKey, at);
      // One line is the header and one may be "more": the rest are facts. A requirement line
      // names the ledger to read for the detail (§8.2: the id, never the whole ledger).
      if (lines.length >= Math.max(1, maxLines - 2)) hidden++;
      else lines.push(`- ${event.subject.requirement ? `[${event.subject.requirement}] ` : ""}${event.summary}`);
    }
    // System notes are one-shot: after this look they are said, not repeated. They never crowd
    // out the facts' own "more" line: with a cut list the digest says how many were left out.
    const notes = systemNotes.splice(0);
    if (hidden === 0) for (const note of notes) if (lines.length < maxLines - 1) lines.push(`- ${note.text}`);
    // The standing picture, when nothing new needed saying: "现在什么情况" must not depend on
    // having been awake for the event. One line; the detail is the ledger the line names. Never
    // with facts that were all silenced — that would be the reminder the silence just forbade.
    if (pending.length === 0 && hidden === 0 && lines.length < maxLines - 1) {
      const waiting = [...ledgers.values()].filter((ledger) => !ledger.archived && ledger.todos.on_person.length > 0);
      if (waiting.length > 0) {
        const first = waiting[0]!;
        lines.push(`- 现在等你 ${waiting.length} 件：「${first.title}」${first.todos.on_person[0]}（读 ledger/${first.req}.md 看细节）`);
      }
    }
    if (lines.length === 0 && hidden === 0) {
      // Nothing new that may be said (or all silenced): the look still counts as seen.
      cursor.delivered_at = iso();
      persistCursor();
      return "";
    }
    if (hidden > 0) lines.push(`（还有 ${hidden} 条动态）`);
    cursor.delivered_at = iso();
    persistCursor();
    return ["【动态】", ...lines].join("\n");
  };

  const ingestLine = (line: InboxLine) => {
    if (line.kind !== "message" && line.kind !== "question") return;
    const messageOf = (id: string) => options.inbox?.message(id) ?? null;
    const subjectOf = (threadId: string) => options.inbox?.threadSubject?.(threadId) ?? null;
    for (const event of projectInboxLine(line, messageOf, subjectOf)) ingest(event);
    if (line.seq > cursor.thread) cursor.thread = line.seq;
  };

  const pollSessions = () => {
    if (!options.sessions) return;
    let list: ButlerSessionNow[];
    try {
      list = options.sessions();
    } catch {
      return;
    }
    const at = iso();
    const events = projectSessionChanges(previousSessions, list, at);
    for (const event of events) ingest(event);
    previousSessions = new Map(list.map((session) => [session.session, session]));
    if (events.length > 0) persistCursor();
  };

  const start = () => {
    if (started) return;
    started = true;
    mkdirSync(ledgerDir, { recursive: true, mode: 0o700 });
    loadCursor();
    loadLedgers();
    const firstAttach = cursor.at === null;

    // Requirements: replay from the cursor, then listen. A first attach seeds the ledgers
    // from the records as they stand (the design's "只从现在开始") and replays nothing.
    if (options.requirements) {
      const { store, watch } = options.requirements;
      if (firstAttach) {
        const all = [...store.list(false).requirements, ...store.list(true).requirements];
        for (const record of all) seedLedger(record);
        const events = store.eventsAfter?.(null) ?? [];
        cursor.requirement = events.length > 0 ? events[events.length - 1]!.id : null;
      } else {
        const missed = store.eventsAfter?.(cursor.requirement) ?? [];
        for (const event of missed) {
          const record = store.get(event.req)?.requirement ?? null;
          ingest(projectRequirementEvent(event, record, ledgers.get(event.req)?.title));
        }
        if (missed.length > 0) systemNotes.push({ at: iso(), text: `补课：期间有 ${missed.length} 条需求动态` });
      }
      const stopEvents = watch.subscribeEvents?.((event) => {
        const record = store.get(event.req)?.requirement ?? null;
        ingest(projectRequirementEvent(event, record, ledgers.get(event.req)?.title));
        persistCursor();
      });
      if (stopEvents) cleanups.push(stopEvents);
    }

    // The message journal: replay what landed while the butler was away, then follow.
    if (options.inbox) {
      const inbox = options.inbox;
      if (!firstAttach) {
        const missed = inbox.changesSince(cursor.thread);
        for (const line of missed) ingestLine(line);
        if (missed.length > 0) systemNotes.push({ at: iso(), text: `补课：期间有 ${missed.length} 条会话动态` });
      }
      cursor.thread = inbox.cursor();
      cleanups.push(inbox.subscribe((line) => {
        ingestLine(line);
        persistCursor();
      }));
    }

    // Sessions: a snapshot now (no events for what already runs), then transitions on a poll.
    if (options.sessions) {
      try {
        previousSessions = new Map(options.sessions().map((session) => [session.session, session]));
      } catch {
        previousSessions = new Map();
      }
      pollTimer = setInterval(pollSessions, pollMs);
      (pollTimer as { unref?: () => void }).unref?.();
    }

    if (firstAttach) {
      systemNotes.push({ at: iso(), text: "我是刚接上的：以前的事我不在，只能从现在开始看" });
      recent.push({
        id: `be_system_first_attach_${ulid()}`,
        at: iso(),
        domain: "system",
        kind: "system.first_attach",
        subject: {},
        actor: "system",
        summary: "管家第一次接上事件流",
        dedupe: `system:first_attach:${cursor.at ?? ""}`,
        level: "record",
      });
    } else {
      const replayed = systemNotes.reduce((sum, note) => sum + (Number(note.text.match(/(\d+)/)?.[1]) ?? 0), 0);
      const text = replayed > 0 ? `我回来了：期间有 ${replayed} 条动态，已经补上` : "我回来了，期间没有新的动态";
      systemNotes.push({ at: iso(), text });
      recent.push({
        id: `be_system_restart_${ulid()}`,
        at: iso(),
        domain: "system",
        kind: "system.daemon_restart",
        subject: {},
        actor: "system",
        summary: text,
        dedupe: `system:restart:${cursor.at ?? ""}`,
        level: "record",
      });
    }
    persistCursor();
  };

  const stop = () => {
    started = false;
    if (pollTimer) clearInterval(pollTimer);
    if (wakeTimer) clearTimeout(wakeTimer);
    pollTimer = null;
    wakeTimer = null;
    for (const cleanup of cleanups.splice(0)) {
      try {
        cleanup();
      } catch {
        // Already gone.
      }
    }
  };

  /**
   * The record as it stands wins over a ledger field a write recorded before it applied the change
   * (a patch records its history line first): on every read the title, stage and archive flag are
   * taken from the source, which is the one truth. A record that is gone keeps the ledger's words.
   */
  const syncLedger = (ledger: ButlerLedger) => {
    let record: Requirement | null = null;
    try {
      record = options.requirements?.store.get(ledger.req)?.requirement ?? null;
    } catch {
      record = null;
    }
    if (!record) return ledger;
    const archived = record.archived_at != null;
    if (ledger.title !== record.title || ledger.stage !== record.stage || ledger.archived !== archived) {
      ledger.title = record.title;
      ledger.stage = record.stage;
      ledger.archived = archived;
      ledger.updated_at = iso();
      saveLedger(ledger);
    }
    return ledger;
  };

  const brief = () => {
    for (const ledger of ledgers.values()) syncLedger(ledger);
    return buildBrief([...ledgers.values()], iso());
  };

  const routes: ButlerEvents = {
    start,
    stop,
    brief,
    takeDigest,
    recent: (limit = 50) => recent.slice(-Math.max(0, limit)),
    record: ingest,
    ledger: (requirement) => {
      const ledger = ledgers.get(requirement);
      return ledger ? syncLedger(ledger) : null;
    },
    ledgers: () => [...ledgers.values()].map(syncLedger),
    ledgerMarkdown: (requirement) => {
      const ledger = ledgers.get(requirement);
      return ledger ? renderLedger(syncLedger(ledger)) : null;
    },
    async route(req, url) {
      // The window's own page only, as every butler route (same-origin fetch).
      if (req.headers.get("sec-fetch-site")?.trim().toLowerCase() !== "same-origin") return null;
      if (url.pathname === "/api/inbox/butler/brief" && req.method === "GET") {
        return Response.json({ brief: brief() });
      }
      if (url.pathname === "/api/inbox/butler/ledger" && req.method === "GET") {
        return Response.json({
          ledgers: [...ledgers.values()].map((ledger) => {
            syncLedger(ledger);
            return {
              req: ledger.req,
              title: ledger.title,
              stage: ledger.stage,
              archived: ledger.archived,
              next_action: ledger.next_action,
              waiting: ledger.todos.on_person.length,
              running: ledger.todos.on_session.length,
            };
          }),
        });
      }
      const match = /^\/api\/inbox\/butler\/ledger\/([A-Za-z0-9_-]+)$/.exec(url.pathname);
      if (match && req.method === "GET") {
        const ledger = ledgers.get(match[1]!);
        if (!ledger) return Response.json({ error: "没有这个需求的台账。" }, { status: 404 });
        syncLedger(ledger);
        return Response.json({ ledger, markdown: renderLedger(ledger) });
      }
      return null;
    },
  };
  return routes;
}
