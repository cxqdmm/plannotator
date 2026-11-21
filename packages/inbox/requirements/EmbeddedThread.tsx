/**
 * The requirement detail's embedded session, drawn: the Inbox's own ThreadPane, mounted here with the
 * smallest glue its required props ask for. Nothing about the conversation is reimplemented — the pane
 * brings its messages, reply box, question cards and its live self; this wrapper only feeds it the
 * held thread from the shared cache and hands back the few callbacks it insists on.
 */
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ThreadPane } from '../components/Thread';
import { putThread } from '../data/queries/thread';
import { keepSavedQuestions } from '../pickQueue';
import { inboxApi } from '../api';
import { useEmbeddedThread } from './embeddedHook';

export function EmbeddedThread({ threadId, fileId = null, artifacts: artifactsFirst = false, onToast, onClose, onChanged }: { threadId: string; fileId?: string | null; artifacts?: boolean; onToast?: (toast: unknown, ms?: number) => void; onClose: () => void; onChanged: () => void }) {
  const client = useQueryClient();
  /** The thread's own Artifacts view (the inbox thread's button, same place, same look). */
  const [artifactsOn, setArtifactsOn] = useState(artifactsFirst);
  const [linksOn, setLinksOn] = useState(false);
  // 受控同步：面板已打开时点产物图标，prop 变化也要切视图（useState 初值只在挂载时取一次）。
  useEffect(() => { setArtifactsOn(artifactsFirst); }, [artifactsFirst]);
  const held = useEmbeddedThread(threadId);

  if (held === null) {
    return (
      <div className="ib-req-viewbody">
        <p aria-busy="true">读取会话中…</p>
      </div>
    );
  }

  return (
    <ThreadPane
      thread={{ ...held.thread, stream: (held.thread as { stream?: true }).stream ?? undefined } as never}
      sent={null}
      onClose={onClose}
      onChanged={async () => {
        const read = await inboxApi.thread(threadId);
        putThread(client, threadId, read);
        onChanged();
      }}
      onQuestions={(messageId, questions) => {
        // The pane hands back the message's questions as picked: hold them in the cache, as the Inbox does.
        const saved = new Map(questions.map((question) => [`${messageId}/${question.key}`, question]));
        putThread(client, threadId, { ...held, thread: keepSavedQuestions(held.thread, saved) });
      }}
      run={held.run ?? null}
      attachCommand={held.attach_command ?? null}
      onToast={onToast as never}
      onRunChanged={() => {
        void inboxApi.thread(threadId).then((read) => putThread(client, threadId, read));
      }}
      file={fileId ? { id: fileId, version: 'current' as const, focus: null } : null}
      artifacts={artifactsOn}
      onArtifacts={setArtifactsOn}
      links={linksOn}
      onLinks={setLinksOn}
      onOpenFile={() => undefined}
      onOpenGuide={() => undefined}
    />
  );
}
