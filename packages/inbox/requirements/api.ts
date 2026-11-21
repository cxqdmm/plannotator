/**
 * The Requirements panel's client for its own routes (packages/server/
 * requirements.ts). Same origin; writes carry the page's serverSession
 * (api.ts's rule), so a tab left open on an older Inbox gets a 409 instead of
 * writing into a store it did not read. A failed read answers null: the panel
 * draws its not-there state rather than an error wall.
 */
import { pageServerSession } from '../api';
import type { Requirement, RequirementEvent, RequirementPriority, RequirementStage } from '@plannotator/core/requirements-types';

async function get<T>(path: string, signal?: AbortSignal): Promise<T | null> {
  try {
    const response = await fetch(path, { headers: { Accept: 'application/json' }, cache: 'no-store', signal });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

export type WriteOutcome<T> = { ok: true; answer: T } | { ok: false; error: string };

async function write<T>(method: 'POST' | 'PATCH' | 'DELETE', path: string, body: Record<string, unknown>): Promise<WriteOutcome<T>> {
  const session = pageServerSession();
  try {
    const response = await fetch(path, {
      method,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(session ? { ...body, serverSession: session } : body),
    });
    const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) return { ok: false, error: typeof data.error === 'string' ? data.error : `HTTP ${response.status}` };
    return { ok: true, answer: data as T };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** One page of the set: the active board, or the archived one (`archived: 1`); `archived` is how many are archived. */
export interface RequirementsPage {
  requirements: Requirement[];
  archived: number;
}

/** The board's page (the module's only list read); null when the routes are off or unreachable. */
export async function readRequirements(signal?: AbortSignal, archived = false): Promise<RequirementsPage | null> {
  return get<RequirementsPage>(archived ? '/api/requirements?archived=1' : '/api/requirements', signal);
}

export function createRequirement(input: { title: string; priority?: RequirementPriority; notes?: string }): Promise<WriteOutcome<{ requirement: Requirement }>> {
  return write('POST', '/api/requirements', input);
}

export function patchRequirement(id: string, patch: { title?: string; notes?: string; stage?: RequirementStage; priority?: RequirementPriority; archived?: boolean; threads?: string[] }): Promise<WriteOutcome<{ requirement: Requirement }>> {
  return write('PATCH', `/api/requirements/${encodeURIComponent(id)}`, patch);
}

/** One requirement with its history (Wave 2's detail pane reads this). */
export async function readRequirement(id: string, signal?: AbortSignal): Promise<{ requirement: Requirement; events: RequirementEvent[]; card?: string } | null> {
  return get<{ requirement: Requirement; events: RequirementEvent[] }>(`/api/requirements/${encodeURIComponent(id)}`, signal);
}

export function deliverRequirement(id: string, input: { kind: string; ref: string; title?: string }): Promise<WriteOutcome<{ deliverable: unknown }>> {
  return write('POST', `/api/requirements/${encodeURIComponent(id)}/deliverables`, input);
}

export function removeDeliverable(id: string, deliverableId: string): Promise<WriteOutcome<{ ok: boolean }>> {
  return write('DELETE', `/api/requirements/${encodeURIComponent(id)}/deliverables/${encodeURIComponent(deliverableId)}`, {});
}

export function adoptSuggestion(id: string, suggestionId: string): Promise<WriteOutcome<{ requirement: Requirement }>> {
  return write('POST', `/api/requirements/${encodeURIComponent(id)}/suggestions/${encodeURIComponent(suggestionId)}/adopt`, {});
}

export function dismissSuggestion(id: string, suggestionId: string): Promise<WriteOutcome<{ ok: boolean }>> {
  return write('DELETE', `/api/requirements/${encodeURIComponent(id)}/suggestions/${encodeURIComponent(suggestionId)}`, {});
}

/** A deliverable's preview: text (markdown/plain) or an image, the person's own window only. */
export function deliverableContent(id: string, deliverableId: string): Promise<{ text?: string; image?: string; binary?: boolean; annotatable?: boolean } | { error: string }> {
  return fetch(`/api/requirements/${encodeURIComponent(id)}/deliverables/${encodeURIComponent(deliverableId)}/content`, { headers: { Accept: 'application/json' }, cache: 'no-store' }).then((response) => response.json());
}

/** 批注: the deliverable's document opens in a plain annotate session; what comes back lands in the history. */
export function annotateDeliverable(id: string, deliverableId: string): Promise<WriteOutcome<{ ok: boolean; url?: string }>> {
  return write('POST', `/api/requirements/${encodeURIComponent(id)}/deliverables/${encodeURIComponent(deliverableId)}/annotate`, {});
}

/** 归档需求：退场并释放全部会话（线程解除挂载，回到收件箱本身）。 */
/** 手动代码评审（工坊入口）：按该需求会话的项目起一个常驻评审页。 */
export async function startCodeReview(id: string): Promise<WriteOutcome<{ url: string }>> {
  return write('POST', `/api/requirements/${encodeURIComponent(id)}/code-review`, {});
}
export function archiveRequirement(id: string): Promise<WriteOutcome<{ ok: boolean; released: number }>> {
  return write('POST', `/api/requirements/${encodeURIComponent(id)}/archive`, {});
}

/** 把线程挂到需求（开启新会话发送即调）：读现状合并后 PATCH，避免整组替换丢掉别的线程。 */
export async function linkThreadRequirement(id: string, threadId: string): Promise<WriteOutcome<{ requirement: unknown }>> {
  const read = await readRequirement(id);
  const held = read?.requirement.threads ?? [];
  if (held.includes(threadId)) return { ok: true, answer: { requirement: null } };
  return patchRequirement(id, { threads: [...held, threadId] });
}

/** 需求上下文: a link, pasted text (which becomes a file), or an uploaded file (base64). */
export function addContext(id: string, input: { kind: 'link'; name: string; ref: string } | { kind: 'text'; name: string; text: string } | { kind: 'upload'; name: string; data: string }): Promise<WriteOutcome<{ context: unknown }>> {
  return write('POST', `/api/requirements/${encodeURIComponent(id)}/contexts`, input as unknown as Record<string, unknown>);
}

export function removeContext(id: string, contextId: string): Promise<WriteOutcome<{ ok: boolean }>> {
  return write('DELETE', `/api/requirements/${encodeURIComponent(id)}/contexts/${encodeURIComponent(contextId)}`, {});
}

/** A context's own preview (the person's window only): text, an image, or a link's URL. */
export function contextContent(id: string, contextId: string): Promise<{ text?: string; image?: string; link?: string; html?: boolean } | { error: string }> {
  return fetch(`/api/requirements/${encodeURIComponent(id)}/contexts/${encodeURIComponent(contextId)}/content`, { headers: { Accept: 'application/json' }, cache: 'no-store' }).then((response) => response.json());
}

/** 修改上下文: rename (all kinds), a link's address, or a text file's content (rewritten in the requirement's library). */
export function patchContext(id: string, contextId: string, patch: { name?: string; ref?: string; text?: string }): Promise<WriteOutcome<{ context: unknown }>> {
  return write('PATCH', `/api/requirements/${encodeURIComponent(id)}/contexts/${encodeURIComponent(contextId)}`, patch as unknown as Record<string, unknown>);
}

/** 去评审 (stage-auto-design §2): the design doc opens in a gated annotate; the verdict moves the stage and
 *  tells the session (approved → 需求开发; annotated → back to 需求设计 with the notes). */
export function reviewDeliverable(id: string, deliverableId: string): Promise<WriteOutcome<{ ok: boolean; doc?: string; url?: string }>> {
  return write('POST', `/api/requirements/${encodeURIComponent(id)}/deliverables/${encodeURIComponent(deliverableId)}/review`, {});
}
