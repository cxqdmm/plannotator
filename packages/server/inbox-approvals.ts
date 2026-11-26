/**
 * 管家审批（doc/管家审批与需求卡-方案.html）：the switch + the one place where a
 * butler action waits for the owner. Phase 1 gates `create-requirement`; launch/stop
 * keep the M2 conversational L3 until they move here in Phase 2.
 *
 *   GET  /api/inbox/butler/approvals            the window's list + the auto switches
 *   POST /api/inbox/butler/approvals/:id/decide  { decision: 'approve'|'deny', always?, note? }
 *   POST /api/inbox/butler/approvals/settings    { action, mode: 'ask'|'auto' }
 *
 * The window only (same origin; writes carry the page's serverSession). The stored
 * `payload` is the action body and never leaves this file; the window gets `detail`
 * (the card document and context names). Approving executes the action through the
 * same executor the action channel uses, then records a butler event with the result,
 * so the butler can report truthfully instead of guessing.
 *
 * The records live in `<dataDir>/approvals.json` (0600), apart from the event log and
 * the MCP surface; the switches live in `~/plannotator-butler/preferences.json`.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ulid } from "@plannotator/core/inbox-types";
import { checkServerSession, INBOX_SERVER_SESSION_MISMATCH_ERROR, serverSessionMismatchBody } from "@plannotator/core/server-session";
import { butlerAuto, setButlerAuto } from "./inbox-butler-preferences";
import type { ButlerEvent } from "./inbox-butler-events";

export type InboxApprovalAction = "create-requirement" | "launch-session" | "stop-session";
export type InboxApprovalStatus = "pending" | "approved" | "denied" | "failed";

/** What the executor answers; only this reaches the approval record and the window. */
export interface InboxApprovalResult {
  ok: boolean;
  requirement_id?: string;
  thread_id?: string;
  message_id?: string;
  session?: string;
  warnings?: string[];
  error?: string;
  code?: string;
}

/** What the owner sees: the document and the references, never the raw payload. */
export interface InboxApprovalDetail {
  requirement?: string;
  thread?: string;
  event_id?: string;
  /** The complete requirement-card document as Markdown (the same renderer as the session). */
  card?: string;
  contexts?: { kind: string; name: string }[];
  /** Missing card sections, or other advice; never blocks the approval. */
  warnings?: string[];
  project_id?: string;
  agent?: string;
  session?: string;
  words?: string;
}

export interface InboxApproval {
  id: string;
  kind: "butler-action";
  action: InboxApprovalAction;
  status: InboxApprovalStatus;
  /** 「管家想建一张需求卡」 */
  title: string;
  /** One line for the face of the card. */
  summary: string;
  detail: InboxApprovalDetail;
  /** Server-only action body (paths, words); never sent to the window. */
  payload: Record<string, unknown>;
  idempotency_key: string;
  requested_at: string;
  decided_at: string | null;
  result: InboxApprovalResult | null;
  note: string | null;
}

export interface InboxApprovalRequest {
  action: InboxApprovalAction;
  title: string;
  summary: string;
  detail: InboxApprovalDetail;
  payload: Record<string, unknown>;
  idempotency_key: string;
  event_id: string | null;
}

export interface InboxApprovals {
  readonly request: (input: InboxApprovalRequest) => InboxApproval;
  /** The approval a key already made (pending or decided), for the action channel's replay. */
  readonly byKey: (key: string) => InboxApproval | null;
  readonly auto: (action: string) => boolean;
  readonly setAuto: (action: string, on: boolean) => void;
  readonly list: () => { pending: InboxApproval[]; decided: InboxApproval[]; auto: Record<string, boolean> };
  readonly decide: (id: string, decision: "approve" | "deny", options?: { always?: boolean; note?: string | null }) => Promise<{ ok: true; approval: InboxApproval } | { ok: false; code: string; error: string }>;
  /** Retry an approval that was approved but never executed (a daemon crash between the mark and the call). */
  readonly resume: () => Promise<void>;
  /** The routes above. */
  readonly route: (req: Request, url: URL) => Promise<Response | null>;
  readonly onChange: (listener: () => void) => () => void;
}

export interface InboxApprovalOptions {
  dataDir: string;
  /** The butler folder: preferences.json's auto switches. */
  butlerDir: string;
  serverSession: string;
  execute: (action: InboxApprovalAction, payload: Record<string, unknown>, meta: { approved: true; approvalId: string; eventId: string | null; idempotencyKey: string }) => Promise<InboxApprovalResult>;
  recordEvent: (event: ButlerEvent) => void;
  now?: () => number;
}

interface ApprovalsFile {
  v: 1;
  approvals: InboxApproval[];
}

const APPROVALS_KEEP_DECIDED = 60;

function iso(now: () => number): string {
  return new Date(now()).toISOString();
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" },
  });
}

/** The window's copy of a record: no payload, ever. */
function publicApproval(approval: InboxApproval): Omit<InboxApproval, "payload"> {
  const { payload: _payload, ...rest } = approval;
  return rest;
}

export function createInboxApprovals(options: InboxApprovalOptions): InboxApprovals {
  const now = options.now ?? Date.now;
  const filePath = join(options.dataDir, "approvals.json");
  const listeners = new Set<() => void>();

  const load = (): ApprovalsFile => {
    try {
      const parsed = JSON.parse(readFileSync(filePath, "utf8")) as Partial<ApprovalsFile>;
      const approvals = Array.isArray(parsed.approvals) ? parsed.approvals.filter((entry): entry is InboxApproval => !!entry && typeof entry.id === "string" && typeof entry.action === "string") : [];
      return { v: 1, approvals };
    } catch {
      return { v: 1, approvals: [] };
    }
  };
  let file = load();

  const save = () => {
    // Pending always stays; decided history is a short recent window, not a log.
    const pending = file.approvals.filter((entry) => entry.status === "pending");
    const decided = file.approvals
      .filter((entry) => entry.status !== "pending")
      .sort((a, b) => (a.decided_at ?? a.requested_at).localeCompare(b.decided_at ?? b.requested_at))
      .slice(-APPROVALS_KEEP_DECIDED);
    file = { v: 1, approvals: [...pending, ...decided] };
    try {
      mkdirSync(join(filePath, ".."), { recursive: true, mode: 0o700 });
      const staged = `${filePath}.tmp`;
      writeFileSync(staged, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 });
      renameSync(staged, filePath);
    } catch {
      // The in-memory record still answers; the next decision tries again.
    }
    for (const listener of listeners) {
      try {
        listener();
      } catch {
        // A listener's failure never fails a decision.
      }
    }
  };

  const find = (id: string): InboxApproval | null => file.approvals.find((entry) => entry.id === id) ?? null;

  const byKey = (key: string): InboxApproval | null => {
    const wanted = key.trim();
    if (!wanted) return null;
    return file.approvals.find((entry) => entry.idempotency_key === wanted) ?? null;
  };

  const request = (input: InboxApprovalRequest): InboxApproval => {
    const existing = byKey(input.idempotency_key);
    if (existing) return existing;
    const approval: InboxApproval = {
      id: `apr_${ulid()}`,
      kind: "butler-action",
      action: input.action,
      status: "pending",
      title: input.title,
      summary: input.summary,
      detail: input.detail,
      payload: input.payload,
      idempotency_key: input.idempotency_key,
      requested_at: iso(now),
      decided_at: null,
      result: null,
      note: null,
    };
    file.approvals.push(approval);
    save();
    return approval;
  };

  const auto = (action: string): boolean => butlerAuto(options.butlerDir, action);

  const setAuto = (action: string, on: boolean) => {
    setButlerAuto(options.butlerDir, action, on);
    for (const listener of listeners) {
      try {
        listener();
      } catch {
        // See save().
      }
    }
  };

  const list = () => {
    const pending = file.approvals.filter((entry) => entry.status === "pending").sort((a, b) => b.requested_at.localeCompare(a.requested_at));
    const decided = file.approvals.filter((entry) => entry.status !== "pending").sort((a, b) => (b.decided_at ?? b.requested_at).localeCompare(a.decided_at ?? a.requested_at)).slice(0, 20);
    return {
      pending: pending.map(publicApproval) as InboxApproval[],
      decided: decided.map(publicApproval) as InboxApproval[],
      auto: {
        "create-requirement": butlerAuto(options.butlerDir, "create-requirement"),
        "launch-session": butlerAuto(options.butlerDir, "launch-session"),
        "stop-session": butlerAuto(options.butlerDir, "stop-session"),
      },
    };
  };

  /** The event the butler receives after a decision — the loop's closing line. */
  const recordDecision = (approval: InboxApproval, kind: "butler.action.approved" | "butler.action.denied" | "butler.action.failed", summary: string) => {
    const requirement = approval.result?.requirement_id ?? approval.detail.requirement;
    const thread = approval.result?.thread_id ?? approval.detail.thread;
    const session = approval.result?.session ?? approval.detail.session;
    try {
      options.recordEvent({
        id: `be_butler_approval_${approval.id}`,
        at: iso(now),
        domain: requirement ? "requirement" : session ? "session" : "thread",
        kind,
        subject: { ...(requirement ? { requirement } : {}), ...(thread ? { thread } : {}), ...(session ? { session } : {}) },
        actor: "butler",
        summary,
        dedupe: `butler:approval:${approval.id}`,
        level: "notify",
      });
    } catch {
      // The result is still in the approval record; the ledger is best effort here.
    }
  };

  const execute = async (approval: InboxApproval): Promise<void> => {
    let result: InboxApprovalResult;
    try {
      result = await options.execute(approval.action, approval.payload, { approved: true, approvalId: approval.id, eventId: approval.detail.event_id ?? null, idempotencyKey: approval.idempotency_key });
    } catch (error) {
      result = { ok: false, code: "action_failed", error: error instanceof Error ? error.message : String(error) };
    }
    approval.result = result;
    approval.status = result.ok ? "approved" : "failed";
    approval.decided_at = approval.decided_at ?? iso(now);
    save();
    const title = approval.title;
    if (result.ok) {
      const extra = result.warnings && result.warnings.length > 0 ? `（注意：${result.warnings.join("；")}）` : "";
      recordDecision(approval, "butler.action.approved", `主人批准，管家完成了：${title}${extra}`);
    } else {
      recordDecision(approval, "butler.action.failed", `主人批准了，但执行失败：${title}（${result.error ?? result.code ?? "未知原因"}）`);
    }
  };

  const decide = async (id: string, decision: "approve" | "deny", settings: { always?: boolean; note?: string | null } = {}): Promise<{ ok: true; approval: InboxApproval } | { ok: false; code: string; error: string }> => {
    const approval = find(id);
    if (!approval) return { ok: false, code: "approval_not_found", error: `没有审批 ${id}。` };
    if (approval.status !== "pending") return { ok: false, code: "already_decided", error: "这件事已经决定过了。" };
    approval.decided_at = iso(now);
    approval.note = typeof settings.note === "string" && settings.note.trim() ? settings.note.trim().slice(0, 500) : null;
    if (settings.always === true) setAuto(approval.action, true);
    if (decision === "deny") {
      approval.status = "denied";
      approval.result = { ok: false, code: "denied", error: "主人拒绝了。" };
      save();
      recordDecision(approval, "butler.action.denied", `主人拒绝了：${approval.title}`);
      return { ok: true, approval };
    }
    // Mark first, then execute: a second window's click finds a decided record, never a second run.
    approval.status = "approved";
    save();
    await execute(approval);
    return { ok: true, approval };
  };

  /** Resume approvals marked approved without a result (a crash between the mark and the call). */
  const resume = async () => {
    for (const approval of file.approvals.filter((entry) => entry.status === "approved" && entry.result === null)) {
      await execute(approval);
    }
  };

  const windowOnlyRead = (req: Request): boolean => req.headers.get("sec-fetch-site")?.trim().toLowerCase() === "same-origin";
  const windowWrite = (req: Request, body: Record<string, unknown>): Response | null => {
    if (req.headers.get("sec-fetch-site")?.trim().toLowerCase() !== "same-origin") {
      return json({ error: "审批只在本机窗口里操作。", code: "window_only" }, 403);
    }
    if (checkServerSession(body, options.serverSession) === "mismatch") return json(serverSessionMismatchBody(INBOX_SERVER_SESSION_MISMATCH_ERROR), 409);
    return null;
  };

  return {
    request,
    byKey,
    auto,
    setAuto,
    list,
    resume,
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    decide,
    async route(req, url) {
      if (url.pathname === "/api/inbox/butler/approvals" && req.method === "GET") {
        if (!windowOnlyRead(req)) return json({ error: "审批只在本机窗口里读。", code: "window_only" }, 403);
        const { pending, decided, auto: switches } = list();
        return json({ approvals: { pending, decided }, auto: switches });
      }
      const decideMatch = /^\/api\/inbox\/butler\/approvals\/([A-Za-z0-9_]+)\/decide$/.exec(url.pathname);
      if (decideMatch && req.method === "POST") {
        let body: Record<string, unknown>;
        try {
          body = (await req.json()) as Record<string, unknown>;
        } catch {
          return json({ error: "body: a JSON object.", code: "validation_error" }, 422);
        }
        const refused = windowWrite(req, body);
        if (refused) return refused;
        const decision = body.decision === "approve" || body.decision === "deny" ? body.decision : null;
        if (!decision) return json({ error: "decision: approve or deny.", code: "validation_error" }, 422);
        if (body.always !== undefined && typeof body.always !== "boolean") return json({ error: "always: a boolean.", code: "validation_error" }, 422);
        if (body.note !== undefined && body.note !== null && typeof body.note !== "string") return json({ error: "note: a string.", code: "validation_error" }, 422);
        const result = await decide(decideMatch[1]!, decision, {
          ...(body.always === true ? { always: true } : {}),
          ...(typeof body.note === "string" ? { note: body.note } : {}),
        });
        if (!result.ok) {
          const status = result.code === "approval_not_found" ? 404 : 409;
          return json({ error: result.error, code: result.code }, status);
        }
        return json({ approval: publicApproval(result.approval) });
      }
      if (url.pathname === "/api/inbox/butler/approvals/settings" && req.method === "POST") {
        let body: Record<string, unknown>;
        try {
          body = (await req.json()) as Record<string, unknown>;
        } catch {
          return json({ error: "body: a JSON object.", code: "validation_error" }, 422);
        }
        const refused = windowWrite(req, body);
        if (refused) return refused;
        const action = body.action;
        if (action !== "create-requirement" && action !== "launch-session" && action !== "stop-session") {
          return json({ error: "action: create-requirement, launch-session or stop-session.", code: "validation_error" }, 422);
        }
        if (body.mode !== "ask" && body.mode !== "auto") return json({ error: "mode: ask or auto.", code: "validation_error" }, 422);
        setAuto(action, body.mode === "auto");
        return json({ auto: list().auto });
      }
      return null;
    },
  };
}
