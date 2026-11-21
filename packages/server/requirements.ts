/**
 * The Requirements module's Bun side (「需求」): storage under
 * <dataDir>/requirements/, the /api/requirements routes the Inbox mounts
 * (packages/server/inbox.ts, one gate + one createBunRequirementRoutes call),
 * the change watch the window stream forwards as `event: requirements`, and
 * the store the `requirement` MCP tool writes through (inbox-mcp-requirements.ts)
 * — the HTTP routes and the tool are two faces of the same methods, so the
 * rules live once.
 *
 * Follows shape-routes.ts: the caller owns who may reach these (the
 * capability switch, the cross-site card, the POST session check); this file
 * only answers.
 *
 * Storage: `requirements.json` (the records) and `requirement-events.json`
 * (the history), both written atomically (a temp file in the same folder,
 * then rename), this process the single writer — the inbox/*.json pattern.
 * The whole set is held in memory (personal scale, the design doc's §9.3).
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, watch, writeFileSync } from "node:fs";
import { isAbsolute, join, basename } from "node:path";
import { ulid } from "@plannotator/core/inbox-types";
import { loadConfig } from "@plannotator/shared/config";
import {
  DELIVERABLE_KINDS,
  REQUIREMENT_STAGES,
  isDeliverableKind,
  isRequirementPriority,
  isRequirementStage,
  requirementStageLabel,
  type Deliverable,
  type DeliverableKind,
  type RequirementContext,
  type Requirement,
  type RequirementEvent,
  type RequirementPriority,
  type RequirementStage,
  type RequirementSuggestion,
} from "@plannotator/core/requirements-types";

const NO_STORE = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } as const;

/**
 * The module's one switch (config.json `inboxRequirements` in the data dir).
 * Unset is ON — this fork's own panel, unlike Shape's opt-in (the design
 * doc's §3.1); `false` takes the sidebar row and the routes away. A broken
 * config.json reads as on (the panel is this fork's own; it never silently
 * disappears).
 */
export function requirementsSwitchOn(): boolean {
  return loadConfig().inboxRequirements !== false;
}

/** What the `requirement` MCP tool answers when the module is off: nothing is written. */
export const REQUIREMENTS_OFF_TEXT =
  "requirements_off: The person's workshop panel is off, so requirements are not kept and nothing was written. They turn it back on in config.json (inboxRequirements); agents get the requirement action in their next session.";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...NO_STORE } });
}

/** The stored file's shape; `v` leaves room for a later migration. */
interface RequirementsFile {
  v: 1;
  requirements: Requirement[];
}

interface RequirementEventsFile {
  v: 1;
  events: RequirementEvent[];
}

/** A field write that passed validation, ready to apply. */
type RequirementPatch = { title?: string; notes?: string; stage?: Requirement["stage"]; priority?: RequirementPriority; archived?: boolean; threads?: string[] };

/** Everything a caller can ask the store to do; every failure is a thrown InboxError-shaped {error, code, field}. */
export interface RequirementStore {
  /** The active board, or the archived page. */
  list(archived: boolean): { requirements: Requirement[]; archived: number };
  get(id: string): { requirement: Requirement; events: RequirementEvent[] } | null;
  create(input: { title: string; priority?: RequirementPriority; notes?: string }): Requirement;
  patch(id: string, patch: RequirementPatch): Requirement;
  remove(id: string): void;
  link(id: string, threadId: string, by?: string | null): Requirement;
  deliver(id: string, input: { kind: DeliverableKind; ref: string; title?: string; by?: string | null }): Deliverable;
  undeliver(id: string, deliverableId: string): void;
  say(id: string, note: string, by?: string | null): void;
  addContext(id: string, input: { kind: "link" | "file"; name: string; ref: string; image?: boolean; by?: string | null }): RequirementContext;
  patchContext(id: string, contextId: string, patch: { name?: string; ref?: string }): RequirementContext;
  removeContext(id: string, contextId: string): void;
  watch: { subscribe(listener: (ids: string[]) => void): () => void };
}

export class RequirementStoreError extends Error {
  constructor(
    public code: "not_found" | "validation_error" | "not_saved",
    message: string,
    public field?: string,
  ) {
    super(message);
  }
}

const TITLE_MAX = 200;
const NOTES_MAX = 100_000;
const REF_MAX = 2_000;
const WHY_MAX = 500;
const THREADS_MAX = 64;

function readJson<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    // Unreadable counts as empty: the panel shows nothing rather than crash,
    // and the next write replaces the file (nothing is ever written over a
    // file this process could not read — see writeJson).
    return fallback;
  }
}

/** Atomic write: a temp file in the same folder, then rename. Returns false when the folder cannot be made or the temp file written. */
function writeJson(path: string, value: unknown): boolean {
  try {
    mkdirSync(join(path, ".."), { recursive: true });
    const staged = `${path}.tmp`;
    writeFileSync(staged, `${JSON.stringify(value, null, 2)}\n`);
    renameSync(staged, path);
    return true;
  } catch {
    return false;
  }
}

/** A Wave-1 record (before threads/suggestions existed) reads with both empty. */
function normalized(record: Partial<Requirement> & { id: string }): Requirement {
  return {
    title: typeof record.title === "string" ? record.title : "",
    notes: typeof record.notes === "string" ? record.notes : "",
    priority: isRequirementPriority(record.priority) ? record.priority : "none",
    // review and code-review are retired as kinds (they are conclusions, not artifacts): whatever an old
    // file holds in those kinds is dropped on read — the history already carries the conclusion.
    deliverables: Array.isArray(record.deliverables) ? record.deliverables.filter((d) => (d as { kind: string }).kind !== 'review' && (d as { kind: string }).kind !== 'code-review') : [],
    threads: Array.isArray(record.threads) ? record.threads.filter((id): id is string => typeof id === "string") : [],
    // suggest is retired (stage-auto-design): whatever an old file holds, nothing waits on the person.
    suggestions: [],
    contexts: Array.isArray(record.contexts) ? record.contexts.filter((entry): entry is RequirementContext => typeof entry === "object" && entry !== null && typeof (entry as RequirementContext).id === "string") : [],
    archived_at: record.archived_at ?? null,
    created_at: typeof record.created_at === "string" ? record.created_at : new Date().toISOString(),
    updated_at: typeof record.updated_at === "string" ? record.updated_at : new Date().toISOString(),
    ...record,
    // After the spread, the mended fields win: a legacy stage (待跟进) stays mended, an array stays an array.
    stage: record.stage === "triage" ? "design" : isRequirementStage(record.stage) ? record.stage : "design",
  } as Requirement;
}

export function createBunRequirementRoutes(options: { dataDir: string; spawnAnnotate?: (file: string) => Promise<{ stdout: string; code: number }>; /** The project root of a requirement's session, for its agents' relative deliverable paths. */ projectRootOf?: (id: string) => string | null; /** Whether a thread's row waits on the person (the Board's You-line idea), for the reads' computed flag. */ waitingOf?: (threadId: string) => boolean; /** The stage-change notifier (stage-auto-design §1): a person-voiced reply into the requirement's newest session. */ notifyThread?: (threadId: string, words: string) => void; /** Stop the launched session a thread owns (the workshop's archive releases Inbox-spawned agents). */ stopLaunchOf?: (threadId: string) => Promise<unknown> }): { route: (req: Request, url: URL) => Promise<Response | null>; watch: RequirementStore["watch"]; store: RequirementStore } {
  /** waiting, computed on reads: any linked session's thread waits on the person. */
  const withWaiting = (record: Requirement): Requirement => {
    const waitingThread = record.threads.find((threadId) => options.waitingOf?.(threadId) === true);
    return waitingThread === undefined ? record : { ...record, waiting: true, waiting_thread: waitingThread };
  };
  const dir = join(options.dataDir, "requirements");
  const requirementsPath = join(dir, "requirements.json");
  const eventsPath = join(dir, "requirement-events.json");

  let file: RequirementsFile = readJson<RequirementsFile>(requirementsPath, { v: 1, requirements: [] });
  let events: RequirementEventsFile = readJson<RequirementEventsFile>(eventsPath, { v: 1, events: [] });
  // A record this build cannot read (a newer Plannotator's field shape) is kept, not dropped: it goes back on every save.
  file.requirements = Array.isArray(file.requirements) ? file.requirements.filter((r) => r && typeof r.id === "string").map(normalized) : [];
  events.events = Array.isArray(events.events) ? events.events.filter((e) => e && typeof e.id === "string") : [];

  /** Who hears that requirements changed: the window stream forwards this as `event: requirements`. */
  const listeners = new Set<(ids: string[]) => void>();
  const watch = {
    subscribe(listener: (ids: string[]) => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  const changed = (ids: string[]) => {
    for (const listener of listeners) listener(ids);
  };

  const recordEvent = (req: string, kind: RequirementEvent["kind"], extra: Partial<RequirementEvent> = {}) => {
    events.events.push({ id: `evt_${ulid()}`, req, at: new Date().toISOString(), kind, ...extra });
    writeJson(eventsPath, events);
  };

  const save = (ids: string[]): void => {
    const written = writeJson(requirementsPath, file);
    if (!written) throw new RequirementStoreError("not_saved", "The data folder could not be written; nothing changed.");
    changed(ids);
  };

  const at = (id: string): Requirement => {
    const record = file.requirements.find((r) => r.id === id);
    if (!record) throw new RequirementStoreError("not_found", "No such requirement.");
    return record;
  };

  const touch = (record: Requirement) => {
    record.updated_at = new Date().toISOString();
  };

  const store: RequirementStore = {
    list(archived: boolean) {
      return {
        requirements: file.requirements.filter((r) => (archived ? r.archived_at != null : r.archived_at == null)),
        archived: file.requirements.filter((r) => r.archived_at != null).length,
      };
    },
    get(id: string) {
      const record = file.requirements.find((r) => r.id === id);
      if (!record) return null;
      return { requirement: record, events: events.events.filter((event) => event.req === id) };
    },
    create(input: { title: string; priority?: RequirementPriority; notes?: string }) {
      if ("stage" in (input as Record<string, unknown>)) throw new RequirementStoreError("validation_error", "stage: not at create (a requirement starts in 待跟进; PATCH moves it).", "stage");
      if (typeof input.title !== "string" || !input.title.trim()) throw new RequirementStoreError("validation_error", "title: a non-empty string.", "title");
      if (input.title.length > TITLE_MAX) throw new RequirementStoreError("validation_error", `title: at most ${TITLE_MAX} characters.`, "title");
      if (input.priority !== undefined && !isRequirementPriority(input.priority)) throw new RequirementStoreError("validation_error", "priority: one of urgent, high, medium, low, none.", "priority");
      const notes = input.notes ?? "";
      if (typeof notes !== "string" || notes.length > NOTES_MAX) throw new RequirementStoreError("validation_error", `notes: a string of at most ${NOTES_MAX} characters.`, "notes");
      const now = new Date().toISOString();
      const record: Requirement = {
        id: `req_${ulid()}`,
        title: input.title.trim(),
        notes,
        stage: "design",
        priority: input.priority ?? "none",
        deliverables: [],
        threads: [],
        suggestions: [],
        contexts: [],
        archived_at: null,
        created_at: now,
        updated_at: now,
      };
      file.requirements.unshift(record);
      save([record.id]);
      recordEvent(record.id, "created");
      return record;
    },
    patch(id: string, patch: RequirementPatch) {
      const record = at(id);
      if (patch.title !== undefined) {
        if (typeof patch.title !== "string" || !patch.title.trim()) throw new RequirementStoreError("validation_error", "title: a non-empty string.", "title");
        if (patch.title.length > TITLE_MAX) throw new RequirementStoreError("validation_error", `title: at most ${TITLE_MAX} characters.`, "title");
      }
      if (patch.notes !== undefined && (typeof patch.notes !== "string" || patch.notes.length > NOTES_MAX)) throw new RequirementStoreError("validation_error", `notes: a string of at most ${NOTES_MAX} characters.`, "notes");
      if (patch.stage !== undefined && !isRequirementStage(patch.stage)) throw new RequirementStoreError("validation_error", "stage: one of the seven lifecycle stages.", "stage");
      if (patch.priority !== undefined && !isRequirementPriority(patch.priority)) throw new RequirementStoreError("validation_error", "priority: one of urgent, high, medium, low, none.", "priority");
      if (patch.threads !== undefined) {
        if (!Array.isArray(patch.threads) || patch.threads.length > THREADS_MAX || !patch.threads.every((id) => typeof id === "string" && id.length > 0)) throw new RequirementStoreError("validation_error", `threads: a list of at most ${THREADS_MAX} thread ids.`, "threads");
      }
      if (patch.stage !== undefined && patch.stage !== record.stage) {
        recordEvent(id, "stage", { from: record.stage, to: patch.stage });
        // A stage the person moved to settles every proposal naming it.
        record.suggestions = record.suggestions.filter((suggestion) => suggestion.stage !== patch.stage);
      }
      const { archived, ...fields } = patch;
      if (archived !== undefined) {
        if (typeof archived !== "boolean") throw new RequirementStoreError("validation_error", "archived: a boolean.", "archived");
        const to = archived ? new Date().toISOString() : null;
        if (record.archived_at !== to) recordEvent(id, "field", { field: "archived", from: String(record.archived_at ?? ""), to: String(to ?? "") });
        record.archived_at = to;
      }
      for (const [field, value] of Object.entries(fields)) {
        if (field === "stage") continue; // The stage event above already names the move.
        if (JSON.stringify((record as unknown as Record<string, unknown>)[field]) !== JSON.stringify(value)) recordEvent(id, "field", { field });
      }
      Object.assign(record, fields);
      touch(record);
      save([id]);
      return record;
    },
    remove(id: string) {
      const record = at(id);
      file.requirements.splice(file.requirements.indexOf(record), 1);
      save([id]);
      recordEvent(id, "deleted");
    },
    link(id: string, threadId: string, by?: string | null) {
      const record = at(id);
      if (typeof threadId !== "string" || !threadId.trim()) throw new RequirementStoreError("validation_error", "thread_id: a thread id.", "thread_id");
      if (record.threads.includes(threadId)) return record;
      if (record.threads.length >= THREADS_MAX) throw new RequirementStoreError("validation_error", `threads: at most ${THREADS_MAX}.`, "thread_id");
      record.threads.push(threadId);
      recordEvent(id, "field", { field: "threads", to: threadId });
      touch(record);
      save([id]);
      return record;
    },
    deliver(id: string, input: { kind: DeliverableKind; ref: string; title?: string; by?: string | null }) {
      const record = at(id);
      if (!isDeliverableKind(input.kind)) throw new RequirementStoreError("validation_error", `kind: one of ${DELIVERABLE_KINDS.join(", ")}.`, "kind");
      if (typeof input.ref !== "string" || !input.ref.trim()) throw new RequirementStoreError("validation_error", "ref: what the deliverable points at.", "ref");
      // 治本（deliver→review 闭环的保证）：design-doc 的 ref 必须是可审阅的文档（.md/.markdown/.txt/.html 的
      // 路径或 URL）。会话 id（pn-…）不是文档——评审开不了它；把文档存成文件再交付。
      if (input.kind === "design-doc" && !/\.(md|markdown|txt|html?)$/i.test(input.ref.trim()))
        throw new RequirementStoreError("validation_error", "design-doc 的 ref 必须是文档本身（.md/.markdown/.txt/.html 的路径或 URL，扩展名结尾），不是会话 id 或其他句柄。把设计文档存成文件再交付。", "ref");
      // link 类同样自包含：必须是完整 URL（http/https）。会话 id（pn-）不是链接——注册表会随会话退出销毁。
      if (input.kind === "link" && !/^https?:\/\//i.test(input.ref.trim()))
        throw new RequirementStoreError("validation_error", "link 的 ref 必须是完整 URL（http:// 或 https:// 开头），不是会话 id 或路径。给能直接打开的地址。", "ref");
      if (input.ref.length > REF_MAX) throw new RequirementStoreError("validation_error", `ref: at most ${REF_MAX} characters.`, "ref");
      if (input.title !== undefined && (typeof input.title !== "string" || input.title.length > TITLE_MAX)) throw new RequirementStoreError("validation_error", `title: at most ${TITLE_MAX} characters.`, "title");
      const deliverable: Deliverable = {
        id: `dlv_${ulid()}`,
        kind: input.kind,
        ref: input.ref.trim(),
        ...(input.title ? { title: input.title } : {}),
        by: input.by ?? null,
        created_at: new Date().toISOString(),
      };
      record.deliverables.unshift(deliverable);
      recordEvent(id, "deliverable", { to: deliverable.kind, note: deliverable.title ?? deliverable.ref, field: deliverable.ref, from: deliverable.id });
      touch(record);
      save([id]);
      return deliverable;
    },
    undeliver(id: string, deliverableId: string) {
      const record = at(id);
      const at_index = record.deliverables.findIndex((entry) => entry.id === deliverableId);
      if (at_index === -1) throw new RequirementStoreError("not_found", "No such deliverable.");
      const [removed] = record.deliverables.splice(at_index, 1);
      recordEvent(id, "deliverable", { from: removed!.kind, note: `removed: ${removed!.title ?? removed!.ref}` });
      touch(record);
      save([id]);
    },
    say(id: string, note: string, by?: string | null) {
      const record = at(id);
      if (typeof note !== "string" || !note.trim()) throw new RequirementStoreError("validation_error", "note: a non-empty line.", "note");
      if (note.length > WHY_MAX) throw new RequirementStoreError("validation_error", `note: at most ${WHY_MAX} characters.`, "note");
      recordEvent(id, "say", { note: `${by ? `${by}: ` : ""}${note.trim()}` });
    },
    /** 需求上下文: the requirement's background material. `file` is the absolute path of a file already written
     *  into the requirement's context folder (the routes below do the writing); the store only records. */
    addContext(id: string, input: { kind: "link" | "file"; name: string; ref: string; image?: boolean; by?: string | null }) {
      const record = at(id);
      if (input.kind !== "link" && input.kind !== "file") throw new RequirementStoreError("validation_error", "kind: link or file.", "kind");
      if (typeof input.name !== "string" || !input.name.trim()) throw new RequirementStoreError("validation_error", "name: what this material is.", "name");
      if (input.name.length > TITLE_MAX) throw new RequirementStoreError("validation_error", `name: at most ${TITLE_MAX} characters.`, "name");
      if (typeof input.ref !== "string" || !input.ref.trim()) throw new RequirementStoreError("validation_error", input.kind === "link" ? "ref: the URL." : "ref: the file's path.", "ref");
      if (input.ref.length > REF_MAX) throw new RequirementStoreError("validation_error", `ref: at most ${REF_MAX} characters.`, "ref");
      if (input.kind === "link" && !/^https?:\/\//i.test(input.ref.trim())) throw new RequirementStoreError("validation_error", "ref: an http(s) URL.", "ref");
      const context: RequirementContext = {
        id: `ctx_${ulid()}`,
        kind: input.kind,
        name: input.name.trim(),
        ref: input.ref.trim(),
        ...(input.image ? { image: true } : {}),
        by: input.by ?? null,
        created_at: new Date().toISOString(),
      };
      record.contexts.unshift(context);
      recordEvent(id, "context", { to: context.kind, note: context.name });
      touch(record);
      save([id]);
      return context;
    },
    patchContext(id: string, contextId: string, patch: { name?: string; ref?: string }) {
      const record = at(id);
      const context = record.contexts.find((entry) => entry.id === contextId);
      if (!context) throw new RequirementStoreError("not_found", "No such context.");
      if (patch.name !== undefined) {
        if (typeof patch.name !== "string" || !patch.name.trim()) throw new RequirementStoreError("validation_error", "name: what this material is.", "name");
        if (patch.name.length > TITLE_MAX) throw new RequirementStoreError("validation_error", `name: at most ${TITLE_MAX} characters.`, "name");
      }
      if (patch.ref !== undefined) {
        if (context.kind !== "link") throw new RequirementStoreError("validation_error", "ref: only a link's address changes.", "ref");
        if (typeof patch.ref !== "string" || !/^https?:\/\//i.test(patch.ref.trim())) throw new RequirementStoreError("validation_error", "ref: an http(s) URL.", "ref");
      }
      if (patch.name !== undefined) context.name = patch.name.trim();
      if (patch.ref !== undefined) context.ref = patch.ref.trim();
      recordEvent(id, "context", { note: `changed: ${context.name}` });
      touch(record);
      save([id]);
      return context;
    },
    removeContext(id: string, contextId: string) {
      const record = at(id);
      const at_index = record.contexts.findIndex((entry) => entry.id === contextId);
      if (at_index === -1) throw new RequirementStoreError("not_found", "No such context.");
      const [removed] = record.contexts.splice(at_index, 1);
      recordEvent(id, "context", { from: removed!.kind, note: `removed: ${removed!.name}` });
      touch(record);
      save([id]);
    },
    watch,
  };

  /** A body read as JSON, or a thrown validation error. */
  const body = async (req: Request): Promise<Record<string, unknown>> => {
    const parsed = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!parsed || typeof parsed !== "object") throw new RequirementStoreError("validation_error", "body: a JSON object.", "body");
    return parsed;
  };
  /** A store failure as its HTTP answer. */
  const failure = (error: unknown): Response =>
    error instanceof RequirementStoreError ? json({ error: error.message, code: error.code, ...(error.field ? { field: error.field } : {}) }, error.code === "not_found" ? 404 : error.code === "not_saved" ? 500 : 400) : json({ error: "Unexpected failure.", code: "unexpected" }, 500);

  /**
   * 「发起设计文档评审」(the design-review bridge): the requirement's design doc — seeded from it on first
   * use, the person's edits kept after that — opened in a gated annotate session; the answer returns at once,
   * and the child's exit writes the outcome back (a deliverable, a say, and on approval a suggestion for the
   * next stage — D1: only the person moves). One review of a requirement at a time.
   */
  const reviewsInFlight = new Set<string>();
  const designDocOf = (id: string): string => join(options.dataDir, "requirements", "design-docs", `${id}.md`);

  /**
   * 需求上下文: the requirement's own folder of background material. Pasted text is written here as a file
   * (D1: everything becomes a reference), uploads are copied in (D2: the path outlives any working folder).
   */
  const contextDirOf = (id: string): string => join(options.dataDir, "requirements", "contexts", id);
  /** A name safe as a filename, still the person's words. */
  const contextFileName = (name: string): string => `${name.trim().replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").slice(0, 60) || "上下文"}.md`;
  const IMAGE_CONTEXT_SUFFIXES = [".png", ".jpg", ".jpeg", ".gif", ".webp"] as const;

  /**
   * The 需求卡 (requirement card): the message a session starts on — the requirement's own words plus its
   * context as REFERENCES (links stay links, files stay paths; the agent reads them itself), never contents.
   */
  const requirementCardOf = (record: Requirement): string => {
    const priority = record.priority === "none" ? "" : `　**优先级**：${record.priority}`;
    const lines = [
      `# 需求卡：${record.title}`,
      "",
      `**需求 ID**：\`${record.id}\`　**阶段**：${requirementStageLabel(record.stage)}${priority}`,
      "",
    ];
    if (record.notes.trim()) lines.push("## 背景", "", record.notes.trim(), "");
    if (record.contexts.length > 0) {
      lines.push("## 相关上下文", "", "> 以下都是引用：链接直接访问，文件按路径读取（图片可直接看）。动手前先读一遍。", "");
      for (const context of record.contexts) {
        lines.push(context.kind === "link" ? `- 链接：${context.ref} —— ${context.name}` : `- 文件：${context.ref} —— ${context.name}`);
      }
      lines.push("");
    }
    lines.push("## 开始吧", "", "1. 读完上下文再动手；有不清楚的先用 Ask 提问，不要猜；", "2. 阶段性产出用 deliver 挂回本需求；该进下一阶段时 suggest，由人采纳。", `（本会话已自动挂到需求 \`${record.id}\`，无需再 link。）`);
    return lines.join("\n");
  };
  const seedDesignDoc = (record: Requirement): string => {
    const file = designDocOf(record.id);
    if (!existsSync(file)) {
      const stage = REQUIREMENT_STAGES.find((entry) => entry.id === record.stage);
      mkdirSync(join(options.dataDir, "requirements", "design-docs"), { recursive: true });
      writeFileSync(
        file,
        `# ${record.title}\n\n> 需求阶段：${requirementStageLabel(record.stage)}${stage?.wants ? `（本阶段期望产出：${stage.wants}）` : ""}\n\n## 背景\n\n${record.notes.trim() || "（待补充）"}\n\n## 目标\n\n- \n\n## 方案\n\n- \n\n## 开放问题\n\n- \n`,
        { mode: 0o600 },
      );
    }
    return file;
  };
  /**
   * A deliverable's own preview and its annotation (「产物」 in the detail): the content route reads the ref the
   * deliverable points at — the person's own window only (the browser's own `Sec-Fetch-Site`), text capped, images
   * as data, anything else named, never guessed at. The annotate route opens the ref in a plain annotate session
   * (the same spawn the design review rides); what comes back lands in the requirement's history as one line.
   */
  const TEXT_SUFFIXES = [".md", ".markdown", ".txt", ".csv", ".json", ".log", ".yaml", ".yml", ".toml"] as const;
  const IMAGE_SUFFIXES = [".png", ".jpg", ".jpeg", ".gif", ".webp"] as const;
  const ANNOTATABLE_SUFFIXES = [".md", ".markdown", ".txt", ".html", ".htm"] as const;
  const deliverableAt = (id: string, deliverableId: string): { record: Requirement; deliverable: Deliverable } | { error: Response } => {    try {
      const record = at(id);
      const deliverable = record.deliverables.find((entry) => entry.id === deliverableId);
      if (!deliverable) return { error: json({ error: "No such deliverable.", code: "not_found" }, 404) };
      return { record, deliverable };
    } catch {
      return { error: json({ error: "No such requirement.", code: "not_found" }, 404) };
    }
  };
  const deliverableContent = async (id: string, deliverableId: string): Promise<Response> => {
    const found = deliverableAt(id, deliverableId);
    if ("error" in found) return found.error;
    // A Plannotator session id is not a file: say so in the person's words, never as a read failure.
    if (/^pn-/.test(found.deliverable.ref)) return json({ session: found.deliverable.ref });
    const lower = found.deliverable.ref.toLowerCase();
    // An agent delivers from its working folder, so its paths can be relative: they resolve against the project
    // root of the requirement's session (projectRootOf, wired by inbox.ts), the absolute ref first.
    const candidates = /^https?:/.test(found.deliverable.ref) || found.deliverable.ref.startsWith("/")
      ? [found.deliverable.ref]
      : [options.projectRootOf?.(id), undefined].filter((root): root is string => typeof root === "string" && root.trim().length > 0).map((root) => join(root, found.deliverable.ref));
    try {
      let bytes = Bun.file(candidates[0] ?? found.deliverable.ref);
      if (candidates.length > 1) {
        // The first candidate that is there wins; a lone candidate's failure is the answer itself.
        for (const candidate of candidates) {
          bytes = Bun.file(candidate);
          if (await bytes.exists()) break;
        }
      }
      if (IMAGE_SUFFIXES.some((suffix) => lower.endsWith(suffix))) {
        const buffer = new Uint8Array(await bytes.arrayBuffer()).slice(0, 2 * 1024 * 1024);
        return json({ image: `data:${bytes.type || "image/png"};base64,${Buffer.from(buffer).toString("base64")}` });
      }
      if (TEXT_SUFFIXES.some((suffix) => lower.endsWith(suffix)) || lower.endsWith(".html") || lower.endsWith(".htm") || !/\.[A-Za-z0-9]{1,8}$/.test(lower)) {
        const text = (await bytes.text()).slice(0, 200 * 1024);
        return json({ text, html: lower.endsWith(".html") || lower.endsWith(".htm"), annotatable: ANNOTATABLE_SUFFIXES.some((suffix) => lower.endsWith(suffix)) });
      }
      return json({ binary: true, annotatable: ANNOTATABLE_SUFFIXES.some((suffix) => lower.endsWith(suffix)) });
    } catch {
      return json({ error: "这个产物的文件在这台机器上读不到。", code: "unreadable" }, 404);
    }
  };
  /** pn- 会话 id 的解析：注册表（sessions/*.json 的 reviewId）命中后，活的给 URL，
   *  死的给它的 target——那次会话打开的原始文档路径，可重新 annotate。 */
  const resolveRef = (ref: string): { kind: "live"; url: string } | { kind: "file"; file: string } | { kind: "raw"; ref: string } => {
    if (!/^pn-/.test(ref)) return { kind: "raw", ref };
    try {
      const dir = join(options.dataDir, "sessions");
      for (const name of readdirSync(dir)) {
        if (!name.endsWith(".json")) continue;
        try {
          const info = JSON.parse(readFileSync(join(dir, name), "utf8")) as { pid: number; url: string; target?: string; reviewId?: string };
          if (info.reviewId !== ref) continue;
          let alive = false;
          try { process.kill(info.pid, 0); alive = true; } catch { alive = false; }
          if (alive) return { kind: "live", url: info.url };
          if (info.target) return { kind: "file", file: info.target };
          return { kind: "raw", ref };
        } catch { /* 一条坏记录不挡路 */ }
      }
    } catch { /* 无注册表目录 */ }
    return { kind: "raw", ref };
  };
  /** 要打开的文档路径：pn- 解出 target；相对路径按需求会话的项目根绝对化。null = 打不开（活的会话或解不出）。 */
  const fileTargetOf = (id: string, ref: string): { file: string } | { url: string } | null => {
    const resolved = resolveRef(ref);
    if (resolved.kind === "live") return { url: resolved.url };
    const file = resolved.kind === "file" ? resolved.file : ref;
    if (/^https?:/.test(file)) return null;
    const absolute = isAbsolute(file) ? file : options.projectRootOf ? join(options.projectRootOf(id) ?? ".", file) : file;
    return { file: absolute };
  };

  /** 同一个文档已有活着的 annotate 会话就直接复用（幂等点击，不再每次 spawn 新链接）。 */
  const aliveAnnotateOf = (file: string): string | null => {
    const same = (a: string, b: string) => a.replaceAll("\\", "/").toLowerCase() === b.replaceAll("\\", "/").toLowerCase();
    try {
      const dir = join(options.dataDir, "sessions");
      for (const name of readdirSync(dir)) {
        if (!name.endsWith(".json")) continue;
        try {
          const info = JSON.parse(readFileSync(join(dir, name), "utf8")) as { pid: number; url: string; mode?: string; target?: string };
          if (info.mode !== "annotate" || !info.target || !same(info.target, file)) continue;
          try { process.kill(info.pid, 0); } catch { continue; }
          return info.url;
        } catch { /* 一条坏记录不挡路 */ }
      }
    } catch { /* 无注册表目录 */ }
    return null;
  };

  const annotateDeliverable = (id: string, deliverableId: string): { ok: true; url?: string } | { ok: false; status: number; error: string; code: string } => {
    if (!options.spawnAnnotate) return { ok: false, status: 501, error: "This Inbox cannot annotate here (no annotate runtime).", code: "no_runtime" };
    if (reviewsInFlight.has(`${id}:${deliverableId}`)) return { ok: false, status: 409, error: "This deliverable is already open for annotation.", code: "annotate_in_flight" };
    const found = deliverableAt(id, deliverableId);
    if ("error" in found) return { ok: false, status: 404, error: "No such deliverable.", code: "not_found" };
    const target = fileTargetOf(id, found.deliverable.ref);
    if (target && "url" in target) return { ok: true, url: target.url };
    if (target && "file" in target) {
      const alive = aliveAnnotateOf(target.file);
      if (alive) return { ok: true, url: alive };
    }
    if (!target || !ANNOTATABLE_SUFFIXES.some((suffix) => target.file.toLowerCase().endsWith(suffix))) {
      return { ok: false, status: 415, error: "只有文档（markdown/文本/HTML）能打开批注；这个交付物解析不出可打开的文档。", code: "not_annotatable" };
    }
    const key = `${id}:${deliverableId}`;
    reviewsInFlight.add(key);
    void options
      .spawnAnnotate(target.file)
      .then(({ stdout }) => {
        let outcome: { decision?: unknown; annotationCount?: unknown } = {};
        try {
          outcome = JSON.parse(stdout.trim().split("\n").at(-1) ?? "{}") as { decision?: unknown };
        } catch {
          outcome = {};
        }
        const count = typeof outcome.annotationCount === "number" ? `，带回批注 ${outcome.annotationCount} 条` : "";
        const words = outcome.decision === "dismissed" ? `「${found.deliverable.title ?? basename(found.deliverable.ref)}」的批注被关闭，未给结论` : `「${found.deliverable.title ?? basename(found.deliverable.ref)}」批注完成${count}`;
        try {
          store.say(id, words, "批注");
        } catch {
          // The requirement went away while its document was open: nothing to write back to.
        }
      })
      .catch(() => {})
      .finally(() => {
        reviewsInFlight.delete(key);
      });
    return { ok: true };
  };

  /**
   * The routes. Returns null when the path is not this module's (the caller
   * answers the unknown-route 404, as it does for Shape).
   */
  async function route(req: Request, url: URL): Promise<Response | null> {
    const path = url.pathname;
    try {
      if (path === "/api/requirements" && req.method === "GET") {
        const page = store.list(url.searchParams.get("archived") === "1");
        return json({ ...page, requirements: page.requirements.map(withWaiting) });
      }
      if (path === "/api/requirements" && req.method === "POST") {
        return json({ requirement: store.create(await body(req) as Parameters<RequirementStore["create"]>[0]) }, 201);
      }

      // /api/requirements/:id[/deliverables[/:did]|/suggestions[/:sid[/adopt]]]
      const rest = path.startsWith("/api/requirements/") ? path.slice("/api/requirements/".length) : null;
      if (rest === null) return null;
      const [idRaw, deeper] = rest.split(/\/(.*)/s, 2);
      const id = decodeURIComponent(idRaw ?? "");
      if (deeper === undefined || deeper === "") {
        if (req.method === "GET") {
          const found = store.get(id);
          return found ? json({ ...found, requirement: withWaiting(found.requirement), card: requirementCardOf(found.requirement) }) : json({ error: "Not found", code: "not_found" }, 404);
        }
        if (req.method === "PATCH") {
          const input = await body(req);
          // The Workshop's compose: threads:'ADD' appends (the window's link on send).
          if (input.threads === 'ADD') {
            const found = store.get(id);
            const threadId = typeof input.thread_id === 'string' ? input.thread_id : null;
            if (found && threadId && !found.requirement.threads.includes(threadId)) {
              return json({ requirement: store.patch(id, { threads: [...found.requirement.threads, threadId] }) });
            }
            return json({ requirement: found?.requirement ?? null });
          }
          const { priority, notes, title, stage, archived, threads } = input;
          if (stage !== undefined && stage !== store.get(id)?.requirement.stage) store.say(id, `阶段：${requirementStageLabel(store.get(id)!.requirement.stage)} → ${requirementStageLabel(stage as RequirementStage)}（手动）`, "阶段");
          return json({ requirement: store.patch(id, { ...(title !== undefined ? { title: title as string } : {}), ...(notes !== undefined ? { notes: notes as string } : {}), ...(stage !== undefined ? { stage: stage as RequirementStage } : {}), ...(priority !== undefined ? { priority: priority as RequirementPriority } : {}), ...(archived !== undefined ? { archived: archived as boolean } : {}), ...(threads !== undefined ? { threads: threads as string[] } : {}) }) });
        }
        if (req.method === "DELETE") {
          store.remove(id);
          return json({ ok: true });
        }
        return json({ error: "Use GET, POST, PATCH or DELETE.", code: "method" }, 405);
      }
      // 归档：需求退场，全部会话释放（线程解除挂载，回到收件箱本身——尤其是 Inbox 拉起的会话，
      // 留在已归档需求下会变成触达不了的终端）。历史留痕，并给每个会话捎一句话让它停手。
      const archiveMatch = deeper === "archive" && req.method === "POST";
      if (archiveMatch) {
        let record: Requirement;
        try {
          record = at(id);
        } catch {
          return json({ error: "No such requirement.", code: "not_found" }, 404);
        }
        const released = record.threads;
        if (record.archived_at == null) store.patch(id, { archived: true });
        if (released.length > 0) store.patch(id, { threads: [] });
        // Inbox 自己拉起的会话直接停掉（like delete）；外部会话只解除挂载并告知停手。
        let stopped = 0;
        for (const threadId of released) {
          if (options.stopLaunchOf) {
            try {
              const outcome = await options.stopLaunchOf(threadId);
              if (outcome != null) {
                stopped += 1;
                continue; // 停止本身就是交代；再发回复会把它复活（reply → respawn）
              }
            } catch { /* best effort */ }
          }
          if (options.notifyThread) {
            try {
              options.notifyThread(threadId, `【工坊】需求「${record.title}」已归档：相关工作停止，本会话已与它解除关联。有遗留产物请另行交代。`);
            } catch { /* best effort */ }
          }
        }
        store.say(id, `需求已归档，${released.length} 个会话已释放${stopped > 0 ? `，其中 ${stopped} 个 Inbox 启动的会话已停止` : ""}`, "归档");
        return json({ ok: true, released: released.length, stopped });
      }
      const deliverableMatch = /^deliverables(?:\/([^/]+))?$/.exec(deeper);
      if (deliverableMatch) {
        if (req.method === "POST" && deliverableMatch[1] === undefined) {
          const input = await body(req);
          const deliverable = store.deliver(id, { kind: input.kind as DeliverableKind, ref: input.ref as string, ...(typeof input.title === "string" ? { title: input.title } : {}), by: typeof input.by === "string" ? input.by : null });
          return json({ deliverable }, 201);
        }
        if (req.method === "DELETE" && deliverableMatch[1] !== undefined) {
          store.undeliver(id, decodeURIComponent(deliverableMatch[1]));
          return json({ ok: true });
        }
      }
      // A deliverable's preview (the person's own window only: the browser's own Sec-Fetch-Site) and its annotation.
      const contentMatch = /^deliverables\/([^/]+)\/content$/.exec(deeper);
      if (contentMatch && req.method === "GET") {
        if (req.headers.get("sec-fetch-site")?.trim().toLowerCase() !== "same-origin") return json({ error: "The preview answers only the Inbox window.", code: "window_only" }, 403);
        return await deliverableContent(id, decodeURIComponent(contentMatch[1]!));
      }
      const annotateMatch = /^deliverables\/([^/]+)\/annotate$/.exec(deeper);
      if (annotateMatch && req.method === "POST") {
        const started = annotateDeliverable(id, decodeURIComponent(annotateMatch[1]!));
        return started.ok ? json(started) : json({ error: started.error, code: started.code }, started.status);
      }
      const reviewMatch = /^deliverables\/([^/]+)\/review$/.exec(deeper);
      if (reviewMatch && req.method === "POST") {
        if (!options.spawnAnnotate) return json({ error: "This Inbox cannot open a review here (no annotate runtime).", code: "no_runtime" }, 501);
        if (reviewsInFlight.has(`review:${id}`)) {
          // 关掉了浏览器标签不会杀门控子进程：锁还在，评审页其实活着——按同一文档找回它，
          // 把地址还给点击处（重新贴上标签页），而不是把人关在门外。
          const target = fileTargetOf(id, deliverableAt(id, decodeURIComponent(reviewMatch[1]!)).deliverable.ref);
          const reopen = target && "file" in target ? aliveAnnotateOf(target.file) : target && "url" in target ? target.url : null;
          if (reopen) return json({ ok: true, url: reopen, reopened: true });
          return json({ error: "This requirement's review is already open.", code: "review_in_flight" }, 409);
        }
        const found = deliverableAt(id, decodeURIComponent(reviewMatch[1]!));
        if ("error" in found) return found.error;
        // 评审不复用：裁决必须由本次 spawn 的 stdout 捕获（复用别人的会话 = 没人读它的 verdict，
        // 批准后阶段不动）。批注端点才复用。pn- 解出文档路径后照常自起门控评审。
        const reviewTarget = fileTargetOf(id, found.deliverable.ref);
        if (!reviewTarget || !/\.(md|markdown|txt|html?)$/i.test(reviewTarget.file)) return json({ error: "Only documents open for review.", code: "not_reviewable" }, 415);
        if (!existsSync(reviewTarget.file)) return json({ error: `设计文档不在磁盘上：${reviewTarget.file}（会话的工作区可能已删除或移动）`, code: "doc_missing" }, 404);
        const key = `review:${id}`;
        reviewsInFlight.add(key);
        const doc = found.deliverable;
        void options
          .spawnAnnotate(reviewTarget.file)
          .then(({ stdout }) => {
            let outcome: { decision?: unknown; feedback?: unknown; annotationCount?: unknown } = {};
            try {
              outcome = JSON.parse(stdout.trim().split("\n").at(-1) ?? "{}") as { decision?: unknown };
            } catch {
              outcome = {};
            }
            // dismissed: no verdict, no move, no message.
          })
          .catch(() => {})
          .finally(() => {
            reviewsInFlight.delete(key);
          });
        return json({ ok: true, doc: doc.ref });
      }
      // 需求上下文 (contexts): the person adds a link, pasted text (which becomes a file in the requirement's
      // context folder), or an uploaded file (base64 in the JSON body, so the window's session check holds).
      const contextMatch = /^contexts(?:\/([^/]+)(\/content)?)?$/.exec(deeper);
      if (contextMatch) {
        if (req.method === "POST" && contextMatch[1] === undefined) {
          const input = await body(req);
          if (input.kind === "link") {
            return json({ context: store.addContext(id, { kind: "link", name: input.name as string, ref: input.ref as string }) }, 201);
          }
          if (input.kind === "text") {
            if (typeof input.text !== "string" || !input.text.trim()) return json({ error: "text: the words to keep.", code: "validation_error", field: "text" }, 400);
            if (input.text.length > 512 * 1024) return json({ error: "text: at most 512 KB.", code: "validation_error", field: "text" }, 400);
            const record = store.get(id);
            if (!record) return json({ error: "Not found", code: "not_found" }, 404);
            mkdirSync(contextDirOf(id), { recursive: true, mode: 0o700 });
            const file = join(contextDirOf(id), contextFileName(typeof input.name === "string" ? input.name : "上下文"));
            writeFileSync(file, input.text, { mode: 0o600 });
            return json({ context: store.addContext(id, { kind: "file", name: typeof input.name === "string" && input.name.trim() ? input.name : "上下文", ref: file }) }, 201);
          }
          if (input.kind === "upload") {
            if (typeof input.data !== "string" || !input.data) return json({ error: "data: the file, base64.", code: "validation_error", field: "data" }, 400);
            if (input.data.length > 12 * 1024 * 1024) return json({ error: "data: at most 9 MB or so of file.", code: "validation_error", field: "data" }, 400);
            const name = typeof input.name === "string" && input.name.trim() ? input.name.trim() : "文件";
            const record = store.get(id);
            if (!record) return json({ error: "Not found", code: "not_found" }, 404);
            mkdirSync(contextDirOf(id), { recursive: true, mode: 0o700 });
            const suffix = (/\.[A-Za-z0-9]{1,8}$/.exec(name)?.[0] ?? "").toLowerCase();
            const file = join(contextDirOf(id), `${ulid()}${suffix}`);
            writeFileSync(file, Buffer.from(input.data, "base64"), { mode: 0o600 });
            const image = IMAGE_CONTEXT_SUFFIXES.some((entry) => suffix === entry);
            return json({ context: store.addContext(id, { kind: "file", name, ref: file, ...(image ? { image: true } : {}) }) }, 201);
          }
          return json({ error: "kind: link, text or upload.", code: "validation_error", field: "kind" }, 400);
        }
        if (req.method === "PATCH" && contextMatch[1] !== undefined && !contextMatch[2]) {
          const input = await body(req);
          const found = store.get(id);
          const context = found?.requirement.contexts.find((entry) => entry.id === decodeURIComponent(contextMatch[1]!));
          if (!found || !context) return json({ error: "No such context.", code: "not_found" }, 404);
          if (typeof input.text === "string") {
            if (context.kind !== "file" || !context.ref.startsWith(contextDirOf(id))) return json({ error: "text: only the requirement's own text files change here.", code: "validation_error", field: "text" }, 400);
            if (input.text.length > 512 * 1024) return json({ error: "text: at most 512 KB.", code: "validation_error", field: "text" }, 400);
            writeFileSync(context.ref, input.text, { mode: 0o600 });
          }
          return json({ context: store.patchContext(id, decodeURIComponent(contextMatch[1]!), { ...(typeof input.name === "string" ? { name: input.name } : {}), ...(typeof input.ref === "string" ? { ref: input.ref } : {}) }) });
        }
        if (req.method === "DELETE" && contextMatch[1] !== undefined && !contextMatch[2]) {
          const contextId = decodeURIComponent(contextMatch[1]!);
          const found = store.get(id);
          const removed = found?.requirement.contexts.find((entry) => entry.id === contextId);
          store.removeContext(id, contextId);
          // The library owns its files: taking the context off takes its file with it.
          if (removed?.kind === "file" && removed.ref.startsWith(contextDirOf(id))) rmSync(removed.ref, { force: true });
          return json({ ok: true });
        }
        if (req.method === "GET" && contextMatch[2] === "/content") {
          if (req.headers.get("sec-fetch-site")?.trim().toLowerCase() !== "same-origin") return json({ error: "The preview answers only the Inbox window.", code: "window_only" }, 403);
          const found = store.get(id);
          const context = found?.requirement.contexts.find((entry) => entry.id === decodeURIComponent(contextMatch[1]!));
          if (!context) return json({ error: "Not found", code: "not_found" }, 404);
          if (context.kind === "link") return json({ link: context.ref });
          try {
            const bytes = Bun.file(context.ref);
            if (context.image) {
              const buffer = new Uint8Array(await bytes.arrayBuffer()).slice(0, 2 * 1024 * 1024);
              return json({ image: `data:${bytes.type || "image/png"};base64,${Buffer.from(buffer).toString("base64")}` });
            }
            const text = (await bytes.text()).slice(0, 200 * 1024);
            return json({ text, html: /\.html?$/i.test(context.ref) });
          } catch {
            return json({ error: "这个上下文的文件在这台机器上读不到。", code: "unreadable" }, 404);
          }
        }
      }
      if (deeper === "suggestions" || deeper.startsWith("suggestions/")) {
        return json({ error: "suggest is retired: stages move themselves — deliver a design doc to enter review; its verdict moves the stage.", code: "suggest_retired" }, 410);
      }
      return null;
    } catch (error) {
      return failure(error);
    }
  }

  return { route, watch, store };
}

/** The `event: requirements` frame the window stream sends (ids: what changed; empty: read everything again). */
export function requirementEventFrame(ids: readonly string[]): string {
  return `event: requirements\ndata: ${JSON.stringify({ ids: [...ids] })}\n\n`;
}
