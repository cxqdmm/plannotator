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
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join, basename } from "node:path";
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
  suggest(id: string, input: { stage: RequirementStage; why: string; by: string }): RequirementSuggestion;
  /** The person ignores a suggestion: it is dropped, nothing else moves. */
  dismiss(id: string, suggestionId: string): void;
  /** The person adopts one: the stage moves (the only writer of stages besides patch), the suggestion drops. */
  adopt(id: string, suggestionId: string): Requirement;
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
    stage: isRequirementStage(record.stage) ? record.stage : "triage",
    priority: isRequirementPriority(record.priority) ? record.priority : "none",
    deliverables: Array.isArray(record.deliverables) ? record.deliverables : [],
    threads: Array.isArray(record.threads) ? record.threads.filter((id): id is string => typeof id === "string") : [],
    suggestions: Array.isArray(record.suggestions) ? record.suggestions : [],
    archived_at: record.archived_at ?? null,
    created_at: typeof record.created_at === "string" ? record.created_at : new Date().toISOString(),
    updated_at: typeof record.updated_at === "string" ? record.updated_at : new Date().toISOString(),
    ...record,
  } as Requirement;
}

export function createBunRequirementRoutes(options: { dataDir: string; spawnAnnotate?: (file: string) => Promise<{ stdout: string; code: number }>; /** The project root of a requirement's session, for its agents' relative deliverable paths. */ projectRootOf?: (id: string) => string | null }): { route: (req: Request, url: URL) => Promise<Response | null>; watch: RequirementStore["watch"]; store: RequirementStore } {
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
        stage: "triage",
        priority: input.priority ?? "none",
        deliverables: [],
        threads: [],
        suggestions: [],
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
      recordEvent(id, "deliverable", { to: deliverable.kind, note: deliverable.title ?? deliverable.ref });
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
    suggest(id: string, input: { stage: RequirementStage; why: string; by: string }) {
      const record = at(id);
      if (!isRequirementStage(input.stage)) throw new RequirementStoreError("validation_error", "stage: one of the seven lifecycle stages.", "stage");
      if (typeof input.why !== "string" || !input.why.trim()) throw new RequirementStoreError("validation_error", "why: one line.", "why");
      if (input.why.length > WHY_MAX) throw new RequirementStoreError("validation_error", `why: at most ${WHY_MAX} characters.`, "why");
      if (typeof input.by !== "string" || !input.by.trim()) throw new RequirementStoreError("validation_error", "by: who proposes it.", "by");
      // One open proposal per stage: a newer one replaces an unadopted older one.
      record.suggestions = record.suggestions.filter((suggestion) => suggestion.stage !== input.stage);
      const suggestion: RequirementSuggestion = { id: `sug_${ulid()}`, stage: input.stage, why: input.why.trim(), by: input.by, at: new Date().toISOString() };
      record.suggestions.push(suggestion);
      recordEvent(id, "suggestion", { to: suggestion.stage, note: `${suggestion.by}: ${suggestion.why}` });
      touch(record);
      save([id]);
      return suggestion;
    },
    dismiss(id: string, suggestionId: string) {
      const record = at(id);
      const before = record.suggestions.length;
      record.suggestions = record.suggestions.filter((suggestion) => suggestion.id !== suggestionId);
      if (record.suggestions.length === before) throw new RequirementStoreError("not_found", "No such suggestion.");
      touch(record);
      save([id]);
    },
    adopt(id: string, suggestionId: string) {
      const record = at(id);
      const suggestion = record.suggestions.find((entry) => entry.id === suggestionId);
      if (!suggestion) throw new RequirementStoreError("not_found", "No such suggestion.");
      record.suggestions = record.suggestions.filter((entry) => entry.stage !== suggestion.stage);
      if (record.stage !== suggestion.stage) recordEvent(id, "stage", { from: record.stage, to: suggestion.stage, note: `adopted ${suggestion.by}'s suggestion` });
      record.stage = suggestion.stage;
      touch(record);
      save([id]);
      return record;
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
  const startDesignReview = (id: string): { ok: true; doc: string } | { ok: false; status: number; error: string; code: string } => {
    if (!options.spawnAnnotate) return { ok: false, status: 501, error: "This Inbox cannot start a review (no annotate runtime).", code: "no_runtime" };
    if (reviewsInFlight.has(id)) return { ok: false, status: 409, error: "A design review of this requirement is already open.", code: "review_in_flight" };
    let record: Requirement;
    try {
      record = at(id);
    } catch {
      return { ok: false, status: 404, error: "No such requirement.", code: "not_found" };
    }
    const doc = seedDesignDoc(record);
    reviewsInFlight.add(id);
    void options
      .spawnAnnotate(doc)
      .then(({ stdout }) => {
        let outcome: { decision?: unknown; annotationCount?: unknown } = {};
        try {
          outcome = JSON.parse(stdout.trim().split("\n").at(-1) ?? "{}") as { decision?: unknown };
        } catch {
          outcome = {};
        }
        const decision = outcome.decision === "approved" ? "approved" : outcome.decision === "dismissed" ? "dismissed" : outcome.decision === "annotated" ? "annotated" : "unknown";
        try {
          const words = decision === "approved" ? "设计文档已批准" : decision === "annotated" ? `设计文档评审完成，带回批注${typeof outcome.annotationCount === "number" ? ` ${outcome.annotationCount} 条` : ""}` : decision === "dismissed" ? "设计文档评审被关闭，未给结论" : "设计文档评审结束（无结果）";
          store.deliver(id, { kind: "design-doc", ref: doc, title: `设计文档评审（${words}）`, by: null });
          store.say(id, words, "设计评审");
          if (decision === "approved") store.suggest(id, { stage: "design-review", why: "设计文档已批准，可进入设计评审收尾", by: "设计评审" });
        } catch {
          // The requirement changed under the review (deleted, say): nothing to write back to.
        }
      })
      .catch(() => {})
      .finally(() => {
        reviewsInFlight.delete(id);
      });
    return { ok: true, doc };
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
  const annotateDeliverable = (id: string, deliverableId: string): { ok: true } | { ok: false; status: number; error: string; code: string } => {
    if (!options.spawnAnnotate) return { ok: false, status: 501, error: "This Inbox cannot annotate here (no annotate runtime).", code: "no_runtime" };
    if (reviewsInFlight.has(`${id}:${deliverableId}`)) return { ok: false, status: 409, error: "This deliverable is already open for annotation.", code: "annotate_in_flight" };
    const found = deliverableAt(id, deliverableId);
    if ("error" in found) return { ok: false, status: 404, error: "No such deliverable.", code: "not_found" };
    if (!ANNOTATABLE_SUFFIXES.some((suffix) => found.deliverable.ref.toLowerCase().endsWith(suffix))) {
      return { ok: false, status: 415, error: "Only documents (markdown, text, HTML) open for annotation.", code: "not_annotatable" };
    }
    const key = `${id}:${deliverableId}`;
    reviewsInFlight.add(key);
    void options
      .spawnAnnotate(found.deliverable.ref)
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
        return json(store.list(url.searchParams.get("archived") === "1"));
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
          return found ? json(found) : json({ error: "Not found", code: "not_found" }, 404);
        }
        if (req.method === "PATCH") {
          const input = await body(req);
          const { priority, notes, title, stage, archived, threads } = input;
          return json({ requirement: store.patch(id, { ...(title !== undefined ? { title: title as string } : {}), ...(notes !== undefined ? { notes: notes as string } : {}), ...(stage !== undefined ? { stage: stage as RequirementStage } : {}), ...(priority !== undefined ? { priority: priority as RequirementPriority } : {}), ...(archived !== undefined ? { archived: archived as boolean } : {}), ...(threads !== undefined ? { threads: threads as string[] } : {}) }) });
        }
        if (req.method === "DELETE") {
          store.remove(id);
          return json({ ok: true });
        }
        return json({ error: "Use GET, POST, PATCH or DELETE.", code: "method" }, 405);
      }
      const designReviewMatch = deeper === "design-review" && req.method === "POST";
      if (designReviewMatch) {
        const started = startDesignReview(id);
        return started.ok ? json(started) : json({ error: started.error, code: started.code }, started.status);
      }
      const deliverableMatch = /^deliverables(?:\/([^/]+))?$/.exec(deeper);
      if (deliverableMatch) {
        if (req.method === "POST" && deliverableMatch[1] === undefined) {
          const input = await body(req);
          return json({ deliverable: store.deliver(id, { kind: input.kind as DeliverableKind, ref: input.ref as string, ...(typeof input.title === "string" ? { title: input.title } : {}), by: typeof input.by === "string" ? input.by : null }) }, 201);
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
      const suggestionMatch = /^suggestions(?:\/([^/]+)(?:\/adopt)?)?$/.exec(deeper);
      if (suggestionMatch) {
        if (req.method === "POST" && suggestionMatch[1] === undefined) {
          const input = await body(req);
          return json({ suggestion: store.suggest(id, { stage: input.stage as RequirementStage, why: input.why as string, by: input.by as string }) }, 201);
        }
        if (req.method === "DELETE" && suggestionMatch[1] !== undefined && !deeper.endsWith("/adopt")) {
          store.dismiss(id, decodeURIComponent(suggestionMatch[1]));
          return json({ ok: true });
        }
        if (req.method === "POST" && deeper.endsWith("/adopt")) {
          return json({ requirement: store.adopt(id, decodeURIComponent(suggestionMatch[1]!)) });
        }
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
