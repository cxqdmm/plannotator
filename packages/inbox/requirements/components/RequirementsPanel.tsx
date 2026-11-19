/**
 * The Workshop (工坊): the Inbox's own shape — a list panel (requirement
 * cards with their sessions as rows, the agent sidebar's pattern) and a
 * right panel that whatever the person picks opens into. No detail page:
 * clicking a session, a deliverable, or the contexts opens its panel
 * beside the list; the list narrows, the panel fills the rest.
 */
import { useEffect, useRef, useState } from 'react';
import { ChatMarkdown } from '@plannotator/ui/components/chat';
import { HostMark, Icon } from '../../icons';
import { SidebarTrigger } from '../../shell/sidebar';
import { subscribeRequirementFrames } from '../frames';
import { addContext, annotateDeliverable, deliverableContent, readRequirement, removeContext } from '../api';
import { inboxApi } from '../../api';
import { EmbeddedThread } from '../EmbeddedThread';
import { putThread } from '../../data/queries/thread';
import { useListModel } from '../../data/queries/list';
import { useQueryClient } from '@tanstack/react-query';
import { rowAgent } from '../../components/InboxList';
import { Tip } from '../../components/Tip';
import { useRequirements } from '../useRequirements';
import { DELIVERABLE_KIND_LABELS, type Deliverable, type Requirement, type RequirementEvent } from '@plannotator/core/requirements-types';

const EVENT_WORDS: Readonly<Record<RequirementEvent['kind'], string>> = {
  created: '创建', stage: '阶段', field: '修改', deleted: '删除', say: '动态', deliverable: '产物', suggestion: '建议', context: '上下文',
};

function timeOf(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** 每个线程的写入会话是否正在跑一轮（inboxApi.sessions 的 per-thread 轻读，写入者优先）。
 *  工坊的会话行据此常驻展示 运行中；null = 连接没说（不显示）。 */
function useThreadBusy(threadIds: readonly string[], on: boolean): Record<string, boolean | null> {
  const [busy, setBusy] = useState<Record<string, boolean | null>>({});
  const key = threadIds.join(',');
  useEffect(() => {
    if (!on || key === '') return;
    let alive = true;
    const read = async () => {
      const ids = key.split(',');
      const reads = await Promise.all(ids.map(async (id) => {
        try {
          const model = await inboxApi.sessions(id);
          const writer = model.sessions.find((s) => s.wrote_thread) ?? model.sessions[0] ?? null;
          return [id, writer ? writer.busy : null] as const;
        } catch {
          return [id, null] as const;
        }
      }));
      if (!alive) return;
      setBusy(Object.fromEntries(reads));
    };
    void read();
    const timer = setInterval(() => void read(), 4000);
    return () => { alive = false; clearInterval(timer); };
  }, [key, on]);
  return busy;
}

/** What the right panel shows. */
type Panel =
  | { k: 'session'; threadId: string }
  | { k: 'contexts'; requirementId: string }
  | { k: 'deliverables'; requirementId: string }
  | { k: 'history'; requirementId: string }
  | null;

export function RequirementsPanel({
  on,
  openThreadId = null,
  onOpenThread,
  onCompose,
}: {
  on: boolean;
  openThreadId?: string | null;
  onOpenThread: (threadId: string) => void;
  onCompose: (requirementId: string, requirementTitle: string, contexts: { id: string; kind: string; name: string; image?: boolean }[]) => void;
}) {
  const { requirements, create, refresh } = useRequirements(on, subscribeRequirementFrames);
  const [draft, setDraft] = useState('');
  const [panel, setPanel] = useState<Panel>(openThreadId !== null ? { k: 'session', threadId: openThreadId } : null);
  const newDialog = useRef<HTMLDialogElement | null>(null);
  const queryClient = useQueryClient();
  const list = useListModel(queryClient);
  const cursor = list?.cursor ?? null;
  useEffect(() => { if (on && cursor !== null) refresh(); /* eslint-disable-next-line */ }, [cursor]);

  const rowsByThread = new Map(
    [...(list?.sections ?? []).flatMap((s) => s.threads), ...(list?.snoozed ?? []), ...(list?.pins ?? [])].map((row) => [row.thread_id, row]),
  );

  // 会话行的工作状态：每个线程的写入会话 busy（轻读，4s 一轮）。
  const threadIds = [...new Set((requirements ?? []).flatMap((r) => r.threads))];
  const threadBusy = useThreadBusy(threadIds, on);

  const submitNew = () => {
    const title = draft.trim();
    if (!title) { newDialog.current?.close(); return; }
    setDraft(''); newDialog.current?.close(); void create({ title });
  };

  return (
    <section className="ib-req-wp" data-requirements-page="" data-panel={panel !== null ? '' : undefined} aria-label="工坊">
      {/* The list panel */}
      <div className="ib-req-wp-list" data-requirements-list="">
        <div className="ib-req-wp-head">
          <SidebarTrigger />
          <h1>工坊</h1>
          <button type="button" className="ib-req-wp-new" onClick={() => { setDraft(''); newDialog.current?.showModal(); }}><Icon name="plus" size={14} /> 新建</button>
        </div>
        <div className="ib-req-wp-cards">
          {(requirements ?? []).map((r) => (
            <ReqCard key={r.id} requirement={r} rowsByThread={rowsByThread} threadBusy={threadBusy} onSession={(tid) => setPanel({ k: 'session', threadId: tid })} onContexts={() => setPanel({ k: 'contexts', requirementId: r.id })} onDeliverables={() => setPanel({ k: 'deliverables', requirementId: r.id })} onHistory={() => setPanel({ k: 'history', requirementId: r.id })} onNewSession={() => onCompose(r.id, r.title, r.contexts)} />
          ))}
          {(requirements ?? []).length === 0 && <p className="ib-req-wp-empty">还没有需求。</p>}
        </div>
      </div>

      {/* The right panel: a session is the product's own ThreadPane (ib-pane) alone — no wrapper, no double chrome. */}
      {panel !== null &&
        (panel.k === 'session' ? (
          <EmbeddedThread threadId={panel.threadId} onClose={() => setPanel(null)} onChanged={() => { void inboxApi.thread(panel.threadId).then((r) => putThread(queryClient, panel.threadId, r)); }} />
        ) : (
          <div className="ib-req-wp-panel">
            <PanelContent panel={panel} requirements={requirements ?? []} rowsByThread={rowsByThread} onClose={() => setPanel(null)} onOpenThread={onOpenThread} queryClient={queryClient} />
          </div>
        ))}

      <dialog ref={newDialog} className="ib-req-new" aria-labelledby="ib-req-new-t" onClose={() => setDraft('')}>
        <form method="dialog" onSubmit={(e) => { e.preventDefault(); submitNew(); }}>
          <h2 id="ib-req-new-t">新建需求</h2>
          <input ref={(n) => { if (n && newDialog.current?.open) queueMicrotask(() => n.focus()); }} className="ib-req-new-input" aria-label="需求标题" placeholder="一句话说清要做什么" value={draft} onChange={(e) => setDraft(e.target.value)} />
          <div className="ib-req-new-act">
            <button type="button" className="ib-btn ib-sm" onClick={() => newDialog.current?.close()}>取消</button>
            <button type="submit" className="ib-btn ib-sm ib-req-new-ok" disabled={!draft.trim()}>创建</button>
          </div>
        </form>
      </dialog>
    </section>
  );
}

/* ── A requirement card: icon + wrapping title, hover actions (out of flow), created
 * time pinned right on row 1, and its sessions as rows INSIDE the card. ── */
function ReqCard({ requirement: r, rowsByThread, threadBusy, onSession, onContexts, onDeliverables, onHistory, onNewSession }: {
  requirement: Requirement;
  rowsByThread: Map<string, unknown>;
  threadBusy: Record<string, boolean | null>;
  onSession: (threadId: string) => void;
  onContexts: () => void;
  onDeliverables: () => void;
  onHistory: () => void;
  onNewSession: () => void;
}) {
  return (
    <div className="ib-req-wcard" data-requirement-id={r.id}>
      <div className="ib-req-wcard-head">
        <span className="ib-req-wcard-ico" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <rect x="4" y="4" width="16" height="16" rx="4.5" />
            <path d="M8 12.2l2.6 2.6L16 9.4" />
          </svg>
        </span>
        <b className="ib-req-wcard-title" dir="auto">{r.title}</b>
        <span className="ib-req-wcard-time" title={timeOf(r.created_at)}>{timeOf(r.created_at)}</span>
      </div>
      {/* 悬停浮现的操作：文档流，标题下方，超出换行；不可见不占空间 */}
      <div className="ib-req-wcard-acts">
        <button type="button" onClick={onNewSession}><Icon name="plus" size={12} /> 开启新会话</button>
        <button type="button" onClick={onContexts}><Icon name="pen" size={12} /> 上下文{r.contexts.length > 0 ? ` ${r.contexts.length}` : ''}</button>
        <button type="button" onClick={onDeliverables}><Icon name="clip" size={12} /> 产物{r.deliverables.length > 0 ? ` ${r.deliverables.length}` : ''}</button>
        <button type="button" onClick={onHistory}><Icon name="clock" size={12} /> 历史</button>
      </div>
      {/* 会话就在卡片里：agent 侧栏的行模式 */}
      <div className="ib-req-wcard-sessions">
        {r.threads.map((tid) => {
          const row = rowsByThread.get(tid) as { subject?: string | null; section?: string } | undefined;
          const agent = row ? rowAgent(row as never) : null;
          const waiting = row?.section === 'stopped' || row?.section === 'holding' || row?.section === 'waiting';
          const subject = (row?.subject?.trim() ? row.subject : null) ?? '会话';
          return (
            <button key={tid} type="button" className="ib-req-wcard-sess" onClick={() => onSession(tid)}>
              <span className="ib-req-wcard-sess-mk">{agent?.kind === 'agent' ? <HostMark host={agent.host} /> : <Icon name="comment" size={14} />}</span>
              <span className="ib-req-wcard-sess-t" dir="auto">{subject}</span>
              {threadBusy[tid] === true && (
                <span className="ib-req-wcard-live">
                  <span className="ib-spin" aria-hidden="true" /> 运行中
                </span>
              )}
              {waiting && (
                <span className="ib-req-wcard-hold">
                  <Icon name="clock" size={11} /> 等你回复
                </span>
              )}
            </button>
          );
        })}
        {r.threads.length === 0 && <p className="ib-req-wcard-nosess">还没有会话；悬停需求，点"开启新会话"。</p>}
      </div>
    </div>
  );
}

/* ── 上下文管理：列表 + 添加（链接 / 文本 / 上传文件）── */
const CONTEXT_KIND_ICON: Record<string, string> = { link: 'external', text: 'doc', upload: 'clip' };
const CONTEXT_KIND_LABEL: Record<string, string> = { link: '链接', text: '文本', upload: '文件' };
const CONTEXT_KIND_HELP: Record<string, string> = {
  link: '给一个网址，会话里能直接引用。',
  text: '粘贴一段文字，保存为文件挂在需求上。',
  upload: '选一个本地文件，原样挂在需求上。',
};

function ContextsBody({ requirementId, contexts, onChanged, onError }: {
  requirementId: string;
  contexts: { id: string; kind: string; name: string; image?: boolean }[];
  onChanged: () => void;
  onError: (message: string | null) => void;
}) {
  const [tab, setTab] = useState<'link' | 'text' | 'upload'>('link');
  const [name, setName] = useState('');
  const [ref, setRef] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState<File | null>(null);

  const run = async (op: () => Promise<{ ok: boolean; error?: string }>) => {
    setBusy(true);
    onError(null);
    const outcome = await op();
    setBusy(false);
    if (!outcome.ok) { onError(outcome.error ?? '写入失败。'); return; }
    setName(''); setRef(''); setText(''); setFile(null);
    onChanged();
  };

  const pickFile = (input: HTMLInputElement | null) => {
    const f = input?.files?.[0];
    if (!f) { setFile(null); return; }
    setFile(f);
    if (!name.trim()) setName(f.name);
  };

  const submit = () => {
    const n = name.trim();
    if (tab === 'link') {
      const address = ref.trim();
      if (!n || !address) return;
      void run(() => addContext(requirementId, { kind: 'link', name: n, ref: address }) as never);
    } else if (tab === 'text') {
      if (!n || !text.trim()) return;
      void run(() => addContext(requirementId, { kind: 'text', name: n, text }) as never);
    } else if (file) {
      const reader = new FileReader();
      reader.onload = () => {
        const data = String(reader.result ?? '').replace(/^data:[^;]*;base64,/, '');
        void run(() => addContext(requirementId, { kind: 'upload', name: file.name, data }) as never);
      };
      reader.readAsDataURL(file);
    }
  };

  const ready = !!name.trim() && (tab === 'link' ? !!ref.trim() : tab === 'text' ? !!text.trim() : !!file);

  return (
    <div className="ib-req-wp-panel-body ib-req-ctx">
      <section className="ib-req-ctx-sec">
        <h3 className="ib-req-ctx-h">已有 {contexts.length > 0 ? `· ${contexts.length}` : ''}</h3>
        {contexts.length === 0 ? (
          <p className="ib-req-ctx-empty">还没有上下文。给这个需求补上链接、文本或文件，开启新会话时会带上。</p>
        ) : (
          <ul className="ib-req-ctx-list">
            {contexts.map((c) => (
              <li key={c.id} className="ib-req-ctx-row">
                <span className="ib-req-ctx-ico"><Icon name={(CONTEXT_KIND_ICON[c.kind] ?? 'doc') as never} size={14} /></span>
                <b className="ib-req-ctx-name" dir="auto">{c.name}</b>
                <span className="ib-req-ctx-kind">{CONTEXT_KIND_LABEL[c.kind] ?? c.kind}</span>
                <button type="button" className="ib-req-ctx-del" aria-label={`删除 ${c.name}`} disabled={busy} onClick={() => void run(() => removeContext(requirementId, c.id) as never)}>
                  <Icon name="x" size={12} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="ib-req-ctx-sec ib-req-ctx-add">
        <h3 className="ib-req-ctx-h">添加上下文</h3>
        <div className="ib-req-ctx-kinds" role="tablist" aria-label="上下文类型">
          {(['link', 'text', 'upload'] as const).map((k) => (
            <Tip key={k} content={CONTEXT_KIND_LABEL[k]}>
              <button type="button" role="tab" aria-selected={tab === k} className={`ib-req-ctx-kindbtn${tab === k ? ' on' : ''}`} onClick={() => setTab(k)}>
                <Icon name={CONTEXT_KIND_ICON[k] as never} size={16} />
              </button>
            </Tip>
          ))}
        </div>
        <p className="ib-req-ctx-help">{CONTEXT_KIND_HELP[tab]}</p>
        {tab !== 'upload' && (
          <input className="ib-req-ctx-input" placeholder="名称" value={name} onChange={(e) => setName(e.target.value)} aria-label="名称" />
        )}
        {tab === 'link' && <input className="ib-req-ctx-input" placeholder="https://… 链接地址" value={ref} onChange={(e) => setRef(e.target.value)} aria-label="链接地址" />}
        {tab === 'text' && <textarea className="ib-req-ctx-text" placeholder="粘贴文本内容" value={text} onChange={(e) => setText(e.target.value)} rows={6} aria-label="文本内容" />}
        {tab === 'upload' && (
          <label className="ib-req-ctx-file">
            <input type="file" onChange={(e) => pickFile(e.currentTarget)} aria-label="选择文件" />
            <Icon name="clip" size={15} />
            {file ? <b>{file.name}</b> : <span>选择文件…</span>}
          </label>
        )}
        <button type="button" className="ib-req-ctx-submit" disabled={busy || !ready} onClick={submit}>
          <Icon name="plus" size={14} /> 添加{tab === 'upload' ? '文件' : tab === 'link' ? '链接' : '文本'}
        </button>
      </section>
    </div>
  );
}

/* ── The right panel's content ── */
function PanelContent({ panel, requirements, rowsByThread, onClose, onOpenThread, queryClient }: {
  panel: NonNullable<Panel>;
  requirements: Requirement[];
  rowsByThread: Map<string, unknown>;
  onClose: () => void;
  onOpenThread: (threadId: string) => void;
  queryClient: import('@tanstack/react-query').QueryClient;
}) {
  const [error, setError] = useState<string | null>(null);
  const [annotating, setAnnotating] = useState<string | null>(null);
  /** 上下文增删后 +1，重读详情。 */
  const [bump, setBump] = useState(0);
  const [dlvPreviews, setDlvPreviews] = useState<Record<string, 'loading' | { text?: string; image?: string; binary?: boolean; session?: string; html?: boolean } | { error: string }>>({});
  const [detail, setDetail] = useState<{ requirement: Requirement; events: RequirementEvent[] } | null>(null);
  const reload = useRef<AbortController | null>(null);

  const reqId = panel.k === 'session' ? null : panel.requirementId;
  const req = reqId !== null ? requirements.find((r) => r.id === reqId) ?? null : null;

  useEffect(() => {
    if (reqId === null) return;
    reload.current?.abort();
    const c = new AbortController(); reload.current = c;
    void readRequirement(reqId, c.signal).then((a) => { if (!c.signal.aborted) setDetail(a); });
    return () => { c.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reqId, bump]);

  useEffect(() => {
    for (const d of detail?.requirement.deliverables ?? []) {
      if (dlvPreviews[d.id] !== undefined) continue;
      setDlvPreviews((h) => ({ ...h, [d.id]: 'loading' }));
      void deliverableContent(reqId!, d.id).then((a) => setDlvPreviews((h) => ({ ...h, [d.id]: a as never })));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail]);

  const top = (title: string) => (
    <div className="ib-req-wp-panel-top">
      <span className="ib-req-wp-panel-title" dir="auto">{title}</span>
      <button type="button" className="ib-req-wp-panel-x" aria-label="关闭" onClick={onClose}><Icon name="x" size={16} /></button>
    </div>
  );

  if (panel.k === 'contexts') {
    return (
      <>
        {top(`上下文 · ${req?.title ?? ''}`)}
        <ContextsBody requirementId={panel.requirementId} contexts={detail?.requirement.contexts ?? req?.contexts ?? []} onChanged={() => setBump(b => b + 1)} onError={setError} />
      </>
    );
  }

  if (panel.k === 'deliverables') {
    return (
      <>
        {top(`产物 · ${req?.title ?? ''}`)}
        <div className="ib-req-wp-panel-body">
          {(detail?.requirement.deliverables ?? []).length === 0 && <p className="ib-req-wp-panel-empty">还没有产物。</p>}
          {(detail?.requirement.deliverables ?? []).map((d: Deliverable) => {
            const c = dlvPreviews[d.id];
            return (
              <div key={d.id} className="ib-req-wp-dlv">
                <div className="ib-req-wp-dlv-row"><span className="ib-req-wp-dlv-kind">{DELIVERABLE_KIND_LABELS[d.kind]}</span><b dir="auto">{d.title ?? d.ref.split('/').pop() ?? d.ref}</b><small>{timeOf(d.created_at)}</small></div>
                {c === 'loading' || c === undefined ? <p className="ib-req-wp-panel-empty">读取中…</p>
                  : 'error' in c ? <p className="ib-req-wp-panel-empty">{c.error}</p>
                  : c.image ? <img src={c.image} alt="预览" style={{ maxWidth: '100%', borderRadius: 6 }} />
                  : c.html ? <iframe sandbox="allow-scripts" srcDoc={c.text} title="预览" style={{ width: '100%', height: 300, border: 0, borderRadius: 6 }} />
                  : <div dir="auto" style={{ fontSize: 12.5, lineHeight: 1.6 }}><ChatMarkdown text={c.text ?? ''} role="assistant" messageId={`dlv-${d.id}`} /></div>}
                {/\.(md|markdown|txt|html?)$/i.test(d.ref) && (
                  <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '4px 10px' }}>
                    <button type="button" className="ib-btn ib-sm" disabled={annotating === d.id} onClick={() => { setAnnotating(d.id); void annotateDeliverable(reqId!, d.id).then((o) => { setAnnotating(null); if (!o.ok) setError(o.error); }); }}><Icon name="pen" size={12} /> 批注</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </>
    );
  }

  // history
  return (
    <>
      {top(`历史 · ${req?.title ?? ''}`)}
      <div className="ib-req-wp-panel-body">
        <ol className="ib-req-wp-hist">
          {[...(detail?.events ?? [])].reverse().slice(0, 20).map((e) => (
            <li key={e.id}><span className="t">{timeOf(e.at)}</span><span className="w">{EVENT_WORDS[e.kind] ?? e.kind}</span><span className="n">{(e.note ?? '').length > 80 ? (e.note ?? '').slice(0, 80) + '…' : e.note ?? e.field ?? ''}</span></li>
          ))}
        </ol>
      </div>
      {error && <p className="ib-error" role="alert">{error}</p>}
    </>
  );
}
