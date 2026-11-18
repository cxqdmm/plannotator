/**
 * The Requirements module's Bun side (「需求」): storage under
 * <dataDir>/requirements/, the /api/requirements routes the Inbox mounts
 * (packages/server/inbox.ts, one gate + one createBunRequirementRoutes call),
 * and the change watch the window stream forwards as `event: requirements`.
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
import { join } from "node:path";
import { ulid } from "@plannotator/core/inbox-types";
import { loadConfig } from "@plannotator/shared/config";
import {
  isRequirementPriority,
  isRequirementStage,
  type Requirement,
  type RequirementEvent,
  type RequirementPriority,
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
type RequirementPatch = { title?: string; notes?: string; stage?: Requirement["stage"]; priority?: RequirementPriority; archived?: boolean };

const TITLE_MAX = 200;
const NOTES_MAX = 100_000;
const REF_MAX = 2_000;

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

/** The body of a validation failure: what was wrong, never a stack. */
function invalid(field: string, problem: string): Response {
  return json({ error: problem, code: "validation_error", field }, 400);
}

export function createBunRequirementRoutes(options: { dataDir: string }) {
  const dir = join(options.dataDir, "requirements");
  const requirementsPath = join(dir, "requirements.json");
  const eventsPath = join(dir, "requirement-events.json");

  let file: RequirementsFile = readJson<RequirementsFile>(requirementsPath, { v: 1, requirements: [] });
  let events: RequirementEventsFile = readJson<RequirementEventsFile>(eventsPath, { v: 1, events: [] });
  // A record this build cannot read (a newer Plannotator's field shape) is kept, not dropped: it goes back on every save.
  file.requirements = Array.isArray(file.requirements) ? file.requirements.filter((r) => r && typeof r.id === "string") : [];
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

  const save = (ids: string[]): boolean => {
    const written = writeJson(requirementsPath, file);
    if (written) changed(ids);
    return written;
  };

  const indexOf = (id: string): number => file.requirements.findIndex((r) => r.id === id);

  /** `body`'s create fields, validated; a Response when something was wrong. */
  function createFields(body: Record<string, unknown>): { title: string; priority: RequirementPriority; notes: string } | Response {
    const title = body.title;
    if (typeof title !== "string" || !title.trim()) return invalid("title", "title: a non-empty string.");
    if (title.length > TITLE_MAX) return invalid("title", `title: at most ${TITLE_MAX} characters.`);
    if (body.stage !== undefined) return invalid("stage", "stage: not at create (a requirement starts in 待跟进; PATCH moves it).");
    const priority = body.priority === undefined ? "none" : body.priority;
    if (!isRequirementPriority(priority)) return invalid("priority", "priority: one of urgent, high, medium, low, none.");
    const notes = body.notes === undefined || body.notes === null ? "" : body.notes;
    if (typeof notes !== "string" || notes.length > NOTES_MAX) return invalid("notes", `notes: a string of at most ${NOTES_MAX} characters.`);
    return { title: title.trim(), priority, notes };
  }

  /** `body`'s patch fields, validated; a Response when something was wrong. Unknown keys are ignored (forward-compatible). */
  function patchFields(body: Record<string, unknown>): RequirementPatch | Response {
    const patch: RequirementPatch = {};
    if (body.title !== undefined) {
      if (typeof body.title !== "string" || !body.title.trim()) return invalid("title", "title: a non-empty string.");
      if (body.title.length > TITLE_MAX) return invalid("title", `title: at most ${TITLE_MAX} characters.`);
      patch.title = body.title.trim();
    }
    if (body.notes !== undefined) {
      if (typeof body.notes !== "string" || body.notes.length > NOTES_MAX) return invalid("notes", `notes: a string of at most ${NOTES_MAX} characters.`);
      patch.notes = body.notes;
    }
    if (body.stage !== undefined) {
      if (!isRequirementStage(body.stage)) return invalid("stage", "stage: one of the seven lifecycle stages.");
      patch.stage = body.stage;
    }
    if (body.priority !== undefined) {
      if (!isRequirementPriority(body.priority)) return invalid("priority", "priority: one of urgent, high, medium, low, none.");
      patch.priority = body.priority;
    }
    if (body.archived !== undefined) {
      if (typeof body.archived !== "boolean") return invalid("archived", "archived: a boolean.");
      patch.archived = body.archived;
    }
    return patch;
  }

  /**
   * The routes. Returns null when the path is not this module's (the caller
   * answers the unknown-route 404, as it does for Shape).
   */
  async function route(req: Request, url: URL): Promise<Response | null> {
    const path = url.pathname;

    if (path === "/api/requirements" && req.method === "GET") {
      const archived = url.searchParams.get("archived") === "1";
      const requirements = archived ? file.requirements.filter((r) => r.archived_at != null) : file.requirements.filter((r) => r.archived_at == null);
      // `archived`: how many are archived, so the board's 已归档 link can say it without a second read.
      return json({ requirements, archived: file.requirements.filter((r) => r.archived_at != null).length });
    }
    if (path === "/api/requirements" && req.method === "POST") {
      const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
      if (!body || typeof body !== "object") return invalid("body", "body: a JSON object.");
      const fields = createFields(body);
      if (fields instanceof Response) return fields;
      const now = new Date().toISOString();
      const requirement: Requirement = {
        id: `req_${ulid()}`,
        title: fields.title,
        notes: fields.notes,
        stage: "triage",
        priority: fields.priority,
        deliverables: [],
        created_at: now,
        updated_at: now,
      };
      file.requirements.unshift(requirement);
      if (!save([requirement.id])) return json({ error: "The data folder could not be written; nothing changed.", code: "not_saved" }, 500);
      recordEvent(requirement.id, "created");
      return json({ requirement }, 201);
    }

    // /api/requirements/:id (and, under it, the Wave 2 deliverable routes).
    const rest = path.startsWith("/api/requirements/") ? path.slice("/api/requirements/".length) : null;
    if (rest === null) return null;
    const [idRaw, deeper] = rest.split(/\/(.*)/s, 2);
    const id = decodeURIComponent(idRaw ?? "");
    if (deeper !== undefined && deeper !== "") return null; // Wave 2 (deliverables); nothing else under :id yet.

    if (req.method === "GET") {
      const requirement = file.requirements[indexOf(id)];
      if (!requirement) return json({ error: "Not found", code: "not_found" }, 404);
      return json({ requirement, events: events.events.filter((event) => event.req === id) });
    }
    if (req.method === "PATCH") {
      const at = indexOf(id);
      if (at === -1) return json({ error: "Not found", code: "not_found" }, 404);
      const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
      if (!body || typeof body !== "object") return invalid("body", "body: a JSON object.");
      const patch = patchFields(body);
      if (patch instanceof Response) return patch;
      const requirement = file.requirements[at]!;
      if (patch.stage !== undefined && patch.stage !== requirement.stage) {
        recordEvent(id, "stage", { from: requirement.stage, to: patch.stage });
      }
      // 归档 writes its timestamp, never an `archived` field on the record.
      const { archived, ...fields } = patch;
      if (archived !== undefined) {
        const to = archived ? new Date().toISOString() : null;
        if (requirement.archived_at !== to) recordEvent(id, "field", { field: "archived", from: String(requirement.archived_at ?? ""), to: String(to ?? "") });
        requirement.archived_at = to;
      }
      for (const [field, value] of Object.entries(fields)) {
        if (field === "stage") continue; // The stage event above already names the move.
        if (requirement[field as keyof Requirement] !== value) recordEvent(id, "field", { field, from: String(requirement[field as keyof Requirement] ?? ""), to: String(value) });
      }
      Object.assign(requirement, fields, { updated_at: new Date().toISOString() });
      if (!save([id])) return json({ error: "The data folder could not be written; nothing changed.", code: "not_saved" }, 500);
      return json({ requirement });
    }
    if (req.method === "DELETE") {
      const at = indexOf(id);
      if (at === -1) return json({ error: "Not found", code: "not_found" }, 404);
      file.requirements.splice(at, 1);
      if (!save([id])) return json({ error: "The data folder could not be written; nothing changed.", code: "not_saved" }, 500);
      recordEvent(id, "deleted");
      return json({ ok: true });
    }
    return json({ error: "Use GET, POST, PATCH or DELETE.", code: "method" }, 405);
  }

  return { route, watch };
}

/** The `event: requirements` frame the window stream sends (ids: what changed; empty: read everything again). */
export function requirementEventFrame(ids: readonly string[]): string {
  return `event: requirements\ndata: ${JSON.stringify({ ids: [...ids] })}\n\n`;
}
