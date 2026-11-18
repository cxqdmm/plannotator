/**
 * The Requirements panel's records, live, while the module is on. Off,
 * nothing is read: the routes answer 404 then. No stream of its own — the
 * Inbox's one event stream carries `event: requirements`, which App.tsx hands
 * to frames.ts, and a change re-reads the list (useInboxShapes' shape).
 *
 * Writes are optimistic: the list moves at once, the server call follows, and
 * a failure rolls the row back and says why (one line, no dialog).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRequirement, deleteRequirement, patchRequirement, readRequirements } from './api';
import type { Requirement, RequirementPriority, RequirementStage } from '@plannotator/core/requirements-types';

export interface RequirementsState {
  /** Null until read (and while the module is off). */
  requirements: Requirement[] | null;
  refresh: () => void;
  create: (input: { title: string; priority?: RequirementPriority }) => Promise<boolean>;
  patch: (id: string, patch: { title?: string; notes?: string; stage?: RequirementStage; priority?: RequirementPriority }) => Promise<boolean>;
  remove: (id: string) => Promise<boolean>;
  /** The last write that failed (its error text); cleared by the next write or a manual clear. */
  error: string | null;
  clearError: () => void;
}

export function useRequirements(on: boolean, frames: (listener: (ids: string[]) => void) => () => void): RequirementsState {
  const [requirements, setRequirements] = useState<Requirement[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reading = useRef<AbortController | null>(null);

  const refresh = useCallback(() => {
    if (!on) return;
    reading.current?.abort();
    const controller = new AbortController();
    reading.current = controller;
    readRequirements(controller.signal).then((answer) => {
      if (!controller.signal.aborted) setRequirements(answer);
    });
  }, [on]);

  useEffect(() => {
    if (!on) {
      setRequirements(null);
      return;
    }
    refresh();
    const stop = frames(() => {
      // A change re-reads the whole list (the frames say what changed; the
      // set is small and one read keeps every window exact).
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(refresh, 60);
    });
    return () => {
      stop();
      reading.current?.abort();
      if (timer.current) clearTimeout(timer.current);
    };
  }, [on, refresh, frames]);

  /** Apply `change` to the list at once; on failure put the row back and say why. */
  const optimistic = useCallback(
    async (id: string, change: (requirement: Requirement) => Requirement, call: () => Promise<{ ok: boolean; error?: string }>): Promise<boolean> => {
      const before = requirements ?? [];
      const at = before.findIndex((requirement) => requirement.id === id);
      if (at === -1) return false;
      const next = [...before];
      next[at] = change(before[at]!);
      setRequirements(next);
      const outcome = await call();
      if (!outcome.ok) {
        setRequirements(before);
        setError(outcome.error ?? '保存失败');
        return false;
      }
      return true;
    },
    [requirements],
  );

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
    async (id, patch) => optimistic(id, (requirement) => ({ ...requirement, ...patch, updated_at: new Date().toISOString() }), () => patchRequirement(id, patch)),
    [optimistic],
  );

  const remove = useCallback<RequirementsState['remove']>(
    async (id) => {
      const before = requirements ?? [];
      setRequirements(before.filter((requirement) => requirement.id !== id));
      const outcome = await deleteRequirement(id);
      if (!outcome.ok) {
        setRequirements(before);
        setError(outcome.error);
        return false;
      }
      return true;
    },
    [requirements],
  );

  const clearError = useCallback(() => setError(null), []);

  return useMemo(
    () => ({ requirements, refresh, create, patch, remove, error, clearError }),
    [requirements, refresh, create, patch, remove, error, clearError],
  );
}
