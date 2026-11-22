/**
 * The requirement detail's embedded session, drawn: the Inbox's own ThreadPane, mounted here with the
 * smallest glue its required props ask for. Nothing about the conversation is reimplemented — the pane
 * brings its messages, reply box, question cards and its live self; this wrapper only feeds it the
 * held thread from the shared cache and hands back the few callbacks it insists on.
 */
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ThreadPane } from '../components/Thread';
import type { ThreadPaneProps } from '../components/Thread';
import { putThread } from '../data/queries/thread';
import { keepSavedQuestions } from '../pickQueue';
import { inboxApi } from '../api';
import { useEmbeddedThread } from './embeddedHook';

/** 文件地址（paneProps 的 file 形状）与消息里关联文件引用。 */
type FileAddress = NonNullable<ThreadPaneProps['file']>;
type NamedRef = NonNullable<ThreadPaneProps['namedFile']>;

export function EmbeddedThread({ threadId, fileId = null, artifacts: artifactsFirst = false, onToast, onClose, onChanged }: { threadId: string; fileId?: string | null; artifacts?: boolean; onToast?: (toast: unknown, ms?: number) => void; onClose: () => void; onChanged: () => void }) {
  const client = useQueryClient();
  /** The thread's own Artifacts view (the inbox thread's button, same place, same look). */
  const [artifactsOn, setArtifactsOn] = useState(artifactsFirst);
  const [linksOn, setLinksOn] = useState(false);
  // 受控同步：面板已打开时点产物图标，prop 变化也要切视图（useState 初值只在挂载时取一次）。
  useEffect(() => { setArtifactsOn(artifactsFirst); }, [artifactsFirst]);
  // 打开的文件/关联文件引用：工坊面板没有路由器（收件箱那套 hash/history 帧不搬），
  // 本地 state 就是地址——onOpenFile 写它、file 吃它，查看器由 ThreadPane 自己按 file 渲染。
  // 版本/步骤/关联附件导航只是更新同一块地址；onOpenFile(null) 关闭回到会话。
  const [openFile, setOpenFile] = useState<FileAddress | null>(fileId ? { id: fileId, version: 'current' as const, focus: null } : null);
  const [namedRef, setNamedRef] = useState<NamedRef | null>(null);
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
      // 在工坊里看到即算已看（同收件箱 ThreadSlot 的 onSeen → seenOnSight，走同一个 /seen 端点）：
      // 会话行上的「新消息」标随之消失；列表本身由事件帧刷新，无需额外接线。
      onSeen={(through) => { void inboxApi.seen(threadId, through); }}
      onRunChanged={() => {
        void inboxApi.thread(threadId).then((read) => putThread(client, threadId, read));
      }}
      file={openFile}
      namedFile={namedRef}
      onOpenNamedFile={(ref) => { if (!ref) setOpenFile(null); setNamedRef(ref); }}
      artifacts={artifactsOn}
      onArtifacts={setArtifactsOn}
      links={linksOn}
      onLinks={setLinksOn}
      onOpenFile={(file) => {
        if (!file) { setNamedRef(null); setOpenFile(null); return; }
        // 不带 view 的调用（版本/步骤/关联）沿用当前 view，同收件箱 fileOpener 的 keepView 语义。
        setOpenFile((current) => ({ ...file, view: file.view === undefined ? current?.view ?? null : file.view }) as FileAddress);
      }}
      onOpenGuide={() => undefined}
    />
  );
}
