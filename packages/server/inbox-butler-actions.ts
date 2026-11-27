/**
 * 管家的行动面（doc/管家-事件机制设计.md，M2）：the butler's own write channel —
 * 建卡 / 派活 / 转达 / 停止 / 提醒 — kept apart from the observation face and
 * from the agents' MCP tools.
 *
 *   POST /api/inbox/butler/act
 *   { action, idempotency_key, event_id?, authorized?, … }
 *
 * Local trust only: a request with no browser headers (the butler's own curl) or
 * the Inbox window's own origin passes; another site's page is refused. The
 * endpoint never asks an agent to write through MCP: the butler has its channel.
 *
 * The four rules of the doc:
 *   - each action is written into the requirement's history with `by: 管家`
 *     (the projector reads that prefix as `actor: butler`), or, with no
 *     requirement, as a butler event;
 *   - a failure is answered as a failure, never as a success to be reported;
 *   - L3 actions (launch-session, stop-session) need the owner's word once,
 *     remembered in `preferences.json`; the first call answers
 *     `needs_authorization`, and the butler asks before retrying with
 *     `authorized: true`;
 *   - every action carries an idempotency key, so a retry never makes a second
 *     card or starts a second session (`actions.json` keeps the answers).
 *
 * Files, all in the butler folder (`~/plannotator-butler/`, 0600):
 *   preferences.json   the L3 grants
 *   actions.json       recent action answers, by idempotency key
 *   action.json        the URL this run's endpoint answers on (rewritten at start)
 *
 * The heavy lifting (starting a session, writing into a thread, interrupting one)
 * stays in packages/server/inbox.ts, passed in as narrow functions: this module
 * owns only the protocol, the authorization and the audit.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { ulid } from "@plannotator/core/inbox-types";
import { isRequirementPriority, type Requirement, type RequirementContext, type RequirementPriority, type RequirementProject } from "@plannotator/core/requirements-types";
import { missingRequirementCardSections, renderRequirementCard } from "@plannotator/core/requirement-card";
import { INBOX_CROSS_SITE_BODY, isCrossSiteRequest } from "./inbox-cross-site";
import type { ButlerEvent } from "./inbox-butler-events";
import { readButlerPreferences } from "./inbox-butler-preferences";
import { RequirementStoreError, type RequirementStore } from "./requirements";

// ─────────────────────────────── protocol ─────────────────────────────────

export type ButlerActionName = "create-requirement" | "launch-session" | "archive-requirement" | "tell-session" | "stop-session" | "remind";

export interface ButlerActionLaunchInput {
  agent: string;
  project_id?: string;
  folder?: string;
  requirement?: string;
  words?: string;
  thread_name?: string;
  idempotency_key: string;
}

export interface ButlerActionTellInput {
  session?: string;
  host?: string;
  requirement?: string;
  thread?: string;
  words: string;
  idempotency_key: string;
}

export interface ButlerActionStopInput {
  session?: string;
  host?: string;
  requirement?: string;
  thread?: string;
}

/** What an action answers. `ok: false` is always safe to repeat to the owner. */
export type ButlerActionOutcome =
  | { ok: true; thread_id?: string; message_id?: string; session?: string; launch_id?: string; requirement?: Requirement; requirement_id?: string; warnings?: string[]; archived?: boolean; released?: number; stopped?: number; /** tell-session: the session was not live and the Inbox is resuming it. */ wake?: boolean }
  | { ok: false; code: string; error: string; status?: number };

/**
 * 管家转达的目标：会话在线就正常送；本收件箱启动的会话停了，转达同时是点火
 * （launch 的 respawn 会把它重新拉起来，和主人在线程里回一句同一条路）；
 * 手动在外面起的会话没有 launch 记录，点不着，仍明确拒绝。
 */
export function butlerTellTarget(alive: boolean, resumable: boolean): { ok: true; wake: boolean } | { ok: false; code: "session_not_live"; error: string } {
  if (alive) return { ok: true, wake: false };
  if (resumable) return { ok: true, wake: true };
  return { ok: false, code: "session_not_live", error: "会话不在线，而且不是本收件箱启动的会话，管家点不着；请主人重开，或让我开一个新会话。" };
}

/** The approval tab, as the action channel needs it (Phase 1: create-requirement). *//** The approval tab, as the action channel needs it (Phase 1: create-requirement). */
export interface ButlerApprovalGate {
  auto(action: string): boolean;
  byKey(key: string): {
    id: string;
    status: string;
    result: { ok: boolean; requirement_id?: string; thread_id?: string; message_id?: string; session?: string; warnings?: string[]; error?: string; code?: string } | null;
  } | null;
  request(input: {
    action: "create-requirement" | "launch-session" | "archive-requirement" | "stop-session";
    title: string;
    summary: string;
    detail: Record<string, unknown>;
    payload: Record<string, unknown>;
    idempotency_key: string;
    event_id: string | null;
  }): { id: string; status: string; result: { ok: boolean; requirement_id?: string; thread_id?: string; message_id?: string; session?: string; warnings?: string[]; error?: string; code?: string } | null };
}

export interface ButlerActionDeps {
  /** The butler folder: preferences, the action answers, the endpoint hint. */
  dir: string;
  /** The Workshop's switch; off: no card actions, while a launch without a card still works. */
  requirementsOn: boolean;
  requirements: RequirementStore;
  /** A butler-only semantic event (for actions that name no requirement). */
  recordEvent: (event: ButlerEvent) => void;
  launch(input: ButlerActionLaunchInput): Promise<ButlerActionOutcome>;
  tell(input: ButlerActionTellInput): Promise<ButlerActionOutcome>;
  stop(input: ButlerActionStopInput): Promise<ButlerActionOutcome>;
  /** The approval tab (absent in a bare test): create-requirement asks it when its switch is off. */
  approvals?: ButlerApprovalGate | null;
  /** Link the source conversation to the new card; absent: the card is still made, without that link. */
  linkThread?: ((requirement: string, thread: string) => void) | null;
  /** Whether a thread id exists in this Inbox (a source thread the butler names). */
  threadExists?: ((thread: string) => boolean) | null;
  /** An Inbox project by id, for the card's project at creation or by the approval selector. */
  projectOf?: ((id: string) => RequirementProject | null) | null;
  /** The project of a requirement's linked thread, for a launch with no explicit project. */
  projectOfThread?: ((thread: string) => RequirementProject | null) | null;
  /** The Inbox's projects, offered by name when a launch needs one and the card has none. */
  listProjects?: (() => RequirementProject[]) | null;
  now?: () => number;
}

export interface ButlerActions {
  /** The one route: `/api/inbox/butler/act`. */
  route(req: Request, url: URL): Promise<Response | null>;
  /** Write `action.json` for this run (after the port is known). */
  publish(port: number): void;
  /** The Inbox is stopping: the hint goes, so the butler never curls a dead port. */
  stop(): void;
  /** The grants, for tests and a later Settings read. */
  preferences(): Readonly<Record<string, { granted_at: string }>>;
  /** The approval tab's executor: the same create path, without the switch. */
  execute(action: ButlerActionName, payload: Record<string, unknown>, meta: { approved?: boolean; eventId?: string | null; idempotencyKey?: string }): Promise<ButlerActionOutcome>;
}

const ACTION_NAMES: readonly ButlerActionName[] = ["create-requirement", "launch-session", "archive-requirement", "tell-session", "stop-session", "remind"];
const ACTION_RESULTS_KEEP = 200;

interface ActionResultsFile {
  v: 1;
  results: Record<string, { action: string; at: string; outcome: ButlerActionOutcome }>;
}

/** Read a JSON file, or null (missing/unreadable). */
function readJson<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
}

/** Atomic write (a temp file in the same folder, then rename), 0600. */
function writeJson(path: string, value: unknown): boolean {
  try {
    mkdirSync(join(path, ".."), { recursive: true, mode: 0o700 });
    const staged = `${path}.tmp`;
    writeFileSync(staged, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    renameSync(staged, path);
    return true;
  } catch {
    return false;
  }
}

function answer(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" },
  });
}

// ─────────────────────────────── validation ───────────────────────────────

type FieldResult = { value: string } | { error: string };

/** A string field: trimmed, required or not, with a maximum length. */
function text(value: unknown, field: string, max: number, required = false): FieldResult {
  if (value === undefined || value === null) {
    return required ? { error: `${field}: 必须有这个字段。` } : { value: "" };
  }
  if (typeof value !== "string") return { error: `${field}: 必须是字符串。` };
  const trimmed = value.trim();
  if (!trimmed && required) return { error: `${field}: 不能为空。` };
  if (trimmed.length > max) return { error: `${field}: 最多 ${max} 个字符。` };
  return { value: trimmed };
}

function short(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

// ─────────────────────────────── the service ──────────────────────────────

export function createButlerActions(deps: ButlerActionDeps): ButlerActions {
  const now = deps.now ?? Date.now;
  const iso = () => new Date(now()).toISOString();
  const resultsPath = join(deps.dir, "actions.json");
  const hintPath = join(deps.dir, "action.json");

  const loadResults = (): ActionResultsFile => {
    const parsed = readJson<Partial<ActionResultsFile>>(resultsPath);
    return { v: 1, results: parsed && typeof parsed.results === "object" && parsed.results !== null && !Array.isArray(parsed.results) ? (parsed.results as ActionResultsFile["results"]) : {} };
  };
  let results = loadResults();

  const priorOf = (key: string): { action: string; outcome: ButlerActionOutcome } | null => {
    const entry = results.results[key];
    return entry ? { action: entry.action, outcome: entry.outcome } : null;
  };

  const remember = (key: string, action: ButlerActionName, outcome: ButlerActionOutcome) => {
    results.results[key] = { action, at: iso(), outcome };
    const keys = Object.keys(results.results);
    if (keys.length > ACTION_RESULTS_KEEP) {
      // Oldest first: the file is a short retry window, not a log (the history is the log).
      keys
        .sort((a, b) => (results.results[a]!.at < results.results[b]!.at ? -1 : 1))
        .slice(0, keys.length - ACTION_RESULTS_KEEP)
        .forEach((old) => delete results.results[old]);
    }
    // A failed write must not fail the action the owner asked for; a retry may then repeat it.
    writeJson(resultsPath, results);
  };

  /** The requirement history line every action leaves (`by: 管家` → actor butler in the ledger). */
  const audit = (requirement: string, words: string, thread: string | null, eventId: string | null) => {
    try {
      deps.requirements.say(requirement, short(words, 450), "管家", thread, eventId);
    } catch {
      // The requirement went away while the action ran: the action itself still happened.
    }
  };

  /** An action with no requirement to write into: a butler event, for the ledger and the trace. */
  const recordAction = (input: { summary: string; subject: ButlerEvent["subject"]; dedupe: string }) => {
    try {
      deps.recordEvent({
        id: `be_butler_${ulid()}`,
        at: iso(),
        domain: input.subject.requirement ? "requirement" : "session",
        kind: "butler.action",
        subject: input.subject,
        actor: "butler",
        summary: input.summary,
        dedupe: input.dedupe,
        level: "record",
      });
    } catch {
      // The audit never fails the action.
    }
  };

  const failure = (code: string, error: string, status: number): Extract<ButlerActionOutcome, { ok: false }> => ({ ok: false, code, error, status });

  /** The Workshop's switch, for the actions that write a requirement. */
  const cardWritesOpen = (requirement: string | undefined): ButlerActionOutcome | null => {
    if (!deps.requirementsOn) return failure("requirements_off", "工坊的需求面板关着，这次没有建卡也没写进需求。", 409);
    if (requirement && !deps.requirements.get(requirement)) return failure("requirement_not_found", `没有需求 ${requirement}。`, 404);
    return null;
  };

  /** A context the card request carries: a link, or a file copied into the requirement's own folder. */
  interface CardContextInput { kind: "link" | "file"; name: string; ref?: string; path?: string }
  interface CardPayload {
    title: string;
    notes: string;
    priority?: RequirementPriority;
    project_id?: string;
    agent?: string;
    contexts: CardContextInput[];
    thread?: string;
    event_id?: string;
    idempotency_key: string;
  }
  interface PreparedCard {
    payload: CardPayload;
    title: string;
    summary: string;
    detail: Record<string, unknown>;
    warnings: string[];
  }
  type Prepared = PreparedCard | { error: Extract<ButlerActionOutcome, { ok: false }> };

  const homeOf = (path: string): string => (path.startsWith("~/") ? join(homedir(), path.slice(2)) : path);

  /**
   * Validate a card request and build what the approval tab shows. The card preview is the
   * same document renderer the session will read; a file context is copied only on approval.
   */
  const prepareCreate = (body: Record<string, unknown>, key: string, eventId: string | null): Prepared => {
    if (!deps.requirementsOn) return { error: failure("requirements_off", "工坊的需求面板关着，这次没有建卡。", 409) };
    const title = text(body.title, "title", 200, true);
    if ("error" in title) return { error: failure("validation_error", title.error, 422) };
    const notes = text(body.notes, "notes", 20_000);
    if ("error" in notes) return { error: failure("validation_error", notes.error, 422) };
    let priority: RequirementPriority | undefined;
    if (body.priority !== undefined && body.priority !== null) {
      if (!isRequirementPriority(body.priority)) return { error: failure("validation_error", "priority: urgent / high / medium / low / none。", 422) };
      priority = body.priority;
    }
    const thread = text(body.thread, "thread", 100);
    if ("error" in thread) return { error: failure("validation_error", thread.error, 422) };
    const projectId = text(body.project_id, "project_id", 100);
    if ("error" in projectId) return { error: failure("validation_error", projectId.error, 422) };
    let project: RequirementProject | null = null;
    if (projectId.value) {
      project = deps.projectOf?.(projectId.value) ?? null;
      if (!project) return { error: failure("project_not_found", `没有项目 ${projectId.value}。`, 404) };
    }
    // 卡上默认的执行 agent（claude-code / opencode / …）：启动时没有点名就用它。
    const agent = text(body.agent, "agent", 32);
    if ("error" in agent) return { error: failure("validation_error", agent.error, 422) };
    if (thread.value && deps.threadExists && !deps.threadExists(thread.value)) {
      return { error: failure("thread_unknown", `没有线程 ${thread.value}；来源线程不挂到卡上。`, 422) };
    }
    const contexts: CardContextInput[] = [];
    const rawContexts = body.contexts;
    if (rawContexts !== undefined && rawContexts !== null) {
      if (!Array.isArray(rawContexts)) return { error: failure("validation_error", "contexts: 一个列表。", 422) };
      if (rawContexts.length > 20) return { error: failure("validation_error", "contexts: 最多 20 个。", 422) };
      for (const [index, raw] of rawContexts.entries()) {
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { error: failure("validation_error", `contexts[${index}]: 一个对象。`, 422) };
        const value = raw as Record<string, unknown>;
        const name = text(value.name, `contexts[${index}].name`, 200, true);
        if ("error" in name) return { error: failure("validation_error", name.error, 422) };
        if (value.kind === "link") {
          const ref = text(value.ref, `contexts[${index}].ref`, 2000, true);
          if ("error" in ref) return { error: failure("validation_error", ref.error, 422) };
          if (!/^https?:\/\//i.test(ref.value)) return { error: failure("validation_error", `contexts[${index}].ref: 完整 http(s) 链接。`, 422) };
          contexts.push({ kind: "link", name: name.value, ref: ref.value });
          continue;
        }
        if (value.kind === "file") {
          const path = text(value.path, `contexts[${index}].path`, 400, true);
          if ("error" in path) return { error: failure("validation_error", path.error, 422) };
          const source = homeOf(path.value);
          if (!existsSync(source)) return { error: failure("validation_error", `contexts[${index}].path: 读不到 ${path.value}。`, 422) };
          try {
            if (statSync(source).size > 9 * 1024 * 1024) return { error: failure("validation_error", `contexts[${index}].path: 文件超过 9 MB。`, 422) };
          } catch {
            return { error: failure("validation_error", `contexts[${index}].path: 读不到 ${path.value}。`, 422) };
          }
          contexts.push({ kind: "file", name: name.value, path: path.value });
          continue;
        }
        return { error: failure("validation_error", `contexts[${index}].kind: link 或 file。`, 422) };
      }
    }
    const previewContexts: RequirementContext[] = contexts.map((context, index) => ({
      id: `preview_${index}`,
      kind: context.kind,
      name: context.name,
      ref: (context.kind === "link" ? context.ref : context.path)!,
      by: "管家",
      created_at: iso(),
    }));
    const card = renderRequirementCard({
      id: "req_待创建",
      title: title.value,
      notes: notes.value,
      stage: "design",
      priority: priority ?? "none",
      project,
      agent: agent.value || null,
      contexts: previewContexts,
    });
    const missing = missingRequirementCardSections(notes.value);
    const warnings = missing.length > 0 ? [`缺少章节：${missing.join("、")}`] : [];
    const firstLine = notes.value.split("\n").map((line) => line.trim()).find((line) => line && !line.startsWith("#")) ?? title.value;
    const summary = `${short(firstLine, 80)}${contexts.length > 0 ? ` · ${contexts.length} 个上下文` : ""}`;
    return {
      payload: {
        title: title.value,
        notes: notes.value,
        ...(priority ? { priority } : {}),
        ...(project ? { project_id: project.id } : {}),
        ...(agent.value ? { agent: agent.value } : {}),
        contexts,
        ...(thread.value ? { thread: thread.value } : {}),
        ...(eventId ? { event_id: eventId } : {}),
        idempotency_key: key,
      },
      title: `建需求卡《${title.value}》`,
      summary,
      detail: {
        ...(thread.value ? { thread: thread.value } : {}),
        ...(project ? { project_id: project.id, project_name: project.name } : {}),
        ...(agent.value ? { agent: agent.value } : {}),
        ...(eventId ? { event_id: eventId } : {}),
        card,
        contexts: contexts.map((context) => ({ kind: context.kind, name: context.name })),
        ...(warnings.length > 0 ? { warnings } : {}),
      },
      warnings,
    };
  };

  /** The one create path, called by the action directly (auto) or by the approval tab (approved). */
  const executeCreate = (payload: CardPayload, meta: { approved?: boolean; eventId?: string | null }): ButlerActionOutcome => {
    try {
      const project = payload.project_id ? deps.projectOf?.(payload.project_id) ?? null : null;
      if (payload.project_id && !project) return failure("project_not_found", `没有项目 ${payload.project_id}。`, 404);
      const requirement = deps.requirements.create({ title: payload.title, notes: payload.notes, ...(payload.priority ? { priority: payload.priority } : {}), ...(project ? { project } : {}), ...(payload.agent ? { agent: payload.agent } : {}) });
      const warnings: string[] = [];
      for (const context of payload.contexts) {
        try {
          if (context.kind === "link") {
            deps.requirements.addContext(requirement.id, { kind: "link", name: context.name, ref: context.ref!, by: "管家" });
          } else if (deps.requirements.addFileContext) {
            deps.requirements.addFileContext(requirement.id, { name: context.name, path: context.path!, by: "管家" });
          } else {
            warnings.push(`${context.name} 没挂上：没有文件上下文通道`);
          }
        } catch (error) {
          warnings.push(`${context.name} 没挂上：${error instanceof Error ? error.message : String(error)}`);
        }
      }
      if (payload.thread && deps.linkThread) {
        try {
          deps.linkThread(requirement.id, payload.thread);
        } catch {
          warnings.push("来源线程没挂上");
        }
      }
      audit(requirement.id, meta.approved ? "替主人建了这张卡（主人批准）" : "替主人建了这张卡", payload.thread ?? null, payload.event_id ?? meta.eventId ?? null);
      const outcome: ButlerActionOutcome = { ok: true, requirement, requirement_id: requirement.id, ...(warnings.length > 0 ? { warnings } : {}) };
      if (payload.idempotency_key) remember(payload.idempotency_key, "create-requirement", outcome);
      return outcome;
    } catch (error) {
      if (error instanceof RequirementStoreError) {
        return failure(error.code, error.message, error.code === "not_found" ? 404 : error.code === "not_saved" ? 500 : 400);
      }
      return failure("not_saved", error instanceof Error ? error.message : String(error), 500);
    }
  };

  interface LaunchPayload {
    agent: string;
    project_id?: string;
    folder?: string;
    requirement?: string;
    words?: string;
    thread_name?: string;
    idempotency_key: string;
  }
  interface PreparedApproval {
    payload: Record<string, unknown>;
    title: string;
    summary: string;
    detail: Record<string, unknown>;
  }

  /** A launch request as the approval card shows it: the requirement card, the agent and the words. */
  const prepareLaunch = (body: Record<string, unknown>, key: string, eventId: string | null): PreparedApproval | { error: Extract<ButlerActionOutcome, { ok: false }> } => {
    const requirement = text(body.requirement, "requirement", 100);
    if ("error" in requirement) return { error: failure("validation_error", requirement.error, 422) };
    const closed = requirement.value ? cardWritesOpen(requirement.value) : null;
    if (closed) return { error: closed as Extract<ButlerActionOutcome, { ok: false }> };
    const asked = text(body.agent, "agent", 64);
    if ("error" in asked) return { error: failure("validation_error", asked.error, 422) };
    const projectId = text(body.project_id, "project_id", 100);
    if ("error" in projectId) return { error: failure("validation_error", projectId.error, 422) };
    const folder = text(body.folder, "folder", 400);
    if ("error" in folder) return { error: failure("validation_error", folder.error, 422) };
    const words = text(body.words, "words", 4_000);
    if ("error" in words) return { error: failure("validation_error", words.error, 422) };
    if (!requirement.value && !words.value) return { error: failure("validation_error", "没有需求卡时，要给出这次执行要做什么（words）。", 422) };
    const threadName = text(body.thread_name, "thread_name", 60);
    if ("error" in threadName) return { error: failure("validation_error", threadName.error, 422) };
    const record = requirement.value ? deps.requirements.get(requirement.value)?.requirement ?? null : null;
    // The agent: the card's own choice wins when it has one (the owner set it in the Workshop / approval);
    // a named agent is the fallback only for a card without one. The card is the source of truth.
    const agent = { value: (record?.agent ?? null) || (asked.value.trim() ? asked.value : null) };
    if (!agent.value) {
      return { error: failure("agent_required", "没有说用哪个 agent，这张卡上也没有选。告诉主人选一个（claude-code、opencode…），或点名一个。", 422) };
    }
    // The card's project, or the project of its linked session, when no project was named.
    const derivedProject = !projectId.value && !folder.value
      ? record?.project ?? (record?.threads[0] ? deps.projectOfThread?.(record.threads[0]) ?? null : null)
      : null;
    if (!projectId.value && !folder.value && !derivedProject) {
      // 给出可选项目，管家就能在回复里报名字让主人挑（页面看得见），而不是去用交互式提问。
      const choices = (deps.listProjects?.() ?? []).slice(0, 8).map((project) => `${project.name}（${project.id}）`);
      const hint = choices.length > 0 ? `可选项目：${choices.join("、")}。` : "工坊里还没有项目，先在需求卡上选一个项目或给一个文件夹。";
      return { error: failure("project_required", `这个需求还没有项目。${hint}`, 422) };
    }
    const resolvedProject = projectId.value ? deps.projectOf?.(projectId.value) ?? null : derivedProject;
    if (projectId.value && !resolvedProject) return { error: failure("project_not_found", `没有项目 ${projectId.value}。`, 404) };
    const card = record ? deps.requirements.card?.(record.id) ?? renderRequirementCard(record) : undefined;
    const detail: Record<string, unknown> = {
      ...(requirement.value ? { requirement: requirement.value } : {}),
      ...(resolvedProject ? { project_id: resolvedProject.id, project_name: resolvedProject.name } : projectId.value ? { project_id: projectId.value } : {}),
      ...(folder.value ? { folder: folder.value } : {}),
      agent: agent.value,
      ...(words.value ? { words: words.value } : {}),
      ...(card ? { card } : {}),
      ...(eventId ? { event_id: eventId } : {}),
    };
    return {
      payload: {
        agent: agent.value,
        ...((resolvedProject?.id ?? projectId.value) ? { project_id: resolvedProject?.id ?? projectId.value } : {}),
        ...(folder.value ? { folder: folder.value } : {}),
        ...(requirement.value ? { requirement: requirement.value } : {}),
        ...(words.value ? { words: words.value } : {}),
        ...(threadName.value ? { thread_name: threadName.value } : {}),
        idempotency_key: key,
      },
      title: `启动执行会话（${agent.value}）`,
      summary: record ? `《${record.title}》 · ${agent.value}` : words.value ? short(words.value, 80) : agent.value,
      detail,
    };
  };

  const executeLaunch = async (payload: LaunchPayload, meta: { approved?: boolean; eventId?: string | null; idempotencyKey?: string }): Promise<ButlerActionOutcome> => {
    const outcome = await deps.launch({
      agent: payload.agent,
      ...(payload.project_id ? { project_id: payload.project_id } : {}),
      ...(payload.folder ? { folder: payload.folder } : {}),
      ...(payload.requirement ? { requirement: payload.requirement } : {}),
      ...(payload.words ? { words: payload.words } : {}),
      ...(payload.thread_name ? { thread_name: payload.thread_name } : {}),
      idempotency_key: payload.idempotency_key,
    });
    if (!outcome.ok) return outcome;
    if (payload.requirement && outcome.thread_id) {
      try {
        deps.requirements.link(payload.requirement, outcome.thread_id, "管家");
      } catch {
        // The session runs; the link is what may fail (the requirement's thread limit).
      }
      audit(payload.requirement, `开好了执行会话${meta.approved ? "（主人批准）" : ""}`, outcome.thread_id, meta.eventId ?? null);
    } else {
      recordAction({
        summary: `管家开了执行会话（${payload.agent}）`,
        subject: { ...(outcome.thread_id ? { thread: outcome.thread_id } : {}), ...(outcome.session ? { session: outcome.session } : {}) },
        dedupe: `butler:launch:${meta.idempotencyKey ?? payload.idempotency_key}`,
      });
    }
    const result: ButlerActionOutcome = { ...outcome, ...(payload.requirement ? { requirement_id: payload.requirement } : {}) };
    remember(meta.idempotencyKey ?? payload.idempotency_key, "launch-session", result);
    return result;
  };

  interface ArchivePayload {
    requirement: string;
    idempotency_key: string;
  }

  /** 归档：the card document, and how many sessions will be released. */
  const prepareArchive = (body: Record<string, unknown>, key: string, eventId: string | null): PreparedApproval | { error: Extract<ButlerActionOutcome, { ok: false }> } => {
    if (!deps.requirementsOn) return { error: failure("requirements_off", "工坊的需求面板关着，这次没有归档。", 409) };
    const requirement = text(body.requirement, "requirement", 100, true);
    if ("error" in requirement) return { error: failure("validation_error", requirement.error, 422) };
    const record = deps.requirements.get(requirement.value)?.requirement ?? null;
    if (!record) return { error: failure("requirement_not_found", `没有需求 ${requirement.value}。`, 404) };
    if (record.archived_at) return { error: failure("already_archived", `需求《${record.title}》已经归档了。`, 409) };
    const card = deps.requirements.card?.(record.id) ?? renderRequirementCard(record);
    return {
      payload: { requirement: record.id, idempotency_key: key, ...(eventId ? { event_id: eventId } : {}) },
      title: `归档需求《${record.title}》`,
      summary: `退回归档，释放 ${record.threads.length} 个会话；归档后可以恢复`,
      detail: {
        requirement: record.id,
        card,
        released: record.threads.length,
        ...(eventId ? { event_id: eventId } : {}),
      },
    };
  };

  const executeArchive = async (payload: ArchivePayload, meta: { approved?: boolean; eventId?: string | null; idempotencyKey?: string }): Promise<ButlerActionOutcome> => {
    if (!deps.requirements.archive) return failure("archive_unavailable", "这个收件箱不能归档需求。", 500);
    const record = deps.requirements.get(payload.requirement)?.requirement ?? null;
    if (!record) return failure("requirement_not_found", `没有需求 ${payload.requirement}。`, 404);
    const outcome = await deps.requirements.archive(payload.requirement);
    audit(payload.requirement, `替主人归档了需求${meta.approved ? "（主人批准）" : ""}`, null, meta.eventId ?? null);
    const result: ButlerActionOutcome = { ok: true, requirement_id: payload.requirement, archived: true, released: outcome.released, stopped: outcome.stopped };
    remember(meta.idempotencyKey ?? payload.idempotency_key, "archive-requirement", result);
    return result;
  };

  const tellSession = async (body: Record<string, unknown>, key: string, eventId: string | null): Promise<ButlerActionOutcome> => {
    const requirement = text(body.requirement, "requirement", 100);
    if ("error" in requirement) return failure("validation_error", requirement.error, 422);
    const closed = requirement.value ? cardWritesOpen(requirement.value) : null;
    if (closed) return closed;
    const session = text(body.session, "session", 200);
    if ("error" in session) return failure("validation_error", session.error, 422);
    const host = text(body.host, "host", 64);
    if ("error" in host) return failure("validation_error", host.error, 422);
    const thread = text(body.thread, "thread", 100);
    if ("error" in thread) return failure("validation_error", thread.error, 422);
    const words = text(body.words, "words", 2_000, true);
    if ("error" in words) return failure("validation_error", words.error, 422);
    if (!session.value && !thread.value && !requirement.value) {
      return failure("target_required", "转达要有目标：requirement、thread 或 session 至少一个。", 422);
    }
    const outcome = await deps.tell({
      ...(session.value ? { session: session.value } : {}),
      ...(host.value ? { host: host.value } : {}),
      ...(requirement.value ? { requirement: requirement.value } : {}),
      ...(thread.value ? { thread: thread.value } : {}),
      words: words.value,
      idempotency_key: key,
    });
    if (!outcome.ok) return outcome;
    const where = outcome.thread_id ?? thread.value;
    const woke = outcome.wake ? "（会话没在线，已让它重新醒来）" : "";
    if (requirement.value) audit(requirement.value, `转达${woke}：${short(words.value, 80)}`, where || null, eventId);
    else recordAction({ summary: `管家转达${woke}：${short(words.value, 80)}`, subject: { ...(where ? { thread: where } : {}), ...(outcome.session ? { session: outcome.session } : {}) }, dedupe: `butler:tell:${key}` });
    return outcome;
  };

  interface StopPayload {
    session?: string;
    host?: string;
    requirement?: string;
    thread?: string;
    idempotency_key: string;
  }

  /** A stop request as the approval card shows it: what will be interrupted. */
  const prepareStop = (body: Record<string, unknown>, key: string, eventId: string | null): PreparedApproval | { error: Extract<ButlerActionOutcome, { ok: false }> } => {
    const requirement = text(body.requirement, "requirement", 100);
    if ("error" in requirement) return { error: failure("validation_error", requirement.error, 422) };
    const closed = requirement.value ? cardWritesOpen(requirement.value) : null;
    if (closed) return { error: closed as Extract<ButlerActionOutcome, { ok: false }> };
    const session = text(body.session, "session", 200);
    if ("error" in session) return { error: failure("validation_error", session.error, 422) };
    const host = text(body.host, "host", 64);
    if ("error" in host) return { error: failure("validation_error", host.error, 422) };
    const thread = text(body.thread, "thread", 100);
    if ("error" in thread) return { error: failure("validation_error", thread.error, 422) };
    if (!session.value && !thread.value && !requirement.value) {
      return { error: failure("target_required", "停止要有目标：requirement、thread 或 session 至少一个。", 422) };
    }
    const record = requirement.value ? deps.requirements.get(requirement.value)?.requirement ?? null : null;
    const card = record ? deps.requirements.card?.(record.id) ?? renderRequirementCard(record) : undefined;
    const detail: Record<string, unknown> = {
      ...(requirement.value ? { requirement: requirement.value } : {}),
      ...(thread.value ? { thread: thread.value } : {}),
      ...(session.value ? { session: session.value } : {}),
      ...(card ? { card } : {}),
      ...(eventId ? { event_id: eventId } : {}),
    };
    return {
      payload: {
        ...(session.value ? { session: session.value } : {}),
        ...(host.value ? { host: host.value } : {}),
        ...(requirement.value ? { requirement: requirement.value } : {}),
        ...(thread.value ? { thread: thread.value } : {}),
        idempotency_key: key,
      },
      title: `停止会话${record ? `（${record.title}）` : ""}`,
      summary: record ? `《${record.title}》` : session.value ? `会话 ${session.value}` : thread.value ? `线程 ${thread.value}` : "停止当前回合",
      detail,
    };
  };

  const executeStop = async (payload: StopPayload, meta: { approved?: boolean; eventId?: string | null; idempotencyKey?: string }): Promise<ButlerActionOutcome> => {
    const outcome = await deps.stop({
      ...(payload.session ? { session: payload.session } : {}),
      ...(payload.host ? { host: payload.host } : {}),
      ...(payload.requirement ? { requirement: payload.requirement } : {}),
      ...(payload.thread ? { thread: payload.thread } : {}),
    });
    if (!outcome.ok) return outcome;
    const where = outcome.thread_id ?? payload.thread;
    if (payload.requirement) audit(payload.requirement, `打断已送出（会话下一次轮询时停下）${meta.approved ? "（主人批准）" : ""}`, where || null, meta.eventId ?? null);
    else recordAction({ summary: "管家让会话停下了", subject: { ...(where ? { thread: where } : {}), ...(outcome.session ? { session: outcome.session } : {}) }, dedupe: `butler:stop:${meta.idempotencyKey ?? payload.idempotency_key}` });
    const result: ButlerActionOutcome = { ...outcome, ...(payload.requirement ? { requirement_id: payload.requirement } : {}) };
    remember(meta.idempotencyKey ?? payload.idempotency_key, "stop-session", result);
    return result;
  };

  const remind = (body: Record<string, unknown>, eventId: string | null): ButlerActionOutcome => {
    const requirement = text(body.requirement, "requirement", 100);
    if ("error" in requirement) return failure("validation_error", requirement.error, 422);
    const textValue = text(body.text ?? body.words, "text", 500, true);
    if ("error" in textValue) return failure("validation_error", textValue.error, 422);
    const thread = text(body.thread, "thread", 100);
    if ("error" in thread) return failure("validation_error", thread.error, 422);
    if (requirement.value) {
      if (!deps.requirementsOn) return failure("requirements_off", "工坊的需求面板关着，没有可写的需求。", 409);
      if (!deps.requirements.get(requirement.value)) return failure("requirement_not_found", `没有需求 ${requirement.value}。`, 404);
      audit(requirement.value, `提醒：${textValue.value}`, thread.value || null, eventId);
    } else {
      recordAction({ summary: `管家提醒：${short(textValue.value, 80)}`, subject: { ...(thread.value ? { thread: thread.value } : {}) }, dedupe: `butler:remind:${short(textValue.value, 80)}` });
    }
    return { ok: true };
  };

  const approvalResponse = (prior: { id: string; status: string; result: { ok: boolean; requirement_id?: string; thread_id?: string; message_id?: string; session?: string; warnings?: string[]; error?: string; code?: string } | null }, action: string): Response => {
    const base = { action, approval_id: prior.id, replayed: true };
    if (prior.status === "pending") return answer({ ok: false, code: "pending_approval", error: "还在等主人批准。", ...base, status: "pending" }, 202);
    if (prior.status === "denied") return answer({ ok: false, code: "approval_denied", error: "主人拒绝了这次操作。", ...base, status: "denied" }, 403);
    if (prior.status === "failed") return answer({ ok: false, code: "approval_failed", error: prior.result?.error ?? "执行失败。", ...base, status: "failed" }, 502);
    if (prior.result?.ok) return answer({ ...prior.result, ...base }, 200);
    return answer({ ok: false, code: "approval_failed", error: "审批记录没有结果。", ...base }, 502);
  };

  const run = async (action: ButlerActionName, body: Record<string, unknown>, key: string, eventId: string | null): Promise<ButlerActionOutcome> => {
    switch (action) {
      case "tell-session":
        return await tellSession(body, key, eventId);
      case "remind":
        return remind(body, eventId);
      default:
        return failure("unsupported", `${action} 走审批通道，不在这里直接执行。`, 400);
    }
  };

  const executeAction = async (action: ButlerActionName, payload: Record<string, unknown>, meta: { approved?: boolean; eventId?: string | null; idempotencyKey?: string }): Promise<ButlerActionOutcome> => {
    if (action === "create-requirement") return executeCreate(payload as unknown as CardPayload, meta);
    if (action === "launch-session") return executeLaunch(payload as unknown as LaunchPayload, meta);
    if (action === "archive-requirement") return executeArchive(payload as unknown as ArchivePayload, meta);
    if (action === "stop-session") return executeStop(payload as unknown as StopPayload, meta);
    return failure("unsupported", `审批执行暂不支持 ${action}。`, 400);
  };

  return {
    async route(req, url) {
      if (url.pathname !== "/api/inbox/butler/act") return null;
      if (req.method !== "POST") return answer({ error: "Use POST.", code: "method" }, 405);
      // The butler's own curl (no browser headers) and the Inbox window pass; another
      // site's page (Sec-Fetch-Site: cross-site/same-site, or a foreign Origin) does not.
      if (isCrossSiteRequest(req)) return answer(INBOX_CROSS_SITE_BODY, 403);
      let body: Record<string, unknown>;
      try {
        // Windows 上模型用 curl 发中文时，命令行编码可能是 GBK（cmd 的代码页），UTF-8 严格解码会失败；
        // 直接把字节当 UTF-8 解会把中文全变成 U+FFFD（现场 2026-11-27：审批卡「要说的话」乱码）。
        // 先严格试 UTF-8，失败再按 GBK 解一次——同一份 JSON 两种编码都能落地。
        const bytes = new Uint8Array(await req.arrayBuffer());
        let text: string;
        try {
          text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        } catch {
          text = new TextDecoder("gbk").decode(bytes);
        }
        const parsed = JSON.parse(text) as unknown;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return answer({ error: "body: a JSON object.", code: "validation_error" }, 422);
        body = parsed as Record<string, unknown>;
      } catch {
        return answer({ error: "body: a JSON object.", code: "validation_error" }, 422);
      }
      const action = body.action;
      if (typeof action !== "string" || !(ACTION_NAMES as readonly string[]).includes(action)) {
        return answer({ error: `action: one of ${ACTION_NAMES.join(", ")}.`, code: "validation_error" }, 422);
      }
      const keyValue = text(body.idempotency_key, "idempotency_key", 200, true);
      if ("error" in keyValue) return answer({ error: keyValue.error, code: "validation_error" }, 422);
      const key = keyValue.value;
      const eventId = text(body.event_id, "event_id", 100);
      const event = "error" in eventId ? null : eventId.value || null;

      const prior = priorOf(key);
      if (prior) {
        if (prior.action !== action) return answer({ error: `这个 idempotency_key 已经用于 ${prior.action}，不能再用于 ${action}。`, code: "idempotency_conflict" }, 409);
        return answer({ ...prior.outcome, action, replayed: true });
      }

      const name = action as ButlerActionName;
      if (name === "create-requirement" || name === "launch-session" || name === "archive-requirement" || name === "stop-session") {
        const prepared = name === "create-requirement" ? prepareCreate(body, key, event) : name === "launch-session" ? prepareLaunch(body, key, event) : name === "archive-requirement" ? prepareArchive(body, key, event) : prepareStop(body, key, event);
        if ("error" in prepared) return answer({ ...prepared.error, action: name, replayed: false }, prepared.error.status ?? 400);
        if (deps.approvals) {
          const existing = deps.approvals.byKey(key);
          if (existing) return approvalResponse(existing, name);
          if (!deps.approvals.auto(name)) {
            const approval = deps.approvals.request({
              action: name,
              title: prepared.title,
              summary: prepared.summary,
              detail: prepared.detail,
              payload: prepared.payload as Record<string, unknown>,
              idempotency_key: key,
              event_id: event,
            });
            return answer(
              {
                ok: false,
                code: "pending_approval",
                error: "已送到管家页的审批，等主人批准。",
                action: name,
                approval_id: approval.id,
                status: "pending",
                ...("warnings" in prepared && prepared.warnings.length > 0 ? { warnings: prepared.warnings } : {}),
                replayed: false,
              },
              202,
            );
          }
        }
        const outcome = await executeAction(name, prepared.payload as Record<string, unknown>, { approved: false, eventId: event, idempotencyKey: key });
        return answer({ ...outcome, action: name, replayed: false }, outcome.ok ? 200 : outcome.status ?? 400);
      }

      let outcome: ButlerActionOutcome;
      try {
        outcome = await run(name, body, key, event);
      } catch (error) {
        outcome = failure("action_failed", error instanceof Error ? error.message : String(error), 500);
      }
      if (outcome.ok) remember(key, name, outcome);
      return answer({ ...outcome, action: name, replayed: false }, outcome.ok ? 200 : outcome.status ?? 400);
    },

    publish(port) {
      // The butler reads this file to find the channel; a stale file would curl a dead port, so it
      // is written for this run and removed when the Inbox stops.
      writeJson(hintPath, { v: 1, url: `http://127.0.0.1:${port}/api/inbox/butler/act`, pid: process.pid, at: iso() });
    },

    stop() {
      try {
        rmSync(hintPath, { force: true });
      } catch {
        // Already gone.
      }
    },

    preferences() {
      return readButlerPreferences(deps.dir).l3;
    },

    async execute(action, payload, meta) {
      return executeAction(action, payload, meta);
    },
  };
}
