/**
 * The requirement detail's embedded session: the Inbox's own conversation, in the
 * workshop's right block. This is the whole data glue — the UI is ThreadPane, untouched.
 *
 * A thread id in, the shared react-query cache fed: `inboxApi.thread` reads it once,
 * `putThread` puts it where every held thread lives, and `useHeldThread` subscribes.
 * The App's global event pipeline (apply/record/drawGap/stream) keeps every cached
 * thread current, so the embedded view is live exactly as the Inbox's own is; a reply
 * sent from here goes through the same send machinery and lands in both views.
 */
import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { inboxApi } from '../api';
import { putThread, useHeldThread } from '../data/queries/thread';

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
  return useHeldThread(threadId);
}
