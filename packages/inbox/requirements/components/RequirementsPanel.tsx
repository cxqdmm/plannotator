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
import { addContext, annotateDeliverable, archiveRequirement, readRequirement, removeContext, reviewDeliverable } from '../api';
import { inboxApi } from '../../api';
import { EmbeddedThread } from '../EmbeddedThread';
import { putThread } from '../../data/queries/thread';
import { useListModel } from '../../data/queries/list';
import { useQueryClient } from '@tanstack/react-query';
import { rowAgent } from '../../components/InboxList';
import { Tip } from '../../components/Tip';
import { Menu } from '@base-ui/react/menu';
import { useRequirements } from '../useRequirements';
import { DELIVERABLE_KIND_LABELS, requirementStageLabel, type Requirement, type RequirementEvent } from '@plannotator/core/requirements-types';

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
  | { k: 'session'; threadId: string; fileId?: string | null; artifacts?: boolean }
  | { k: 'contexts'; requirementId: string }
  | { k: 'history'; requirementId: string }
  | null;

export function RequirementsPanel({
  on,
  openThreadId = null,
  onOpenThread,
  onCompose,
  onToast,
}: {
  on: boolean;
  openThreadId?: string | null;
  onOpenThread: (threadId: string) => void;
  onCompose: (requirementId: string, requirementTitle: string, contexts: { id: string; kind: string; name: string; image?: boolean }[]) => void;
  onToast: (toast: unknown, ms?: number) => void;
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
            <ReqCard key={r.id} requirement={r} rowsByThread={rowsByThread} threadBusy={threadBusy} onSession={(tid) => setPanel({ k: 'session', threadId: tid })} onContexts={() => setPanel({ k: 'contexts', requirementId: r.id })} onHistory={() => setPanel({ k: 'history', requirementId: r.id })} onNewSession={() => onCompose(r.id, r.title, r.contexts)} onToast={onToast} onReview={(reqId, dlvId) => {
                  // 评审现在总是自起门控会话（子进程自己开浏览器）；只有复用路径带 url 才在这里导航。
                  void reviewDeliverable(reqId, dlvId).then((o) => {
                    if (!o.ok) { onToast({ icon: 'excl', lead: `审阅没能打开：${o.error}`, wrap: true }); return; }
                    if (o.answer.url) window.open(o.answer.url, '_blank', 'noreferrer');
                  });
                }} />
          ))}
          {(requirements ?? []).length === 0 && <p className="ib-req-wp-empty">还没有需求。</p>}
        </div>
      </div>

      {/* The right panel: a session is the product's own ThreadPane (ib-pane) alone — no wrapper, no double chrome. */}
      {panel !== null &&
        (panel.k === 'session' ? (
          <EmbeddedThread threadId={panel.threadId} fileId={panel.fileId ?? null} artifacts={panel.artifacts ?? false} onToast={onToast} onClose={() => setPanel(null)} onChanged={() => { void inboxApi.thread(panel.threadId).then((r) => putThread(queryClient, panel.threadId, r)); }} />
        ) : (
          <div className="ib-req-wp-panel">
            <PanelContent panel={panel} requirements={requirements ?? []} rowsByThread={rowsByThread} onClose={() => setPanel(null)} onOpenThread={onOpenThread} queryClient={queryClient} onOpenSessionFile={(threadId, fileId) => setPanel({ k: 'session', threadId, fileId })} onToast={onToast} onReview={(reqId, dlvId) => {
                  // 评审现在总是自起门控会话（子进程自己开浏览器）；只有复用路径带 url 才在这里导航。
                  void reviewDeliverable(reqId, dlvId).then((o) => {
                    if (!o.ok) { onToast({ icon: 'excl', lead: `审阅没能打开：${o.error}`, wrap: true }); return; }
                    if (o.answer.url) window.open(o.answer.url, '_blank', 'noreferrer');
                  });
                }} />
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
function ReqCard({ requirement: r, rowsByThread, threadBusy, onSession, onContexts, onHistory, onNewSession, onToast, onReview }: {
  requirement: Requirement;
  rowsByThread: Map<string, unknown>;
  threadBusy: Record<string, boolean | null>;
  onSession: (threadId: string) => void;
  onContexts: () => void;
  onHistory: () => void;
  onNewSession: () => void;
  onToast: (toast: unknown, ms?: number) => void;
  onReview: (requirementId: string, deliverableId: string) => void;
}) {
  return (
    <div className="ib-req-wcard" data-requirement-id={r.id}>
      <div className="ib-req-wcard-head">
        <b className="ib-req-wcard-title" dir="auto">{r.title}</b>
        {/* 常驻图标操作（气泡提示名字与数量）；窄面板下随标题换行、右对齐 */}
        <div className="ib-req-wcard-acts">
          <Tip content={`开启新会话${r.threads.length > 0 ? `（已有 ${r.threads.length} 个）` : ''}`}>
            <button type="button" className="ib-req-wact" onClick={onNewSession} aria-label="开启新会话"><Icon name="compose" size={15} /></button>
          </Tip>
          <Tip content="历史">
            <button type="button" className="ib-req-wact" onClick={onHistory} aria-label="历史"><Icon name="clock" size={15} /></button>
          </Tip>
          {/* ⋯：次要操作收进菜单（样式/交互对齐会话面板的三点菜单） */}
          <Menu.Root modal={false}>
            <Tip content="更多">
              <Menu.Trigger className="ib-req-wact" aria-label="更多操作" data-req-more="">
                <Icon name="dots" size={15} />
              </Menu.Trigger>
            </Tip>
            <Menu.Portal>
              <Menu.Positioner className="ib-pm-pos" side="bottom" align="end" sideOffset={4}>
                <Menu.Popup className="ib-pm" aria-label={`需求「${r.title}」的操作`}>
                  <Menu.Item className="ib-pmi" label="上下文" onClick={onContexts} data-req-menu="contexts">
                    <Icon name="book" size={14} /> 上下文（{r.contexts.length}）
                  </Menu.Item>
                  <Menu.Separator className="ib-pm-sep" />
                  <Menu.Item className="ib-pmi" label="归档需求" onClick={() => { void archiveRequirement(r.id).then((o) => { if (!o.ok) onToast({ icon: 'excl', lead: `归档失败：${o.error}`, wrap: true }); }); }} data-req-menu="archive">
                    <Icon name="archive" size={14} /> 归档（释放全部会话）
                  </Menu.Item>
                </Menu.Popup>
              </Menu.Positioner>
            </Menu.Portal>
          </Menu.Root>
        </div>
        <span className="ib-req-wcard-time" title={timeOf(r.created_at)}>{timeOf(r.created_at)}</span>
      </div>
      {/* 会话就在卡片里：agent 侧栏的行模式 */}
      <div className="ib-req-wcard-sessions">
        {r.threads.map((tid) => {
          const row = rowsByThread.get(tid) as { subject?: string | null; section?: string } | undefined;
          const agent = row ? rowAgent(row as never) : null;
          const waiting = row?.section === 'stopped' || row?.section === 'holding' || row?.section === 'waiting';
          const subject = (row?.subject?.trim() ? row.subject : null) ?? '会话';
          return (
            <div key={tid} role="button" tabIndex={0} className="ib-req-wcard-sess" onClick={() => onSession(tid)} onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); onSession(tid); } }}>
              <span className={`ib-req-wcard-sess-mk${threadBusy[tid] === true ? ' running' : ''}`}>{agent?.kind === 'agent' ? <HostMark host={agent.host} /> : <Icon name="comment" size={14} />}</span>
              <span className="ib-req-wcard-sess-t" dir="auto">{subject}</span>
              {threadBusy[tid] === true && (
                <span className="ib-req-wcard-live">
                  <span className="ib-spin" aria-hidden="true" /> 运行中
                </span>
              )}
              {waiting && (
                <>
                  <span className="ib-req-wcard-sep" aria-hidden="true" />
                  <span className="ib-req-wcard-hold">
                    <Icon name="clock" size={11} /> 等你回复
                  </span>
                </>
              )}
              {(() => {
                // 审阅融合进会话：待审的设计文档挂在最新会话上（产出它的那个），按类型选图标。
                if (r.stage !== 'design-review' || tid !== r.threads[r.threads.length - 1]) return null;
                const doc = r.deliverables.find((d) => d.kind === 'design-doc' || /\.(md|markdown|html?)$/i.test(d.ref));
                if (!doc) return null;
                const REVIEW_ICON: Record<string, string> = { 'design-doc': 'doc', 'test-report': 'checkCircle', link: 'external', file: 'clip' };
                return (
                  <Tip content={`去审阅 · ${doc.title ?? doc.ref}`}>
                    <button
                      type="button"
                      className="ib-req-wcard-sess-review"
                      aria-label={`去审阅 ${doc.title ?? doc.ref}`}
                      onClick={(ev) => { ev.stopPropagation(); onReview(r.id, doc.id); }}
                    >
                      <Icon name={(REVIEW_ICON[doc.kind] ?? 'doc') as never} size={13} />
                      <span>去审阅</span>
                    </button>
                  </Tip>
                );
              })()}
              <span className="ib-req-wcard-stage">{requirementStageLabel(r.stage)}</span>

            </div>
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
function PanelContent({ panel, requirements, rowsByThread, onClose, onOpenThread, queryClient, onOpenSessionFile, onReview, onToast }: {
  panel: NonNullable<Panel>;
  requirements: Requirement[];
  rowsByThread: Map<string, unknown>;
  onClose: () => void;
  onOpenThread: (threadId: string) => void;
  queryClient: import('@tanstack/react-query').QueryClient;
  onOpenSessionFile: (threadId: string, fileId: string | null) => void;
  onReview: (reqId: string, deliverableId: string) => void;
  onToast: (toast: unknown, ms?: number) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [annotating, setAnnotating] = useState<string | null>(null);
  /** 上下文增删后 +1，重读详情。 */
  const [bump, setBump] = useState(0);
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

  // history
  return (
    <>
      {top(`历史 · ${req?.title ?? ''}`)}
      <div className="ib-req-wp-panel-body ib-req-hist-body">
        <ol className="ib-req-hist">
          {[...(detail?.events ?? [])].reverse().map((e) => {
            const stageLine = e.kind === 'stage' && (e.from || e.to)
              ? `${e.from ? requirementStageLabel(e.from as never) : '?'} → ${e.to ? requirementStageLabel(e.to as never) : '?'}`
              : null;
            const note = e.note ?? '';
            return (
              <li key={e.id} className="ib-req-hist-item" data-k={e.kind}>
                <span className="ib-req-hist-time">{timeOf(e.at)}</span>
                <span className="ib-req-hist-dot" aria-hidden="true" />
                <div className="ib-req-hist-main">
                  <div className="ib-req-hist-head">
                    <span className="ib-req-hist-kind">{e.kind === 'deliverable' ? DELIVERABLE_KIND_LABELS[(e.to ?? '') as never] ?? '交付' : EVENT_WORDS[e.kind] ?? e.kind}</span>
                    {stageLine && <span className="ib-req-hist-sub" dir="auto">{stageLine}</span>}
                    {!stageLine && e.kind !== 'deliverable' && e.field && <span className="ib-req-hist-sub" dir="auto">{e.field}</span>}
                  </div>
                  {note.trim() && (e.kind === 'deliverable' && e.field ? (
                    <div className="ib-req-hist-dlv" data-review={(() => {
                      const older = (detail?.requirement.deliverables ?? []).find((d) => (d.title ?? d.ref) === note) ?? null;
                      const ref = e.field ?? older?.ref ?? '';
                      const dlvId = e.from ?? older?.id ?? '';
                      return (detail?.requirement.stage ?? req?.stage) === 'design-review' && e.to === 'design-doc' && /\.(md|markdown|txt|html?)$/i.test(ref) && dlvId && reqId ? '' : undefined;
                    })()}>
                    <button
                      type="button"
                      className="ib-req-hist-open"
                      title={e.field}
                      onClick={() => {
                        // 旧事件没带 id/ref：按标题回查当前交付物列表（无需重新生成）。
                        const older = (detail?.requirement.deliverables ?? []).find((d) => (d.title ?? d.ref) === note) ?? null;
                        const ref = e.field ?? older?.ref ?? '';
                        const dlvId = e.from ?? older?.id ?? ''; // 事件携带的交付物 id（recordEvent 的 from）
                        if (!dlvId || !reqId) return;
                        const underReview = (detail?.requirement.stage ?? req?.stage) === 'design-review' && e.to === 'design-doc' && /\.(md|markdown|txt|html?)$/i.test(ref);
                        if (underReview) { onReview(reqId, dlvId); return; }
                        if (/^https?:/.test(ref)) { window.open(ref, '_blank', 'noreferrer'); return; }
                        {
                          setAnnotating(e.id ?? ref);
                          void annotateDeliverable(reqId, dlvId).then((o) => {
                            setAnnotating(null);
                            if (!o.ok) { setError(o.error); onToast({ icon: 'excl', lead: `预览没能打开：${o.error}`, wrap: true }); return; }
                            if (o.answer.url) window.open(o.answer.url, '_blank', 'noreferrer');
                          });
                        }
                      }}
                    >
                      {note}
                    </button>
                    {(() => {
                      const older = (detail?.requirement.deliverables ?? []).find((d) => (d.title ?? d.ref) === note) ?? null;
                      const ref = e.field ?? older?.ref ?? '';
                      const dlvId = e.from ?? older?.id ?? '';
                      const reviewable = (detail?.requirement.stage ?? req?.stage) === 'design-review' && e.to === 'design-doc' && /\.(md|markdown|txt|html?)$/i.test(ref) && dlvId && reqId;
                      return reviewable ? (
                        <button type="button" className="ib-req-hist-review" onClick={() => reqId && onReview(reqId, dlvId)}>去审阅</button>
                      ) : null;
                    })()}
                    </div>
                  ) : (
                    <p className="ib-req-hist-note" dir="auto">{note}</p>
                  ))}
                </div>
              </li>
            );
          })}
          {(detail?.events ?? []).length === 0 && <p className="ib-req-hist-none">还没有事件。</p>}
        </ol>
      </div>
      {error && <p className="ib-error" role="alert">{error}</p>}
    </>
  );
}

