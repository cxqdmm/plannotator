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

/** 「发起设计文档评审」: opens a gated annotate session on the requirement's design doc; the outcome writes
 * itself back (a deliverable, a say line, and on approval a suggestion), and the event stream refreshes the pane. */
export function startDesignReview(id: string): Promise<WriteOutcome<{ ok: boolean; doc: string }>> {
  return write('POST', `/api/requirements/${encodeURIComponent(id)}/design-review`, {});
}

/** A deliverable's preview: text (markdown/plain) or an image, the person's own window only. */
export function deliverableContent(id: string, deliverableId: string): Promise<{ text?: string; image?: string; binary?: boolean; annotatable?: boolean } | { error: string }> {
  return fetch(`/api/requirements/${encodeURIComponent(id)}/deliverables/${encodeURIComponent(deliverableId)}/content`, { headers: { Accept: 'application/json' }, cache: 'no-store' }).then((response) => response.json());
}

/** 批注: the deliverable's document opens in a plain annotate session; what comes back lands in the history. */
export function annotateDeliverable(id: string, deliverableId: string): Promise<WriteOutcome<{ ok: boolean }>> {
  return write('POST', `/api/requirements/${encodeURIComponent(id)}/deliverables/${encodeURIComponent(deliverableId)}/annotate`, {});
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
