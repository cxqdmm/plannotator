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

/** The whole set (the module's only list read); null when the routes are off or unreachable. */
export async function readRequirements(signal?: AbortSignal): Promise<Requirement[] | null> {
  return (await get<{ requirements: Requirement[] }>('/api/requirements', signal))?.requirements ?? null;
}

export function createRequirement(input: { title: string; priority?: RequirementPriority; notes?: string }): Promise<WriteOutcome<{ requirement: Requirement }>> {
  return write('POST', '/api/requirements', input);
}

export function patchRequirement(id: string, patch: { title?: string; notes?: string; stage?: RequirementStage; priority?: RequirementPriority }): Promise<WriteOutcome<{ requirement: Requirement }>> {
  return write('PATCH', `/api/requirements/${encodeURIComponent(id)}`, patch);
}

export function deleteRequirement(id: string): Promise<WriteOutcome<{ ok: boolean }>> {
  return write('DELETE', `/api/requirements/${encodeURIComponent(id)}`, {});
}

/** One requirement with its history (Wave 2's detail pane reads this). */
export async function readRequirement(id: string, signal?: AbortSignal): Promise<{ requirement: Requirement; events: RequirementEvent[] } | null> {
  return get<{ requirement: Requirement; events: RequirementEvent[] }>(`/api/requirements/${encodeURIComponent(id)}`, signal);
}
