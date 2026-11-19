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
import { annotateDeliverable, deliverableContent, readRequirement } from '../api';
import { inboxApi } from '../../api';
import { EmbeddedThread } from '../EmbeddedThread';
import { putThread } from '../../data/queries/thread';
import { useListModel } from '../../data/queries/list';
import { useQueryClient } from '@tanstack/react-query';
import { rowAgent } from '../../components/InboxList';
import { useRequirements } from '../useRequirements';
import { DELIVERABLE_KIND_LABELS, type Deliverable, type Requirement, type RequirementEvent } from '@plannotator/core/requirements-types';

const EVENT_WORDS: Readonly<Record<RequirementEvent['kind'], string>> = {
  created: '创建', stage: '阶段', field: '修改', deleted: '删除', say: '动态', deliverable: '产物', suggestion: '建议', context: '上下文',
};

function timeOf(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function ageOf(iso: string): string {
  const ms = Date.now() - Date.parse(iso);
  if (Number.isNaN(ms)) return '';
  const m = Math.floor(ms / 60000); if (m < 1) return '刚刚'; if (m < 60) return `${m} 分钟`;
  const h = Math.floor(m / 60); if (h < 24) return `${h} 小时`;
  const d = Math.floor(h / 24); return d < 30 ? `${d} 天` : `${Math.floor(d / 30)} 个月`;
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

  const submitNew = () => {
    const title = draft.trim();
    if (!title) { newDialog.current?.close(); return; }
    setDraft(''); newDialog.current?.close(); void create({ title });
  };

  return (
    <section className="ib-req-wp" data-requirements-page="" aria-label="工坊">
      {/* The list panel */}
      <div className="ib-req-wp-list" data-requirements-list="">
        <div className="ib-req-wp-head">
          <SidebarTrigger />
          <h1>工坊</h1>
          <button type="button" className="ib-req-wp-new" onClick={() => { setDraft(''); newDialog.current?.showModal(); }}><Icon name="plus" size={14} /> 新建</button>
        </div>
        <div className="ib-req-wp-cards">
          {(requirements ?? []).map((r) => (
            <ReqCard key={r.id} requirement={r} rowsByThread={rowsByThread} onSession={(tid) => setPanel({ k: 'session', threadId: tid })} onContexts={() => setPanel({ k: 'contexts', requirementId: r.id })} onDeliverables={() => setPanel({ k: 'deliverables', requirementId: r.id })} onHistory={() => setPanel({ k: 'history', requirementId: r.id })} onNewSession={() => onCompose(r.id, r.title, r.contexts)} />
          ))}
          {(requirements ?? []).length === 0 && <p className="ib-req-wp-empty">还没有需求。</p>}
        </div>
      </div>

      {/* The right panel */}
      {panel !== null && (
        <div className="ib-req-wp-panel">
          <PanelContent panel={panel} requirements={requirements ?? []} rowsByThread={rowsByThread} onClose={() => setPanel(null)} onOpenThread={onOpenThread} queryClient={queryClient} />
        </div>
      )}

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

/* ── A requirement card: title + marks + sessions as rows ── */
function ReqCard({ requirement: r, rowsByThread, onSession, onContexts, onDeliverables, onHistory, onNewSession }: {
  requirement: Requirement;
  rowsByThread: Map<string, unknown>;
  onSession: (threadId: string) => void;
  onContexts: () => void;
  onDeliverables: () => void;
  onHistory: () => void;
  onNewSession: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="ib-req-wcard" data-requirement-id={r.id}>
      <button type="button" className="ib-req-wcard-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <b dir="auto">{r.title}</b>
        {r.waiting === true && <span className="ib-req-wcard-wait">等你</span>}
        <span className="ib-req-wcard-meta">
          {r.threads.length > 0 && <span>💬{r.threads.length}</span>}
          {r.deliverables.length > 0 && <span>📦{r.deliverables.length}</span>}
          <span>{ageOf(r.updated_at)}</span>
        </span>
      </button>
      {open && (
        <div className="ib-req-wcard-body">
          {/* Sessions as rows — the agent sidebar's pattern */}
          {r.threads.map((tid) => {
            const row = rowsByThread.get(tid) as { subject?: string | null; section?: string } | undefined;
            const agent = row ? rowAgent(row as never) : null;
            const waiting = row?.section === 'stopped' || row?.section === 'holding' || row?.section === 'waiting';
            const subject = (row?.subject?.trim() ? row.subject : null) ?? '会话';
            return (
              <button key={tid} type="button" className="ib-req-wcard-sess" onClick={() => onSession(tid)}>
                <span className="ib-req-wcard-sess-mk">{agent?.kind === 'agent' ? <HostMark host={agent.host} /> : <Icon name="comment" size={14} />}</span>
                <span className="ib-req-wcard-sess-t" dir="auto">{subject}</span>
                {waiting && <span className="ib-req-wcard-sess-wait">等你</span>}
              </button>
            );
          })}
          {/* Entry rows */}
          <div className="ib-req-wcard-entries">
            <button type="button" onClick={onNewSession}><Icon name="plus" size={12} /> 开启新会话</button>
            <button type="button" onClick={onContexts}><Icon name="pen" size={12} /> 上下文 {r.contexts.length > 0 && `(${r.contexts.length})`}</button>
            <button type="button" onClick={onDeliverables}><Icon name="clip" size={12} /> 产物 {r.deliverables.length > 0 && `(${r.deliverables.length})`}</button>
            <button type="button" onClick={onHistory}><Icon name="clock" size={12} /> 历史</button>
          </div>
        </div>
      )}
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
  }, [reqId]);

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
      <SidebarTrigger />
      <button type="button" className="ib-req-wp-panel-back" onClick={onClose}><Icon name="chevL" size={14} /><span>工坊</span></button>
      <span className="ib-req-wp-panel-title" dir="auto">{title}</span>
      <button type="button" className="ib-req-wp-panel-x" aria-label="关闭" onClick={onClose}><Icon name="x" size={16} /></button>
    </div>
  );

  if (panel.k === 'session') {
    const row = rowsByThread.get(panel.threadId) as { subject?: string } | undefined;
    return (
      <>
        {top(row?.subject ?? '会话')}
        <EmbeddedThread threadId={panel.threadId} onClose={onClose} onChanged={() => { void inboxApi.thread(panel.threadId).then((r) => putThread(queryClient, panel.threadId, r)); }} />
      </>
    );
  }

  if (panel.k === 'contexts') {
    return (
      <>
        {top(`上下文 · ${req?.title ?? ''}`)}
        <div className="ib-req-wp-panel-body">
          <p className="ib-req-wp-panel-empty">上下文管理在此面板中。</p>
        </div>
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
    </>
  );
}
