/**
 * The Requirements panel's records, live, while the module is on. Off,
 * nothing is read: the routes answer 404 then. No stream of its own — the
 * Inbox's one event stream carries `event: requirements`, which App.tsx hands
 * to frames.ts, and a change re-reads both pages (useInboxShapes' shape).
 *
 * Writes are optimistic: the board moves at once, the server call follows,
 * and a failure rolls the card back and says why (one line, no dialog).
 * 归档 moves a card between the two pages; after it settles both pages are
 * re-read, so the counts and the archived view stay exact.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRequirement, patchRequirement, readRequirements } from './api';
import type { Requirement, RequirementPriority, RequirementStage } from '@plannotator/core/requirements-types';

export interface RequirementsState {
  /** The active board. Null until read (and while the module is off). */
  requirements: Requirement[] | null;
  /** The archived page. Null until read. */
  archived: Requirement[] | null;
  /** How many are archived (the board's 已归档 link). */
  archivedCount: number;
  refresh: () => void;
  create: (input: { title: string; priority?: RequirementPriority }) => Promise<boolean>;
  patch: (id: string, patch: { title?: string; notes?: string; stage?: RequirementStage; priority?: RequirementPriority; archived?: boolean }) => Promise<boolean>;
  /** The last write that failed (its error text); cleared by the next write or a manual clear. */
  error: string | null;
  clearError: () => void;
}

export function useRequirements(on: boolean, frames: (listener: (ids: string[]) => void) => () => void): RequirementsState {
  const [requirements, setRequirements] = useState<Requirement[] | null>(null);
  const [archived, setArchived] = useState<Requirement[] | null>(null);
  const [archivedCount, setArchivedCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reading = useRef<AbortController | null>(null);

  const refresh = useCallback(() => {
    if (!on) return;
    reading.current?.abort();
    const controller = new AbortController();
    reading.current = controller;
    void readRequirements(controller.signal).then((page) => {
      if (controller.signal.aborted) return;
      setRequirements(page?.requirements ?? null);
      setArchivedCount(page?.archived ?? 0);
    });
    void readRequirements(controller.signal, true).then((page) => {
      if (!controller.signal.aborted) setArchived(page?.requirements ?? null);
    });
  }, [on]);

  useEffect(() => {
    if (!on) {
      setRequirements(null);
      setArchived(null);
      return;
    }
    refresh();
    const stop = frames(() => {
      // A change re-reads both pages (the frames say what changed; the set is
      // small and one read keeps every window exact).
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(refresh, 60);
    });
    return () => {
      stop();
      reading.current?.abort();
      if (timer.current) clearTimeout(timer.current);
    };
  }, [on, refresh, frames]);

  const create = useCallback(
    async (input: { title: string; priority?: RequirementPriority }): Promise<boolean> => {
      const outcome = await createRequirement(input);
      if (!outcome.ok) {
        setError(outcome.error);
        return false;
      }
      setRequirements((current) => [outcome.answer.requirement, ...(current ?? [])]);
      return true;
    },
    [],
  );

  const patch = useCallback<RequirementsState['patch']>(
    async (id, patchIn) => {
      const activeBefore = requirements ?? [];
      const archivedBefore = archived ?? [];
      const wasActive = activeBefore.some((requirement) => requirement.id === id);
      const wasArchived = archivedBefore.some((requirement) => requirement.id === id);
      if (!wasActive && !wasArchived) return false;
      const before = (wasActive ? activeBefore : archivedBefore).find((requirement) => requirement.id === id)!;
      const after: Requirement = {
        ...before,
        ...patchIn,
        archived_at: patchIn.archived === undefined ? before.archived_at : patchIn.archived ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      };
      const inPlace = (list: Requirement[]) => list.map((requirement) => (requirement.id === id ? after : requirement));
      // The card stays where it was unless 归档 moves it between the two pages.
      const activeNext = after.archived_at == null ? (before.archived_at == null ? inPlace(activeBefore) : [...activeBefore, after]) : activeBefore.filter((requirement) => requirement.id !== id);
      const archivedNext = after.archived_at != null ? (before.archived_at != null ? inPlace(archivedBefore) : [after, ...archivedBefore]) : archivedBefore.filter((requirement) => requirement.id !== id);
      setRequirements(activeNext);
      setArchived(archivedNext);
      const outcome = await patchRequirement(id, patchIn);
      if (!outcome.ok) {
        setRequirements(activeBefore);
        setArchived(archivedBefore);
        setError(outcome.error ?? '保存失败');
        return false;
      }
      // The server's own record, when the answer carries it, replaces the optimistic one (the write
      // may have normalized a value). 归档 re-reads both pages: the counts and the other page move too.
      if (outcome.answer.requirement) {
        const settled = outcome.answer.requirement;
        setRequirements((current) => (current ?? []).map((requirement) => (requirement.id === id ? settled : requirement)));
        setArchived((current) => (current ?? []).map((requirement) => (requirement.id === id ? settled : requirement)));
      }
      if (patchIn.archived !== undefined) refresh();
      return true;
    },
    [requirements, archived, refresh],
  );

  const clearError = useCallback(() => setError(null), []);

  return useMemo(
    () => ({ requirements, archived, archivedCount, refresh, create, patch, error, clearError }),
    [requirements, archived, archivedCount, refresh, create, patch, error, clearError],
  );
}
