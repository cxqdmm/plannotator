/**
 * The Workshop (工坊): a flat list of requirement cards — no lanes, no stages
 * on the card, no cook. Each card carries its marks (waiting, sessions,
 * deliverables, age) and one action: ＋ 开启新会话, a dialog that reuses the
 * Inbox compose's To-row (agent + project) with a dual-mode message area
 * (写想法 / 用模板). The detail is a single flat page. Chinese in place.
 */
import { useEffect, useRef, useState } from 'react';
import { ChatMarkdown } from '@plannotator/ui/components/chat';
import { HostMark, Icon } from '../../icons';
import { SidebarTrigger } from '../../shell/sidebar';
import { subscribeRequirementFrames } from '../frames';
import { annotateDeliverable, deliverableContent, readRequirement, reviewDeliverable } from '../api';
import { inboxApi } from '../../api';
import type { InboxLaunchAgent } from '@plannotator/core/inbox-types';
import { EmbeddedThread } from '../EmbeddedThread';
import { putThread } from '../../data/queries/thread';
import { useListModel } from '../../data/queries/list';
import { useQueryClient } from '@tanstack/react-query';
import { rowAgent } from '../../components/InboxList';
import { useRequirements } from '../useRequirements';
import { DELIVERABLE_KIND_LABELS, type Deliverable, type Requirement, type RequirementContext, type RequirementEvent } from '@plannotator/core/requirements-types';

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
  const m = Math.floor(ms / 60000);
  if (m < 1) return '刚刚';
  if (m < 60) return `${m} 分钟`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时`;
  const d = Math.floor(h / 24);
  return d < 30 ? `${d} 天` : `${Math.floor(d / 30)} 个月`;
}

/* ── Card ── */
function RequirementCard({ requirement, onOpen, onOpenWaiting, onNewSession }: { requirement: Requirement; onOpen: () => void; onOpenWaiting: (threadId: string | null) => void; onNewSession: () => void }) {
  return (
    <div className="ib-req-fcard" data-requirement-id={requirement.id} onClick={onOpen} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') onOpen(); }}>
      <div className="ib-req-fcard-top"><b dir="auto">{requirement.title}</b><span className="ib-req-fcard-age">{ageOf(requirement.updated_at)}</span></div>
      <div className="ib-req-fcard-marks">
        {requirement.waiting === true && <button type="button" className="ib-req-fcard-wait" onClick={(e) => { e.stopPropagation(); onOpenWaiting(requirement.waiting_thread ?? null); }}><Icon name="comment" size={11} /> 等你 ›</button>}
        {requirement.threads.length > 0 && <span className="ib-req-fcard-mark"><Icon name="comment" size={11} /> {requirement.threads.length}</span>}
        {requirement.deliverables.length > 0 && <span className="ib-req-fcard-mark"><Icon name="clip" size={11} /> {requirement.deliverables.length}</span>}
        {requirement.contexts.length > 0 && <span className="ib-req-fcard-mark"><Icon name="pen" size={11} /> {requirement.contexts.length}</span>}
      </div>
      <div className="ib-req-fcard-act">
        <button type="button" className="ib-req-fcard-new" onClick={(e) => { e.stopPropagation(); onNewSession(); }}><Icon name="plus" size={12} /> 开启新会话</button>
      </div>
    </div>
  );
}

/* ── Panel ── */
export function RequirementsPanel({ on, openId = null, openThreadId = null, onOpen, onOpenThread }: { on: boolean; openId?: string | null; openThreadId?: string | null; onOpen: (id: string | null, threadId?: string | null) => void; onOpenThread: (threadId: string) => void }) {
  const { requirements, create, refresh } = useRequirements(on, subscribeRequirementFrames);
  const [draft, setDraft] = useState('');
  const newDialog = useRef<HTMLDialogElement | null>(null);
  const sessionDialog = useRef<HTMLDialogElement | null>(null);
  const [sessionFor, setSessionFor] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const panelList = useListModel(queryClient);
  const cursor = panelList?.cursor ?? null;
  useEffect(() => { if (on && cursor !== null) refresh(); /* eslint-disable-next-line */ }, [cursor]);

  const rowsByThread = new Map(
    [...(panelList?.sections ?? []).flatMap((s) => s.threads), ...(panelList?.snoozed ?? []), ...(panelList?.pins ?? [])].map((row) => [row.thread_id, row]),
  );

  const submitNew = () => {
    const title = draft.trim();
    if (!title) { newDialog.current?.close(); return; }
    setDraft(''); newDialog.current?.close(); void create({ title });
  };

  return (
    <section className="ib-bpage" data-requirements-page="" data-requirements-view={openId ? 'detail' : 'list'} aria-label="工坊">
      {!openId && (
        <div className="ib-req-flat">
          <div className="ib-req-flat-head">
            <SidebarTrigger />
            <h1>工坊</h1>
            <button type="button" className="ib-req-flat-new" onClick={() => { setDraft(''); newDialog.current?.showModal(); }}><Icon name="plus" size={14} /> 新建需求</button>
          </div>
          <div className="ib-req-flat-list">
            {(requirements ?? []).map((r) => (
              <RequirementCard key={r.id} requirement={r} onOpen={() => onOpen(r.id)} onOpenWaiting={(t) => onOpen(r.id, t)} onNewSession={() => { setSessionFor(r.id); sessionDialog.current?.showModal(); }} />
            ))}
            {(requirements ?? []).length === 0 && <p className="ib-req-flat-empty">还没有需求。新建一个，挂上上下文，开启会话开工。</p>}
          </div>
        </div>
      )}

      <dialog ref={newDialog} className="ib-req-new" aria-labelledby="ib-req-new-t" onClose={() => setDraft('')}>
        <form method="dialog" onSubmit={(e) => { e.preventDefault(); submitNew(); }}>
          <h2 id="ib-req-new-t">新建需求</h2>
          <input ref={(n) => { if (n && newDialog.current?.open) queueMicrotask(() => n.focus()); }} className="ib-req-new-input" aria-label="需求标题" placeholder="一句话说清要做什么" value={draft} onChange={(e) => setDraft(e.target.value)} />
          <p className="ib-req-new-hint">回车创建；Esc 放弃。</p>
          <div className="ib-req-new-act">
            <button type="button" className="ib-btn ib-sm" onClick={() => newDialog.current?.close()}>取消</button>
            <button type="submit" className="ib-btn ib-sm ib-req-new-ok" disabled={!draft.trim()}>创建</button>
          </div>
        </form>
      </dialog>

      {sessionFor !== null && (
        <NewSessionDialog requirementId={sessionFor} requirement={(requirements ?? []).find((r) => r.id === sessionFor) ?? null} onClose={() => { sessionDialog.current?.close(); setSessionFor(null); }} onStarted={(t) => { onOpen(sessionFor, t); setSessionFor(null); }} dialogRef={sessionDialog} />
      )}

      {openId !== null && (
        <RequirementDetail id={openId} openThreadId={openThreadId} rowsByThread={rowsByThread} onClose={() => onOpen(null, null)} onOpenThread={onOpenThread} onNewSession={() => { setSessionFor(openId); sessionDialog.current?.showModal(); }} queryClient={queryClient} />
      )}
    </section>
  );
}

/* ── 开启新会话 ── */
function NewSessionDialog({ requirementId, requirement, onClose, onStarted, dialogRef }: { requirementId: string; requirement: Requirement | null; onClose: () => void; onStarted: (threadId: string) => void; dialogRef: React.RefObject<HTMLDialogElement | null> }) {
  const [mode, setMode] = useState<'idea' | 'template'>('idea');
  const [launch, setLaunch] = useState<{ agents: { agent: string; name: string }[]; projects: { id: string; name: string }[]; agent: string; project: string } | null>(null);
  const [openRow, setOpenRow] = useState<'agent' | 'project' | null>(null);
  const [words, setWords] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tBg, setTBg] = useState(''); const [tGoal, setTGoal] = useState(''); const [tAcc, setTAcc] = useState('');
  const [tCtx, setTCtx] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    void inboxApi.composeSessions().then((m) => {
      const agents = (m.launch?.agents ?? []).map(({ agent, name }) => ({ agent, name }));
      const projects = (m.launch?.projects ?? []).filter((p) => p.exists).map(({ id, name }) => ({ id, name }));
      const claude = agents.find((a) => a.agent === 'claude-code') ?? agents[0];
      if (agents.length > 0 && projects.length > 0) setLaunch({ agents, projects, agent: claude.agent, project: projects[0]!.id });
      else setError(agents.length === 0 ? '没有可用的 agent。' : '没有可选的项目。');
    }).catch((c) => setError(c instanceof Error ? c.message : String(c)));
  }, []);

  const send = async () => {
    if (!launch || busy) return;
    setBusy(true);
    try {
      const body = mode === 'idea'
        ? (words.trim() || `用 plannotator requirement 工具开始做「${requirement?.title ?? ''}」。`)
        : [`# 需求：${requirement?.title ?? ''}`,
           tBg.trim() ? `\n## 背景\n\n${tBg.trim()}` : '',
           tGoal.trim() ? `\n## 目标\n\n${tGoal.trim()}` : '',
           tCtx.size > 0 && requirement ? `\n## 上下文材料\n\n${requirement.contexts.filter((c) => tCtx.has(c.id)).map((c) => `- ${c.kind === 'link' ? `链接：${c.ref}` : `文件：${c.ref}`} —— ${c.name}`).join('\n')}` : '',
           tAcc.trim() ? `\n## 验收标准\n\n${tAcc.trim()}` : '',
           `\n用 plannotator requirement 工具 link 本会话到 \`${requirementId}\`。`,
          ].filter(Boolean).join('\n');
      const answer = await inboxApi.startThread({ to: { launch: { agent: launch.agent as InboxLaunchAgent, project_id: launch.project } }, body, idempotency_key: crypto.randomUUID(), thread_name: requirement?.title ?? undefined });
      onStarted(answer.thread_id);
    } catch (c) { setError(c instanceof Error ? c.message : String(c)); } finally { setBusy(false); }
  };

  return (
    <dialog ref={dialogRef} className="ib-req-ns-dialog" aria-labelledby="ib-req-ns-t" onClose={onClose}>
      <div className="ib-req-ns">
        <div className="ib-req-ns-head"><span className="ib-req-ns-title">开启新会话</span><span className="ib-req-ns-sub">为「{requirement?.title ?? ''}」</span></div>
        <div className="ib-req-ns-to">
          <span className="ib-req-ns-tol">发送给</span>
          <button type="button" className="ib-req-ns-agent" onClick={() => setOpenRow((r) => (r === 'agent' ? null : 'agent'))}>
            <span className="ib-req-ns-mk">C</span> {launch?.agents.find((a) => a.agent === launch.agent)?.name ?? '读取中…'}
          </button>
          <span className="ib-req-ns-sep">·</span>
          <button type="button" className="ib-req-ns-proj" onClick={() => setOpenRow((r) => (r === 'project' ? null : 'project'))}>
            位于 {launch?.projects.find((p) => p.id === launch.project)?.name ?? '读取中…'}
          </button>
          {openRow !== null && <div className="ib-req-dropback" onClick={() => setOpenRow(null)} />}
          {openRow === 'agent' && (
            <div className="ib-req-ns-drop" role="listbox" aria-label="会话类型">
              {(launch?.agents ?? []).map((a) => <button key={a.agent} type="button" className={launch?.agent === a.agent ? 'on' : ''} onClick={() => { if (launch) setLaunch({ ...launch, agent: a.agent }); setOpenRow(null); }}>{a.name}</button>)}
            </div>
          )}
          {openRow === 'project' && (
            <div className="ib-req-ns-drop" role="listbox" aria-label="项目">
              {(launch?.projects ?? []).map((p) => <button key={p.id} type="button" className={launch?.project === p.id ? 'on' : ''} onClick={() => { if (launch) setLaunch({ ...launch, project: p.id }); setOpenRow(null); }}>{p.name}</button>)}
            </div>
          )}
        </div>
        <div className="ib-req-ns-tabs">
          <button type="button" className={mode === 'idea' ? 'on' : ''} onClick={() => setMode('idea')}>写想法</button>
          <button type="button" className={mode === 'template' ? 'on' : ''} onClick={() => setMode('template')}>用模板</button>
        </div>
        {mode === 'idea' ? (
          <textarea className="ib-req-ns-idea" rows={5} placeholder="把你的想法告诉会话——它会带着需求卡开工…" value={words} onChange={(e) => setWords(e.target.value)} aria-label="想法" />
        ) : (
          <div className="ib-req-ns-tmpl">
            <label>背景<textarea rows={2} placeholder="为什么要做？" value={tBg} onChange={(e) => setTBg(e.target.value)} /></label>
            <label>目标<textarea rows={2} placeholder="做到什么程度？" value={tGoal} onChange={(e) => setTGoal(e.target.value)} /></label>
            {requirement && requirement.contexts.length > 0 && (
              <label>上下文材料
                <div className="ib-req-ns-ctx">
                  {requirement.contexts.map((c) => (
                    <button key={c.id} type="button" className={`ib-req-ns-mat${tCtx.has(c.id) ? ' on' : ''}`} onClick={() => setTCtx((h) => { const n = new Set(h); if (n.has(c.id)) n.delete(c.id); else n.add(c.id); return n; })}>
                      <span className="k">{c.kind === 'link' ? '🔗' : c.image ? '🖼' : '📄'}</span> {c.name}
                    </button>
                  ))}
                  <span className="ib-req-ns-ctx-hint">点击选中/取消</span>
                </div>
              </label>
            )}
            <label>验收标准<textarea rows={2} placeholder="怎么判断做好了？" value={tAcc} onChange={(e) => setTAcc(e.target.value)} /></label>
          </div>
        )}
        {error && <p className="ib-req-ns-error" role="alert">{error}</p>}
        <div className="ib-req-ns-act">
          <button type="button" className="ib-req-ns-send" disabled={busy || !launch} onClick={() => void send()}><Icon name="play" size={13} /> {busy ? '正在启动…' : '发送'}</button>
          <span className="ib-req-ns-note">会话自动关联到这个需求</span>
        </div>
      </div>
    </dialog>
  );
}

/* ── 详情（平铺） ── */
function RequirementDetail({ id, openThreadId = null, rowsByThread, onClose, onOpenThread, onNewSession, queryClient }: { id: string; openThreadId?: string | null; rowsByThread: Map<string, unknown>; onClose: () => void; onOpenThread: (threadId: string) => void; onNewSession: () => void; queryClient: import('@tanstack/react-query').QueryClient }) {
  const [detail, setDetail] = useState<{ requirement: Requirement; events: RequirementEvent[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dlvPreviews, setDlvPreviews] = useState<Record<string, 'loading' | { text?: string; image?: string; binary?: boolean; session?: string; html?: boolean } | { error: string }>>({});
  const [embedded, setEmbedded] = useState<string | null>(openThreadId);
  const [annotating, setAnnotating] = useState<string | null>(null);
  const reload = useRef<AbortController | null>(null);

  const read = () => {
    reload.current?.abort();
    const c = new AbortController(); reload.current = c;
    void readRequirement(id, c.signal).then((a) => { if (!c.signal.aborted) setDetail(a); });
  };
  useEffect(() => { read(); return () => reload.current?.abort(); /* eslint-disable-next-line */ }, [id]);
  useEffect(() => { if (openThreadId !== null) setEmbedded(openThreadId); }, [openThreadId]);
  useEffect(() => {
    for (const d of detail?.requirement.deliverables ?? []) {
      if (dlvPreviews[d.id] !== undefined) continue;
      setDlvPreviews((h) => ({ ...h, [d.id]: 'loading' }));
      void deliverableContent(id, d.id).then((a) => setDlvPreviews((h) => ({ ...h, [d.id]: a as never })));
    }
    /* eslint-disable-next-line */ }, [detail]);

  const requirement = detail?.requirement ?? null;
  if (requirement === null) return null;

  const startReview = (dlvId: string) => {
    void reviewDeliverable(id, dlvId).then((o) => { if (!o.ok) setError(o.error); });
  };

  return (
    <div className="ib-req-fd" data-requirement-detail={id}>
      <div className="ib-req-fd-top">
        <SidebarTrigger />
        <button type="button" className="ib-req-fd-back" onClick={onClose}><Icon name="chevL" size={15} /><span>工坊</span></button>
        <span className="ib-req-fd-title" dir="auto">{requirement.title}</span>
        <button type="button" className="ib-req-fd-close" aria-label="关闭" onClick={onClose}><Icon name="x" size={16} /></button>
      </div>

      <div className="ib-req-fd-actions">
        {requirement.stage === 'design-review' && (() => {
          const doc = requirement.deliverables.find((d) => d.kind === 'design-doc' || /\.(md|markdown|html?)$/i.test(d.ref));
          return doc ? <button type="button" className="ib-req-fd-go" onClick={() => startReview(doc.id)}><Icon name="pen" size={13} /> 去评审</button> : <span className="ib-req-fd-desc">等设计文档挂上</span>;
        })()}
        <button type="button" className="ib-req-fd-go" onClick={onNewSession}><Icon name="plus" size={13} /> 开启新会话</button>
      </div>

      <div className="ib-req-fd-grid">
        <div className="ib-req-fd-col">
          <h4 className="ib-req-fd-h">上下文 <span>{requirement.contexts.length}</span></h4>
          {requirement.contexts.length === 0 && <p className="ib-req-fd-empty">还没有上下文。</p>}
          <div className="ib-req-fd-mats">
            {requirement.contexts.map((c: RequirementContext) => (
              <span key={c.id} className="ib-req-fd-mat"><span className="k">{c.kind === 'link' ? '🔗' : c.image ? '🖼' : '📄'}</span><b>{c.name}</b><small>{c.kind === 'link' ? 'link' : '文件'}</small></span>
            ))}
          </div>
          <h4 className="ib-req-fd-h" style={{ marginTop: 18 }}>会话 <span>{requirement.threads.length}</span></h4>
          {requirement.threads.length === 0 && <p className="ib-req-fd-empty">还没有会话。点上方「开启新会话」。</p>}
          {requirement.threads.map((threadId) => {
            const row = rowsByThread.get(threadId) as { subject?: string | null; section?: string } | undefined;
            const agent = row ? rowAgent(row as never) : null;
            const waiting = row?.section === 'stopped' || row?.section === 'holding' || row?.section === 'waiting';
            const subject = (row?.subject?.trim() ? row.subject : null) ?? '会话';
            return (
              <div key={threadId} className="ib-req-fd-sess" onClick={() => setEmbedded(threadId)} role="button" tabIndex={0}>
                <span className="ib-req-fd-sess-mk">{agent?.kind === 'agent' ? <HostMark host={agent.host} /> : <Icon name="comment" size={14} />}</span>
                <span className="ib-req-fd-sess-t"><b dir="auto">{subject}</b><small>{agent?.kind === 'agent' ? agent.name ?? 'Claude Code' : ''}</small></span>
                {waiting && <span className="ib-req-fd-sess-wait">等你</span>}
              </div>
            );
          })}
        </div>
        <div className="ib-req-fd-col">
          <h4 className="ib-req-fd-h">产物 <span>{requirement.deliverables.length}</span></h4>
          {requirement.deliverables.length === 0 && <p className="ib-req-fd-empty">还没有产物。</p>}
          {requirement.deliverables.map((d: Deliverable) => {
            const c = dlvPreviews[d.id];
            const annotatable = /\.(md|markdown|txt|html?)$/i.test(d.ref);
            return (
              <div key={d.id} className="ib-req-fd-dlv">
                <div className="ib-req-fd-dlv-row"><span className="ib-req-fd-dlv-kind">{DELIVERABLE_KIND_LABELS[d.kind]}</span><b dir="auto">{d.title ?? d.ref.split('/').pop() ?? d.ref}</b><small>{d.by ? `${d.by} · ` : ''}{timeOf(d.created_at)}</small></div>
                {c === 'loading' || c === undefined ? <p className="ib-req-fd-empty">读取中…</p> : 'error' in c ? <p className="ib-req-fd-empty">{c.error}</p> : c.session ? <p className="ib-req-fd-empty">批注会话（{c.session}）</p> : c.image ? <img className="ib-req-fd-dlv-img" src={c.image} alt="预览" /> : c.binary ? <p className="ib-req-fd-empty">不可预览</p> : c.html ? <iframe className="ib-req-fd-dlv-html" sandbox="allow-scripts" srcDoc={c.text} title="预览" /> : <div className="ib-req-fd-dlv-doc" dir="auto"><ChatMarkdown text={c.text ?? ''} role="assistant" messageId={`dlv-${d.id}`} /></div>}
                {annotatable && <div className="ib-req-fd-dlv-act"><button type="button" className="ib-btn ib-sm" disabled={annotating === d.id} onClick={() => { setAnnotating(d.id); void annotateDeliverable(id, d.id).then((o) => { setAnnotating(null); if (!o.ok) setError(o.error); }); }}><Icon name="pen" size={12} /> 批注</button></div>}
              </div>
            );
          })}
          <h4 className="ib-req-fd-h" style={{ marginTop: 18 }}>历史 <span>{(detail?.events ?? []).length}</span></h4>
          <ol className="ib-req-fd-hist">
            {[...(detail?.events ?? [])].reverse().slice(0, 12).map((e) => (
              <li key={e.id}><span className="t">{timeOf(e.at)}</span><span className="w">{EVENT_WORDS[e.kind] ?? e.kind}</span><span className="n" dir="auto">{(e.note ?? '').length > 80 ? `${(e.note ?? '').slice(0, 80)}…` : e.note ?? e.field ?? ''}</span></li>
            ))}
          </ol>
        </div>
      </div>

      {embedded !== null && (
        <div className="ib-req-fd-embed">
          <div className="ib-req-fd-embed-top">
            <button type="button" className="ib-req-fd-embed-back" onClick={() => setEmbedded(null)}><Icon name="chevL" size={14} /><span>返回</span></button>
            <span className="ib-req-fd-embed-subj" dir="auto">{((rowsByThread.get(embedded) as { subject?: string } | undefined)?.subject ?? '会话')}</span>
            <span className="ib-sp" />
            <button type="button" className="ib-iconbtn" title="在收件箱中打开" onClick={() => onOpenThread(embedded)}><Icon name="expand" size={14} /></button>
          </div>
          <EmbeddedThread threadId={embedded} onClose={() => setEmbedded(null)} onChanged={() => { void inboxApi.thread(embedded).then((r) => putThread(queryClient, embedded, r)); read(); }} />
        </div>
      )}
      {error && <p className="ib-error" role="alert">{error}</p>}
    </div>
  );
}
