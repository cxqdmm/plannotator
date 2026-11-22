/**
 * The Workshop (工坊): the Inbox's own shape — a list panel (requirement
 * cards with their sessions as rows, the agent sidebar's pattern) and a
 * right panel that whatever the person picks opens into. No detail page:
 * clicking a session, a deliverable, or the contexts opens its panel
 * beside the list; the list narrows, the panel fills the rest.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { HostMark, Icon } from '../../icons';
import { SidebarTrigger } from '../../shell/sidebar';
import { subscribeRequirementFrames } from '../frames';
import { addContext, annotateDeliverable, readRequirement, removeContext, reviewDeliverable, startSessionCodeReview } from '../api';
import { inboxApi } from '../../api';
import { EmbeddedThread } from '../EmbeddedThread';
import { putThread } from '../../data/queries/thread';
import { useListModel } from '../../data/queries/list';
import { useQueryClient } from '@tanstack/react-query';
import { rowAgent } from '../../components/InboxList';
import { Tip } from '../../components/Tip';
import { Menu } from '@base-ui/react/menu';
import { useRequirements } from '../useRequirements';
import { DELIVERABLE_KIND_LABELS, requirementStageLabel, type Requirement, type RequirementEvent, type RequirementStage } from '@plannotator/core/requirements-types';
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
  const { requirements, archived, create, patch, refresh } = useRequirements(on, subscribeRequirementFrames);
  const [draft, setDraft] = useState('');
  /** 工坊的视图：进行中（默认）/ 已完成（阶段到 done 且未归档）/ 已归档。 */
  const [view, setView] = useState<'active' | 'done' | 'archived'>('active');
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

  // 三个视图：进行中（未归档且阶段未到 done）、已完成（阶段到 done 且未归档）、已归档。
  // 数据全在 useRequirements 手里（active 页 + archived 页，帧实时刷新），这里只分组。
  const activeList = (requirements ?? []).filter((r) => r.stage !== 'done');
  const doneList = (requirements ?? []).filter((r) => r.stage === 'done');
  const archivedList = archived ?? [];
  const counts = { active: activeList.length, done: doneList.length, archived: archivedList.length };
  const shown = view === 'active' ? activeList : view === 'done' ? doneList : archivedList;
  const emptyText = view === 'active' ? '还没有需求，点右上角「＋」开工。' : view === 'done' ? '还没有完成的需求；阶段走到「完成」的需求会落在这里。' : '归档的需求会落在这里，⋯ 菜单里可以恢复。';

  return (
    <section className="ib-req-wp" data-requirements-page="" data-panel={panel !== null ? '' : undefined} aria-label="工坊">
      {/* The list panel */}
      <div className="ib-req-wp-list" data-requirements-list="">
        <div className="ib-req-wp-head">
          <SidebarTrigger />
          <h1>工坊</h1>
          <button type="button" className="ib-req-wp-new" title="新建需求" aria-label="新建需求" onClick={() => { setDraft(''); newDialog.current?.showModal(); }}><Icon name="plus" size={15} /></button>
        </div>
        <div className="ib-req-wp-views" role="tablist" aria-label="需求视图">
          {([['active', '进行中'], ['done', '已完成'], ['archived', '已归档']] as const).map(([key, label]) => (
            <button key={key} type="button" role="tab" aria-selected={view === key} className={`ib-req-wp-view${view === key ? ' on' : ''}`} onClick={() => setView(key)}>
              {label} <span className="n">{counts[key]}</span>
            </button>
          ))}
        </div>
        <div className="ib-req-wp-cards">
          {shown.map((r) => (
            <ReqCard key={r.id} requirement={r} rowsByThread={rowsForCards} patch={patch} onSession={(tid) => setPanel({ k: 'session', threadId: tid })} onContexts={() => setPanel({ k: 'contexts', requirementId: r.id })} onHistory={() => setPanel({ k: 'history', requirementId: r.id })} onNewSession={() => onCompose(r.id, r.title, r.contexts)} onToast={onToast} onReview={(reqId, dlvId) => {
                  // 评审由守护进程自起门控会话；路由等会话起好从登记簿拿地址返回，窗口统一打开（首击即达）。
                  onToast({ icon: 'clock', lead: '正在打开评审页…' });
                  void reviewDeliverable(reqId, dlvId).then((o) => {
                    if (!o.ok) { onToast({ icon: 'excl', lead: `审阅没能打开：${o.error}`, wrap: true }); return; }
                    if (o.answer.url) window.open(o.answer.url, '_blank', 'noreferrer');
                  });
                }} />
          ))}
          {shown.length === 0 && <p className="ib-req-wp-empty">{emptyText}</p>}
        </div>
      </div>

      {/* The right panel: a session is the product's own ThreadPane (ib-pane) alone — no wrapper, no double chrome. */}
      {panel !== null &&
        (panel.k === 'session' ? (
          <EmbeddedThread threadId={panel.threadId} fileId={panel.fileId ?? null} artifacts={panel.artifacts ?? false} onToast={onToast} onClose={() => setPanel(null)} onChanged={() => { void inboxApi.thread(panel.threadId).then((r) => putThread(queryClient, panel.threadId, r)); }} />
        ) : (
          <div className="ib-req-wp-panel">
            <PanelContent panel={panel} requirements={requirements ?? []} rowsByThread={rowsForCards} onClose={() => setPanel(null)} onOpenThread={(tid) => setPanel({ k: 'session', threadId: tid })} onToast={onToast} onReview={(reqId, dlvId) => {
                  // 评审由守护进程自起门控会话；路由等会话起好从登记簿拿地址返回，窗口统一打开（首击即达）。
                  onToast({ icon: 'clock', lead: '正在打开评审页…' });
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
function ReqCard({ requirement: r, rowsByThread, patch, onSession, onContexts, onHistory, onNewSession, onToast, onReview }: {
  requirement: Requirement;
  rowsByThread: Map<string, unknown>;
  /** 乐观写（useRequirements 的 patch）：归档/恢复/重新开启都走它，卡片在视图间流动。 */
  patch: (id: string, patch: { stage?: RequirementStage; archived?: boolean }) => Promise<boolean>;
  onSession: (threadId: string) => void;
  onContexts: () => void;
  onHistory: () => void;
  onNewSession: () => void;
  onToast: (toast: unknown, ms?: number) => void;
  onReview: (requirementId: string, deliverableId: string) => void;
}) {
  // 弹层的容器：.pn-inbox 本身（同 CopyMenus 的 usePortal）。菜单出 .pn-inbox 门，
  // svg 拿不到描边样式，图标会糊成实心块——工坊菜单此前没传 container，正是这个症状。
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [portal, setPortal] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const root = cardRef.current?.closest<HTMLElement>('.pn-inbox');
    if (root) setPortal(root);
  });
  const dead = r.archived_at != null;
  return (
    <div ref={cardRef} className="ib-req-wcard" data-requirement-id={r.id} data-dead={dead ? '' : undefined}>
      <div className="ib-req-wcard-head">
        <b className="ib-req-wcard-title" dir="auto">{r.title}</b>
        {r.stage === 'done' && !dead && <span className="ib-req-wcard-done" title="阶段已到完成">✓ 已完成</span>}
        {/* 常驻图标操作（气泡提示名字与数量）；窄面板下随标题换行、右对齐 */}
        <div className="ib-req-wcard-acts">
          <Tip content={`开启新会话${r.threads.length > 0 ? `（已有 ${r.threads.length} 个）` : ''}`}>
            <button type="button" className="ib-req-wact" onClick={onNewSession} aria-label="开启新会话"><Icon name="chatPlus" size={15} /></button>
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
            <Menu.Portal container={portal ?? undefined}>
              <Menu.Positioner className="ib-pm-pos" side="bottom" align="end" sideOffset={4}>
                <Menu.Popup className="ib-pm" aria-label={`需求「${r.title}」的操作`}>
                  <Menu.Item className="ib-pmi" label="上下文" onClick={onContexts} data-req-menu="contexts">
                    <Icon name="book" size={15} /> 上下文（{r.contexts.length}）
                  </Menu.Item>
                  {dead ? (
                    <Menu.Item className="ib-pmi" label="恢复" onClick={() => { void patch(r.id, { archived: false }).then((ok) => { if (!ok) onToast({ icon: 'excl', lead: '恢复失败', wrap: true }); }); }} data-req-menu="restore">
                      <Icon name="restart" size={15} /> 恢复（回到进行中）
                    </Menu.Item>
                  ) : (
                    <>
                      {r.stage === 'done' && (
                        <Menu.Item className="ib-pmi" label="重新开启" onClick={() => { void patch(r.id, { stage: 'design' }).then((ok) => { if (!ok) onToast({ icon: 'excl', lead: '重新开启失败', wrap: true }); }); }} data-req-menu="reopen">
                          <Icon name="restart" size={15} /> 重新开启（回到需求设计）
                        </Menu.Item>
                      )}
                      <Menu.Separator className="ib-pm-sep" />
                      <Menu.Item className="ib-pmi" label="归档需求" onClick={() => { void patch(r.id, { archived: true }).then((ok) => { if (!ok) onToast({ icon: 'excl', lead: '归档失败', wrap: true }); }); }} data-req-menu="archive">
                        <Icon name="archive" size={15} /> 归档（释放全部会话）
                      </Menu.Item>
                    </>
                  )}
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
          const row = rowsByThread.get(tid) as { subject?: string | null; section?: string; run?: 'starting' | 'working' | 'cloning' | null; launch_id?: string | null; busy?: boolean | null; resolved_at: string | null; back_from_archive?: boolean; unread?: boolean } | undefined;
          const agent = row ? rowAgent(row as never) : null;
          // 已归档：行从归档列表来（活跃列表不收），展示照旧（图标、标题都是原来的），
          // 只加「已归档」——与收件箱的字序一致，它顶掉工作状态与等你回复。
          const archived = row ? inboxRowArchived(row) : false;
          const waiting = !archived && (row?.section === 'stopped' || row?.section === 'holding' || row?.section === 'waiting');
          const subject = (row?.subject?.trim() ? row.subject : null) ?? '会话';
          // 工作状态＝收件箱会话行自己的方案：行上的 run 字（启动的会话才有，launch 的 run line 决定），
          // 同一个字表（InboxList 的 countWords）；手动起的会话没有 run 字，读行上装饰的 busy（连接的 poll
          // 说有回合在跑）；event: deliveries 挪动它们，这里不自己轮询。
          const runWord = archived ? null : row?.run === 'starting' ? '启动中' : row?.run === 'cloning' ? '克隆中' : row?.run === 'working' || row?.busy === true ? '工作中' : null;
          // 打断（v2，会话级）：回合正在跑（run 字「工作中」，或行上的 busy——手动起的会话没有 run 字）就可
          // 打断——按会话下达，手动终端起的会话和工坊启动的一视同仁。
          return (
            <div key={tid} role="button" tabIndex={0} className="ib-req-wcard-sess" onClick={() => onSession(tid)} onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); onSession(tid); } }}>
              <span className={`ib-req-wcard-sess-mk${runWord !== null ? ' running' : ''}`}>{agent?.kind === 'agent' ? <HostMark host={agent.host} /> : <Icon name="comment" size={14} />}</span>
              <span className={`ib-req-wcard-sess-t${row?.unread && !archived ? ' is-unread' : ''}`} dir="auto">{subject}</span>
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
              {/* 有新消息（send_message 落下未看）：与收件箱行同一个 row.unread 数据源，粗体 + 「新消息」标。 */}
              {!archived && row?.unread && (
                <span className="ib-req-wcard-new">新消息</span>
              )}
              {(() => {
                // 去审阅跟会话走：只看这条会话有没有「待审」的设计文档（交付时记的 thread 匹配 +
                // 无裁决），与 stage 无关——阶段由 progress（MCP）流转，两边互不拖累。
                // 多份待审 → 点击弹下拉（只列待审的）；单份 → 直接触发审阅。
                // 全部裁决完 → 不显示（结果态在历史页看）。
                const pending = r.deliverables.filter((d) => d.thread === tid && d.kind === 'design-doc' && d.verdict === undefined);
                if (pending.length === 0) return null;
                if (pending.length === 1) {
                  const doc = pending[0]!;
                  return (
                    <Tip content={`去审阅 · ${doc.title ?? doc.ref}`}>
                      <button
                        type="button"
                        className="ib-req-wcard-sess-review"
                        aria-label={`去审阅 ${doc.title ?? doc.ref}`}
                        onClick={(ev) => { ev.stopPropagation(); onReview(r.id, doc.id); }}
                      >
                        <Icon name="search" size={11} />
                        <span>去审阅</span>
                      </button>
                    </Tip>
                  );
                }
                return (
                  <Menu.Root modal={false}>
                    <Menu.Trigger
                      className="ib-req-wcard-sess-review"
                      aria-label={`去审阅：本会话有 ${pending.length} 份待审设计文档`}
                      data-sess-review-menu=""
                      onClick={(ev) => ev.stopPropagation()}
                      onKeyDown={(ev) => ev.stopPropagation()}
                    >
                      <Icon name="search" size={11} />
                      <span>去审阅</span>
                    </Menu.Trigger>
                    <Menu.Portal container={portal ?? undefined}>
                      <Menu.Positioner className="ib-pm-pos" side="bottom" align="end" sideOffset={4}>
                        <Menu.Popup className="ib-pm" aria-label={`待审设计文档（${pending.length}）`}>
                          {pending.map((doc) => (
                            <Menu.Item key={doc.id} className="ib-pmi" label={doc.title ?? doc.ref} onClick={() => onReview(r.id, doc.id)} data-sess-review-doc={doc.id}>
                              <Icon name="doc" size={15} /> {doc.title ?? doc.ref}
                            </Menu.Item>
                          ))}
                        </Menu.Popup>
                      </Menu.Positioner>
                    </Menu.Portal>
                  </Menu.Root>
                );
              })()}
              <span className="ib-req-wcard-stage">{requirementStageLabel(r.stage)}</span>
              {/* 门控代码评审（挂会话）挪进行尾 ⋯ 菜单：悬停才现的图标太隐晦，菜单里给它名字和去向。 */}
              <Menu.Root modal={false}>
                <Menu.Trigger
                  className="ib-req-wcard-sess-more"
                  aria-label={`会话「${subject}」的更多操作`}
                  data-sess-more=""
                  onClick={(ev) => ev.stopPropagation()}
                  onKeyDown={(ev) => ev.stopPropagation()}
                >
                  <Icon name="dots" size={14} />
                </Menu.Trigger>
                <Menu.Portal container={portal ?? undefined}>
                  <Menu.Positioner className="ib-pm-pos" side="bottom" align="end" sideOffset={4}>
                    <Menu.Popup className="ib-pm" aria-label={`会话「${subject}」的操作`}>
                      {/* 页面自开、带 关闭/通过，结论落需求历史并送达本会话。 */}
                      <Menu.Item className="ib-pmi" label="代码评审" data-sess-menu="code-review" onClick={() => {
                        void startSessionCodeReview(r.id, tid).then((outcome) => {
                          if (!outcome.ok) { onToast({ icon: 'excl', lead: `代码评审没能打开：${outcome.error}`, wrap: true }); return; }
                          if (outcome.answer.state === 'already') {
                            // 标签被手动关掉不会杀门控子进程：评审其实还活着——把同一个链接重新打开（同设计评审的复用路径）。
                            if (outcome.answer.url) window.open(outcome.answer.url, '_blank', 'noreferrer');
                            onToast({ icon: 'clock', lead: outcome.answer.url ? '这个会话的评审还在进行中——已重新打开那个评审页。' : '这个会话的评审已在进行中，评审页即将弹出。' });
                            return;
                          }
                          onToast({ icon: 'check', lead: '评审页已打开；结论将送达本会话并记入需求历史。' });
                        });
                      }}>
                        <Icon name="gitBranch" size={15} /> 代码评审 · 结论送达本会话
                      </Menu.Item>
                      {!archived && (row?.run === 'working' || row?.busy === true) && (
                        <>
                          <Menu.Separator className="ib-pm-sep" />
                          <Menu.Item className="ib-pmi" label="打断" data-sess-menu="interrupt" onClick={() => {
                            void inboxApi.interruptThread(tid).then(
                              () => onToast({ icon: 'check', lead: '已请求打断，正在停止当前回合…' }),
                              (cause: unknown) => onToast({ icon: 'excl', lead: cause instanceof Error && cause.message ? `打断没能送达：${cause.message}` : '打断没能送达，请重试。', wrap: true }),
                            );
                          }}>
                            <Icon name="xCircle" size={15} /> 打断 · 停止当前回合
                          </Menu.Item>
                        </>
                      )}
                    </Menu.Popup>
                  </Menu.Positioner>
                </Menu.Portal>
              </Menu.Root>
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
function PanelContent({ panel, requirements, rowsByThread, onClose, onOpenThread, onReview, onToast }: {
  panel: NonNullable<Panel>;
  requirements: Requirement[];
  /** 会话行（subject 等），历史里给事件标会话归属用。 */
  rowsByThread: Map<string, unknown>;
  onClose: () => void;
  /** 历史里的会话归属点开该会话（事件的 thread 是收件箱线程 id 才可点）。 */
  onOpenThread: (threadId: string) => void;
  onReview: (reqId: string, deliverableId: string) => void;
  onToast: (toast: unknown, ms?: number) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [, setAnnotating] = useState<string | null>(null);
  /** 上下文增删后 +1，重读详情。 */
  const [bump, setBump] = useState(0);
  const [detail, setDetail] = useState<{ requirement: Requirement; events: RequirementEvent[] } | null>(null);
  /** 历史的会话过滤：'all' | thread id | 'none'（工坊手动操作/旧事件）。 */
  const [histFilter, setHistFilter] = useState<string>('all');
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

  // history —— 事件的会话归属：事件自带 thread（progress 记的），交付/裁决从交付物的 thread 回查；
  // 其余（创建/挂会话/归档/旧事件）无归属。过滤条按会话切，含「无归属」。
  const events = detail?.events ?? [];
  const dlvById = new Map((detail?.requirement.deliverables ?? req?.deliverables ?? []).map((d) => [d.id, d]));
  const threadOf = (e: RequirementEvent): string | null => {
    if (e.thread) return e.thread;
    if (e.from && dlvById.has(e.from)) return dlvById.get(e.from)!.thread ?? null;
    return null;
  };
  const histSessions = (detail?.requirement.threads ?? req?.threads ?? []).map((tid) => {
    const row = rowsByThread.get(tid) as { subject?: string | null } | undefined;
    return { id: tid, subject: row?.subject?.trim() || '会话' };
  });
  // 同名会话（subject 相同的多条）在 chip 上带 id 尾缀区分。
  const dupSubjects = new Set(histSessions.map((s) => s.subject).filter((subject, i, all) => all.indexOf(subject) !== i));
  const sessLabel = (tid: string) => {
    const s = histSessions.find((x) => x.id === tid);
    return s ? (dupSubjects.has(s.subject) ? `${s.subject} …${s.id.slice(-4)}` : s.subject) : '会话';
  };
  const filterOf = (e: RequirementEvent) => threadOf(e) ?? 'none';
  const shown = histFilter === 'all' ? events : events.filter((e) => filterOf(e) === histFilter);

  // history
  return (
    <>
      {top(`历史 · ${req?.title ?? ''}`)}
      <div className="ib-req-hist-fbar" role="group" aria-label="按会话过滤历史">
        <span className="ib-req-hist-fbar-label">会话</span>
        <button type="button" className={`ib-req-hist-fchip${histFilter === 'all' ? ' on' : ''}`} onClick={() => setHistFilter('all')}>全部 <span className="n">{events.length}</span></button>
        {histSessions.map((s) => (
          <button key={s.id} type="button" className={`ib-req-hist-fchip${histFilter === s.id ? ' on' : ''}`} title={s.id} onClick={() => setHistFilter(s.id)}>
            <Icon name="chatPlus" size={11} /> <span className="subj">{sessLabel(s.id)}</span> <span className="n">{events.filter((e) => filterOf(e) === s.id).length}</span>
          </button>
        ))}
        <button type="button" className={`ib-req-hist-fchip none${histFilter === 'none' ? ' on' : ''}`} onClick={() => setHistFilter('none')}>无归属 <span className="n">{events.filter((e) => filterOf(e) === 'none').length}</span></button>
      </div>
      <div className="ib-req-wp-panel-body ib-req-hist-body">
        <ol className="ib-req-hist">
          {[...shown].reverse().map((e) => {
            const stageLine = e.kind === 'stage' && (e.from || e.to)
              ? `${e.from ? requirementStageLabel(e.from as never) : '?'} → ${e.to ? requirementStageLabel(e.to as never) : '?'}`
              : null;
            const note = e.note ?? '';
            const owner = threadOf(e);
            const isVerdict = e.kind === 'say' && e.field === '审阅裁决';
            const dataK = isVerdict ? (e.to === 'approved' ? 'verdict-ok' : 'verdict-back') : e.kind;
            // 归属只在收件箱里真有这个线程时才算数（旧数据存过引擎会话 id，解析不出线程 → 无归属）。
            const ownerRow = owner !== null ? (rowsByThread.get(owner) as { subject?: string | null } | undefined) : undefined;
            const ownerChip = owner === null || ownerRow === undefined
              ? <span className="ib-req-hist-sess none" title="工坊手动操作、旧事件，或产出会话不在收件箱里">无归属</span>
              : (() => {
                  const subject = ownerRow?.subject?.trim() || '会话';
                  const dup = histSessions.filter((s) => s.subject === subject).length > 1;
                  return (
                    <button type="button" className="ib-req-hist-sess" title={`打开会话 ${subject}`} onClick={() => onOpenThread(owner)}>
                      <Icon name="chatPlus" size={11} /> {subject}{dup ? <span className="tail">…{owner.slice(-4)}</span> : null}
                    </button>
                  );
                })();
            return (
              <li key={e.id} className="ib-req-hist-item" data-k={dataK}>
                <span className="ib-req-hist-time">{timeOf(e.at)}</span>
                <span className="ib-req-hist-dot" aria-hidden="true" />
                <div className="ib-req-hist-main">
                  <div className="ib-req-hist-head">
                    <span className="ib-req-hist-kind">{isVerdict ? '审阅裁决' : e.kind === 'deliverable' ? DELIVERABLE_KIND_LABELS[(e.to ?? '') as never] ?? '交付' : EVENT_WORDS[e.kind] ?? e.kind}</span>
                    {stageLine && <span className="ib-req-hist-sub" dir="auto">{stageLine}</span>}
                    {!stageLine && !isVerdict && e.kind !== 'deliverable' && e.field && <span className="ib-req-hist-sub" dir="auto">{e.field}</span>}
                    {ownerChip}
                  </div>
                  {note.trim() && (e.kind === 'deliverable' && e.field ? (
                    <div className="ib-req-hist-dlv" data-review={(() => {
                      const older = (detail?.requirement.deliverables ?? []).find((d) => (d.title ?? d.ref) === note) ?? null;
                      const ref = e.field ?? older?.ref ?? '';
                      const dlvId = e.from ?? older?.id ?? '';
                      // 待审高亮只看交付物本身（design-doc 且无裁决），与 stage 无关。
                      const verdict = dlvId ? (detail?.requirement.deliverables ?? []).find((d) => d.id === dlvId)?.verdict : undefined;
                      return verdict === undefined && e.to === 'design-doc' && /\.(md|markdown|txt|html?)$/i.test(ref) && dlvId && reqId ? '' : undefined;
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
                        // 待审的设计文档点了进评审；已有裁决或非文档落回普通预览。
                        const doc = (detail?.requirement.deliverables ?? req?.deliverables ?? []).find((d) => d.id === dlvId);
                        const verdict = doc?.verdict;
                        const underReview = verdict === undefined && (doc?.kind ?? e.to) === 'design-doc' && /\.(md|markdown|txt|html?)$/i.test(ref);
                        if (underReview) { onReview(reqId, dlvId); return; }
                        if (/^https?:/.test(ref)) { window.open(ref, '_blank', 'noreferrer'); return; }
                        {
                          setAnnotating(e.id ?? ref);
                          onToast({ icon: 'clock', lead: '正在打开批注页…' });
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
                      const doc = (detail?.requirement.deliverables ?? req?.deliverables ?? []).find((d) => d.id === dlvId);
                      const reviewable = (doc?.kind ?? e.to) === 'design-doc' && /\.(md|markdown|txt|html?)$/i.test(ref) && dlvId && reqId;
                      if (!reviewable) return null;
                      // 有裁决就不是「去审阅」了：已批准/已退回（deliverable.verdict，读侧算来的结果状态）。
                      const verdict = doc?.verdict;
                      if (verdict === 'approved' || verdict === 'annotated') {
                        return <span className={`ib-req-hist-verdict${verdict === 'approved' ? ' ok' : ' back'}`}>{verdict === 'approved' ? '已批准' : '已退回'}</span>;
                      }
                      return <button type="button" className="ib-req-hist-review" onClick={() => reqId && onReview(reqId, dlvId)}>去审阅</button>;
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
          {events.length > 0 && shown.length === 0 && <p className="ib-req-hist-none">这个会话还没有事件。</p>}
        </ol>
      </div>
      {error && <p className="ib-error" role="alert">{error}</p>}
    </>
  );
}

