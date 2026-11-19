/**
 * The requirement detail's embedded session, drawn: the Inbox's own ThreadPane, mounted here with the
 * smallest glue its required props ask for. Nothing about the conversation is reimplemented — the pane
 * brings its messages, reply box, question cards and its live self; this wrapper only feeds it the
 * held thread from the shared cache and hands back the few callbacks it insists on.
 */
import { useQueryClient } from '@tanstack/react-query';
import { ThreadPane } from '../components/Thread';
import { putThread } from '../data/queries/thread';
import { keepSavedQuestions } from '../pickQueue';
import { inboxApi } from '../api';
import { useEmbeddedThread } from './embeddedHook';

export function EmbeddedThread({ threadId, onClose, onChanged }: { threadId: string; onClose: () => void; onChanged: () => void }) {
  const client = useQueryClient();
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
      onRunChanged={() => {
        void inboxApi.thread(threadId).then((read) => putThread(client, threadId, read));
      }}
      file={null}
      onOpenFile={() => undefined}
      onOpenGuide={() => undefined}
    />
  );
}
