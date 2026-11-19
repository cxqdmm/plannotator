/**
 * The requirement detail's embedded session: the Inbox's own conversation, in the
 * workshop's right block. This is the whole data glue — the UI is ThreadPane, untouched.
 *
 * A thread id in, the shared react-query cache fed: `inboxApi.thread` reads it once,
 * `putThread` puts it where every held thread lives, and this hook subscribes WITHOUT
 * useHeldThread's showable gate (a launched thread carries `run`, which that gate hides —
 * the Inbox's own panes bypass it through their pane model; ours has none, and every
 * workshop session is launched). The App's global event pipeline keeps the cache current,
 * so the embedded view is live exactly as the Inbox's own is.
 */
import { useEffect } from 'react';
import { skipToken, useQuery, useQueryClient } from '@tanstack/react-query';
import { inboxApi } from '../api';
import { putThread } from '../data/queries/thread';
import type { HeldThread } from '../data/apply/record';
import { inboxKeys } from '../data/keys';

export function useEmbeddedThread(threadId: string | null) {
  const client = useQueryClient();
  useEffect(() => {
    if (threadId === null) return;
    let alive = true;
    void inboxApi.thread(threadId).then((read) => {
      if (alive) putThread(client, threadId, read);
    }).catch(() => {});
    return () => {
      alive = false;
    };
  }, [threadId, client]);
  const { data } = useQuery<HeldThread>({ queryKey: inboxKeys.thread(threadId ?? ''), queryFn: skipToken, notifyOnChangeProps: ['data'] });
  return threadId === null ? null : data ?? null;
}
