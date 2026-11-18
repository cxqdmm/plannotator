/**
 * The Requirements panel (「需求」): a Board-style kanban — the seven lifecycle
 * stages as lanes, cards dragged between them — with the detail pane a
 * requirement opens into (CardPanel's own classes: ib-crdp), all drawn with
 * the Inbox's look in light and dark. The pane carries the Wave 2a surface:
 * rename, notes, 归档/恢复 stays on the card's hover corner, the person
 * adopts or dismisses an agent's stage suggestions (D1: only the person
 * moves), deliverables are attached by hand here or by an agent over the
 * `requirement` MCP tool, and the linked threads (D3: many) open in the
 * Inbox. Owns its data (useRequirements) so App.tsx only mounts it.
 *
 * Words are Simplified Chinese in place, this fork's rule.
 */
import { useEffect, useRef, useState } from 'react';
import { Icon } from '../../icons';
import { SidebarTrigger } from '../../shell/sidebar';
import { subscribeRequirementFrames } from '../frames';
import { adoptSuggestion, deliverRequirement, dismissSuggestion, readRequirement, removeDeliverable, startDesignReview } from '../api';
import { inboxApi } from '../../api';
import type { InboxLaunchAgent } from '@plannotator/core/inbox-types';
import { CopyCommand } from '../../components/RestartNote';
import { useRequirements } from '../useRequirements';
import {
  DELIVERABLE_KINDS,
  DELIVERABLE_KIND_LABELS,
  REQUIREMENT_STAGES,
  requirementStageLabel,
  type Deliverable,
  type Requirement,
  type RequirementEvent,
  type RequirementStage,
} from '@plannotator/core/requirements-types';

/** Each stage's mark: the system's own SVG icons, the colour every other one draws in. */
const STAGE_ICON: Record<RequirementStage, Parameters<typeof Icon>[0]['name']> = {
  triage: 'inbox',
  design: 'pen',
  'design-review': 'eye',
  dev: 'code',
  qa: 'todo',
  'code-review': 'reviews',
  done: 'check',
};

const KIND_OPTIONS = DELIVERABLE_KINDS.map((kind) => ({ id: kind, label: DELIVERABLE_KIND_LABELS[kind] }));

const EVENT_WORDS: Readonly<Record<RequirementEvent['kind'], string>> = {
  created: '创建',
  stage: '移阶段',
  field: '修改',
  deleted: '删除',
  say: '进展',
  deliverable: '产物',
  suggestion: '建议',
};

const timeOf = (iso: string): string => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};

/** One requirement as a lane card: the title opens the detail pane; 归档/恢复 from the hover corner. */
function RequirementCard({
  requirement,
  open,
  dragging,
  draggable,
  onDragStart,
  onDragEnd,
  onOpen,
  onArchiveToggle,
}: {
  requirement: Requirement;
  open: boolean;
  dragging: boolean;
  draggable: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onOpen: () => void;
  onArchiveToggle: () => void;
}) {
  const archived = requirement.archived_at != null;
  return (
    <li
      className="ib-bcard"
      data-card-id={requirement.id}
      data-requirement-id={requirement.id}
      data-stage={requirement.stage}
      data-dragging={dragging ? '' : undefined}
      data-open={open ? '' : undefined}
      draggable={draggable ? true : undefined}
      onDragStart={(event) => {
        event.dataTransfer.setData('text/plain', requirement.id);
        event.dataTransfer.effectAllowed = 'move';
        onDragStart();
      }}
      onDragEnd={onDragEnd}
    >
      <button
        type="button"
        className="ib-req-corner"
        title={archived ? '恢复到看板' : '归档'}
        aria-label={archived ? '恢复到看板' : '归档'}
        onClick={onArchiveToggle}
      >
        <Icon name={archived ? 'back' : 'archive'} size={14} />
      </button>
      <span className="ib-bc-top">
        <button type="button" className="ib-bc-main" data-card-open="" title={requirement.title} onClick={onOpen}>
          <span className="ib-bc-t" dir="auto">
            {requirement.title}
          </span>
        </button>
      </span>
      {(requirement.suggestions.length > 0 || requirement.deliverables.length > 0 || requirement.threads.length > 0) && (
        <span className="ib-bc-bot">
          <span className="ib-bc-line ib-req-line">
            {requirement.suggestions.length > 0 && (
              <span className="ib-req-mark" title={requirement.suggestions.map((s) => `${requirementStageLabel(s.stage)}：${s.why}`).join('\n')}>
                <Icon name="swap" size={12} /> {requirementStageLabel(requirement.suggestions[0]!.stage)}
              </span>
            )}
            {requirement.deliverables.length > 0 && (
              <span className="ib-req-mark" title={requirement.deliverables.map((entry) => `${DELIVERABLE_KIND_LABELS[entry.kind]}：${entry.title ?? entry.ref}`).join('\n')}>
                <Icon name="clip" size={12} /> {requirement.deliverables.length}
              </span>
            )}
            {requirement.threads.length > 0 && (
              <span className="ib-req-mark" title={`关联 ${requirement.threads.length} 个线程`}>
                <Icon name="comment" size={12} /> {requirement.threads.length}
              </span>
            )}
          </span>
        </span>
      )}
    </li>
  );
}

/** The detail pane (CardPanel's classes): suggestions to adopt, notes, deliverables, threads, history. */
function RequirementDetail({
  id,
  onClose,
  onPatch,
  onOpenThread,
}: {
  id: string;
  onClose: () => void;
  onPatch: (id: string, patch: { title?: string; notes?: string; stage?: RequirementStage; threads?: string[] }) => void;
  onOpenThread: (threadId: string) => void;
}) {
  const [detail, setDetail] = useState<{ requirement: Requirement; events: RequirementEvent[] } | null>(null);
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [threadDraft, setThreadDraft] = useState('');
  const [deliverKind, setDeliverKind] = useState<string>(KIND_OPTIONS[0]!.id);
  const [deliverRef, setDeliverRef] = useState('');
  const [deliverTitle, setDeliverTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [reviewStarting, setReviewStarting] = useState(false);
  // 「开始做」: the form a fresh requirement opens on — the agents and projects the person can start (compose's
  // own launch read), the words the session starts with, and the going-out itself.
  const [start, setStart] = useState<{ agents: { agent: string; name: string }[]; projects: { id: string; name: string; root: string }[]; agent: string; project: string; words: string } | null>(null);
  const [startLoading, setStartLoading] = useState(false);
  const [starting, setStarting] = useState(false);
  const reload = useRef<AbortController | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** 开始做: read what this machine can start (the compose launch block), then the form. */
  const beginStart = () => {
    setStartLoading(true);
    void inboxApi.composeSessions().then((model) => {
      const agents = (model.launch?.agents ?? []).map(({ agent, name }) => ({ agent, name }));
      const projects = (model.launch?.projects ?? []).filter((project) => project.exists);
      if (agents.length === 0 || projects.length === 0) {
        setStart(null);
        setError(agents.length === 0 ? '这台机器现在起不了新会话（没有可用的 agent 运行时）。' : '没有可选的项目文件夹——先在收件箱的 To 里看一眼可用的项目。');
        return;
      }
      const claude = agents.find((entry) => entry.agent === 'claude-code') ?? agents[0]!;
      setStart({ agents, projects, agent: claude.agent, project: projects[0]!.id, words: `用 plannotator requirement 工具开始做「${detail?.requirement.title ?? ''}」，先出设计方案，产出用 deliver 挂回这条需求。` });
    }).catch((cause) => {
      setError(cause instanceof Error ? cause.message : String(cause));
    }).finally(() => setStartLoading(false));
  };

  /** The form's send: a new thread whose first message is the requirement's own words (startThread's launch
   *  target starts the session), the thread linked at once (D2: auto-attach, the link never waits on the agent),
   *  and the person lands in the thread — the 对话流 pane is where the work then runs. */
  const submitStart = () => {
    if (!start || starting) return;
    setStarting(true);
    void inboxApi.startThread({
      to: { launch: { agent: start.agent as InboxLaunchAgent, project_id: start.project } },
      body: start.words,
      idempotency_key: crypto.randomUUID(),
      thread_name: detail?.requirement.title ?? undefined,
    }).then((answer) => {
      const linked = [...(detail?.requirement.threads ?? []), answer.thread_id];
      onPatch(id, { threads: linked });
      onOpenThread(answer.thread_id);
    }).catch((cause) => {
      setError(cause instanceof Error ? cause.message : String(cause));
      setStarting(false);
    });
  };

  const read = () => {
    reload.current?.abort();
    const controller = new AbortController();
    reload.current = controller;
    void readRequirement(id, controller.signal).then((answer) => {
      if (controller.signal.aborted) return;
      setDetail(answer);
      if (answer) {
        setTitle(answer.requirement.title);
        setNotes(answer.requirement.notes);
      }
    });
  };

  useEffect(() => {
    setDetail(null);
    setError(null);
    read();
    // A change anywhere re-reads the open pane (the frames say what changed; one read keeps it exact).
    const stop = subscribeRequirementFrames(() => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(read, 60);
    });
    return () => {
      stop();
      reload.current?.abort();
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const requirement = detail?.requirement ?? null;

  const saveTitle = () => {
    const next = title.trim();
    if (requirement && next && next !== requirement.title) onPatch(id, { title: next });
    else if (requirement) setTitle(requirement.title);
  };

  const saveNotes = () => {
    if (requirement && notes !== requirement.notes) onPatch(id, { notes });
  };

  const attach = async () => {
    const ref = deliverRef.trim();
    if (!ref) return;
    const outcome = await deliverRequirement(id, { kind: deliverKind, ref, ...(deliverTitle.trim() ? { title: deliverTitle.trim() } : {}) });
    if (!outcome.ok) setError(outcome.error);
    else {
      setDeliverRef('');
      setDeliverTitle('');
      read();
    }
  };

  /** 「发起设计文档评审」: the server opens the gated annotate session; the pane refreshes when it lands. */
  const startReview = async () => {
    setReviewStarting(true);
    const outcome = await startDesignReview(id);
    if (!outcome.ok) {
      setError(outcome.error);
      setReviewStarting(false);
    }
  };

  return (
    <aside className="ib-crdp ib-req-detail" aria-label="需求详情" data-requirement-detail={id}>
      <div className="ib-crdp-top">
        <button type="button" className="ib-bback" data-requirements-back="" onClick={onClose}>
          <Icon name="chevL" size={16} />
          <span className="ib-bback-l">需求</span>
        </button>
        <span className="ib-req-stage ib-crdp-colsent">{requirement ? requirementStageLabel(requirement.stage) : ''}</span>
        <button type="button" className="ib-crdp-x" aria-label="关闭详情" onClick={onClose}>
          <Icon name="x" size={16} />
        </button>
      </div>
      {requirement === null ? (
        <div className="ib-crdp-body">
          <p aria-busy="true">读取需求中…</p>
        </div>
      ) : (
        <div className="ib-crdp-body">
          <input
            ref={(node) => {
              if (node) queueMicrotask(() => node.focus());
            }}
            className="ib-req-title"
            aria-label="需求标题"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            onBlur={saveTitle}
            onKeyDown={(event) => event.key === 'Enter' && saveTitle()}
          />

          {requirement.threads.length === 0 && requirement.deliverables.length === 0 && (
            <section className="ib-req-next" aria-label="下一步">
              <h3 className="ib-req-h">下一步</h3>
              {start === null ? (
                <>
                  <p className="ib-req-empty">在 Inbox 里直接开工：起一个会话做这条需求，线程自动连进来，产出与建议回到这里。</p>
                  <button type="button" className="ib-btn ib-req-launch" data-requirements-start="" disabled={startLoading} onClick={beginStart}>
                    <Icon name="play" size={14} />
                    {startLoading ? '读取可用环境…' : '开始做'}
                  </button>
                  {/* 已有跑着的终端会话：老路仍在——那句话交给它，它的线程同样连进来。 */}
                  <details className="ib-req-handoff">
                    <summary>已有终端里的会话？给它这句话</summary>
                    <div className="ib-rw-cmd">
                      <code data-requirements-handoff="">{`用 plannotator requirement 工具开始做「${requirement.title}」，先出设计方案。`}</code>
                      <CopyCommand text={`用 plannotator requirement 工具开始做「${requirement.title}」，先出设计方案。`} label="复制交给 agent 的话" announcement="已复制。粘贴到一个 Claude Code 会话即可。" />
                    </div>
                  </details>
                </>
              ) : (
                <div className="ib-req-start" data-requirements-start-form="">
                  <label className="ib-req-start-row">
                    项目
                    <select value={start.project} onChange={(event) => setStart({ ...start, project: event.target.value })} aria-label="项目">
                      {start.projects.map((project) => (
                        <option key={project.id} value={project.id}>{project.name}</option>
                      ))}
                    </select>
                  </label>
                  {start.agents.length > 1 && (
                    <label className="ib-req-start-row">
                      会话
                      <select value={start.agent} onChange={(event) => setStart({ ...start, agent: event.target.value })} aria-label="会话类型">
                        {start.agents.map((agent) => (
                          <option key={agent.agent} value={agent.agent}>{agent.name}</option>
                        ))}
                      </select>
                    </label>
                  )}
                  <label className="ib-req-start-row">
                    首条消息
                    <textarea rows={3} value={start.words} onChange={(event) => setStart({ ...start, words: event.target.value })} aria-label="首条消息" />
                  </label>
                  <div className="ib-req-start-act">
                    <button type="button" className="ib-btn" data-requirements-start-send="" disabled={starting || !start.words.trim()} onClick={() => void submitStart()}>
                      <Icon name="play" size={14} />
                      {starting ? '正在启动…' : '开始'}
                    </button>
                    <button type="button" className="ib-btn ib-sm" disabled={starting} onClick={() => setStart(null)}>
                      取消
                    </button>
                  </div>
                  <p className="ib-req-empty">会话在所选项目里启动，带上这条需求开工；你会直接落到它的线程里，右上角的星标就是它的对话流。</p>
                </div>
              )}
            </section>
          )}

          {requirement.suggestions.length > 0 && (
            <section className="ib-req-sug" aria-label="阶段建议">
              {requirement.suggestions.map((suggestion) => (
                <div key={suggestion.id} className="ib-req-sug-row">
                  <span className="ib-req-sug-why">
                    建议 → <b>{requirementStageLabel(suggestion.stage)}</b>：{suggestion.why} <span className="ib-req-sug-by">（{suggestion.by}）</span>
                  </span>
                  <span className="ib-req-sug-act">
                    <button
                      type="button"
                      className="ib-btn ib-sm"
                      onClick={() => void adoptSuggestion(id, suggestion.id).then((outcome) => (outcome.ok ? read() : setError(outcome.error)))}
                    >
                      采纳
                    </button>
                    <button
                      type="button"
                      className="ib-req-x"
                      aria-label="忽略建议"
                      title="忽略"
                      onClick={() => void dismissSuggestion(id, suggestion.id).then((outcome) => (outcome.ok ? read() : setError(outcome.error)))}
                    >
                      <Icon name="x" size={13} />
                    </button>
                  </span>
                </div>
              ))}
            </section>
          )}

          <section aria-label="设计评审">
            <button type="button" className="ib-btn ib-req-launch" data-requirements-review="" disabled={reviewStarting} onClick={() => void startReview()}>
              <Icon name="pen" size={14} />
              {reviewStarting ? '评审已打开，完成后自动挂回…' : '发起设计文档评审'}
            </button>
            <p className="ib-req-empty">打开 Plannotator 的批注页评审当前设计文档；批准后自动建议进入下一阶段。文档首次从需求生成，之后保留你的修改。</p>
          </section>

          <section aria-label="产物">
            <h3 className="ib-req-h">产物</h3>
            {requirement.deliverables.length === 0 ? (
              <p className="ib-req-empty">还没有产物。阶段期望的产出（设计文档、评审结论…）由你或 agent 挂接。</p>
            ) : (
              <ul className="ib-req-list">
                {requirement.deliverables.map((deliverable: Deliverable) => (
                  <li key={deliverable.id} className="ib-req-dlv">
                    <span className="ib-req-dlv-kind">{DELIVERABLE_KIND_LABELS[deliverable.kind]}</span>
                    <a className="ib-req-dlv-ref" href={/^https?:/.test(deliverable.ref) ? deliverable.ref : undefined} title={deliverable.ref} target="_blank" rel="noreferrer">
                      {deliverable.title ?? deliverable.ref}
                    </a>
                    <span className="ib-req-dlv-meta">
                      {deliverable.by ? deliverable.by : ''} {timeOf(deliverable.created_at)}
                    </span>
                    <button type="button" className="ib-req-x" aria-label="移除产物" title="移除" onClick={() => void removeDeliverable(id, deliverable.id).then((outcome) => (outcome.ok ? read() : setError(outcome.error)))}>
                      <Icon name="x" size={13} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="ib-req-add">
              <select aria-label="产物类型" value={deliverKind} onChange={(event) => setDeliverKind(event.target.value)}>
                {KIND_OPTIONS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
              <input aria-label="产物指向" placeholder="会话 id / owner/repo#123 / URL / 路径" value={deliverRef} onChange={(event) => setDeliverRef(event.target.value)} />
              <input aria-label="产物名称" placeholder="名称（可选）" value={deliverTitle} onChange={(event) => setDeliverTitle(event.target.value)} />
              <button type="button" className="ib-btn ib-sm" onClick={() => void attach()}>
                挂接
              </button>
            </div>
          </section>

          <section aria-label="关联线程">
            <h3 className="ib-req-h">关联线程</h3>
            {requirement.threads.length === 0 ? (
              <p className="ib-req-empty">还没有关联线程。把讨论、开发的会话线程连进来，agent 就能通过 requirement 工具看到它。</p>
            ) : (
              <ul className="ib-req-threads">
                {requirement.threads.map((threadId) => (
                  <li key={threadId}>
                    <button type="button" className="ib-req-thread" title={threadId} onClick={() => onOpenThread(threadId)}>
                      <Icon name="comment" size={13} /> {threadId}
                    </button>
                    <button
                      type="button"
                      className="ib-req-x"
                      aria-label="取消关联"
                      title="取消关联"
                      onClick={() => onPatch(id, { threads: requirement.threads.filter((entry) => entry !== threadId) })}
                    >
                      <Icon name="x" size={13} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="ib-req-add">
              <input
                aria-label="线程 id"
                placeholder="msg_… 线程 id"
                value={threadDraft}
                onChange={(event) => setThreadDraft(event.target.value)}
                onKeyDown={(event) => {
                  const value = threadDraft.trim();
                  if (event.key === 'Enter' && value) {
                    onPatch(id, { threads: [...requirement.threads, value] });
                    setThreadDraft('');
                  }
                }}
              />
            </div>
          </section>

          <section aria-label="备注">
            <h3 className="ib-req-h">备注</h3>
            <textarea className="ib-req-notes" aria-label="需求备注" rows={4} value={notes} onChange={(event) => setNotes(event.target.value)} onBlur={saveNotes} placeholder="背景、验收标准…" />
          </section>

          <section aria-label="历史">
            <h3 className="ib-req-h">历史</h3>
            <ul className="ib-req-history">
              {[...(detail?.events ?? [])].reverse().slice(0, 12).map((event) => (
                <li key={event.id}>
                  <span className="ib-req-hist-time">{timeOf(event.at)}</span> {EVENT_WORDS[event.kind] ?? event.kind}
                  {event.note ? `：${event.note.length > 80 ? `${event.note.slice(0, 80)}…` : event.note}` : event.field ? `：${event.field}` : ''}
                </li>
              ))}
            </ul>
          </section>

          {error && (
            <p className="ib-error" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
    </aside>
  );
}

/** The panel: a Board page whose lanes are the seven stages; `archived` shows the 已归档 page instead. */
export function RequirementsPanel({ on, archived = false, openId = null, onView, onOpen, onOpenThread }: { on: boolean; archived?: boolean; openId?: string | null; onView: (archived: boolean) => void; onOpen: (id: string | null) => void; onOpenThread: (threadId: string) => void }) {
  const { requirements, archived: archivedList, archivedCount, create, patch, error, clearError } = useRequirements(on, subscribeRequirementFrames);
  const [composing, setComposing] = useState(false);
  const [draft, setDraft] = useState('');
  /** The card being dragged (the Board's own mechanism: state, not the dataTransfer's contents). */
  const [dragging, setDragging] = useState<Requirement | null>(null);
  const [over, setOver] = useState<RequirementStage | null>(null);

  const submit = () => {
    const title = draft.trim();
    if (!title) {
      setComposing(false);
      return;
    }
    setDraft('');
    void create({ title });
  };

  const shown = archived ? (archivedList ?? []) : (requirements ?? []);
  const lanes = new Map<RequirementStage, Requirement[]>(REQUIREMENT_STAGES.map((stage) => [stage.id, [] as Requirement[]]));
  for (const requirement of shown) lanes.get(requirement.stage)?.push(requirement);

  const board = (
    <div className="ib-blanes" data-dragging={dragging ? '' : undefined}>
      {REQUIREMENT_STAGES.map((stage) => {
        const cards = lanes.get(stage.id) ?? [];
        const target = !archived && dragging !== null && dragging.stage !== stage.id;
        const dragOver = (event: React.DragEvent) => {
          if (!target) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = 'move';
          if (over !== stage.id) setOver(stage.id);
        };
        return (
          <section
            key={stage.id}
            className="ib-lane"
            aria-labelledby={`ib-req-lane-${stage.id}`}
            data-lane={stage.id}
            data-drop={target ? '' : undefined}
            data-over={target && over === stage.id ? '' : undefined}
            onDragOver={dragOver}
            onDragEnter={dragOver}
            onDragLeave={(event) => {
              if (!(event.currentTarget as HTMLElement).contains(event.relatedTarget as Node | null)) setOver((current) => (current === stage.id ? null : current));
            }}
            onDrop={(event) => {
              event.preventDefault();
              const card = dragging;
              setDragging(null);
              setOver(null);
              if (card && card.stage !== stage.id) void patch(card.id, { stage: stage.id });
            }}
          >
            <h2 className="ib-lane-h" id={`ib-req-lane-${stage.id}`} tabIndex={-1}>
              <Icon name={STAGE_ICON[stage.id]} size={15} className="ib-req-lane-ico" />
              <span className="ib-lane-l">{stage.label}</span>
              <span className="ib-lane-n">{cards.length}</span>
            </h2>
            <ul className="ib-lane-cards" aria-labelledby={`ib-req-lane-${stage.id}`}>
              {!archived && stage.id === 'triage' && composing && (
                <li className="ib-bcard" data-composer="">
                  <span className="ib-bc-top">
                    <input
                      ref={(node) => queueMicrotask(() => node?.focus())}
                      className="ib-req-rename"
                      aria-label="需求标题"
                      placeholder="需求标题，回车创建"
                      value={draft}
                      onChange={(event) => setDraft(event.target.value)}
                      onBlur={submit}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') submit();
                        if (event.key === 'Escape') {
                          setDraft('');
                          setComposing(false);
                        }
                      }}
                    />
                  </span>
                </li>
              )}
              {cards.map((requirement) => (
                <RequirementCard
                  key={requirement.id}
                  requirement={requirement}
                  open={openId === requirement.id}
                  dragging={dragging?.id === requirement.id}
                  draggable={!archived}
                  onDragStart={() => setDragging(requirement)}
                  onDragEnd={() => {
                    setDragging(null);
                    setOver(null);
                  }}
                  onOpen={() => onOpen(requirement.id)}
                  onArchiveToggle={() => void patch(requirement.id, { archived: requirement.archived_at == null })}
                />
              ))}
            </ul>
            {cards.length === 0 && !(!archived && stage.id === 'triage' && composing) && <p className="ib-lane-empty">{archived ? '没有已归档的需求。' : stage.wants ? `还没有需求；此阶段产出${stage.wants}。` : '还没有需求。'}</p>}
          </section>
        );
      })}
    </div>
  );

  return (
    <section className="ib-bpage" aria-labelledby="ib-req-title" data-requirements-page="" data-requirements-view={archived ? 'archived' : 'board'}>
      <div className="ib-bhead">
        <SidebarTrigger />
        {archived ? (
          <>
            <button type="button" className="ib-bback" data-requirements-back="" onClick={() => onView(false)}>
              <Icon name="chevL" size={16} />
              需求
            </button>
            <h1 id="ib-req-title" tabIndex={-1}>
              已归档
            </h1>
          </>
        ) : (
          <>
            <h1 id="ib-req-title" tabIndex={-1}>
              需求
            </h1>
            <span className="ib-bsp" />
            <nav className="ib-blinks" aria-label="已归档的需求">
              <a
                href="#requirements&archived"
                data-requirements-link="archived"
                onClick={(event) => {
                  event.preventDefault();
                  onView(true);
                }}
              >
                已归档 {archivedCount}
              </a>
            </nav>
            <button
              type="button"
              className="ib-btn ib-sm ib-bnew"
              data-requirements-new=""
              onClick={() => {
                setComposing(true);
                clearError();
              }}
            >
              <Icon name="plus" size={15} />
              新建需求
            </button>
          </>
        )}
      </div>
      {error && (
        <div className="ib-error ib-bfail" role="alert">
          {error}
        </div>
      )}
      {openId ? (
        <div className="ib-bmain">
          {board}
          <RequirementDetail
            key={openId}
            id={openId}
            onClose={() => onOpen(null)}
            onPatch={(id, patchIn) => void patch(id, patchIn)}
            onOpenThread={onOpenThread}
          />
        </div>
      ) : (
        board
      )}
    </section>
  );
}
