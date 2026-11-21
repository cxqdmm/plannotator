/**
 * The Workshop (工坊): the Inbox's own shape — a list panel (requirement
 * cards with their sessions as rows, the agent sidebar's pattern) and a
 * right panel that whatever the person picks opens into. No detail page:
 * clicking a session, a deliverable, or the contexts opens its panel
 * beside the list; the list narrows, the panel fills the rest.
 */
import { useEffect, useRef, useState } from 'react';
import { HostMark, Icon } from '../../icons';
import { SidebarTrigger } from '../../shell/sidebar';
import { subscribeRequirementFrames } from '../frames';
import { addContext, annotateDeliverable, archiveRequirement, readRequirement, removeContext, reviewDeliverable, startCodeReview, startSessionCodeReview } from '../api';
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
import { inboxRowArchived } from '@plannotator/core/inbox-types';

const EVENT_WORDS: Readonly<Record<RequirementEvent['kind'], string>> = {
  created: '创建', stage: '阶段', field: '修改', deleted: '删除', say: '动态', deliverable: '产物', suggestion: '建议', context: '上下文',
};

function timeOf(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** 卡片上不在活跃列表里的会话（已归档）：从归档列表（GET /threads/archived，收件箱设置页那同一份）
 *  读回它们的行——图标、标题都还在，展示不因归档而变形，只多一个「已归档」字样。缺谁读谁变。 */
function useArchivedRows(on: boolean, missing: readonly string[]): Map<string, unknown> {
  const [rows, setRows] = useState<Map<string, unknown>>(() => new Map());
  const key = missing.join(',');
  useEffect(() => {
    if (!on || key === '') return;
    let alive = true;
    void inboxApi.archived({ limit: 200 })
      .then((model) => { if (alive) setRows(new Map(model.threads.map((row) => [row.thread_id, row as unknown]))); })
      .catch(() => { /* 读不到就保持素显示 */ });
    return () => { alive = false; };
  }, [key, on]);
  return rows;
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
  onCompose,
  onToast,
}: {
  on: boolean;
  openThreadId?: string | null;
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

  // 已归档的会话不在活跃列表里：把它们的行从归档列表补进来（活跃的优先），
  // 卡片上依旧画原本的图标与标题，只多「已归档」。
  const missing = [...new Set((requirements ?? []).flatMap((r) => r.threads))].filter((tid) => !rowsByThread.has(tid));
  const archivedByThread = useArchivedRows(on, missing);
  const rowsForCards = new Map([...archivedByThread, ...rowsByThread]);

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
            <ReqCard key={r.id} requirement={r} rowsByThread={rowsForCards} onSession={(tid) => setPanel({ k: 'session', threadId: tid })} onContexts={() => setPanel({ k: 'contexts', requirementId: r.id })} onHistory={() => setPanel({ k: 'history', requirementId: r.id })} onNewSession={() => onCompose(r.id, r.title, r.contexts)} onToast={onToast} onReview={(reqId, dlvId) => {
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
            <PanelContent panel={panel} requirements={requirements ?? []} onClose={() => setPanel(null)} onToast={onToast} onReview={(reqId, dlvId) => {
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
function ReqCard({ requirement: r, rowsByThread, onSession, onContexts, onHistory, onNewSession, onToast, onReview }: {
  requirement: Requirement;
  rowsByThread: Map<string, unknown>;
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
                    <Icon name="book" size={15} /> 上下文（{r.contexts.length}）
                  </Menu.Item>
                  {/* 手动代码评审（v1）：按本需求会话的项目起常驻评审页；比较对象在页面里随时切。
                      占位标签同步开（保留用户手势），成功后定向——异步 window.open 会被弹窗拦截静默吞掉。 */}
                  <Menu.Item className="ib-pmi" label="代码评审" data-req-menu="code-review" onClick={() => {
                    const tab = window.open('', '_blank');
                    void startCodeReview(r.id).then((outcome) => {
                      if (outcome.ok) { if (tab) tab.location.href = outcome.answer.url; else window.open(outcome.answer.url, '_blank', 'noreferrer'); }
                      else { tab?.close(); onToast({ icon: 'excl', lead: `代码评审没能打开：${outcome.error}`, wrap: true }); }
                    });
                  }}>
                    <Icon name="gitBranch" size={15} /> 代码评审（常驻查看）
                  </Menu.Item>
                  <Menu.Separator className="ib-pm-sep" />
                  <Menu.Item className="ib-pmi" label="归档需求" onClick={() => { void archiveRequirement(r.id).then((o) => { if (!o.ok) onToast({ icon: 'excl', lead: `归档失败：${o.error}`, wrap: true }); }); }} data-req-menu="archive">
                    <Icon name="archive" size={15} /> 归档（释放全部会话）
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
          const row = rowsByThread.get(tid) as { subject?: string | null; section?: string; run?: 'starting' | 'working' | 'cloning' | null; resolved_at: string | null; back_from_archive?: boolean } | undefined;
          const agent = row ? rowAgent(row as never) : null;
          // 已归档：行从归档列表来（活跃列表不收），展示照旧（图标、标题都是原来的），
          // 只加「已归档」——与收件箱的字序一致，它顶掉工作状态与等你回复。
          const archived = row ? inboxRowArchived(row) : false;
          const waiting = !archived && (row?.section === 'stopped' || row?.section === 'holding' || row?.section === 'waiting');
          const subject = (row?.subject?.trim() ? row.subject : null) ?? '会话';
          // 工作状态＝收件箱会话行自己的方案：行上的 run 字（启动的会话才有，launch 的 run line 决定），
          // 同一个字表（InboxList 的 countWords）；event: deliveries 挪动它，这里不自己轮询。
          const runWord = archived ? null : row?.run === 'starting' ? '启动中' : row?.run === 'cloning' ? '克隆中' : row?.run === 'working' ? '工作中' : null;
          return (
            <div key={tid} role="button" tabIndex={0} className="ib-req-wcard-sess" onClick={() => onSession(tid)} onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); onSession(tid); } }}>
              <span className={`ib-req-wcard-sess-mk${runWord !== null ? ' running' : ''}`}>{agent?.kind === 'agent' ? <HostMark host={agent.host} /> : <Icon name="comment" size={14} />}</span>
              <span className="ib-req-wcard-sess-t" dir="auto">{subject}</span>
              {archived && (
                <span className="ib-req-wcard-arch">已归档</span>
              )}
              {runWord !== null && (
                <span className="ib-req-wcard-live">
                  <span className="ib-spin" aria-hidden="true" /> {runWord}
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
              {/* 门控代码评审（挂会话）：页面自开、带 关闭/通过，结论落需求历史并送达本会话。 */}
              <Tip content="代码评审 · 结论送达本会话">
                <button
                  type="button"
                  className="ib-req-wcard-sess-codereview"
                  aria-label={`对 ${subject} 的项目发起代码评审`}
                  data-req-code-review=""
                  onClick={(ev) => {
                    ev.stopPropagation();
                    void startSessionCodeReview(r.id, tid).then((outcome) => {
                      if (!outcome.ok) { onToast({ icon: 'excl', lead: `代码评审没能打开：${outcome.error}`, wrap: true }); return; }
                      onToast(outcome.answer.state === 'already'
                        ? { icon: 'clock', lead: '这个会话的评审已在进行中——回到已打开的那个评审页继续。' }
                        : { icon: 'check', lead: '评审页已打开；结论将送达本会话并记入需求历史。' });
                    });
                  }}
                >
                  <Icon name="gitBranch" size={13} />
                </button>
              </Tip>
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
function PanelContent({ panel, requirements, onClose, onReview, onToast }: {
  panel: NonNullable<Panel>;
  requirements: Requirement[];
  onClose: () => void;
  onReview: (reqId: string, deliverableId: string) => void;
  onToast: (toast: unknown, ms?: number) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [, setAnnotating] = useState<string | null>(null);
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

