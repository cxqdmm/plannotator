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
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from '../../icons';
import { SidebarTrigger } from '../../shell/sidebar';
import { subscribeRequirementFrames } from '../frames';
import { addContext, adoptSuggestion, annotateDeliverable, contextContent, deliverableContent, dismissSuggestion, readRequirement, removeContext } from '../api';
import { inboxApi } from '../../api';
import { SessionStreamPane } from '../../stream/SessionStreamPane';
import { HostMark } from '../../icons';
import { GroupBand } from '../../components/GroupBand';
import { ChatMarkdown } from '@plannotator/ui/components/chat';
import type { InboxLaunchAgent } from '@plannotator/core/inbox-types';
import { CopyCommand } from '../../components/RestartNote';
import { useRequirements } from '../useRequirements';
import {
  DELIVERABLE_KIND_LABELS,
  REQUIREMENT_STAGES,
  requirementStageLabel,
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

/** The first of a requirement's threads whose session has a transcript here (null: none), for the 对话流 entry. */
function streamThreadOf(meta: Record<string, { stream: boolean; subject: string | null }>, requirement: Requirement | null): string | null {
  if (!requirement) return null;
  return requirement.threads.find((threadId) => meta[threadId]?.stream === true) ?? null;
}

const EVENT_WORDS: Readonly<Record<RequirementEvent['kind'], string>> = {
  created: '创建',
  stage: '移阶段',
  field: '修改',
  deleted: '删除',
  say: '进展',
  deliverable: '产物',
  suggestion: '建议',
  context: '上下文',
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
      role="button"
      tabIndex={0}
      aria-label={`${requirement.title}（回车打开详情）`}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpen();
        }
      }}
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
        onClick={(event) => {
          event.stopPropagation();
          onArchiveToggle();
        }}
      >
        <Icon name={archived ? 'back' : 'archive'} size={14} />
      </button>
      <span className="ib-bc-top">
        <span className="ib-bc-main" data-card-open="" title={requirement.title}>
          <span className="ib-bc-t" dir="auto">
            {requirement.title}
          </span>
        </span>
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
  const [error, setError] = useState<string | null>(null);
  // 「开始做」: the form a fresh requirement opens on — the agents and projects the person can start (compose's
  // own launch read), the words the session starts with, and the going-out itself.
  const [start, setStart] = useState<{ agents: { agent: string; name: string }[]; projects: { id: string; name: string; root: string }[]; agent: string; project: string; words: string } | null>(null);
  const [startLoading, setStartLoading] = useState(false);
  const [starting, setStarting] = useState(false);
  // The requirement's linked threads that own a readable transcript (the thread read's `stream`): their sessions'
  // 对话流 opens right here in the detail, work beside the requirement it is for.
  const [threadMeta, setThreadMeta] = useState<Record<string, { stream: boolean; subject: string | null }>>({});
  // A deliverable's preview (fetched on first open) and the one whose annotate page is out.
  const [previews, setPreviews] = useState<Record<string, 'loading' | { text?: string; image?: string; binary?: boolean; session?: string; html?: boolean; annotatable?: boolean } | { error: string }>>({});
  const [annotating, setAnnotating] = useState<string | null>(null);
  // 需求上下文: the add dialog (link / pasted text / uploaded file), each context's preview, and the requirement
  // card the session starts on (the server's own template, single source).
  const [contextKind, setContextKind] = useState<'link' | 'text' | 'upload'>('link');
  const [contextName, setContextName] = useState('');
  const [contextRef, setContextRef] = useState('');
  const [contextText, setContextText] = useState('');
  const [contextFile, setContextFile] = useState<File | null>(null);
  const [contextBusy, setContextBusy] = useState(false);
  const [contextPreviews, setContextPreviews] = useState<Record<string, 'loading' | { text?: string; image?: string; link?: string; html?: boolean } | { error: string }>>({});
  const [card, setCard] = useState<string | null>(null);
  // The detail's own two areas: the left list picks, the right shows. History is a row like any other.
  const [view, setView] = useState<{ k: 'overview' } | { k: 'context'; id: string } | { k: 'deliverable'; id: string } | { k: 'session'; id: string } | { k: 'history' }>({ k: 'overview' });
  const contextDialog = useRef<HTMLDialogElement | null>(null);

  /** 添加上下文: link straight in; text becomes a file in the requirement's library; a file uploads (base64 in
   *  the JSON body, so the window's session check holds). All three land as one reference on the card. */
  const addTheContext = async () => {
    if (contextBusy) return;
    setContextBusy(true);
    try {
      let outcome: { ok: boolean; error?: string };
      if (contextKind === 'link') outcome = await addContext(id, { kind: 'link', name: contextName.trim(), ref: contextRef.trim() });
      else if (contextKind === 'text') outcome = await addContext(id, { kind: 'text', name: contextName.trim(), text: contextText });
      else if (contextFile) outcome = await addContext(id, { kind: 'upload', name: contextName.trim(), data: await fileAsBase64(contextFile) });
      else outcome = { ok: false, error: '先选一个文件。' };
      if (!outcome.ok) {
        setError(outcome.error ?? '添加失败。');
        return;
      }
      contextDialog.current?.close();
    } finally {
      setContextBusy(false);
    }
  };
  const [streamOpen, setStreamOpen] = useState<string | null>(null);
  const streamsRead = useRef<ReadonlySet<string>>(new Set());
  const reload = useRef<AbortController | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Every deliverable previews itself: all contents are read in parallel when the requirement lands, so the
   *  page opens with its documents already on it — nothing to unfold, nothing to wait on one at a time. */
  useEffect(() => {
    for (const deliverable of detail?.requirement.deliverables ?? []) {
      if (previews[deliverable.id] !== undefined) continue;
      setPreviews((held) => ({ ...held, [deliverable.id]: 'loading' }));
      void deliverableContent(id, deliverable.id).then((answer) => {
        setPreviews((held) => ({ ...held, [deliverable.id]: answer as never }));
      });
    }
  }, [detail, id]);

  /** Which of the requirement's threads have a transcript here, read once per thread while the pane is open. */
  useEffect(() => {
    for (const threadId of detail?.requirement.threads ?? []) {
      if (streamsRead.current.has(threadId)) continue;
      const read = new Set(streamsRead.current);
      read.add(threadId);
      streamsRead.current = read;
      void inboxApi.thread(threadId).then((answer) => {
        setThreadMeta((held) => ({ ...held, [threadId]: { stream: (answer.thread as { stream?: true }).stream === true, subject: answer.thread.subject ?? null } }));
      }).catch(() => {
        const undo = new Set(streamsRead.current);
        undo.delete(threadId);
        streamsRead.current = undo;
      });
    }
  }, [detail]);

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
      setStart({ agents, projects, agent: claude.agent, project: projects[0]!.id, words: card ?? `用 plannotator requirement 工具开始做「${detail?.requirement.title ?? ''}」。` });
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
      setCard(answer?.card ?? null);
      if (answer) {
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

  return (
    <aside className="ib-req-detail" aria-label="需求详情" data-requirement-detail={id}>
      {streamOpen !== null && <SessionStreamPane threadId={streamOpen} onClose={() => setStreamOpen(null)} />}
      <dialog
        className="ib-req-new"
        aria-labelledby="ib-req-ctx-title"
        ref={contextDialog}
      >
        <form
          method="dialog"
          onSubmit={(event) => {
            event.preventDefault();
            void addTheContext();
          }}
        >
          <h2 id="ib-req-ctx-title">添加上下文</h2>
          <div className="ib-req-ctx-kinds" role="tablist">
            {(['link', 'text', 'upload'] as const).map((kind) => (
              <button key={kind} type="button" className={`ib-req-ctx-kind${contextKind === kind ? ' on' : ''}`} role="tab" aria-selected={contextKind === kind} onClick={() => setContextKind(kind)}>
                {kind === 'link' ? '链接' : kind === 'text' ? '文本' : '文件'}
              </button>
            ))}
          </div>
          <input
            className="ib-req-new-input"
            aria-label="名称"
            placeholder={contextKind === 'link' ? '名称，如「PRD」' : contextKind === 'text' ? '名称，如「背景说明」' : '名称，如「登录接口文档」'}
            value={contextName}
            onChange={(event) => setContextName(event.target.value)}
          />
          {contextKind === 'link' && (
            <input className="ib-req-new-input" aria-label="URL" placeholder="https://…" value={contextRef} onChange={(event) => setContextRef(event.target.value)} />
          )}
          {contextKind === 'text' && (
            <textarea className="ib-req-new-input ib-req-ctx-text" aria-label="内容" rows={7} placeholder="贴进来——保存时自动落成文件" value={contextText} onChange={(event) => setContextText(event.target.value)} />
          )}
          {contextKind === 'upload' && (
            <input className="ib-req-ctx-file" aria-label="文件" type="file" onChange={(event) => setContextFile(event.target.files?.[0] ?? null)} />
          )}
          <p className="ib-req-new-hint">{contextKind === 'link' ? '会话开工时会拿到这个链接。' : contextKind === 'text' ? '文本保存为需求库里的文件，会话按路径读取。' : '文件拷贝进需求库；图片会话可以直接看。'}</p>
          <div className="ib-req-new-act">
            <button type="button" className="ib-btn ib-sm" onClick={() => contextDialog.current?.close()}>
              取消
            </button>
            <button type="submit" className="ib-btn ib-sm ib-req-new-ok" data-requirements-context-create="" disabled={contextBusy || !contextName.trim() || (contextKind === 'link' && !contextRef.trim()) || (contextKind === 'text' && !contextText.trim()) || (contextKind === 'upload' && !contextFile)}>
              添加
            </button>
          </div>
        </form>
      </dialog>
      {requirement === null ? (
        <div className="ib-crdp-body">
          <p aria-busy="true">读取需求中…</p>
        </div>
      ) : (
        <div className="ib-crdp-body ib-req-body">
          {/* Two rounded blocks, as the Inbox's own list column and thread pane: the left block's head is the
              requirement's name, its groups the areas (a band and rows, as 阻碍工作/安静 are in the list), and
              whatever row the person picks opens in the right block. */}
          <div className="ib-req-col">
            <div className="ib-lhead">
              <SidebarTrigger />
              <button type="button" className="ib-bback" data-requirements-back="" onClick={onClose} aria-label="回到工坊">
                <Icon name="chevL" size={16} />
                <span className="ib-bback-l">工坊</span>
              </button>
              <h1 className="ib-lhead-h" dir="auto">{requirement.title}</h1>
              <span className="ib-req-stage-chip">{requirementStageLabel(requirement.stage)}</span>
              <span className="ib-sp" />
              {streamThreadOf(threadMeta, requirement) && (
                <button
                  type="button"
                  className="ib-iconbtn ib-req-streambtn"
                  aria-label="对话流"
                  aria-pressed={streamOpen !== null}
                  title="对话流：这个会话自己在读什么、跑什么、改什么"
                  data-requirements-stream=""
                  onClick={() => setStreamOpen((open) => (open === null ? streamThreadOf(threadMeta, requirement) : null))}
                >
                  <HostMark host="claude-code" />
                </button>
              )}
            </div>
            <div className="ib-req-groups">
              <ReqGroup label="概览" count={requirement.suggestions.length > 0 ? `${requirement.suggestions.length} 条建议` : ''}>
                <ReqRow selected={view.k === 'overview'} icon="todo" title="开始做与建议" preview={navPreview('overview', requirement)} onClick={() => setView({k: 'overview'})} />
              </ReqGroup>
              <ReqGroup label="上下文" count={requirement.contexts.length > 0 ? String(requirement.contexts.length) : ''}>
                {requirement.contexts.map((context) => (
                  <ReqRow key={context.id} selected={view.k === 'context' && view.id === context.id} icon={context.kind === 'link' ? 'clip' : context.image ? 'photo' : 'pen'} title={context.name} preview={context.kind === 'link' ? new URL(context.ref).hostname : '文件'} onClick={() => { setView({k: 'context', id: context.id}); if (!contextPreviews[context.id]) { setContextPreviews((held) => ({...held, [context.id]: 'loading'})); void contextContent(id, context.id).then((answer) => setContextPreviews((held) => ({...held, [context.id]: answer as never}))); } } } />
                ))}
                <button type="button" className="ib-req-addrow" data-requirements-context-add="" onClick={() => { setContextKind('link'); setContextName(''); setContextRef(''); setContextText(''); setContextFile(null); contextDialog.current?.showModal(); }}>
                  <Icon name="plus" size={13} /> 添加上下文
                </button>
              </ReqGroup>
              <ReqGroup label="产物" count={requirement.deliverables.length > 0 ? String(requirement.deliverables.length) : ''}>
                {requirement.deliverables.map((deliverable) => (
                  <ReqRow key={deliverable.id} selected={view.k === 'deliverable' && view.id === deliverable.id} icon="cube" title={deliverable.title ?? deliverable.ref.split('/').pop() ?? deliverable.ref} preview={DELIVERABLE_KIND_LABELS[deliverable.kind]} onClick={() => { setView({k: 'deliverable', id: deliverable.id}); if (!previews[deliverable.id]) { setPreviews((held) => ({...held, [deliverable.id]: 'loading'})); void deliverableContent(id, deliverable.id).then((answer) => setPreviews((held) => ({...held, [deliverable.id]: answer as never}))); } } } />
                ))}
              </ReqGroup>
              <ReqGroup label="会话" count={requirement.threads.length > 0 ? String(requirement.threads.length) : ''}>
                {requirement.threads.map((threadId) => (
                  <ReqRow key={threadId} selected={view.k === 'session' && view.id === threadId} icon="comment" title={threadMeta[threadId]?.subject ?? '会话'} preview="Claude Code" onClick={() => setView({k: 'session', id: threadId})} />
                ))}
              </ReqGroup>
              <ReqGroup label="历史" count={(detail?.events ?? []).length > 0 ? String((detail?.events ?? []).length) : ''}>
                <ReqRow selected={view.k === 'history'} icon="clock" title="时间线" preview={(detail?.events ?? [])[0] ? EVENT_WORDS[(detail!.events[0]!.kind)] ?? '' : '还没有记录'} onClick={() => setView({k: 'history'})} />
              </ReqGroup>
            </div>
          </div>
          <div className="ib-req-pane">
            {view.k === 'overview' && (
              <div className="ib-req-viewbody">
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
              </div>
            )}
            {view.k === 'context' && (() => {
              const context = requirement.contexts.find((entry) => entry.id === view.id);
              if (!context) return null;
              const preview = contextPreviews[context.id];
              return (
                <div className="ib-req-viewbody">
                  <div className="ib-req-itemhead">
                    <h3 className="ib-req-itemtitle" dir="auto">{context.name}</h3>
                    <span className="ib-req-dlv-meta">{context.kind === 'link' ? '链接' : '文件'} · {context.by ?? '你'}</span>
                    <span className="ib-sp" />
                    <button type="button" className="ib-req-x" aria-label="移除上下文" title="移除" onClick={() => void removeContext(id, context.id).then((outcome) => (outcome.ok ? (read(), setView({k: 'overview'})) : setError(outcome.error)))}>
                      <Icon name="x" size={13} />
                    </button>
                  </div>
                  {context.kind === 'link' ? (
                    <a className="ib-req-ctxlink-big" href={context.ref} target="_blank" rel="noreferrer" dir="auto">{context.ref}</a>
                  ) : preview === 'loading' || preview === undefined ? (
                    <p className="ib-req-empty">读取中…</p>
                  ) : 'error' in preview ? (
                    <p className="ib-req-empty">{preview.error}</p>
                  ) : preview.image ? (
                    <img className="ib-req-dlv-img" src={preview.image} alt={context.name} />
                  ) : preview.html ? (
                    <iframe className="ib-req-dlv-html" sandbox="allow-scripts" srcDoc={preview.text} title={context.name} />
                  ) : (
                    <div className="ib-req-dlv-doc" dir="auto"><ChatMarkdown text={preview.text ?? ''} role="assistant" messageId={`ctx-${context.id}`} /></div>
                  )}
                </div>
              );
            })()}
            {view.k === 'deliverable' && (() => {
              const deliverable = requirement.deliverables.find((entry) => entry.id === view.id);
              if (!deliverable) return null;
              const content = previews[deliverable.id];
              const annotatable = /\.(md|markdown|txt|html?)$/i.test(deliverable.ref);
              return (
                <div className="ib-req-viewbody">
                  <div className="ib-req-itemhead">
                    <span className="ib-req-dlv-kind">{DELIVERABLE_KIND_LABELS[deliverable.kind]}</span>
                    <h3 className="ib-req-itemtitle" dir="auto">{deliverable.title ?? deliverable.ref.split('/').pop() ?? deliverable.ref}</h3>
                    <span className="ib-req-dlv-meta">{deliverable.by ? `${deliverable.by} · ` : ''}{timeOf(deliverable.created_at)}</span>
                  </div>
                  {content === 'loading' || content === undefined ? <p className="ib-req-empty">读取中…</p> : 'error' in content ? <p className="ib-req-empty">{content.error}</p> : content.session ? <p className="ib-req-empty">这是一次 Plannotator 批注会话（{content.session}），不是文件。</p> : content.image ? <img className="ib-req-dlv-img" src={content.image} alt="产物预览" /> : content.binary ? <p className="ib-req-empty">这个产物不是可在这里预览的文档。</p> : content.html ? <iframe className="ib-req-dlv-html" sandbox="allow-scripts" srcDoc={content.text} title="产物预览" /> : <div className="ib-req-dlv-doc" dir="auto"><ChatMarkdown text={content.text ?? ''} role="assistant" messageId={`dlv-${deliverable.id}`} /></div>}
                  {annotatable && (
                    <div className="ib-req-dlv-act">
                      <button type="button" className="ib-btn ib-sm" disabled={annotating === deliverable.id} onClick={() => { setAnnotating(deliverable.id); void annotateDeliverable(id, deliverable.id).then((outcome) => { setAnnotating(null); if (!outcome.ok) setError(outcome.error); }).catch(() => setAnnotating(null)); }}>
                        <Icon name="pen" size={13} />
                        {annotating === deliverable.id ? '批注页已打开，完成后写回历史…' : '批注'}
                      </button>
                    </div>
                  )}
                </div>
              );
            })()}
            {view.k === 'session' && (() => {
              const meta = threadMeta[view.id];
              return (
                <div className="ib-req-viewbody">
                  <div className="ib-req-itemhead">
                    <HostMark host="claude-code" />
                    <h3 className="ib-req-itemtitle" dir="auto">{meta?.subject ?? '会话'}</h3>
                    <span className="ib-sp" />
                    <button type="button" className="ib-btn ib-sm" onClick={() => onOpenThread(view.id)}>
                      打开 <Icon name="chevR" size={12} />
                    </button>
                  </div>
                  <p className="ib-req-empty">这个会话正在为需求「{requirement.title}」工作；打开它进入线程，右上角星标是它的对话流。</p>
                </div>
              );
            })()}
            {view.k === 'history' && (
              <div className="ib-req-viewbody">
          <section aria-label="历史">
            <h3 className="ib-req-h">历史</h3>
            <ol className="ib-req-hist">
              {[...(detail?.events ?? [])].reverse().slice(0, 12).map((event) => (
                <li key={event.id} className="ib-req-hist-row">
                  <span className="ib-req-hist-time">{timeOf(event.at)}</span>
                  <span className="ib-req-hist-word">{EVENT_WORDS[event.kind] ?? event.kind}</span>
                  {event.note ? <span className="ib-req-hist-note" dir="auto">{event.note.length > 90 ? `${event.note.slice(0, 90)}…` : event.note}</span> : event.field ? <span className="ib-req-hist-note">{event.field}</span> : null}
                </li>
              ))}
            </ol>
          </section>

              </div>
            )}
            {error && (
              <p className="ib-error" role="alert">
                {error}
              </p>
            )}
          </div>
        </div>
      )}
    </aside>
  );
}

/** The panel: a Board page whose lanes are the seven stages; `archived` shows the 已归档 page instead. */
export function RequirementsPanel({ on, archived = false, openId = null, onView, onOpen, onOpenThread }: { on: boolean; archived?: boolean; openId?: string | null; onView: (archived: boolean) => void; onOpen: (id: string | null) => void; onOpenThread: (threadId: string) => void }) {
  const { requirements, archived: archivedList, archivedCount, create, patch, error, clearError } = useRequirements(on, subscribeRequirementFrames);
  // 新建需求 is a dialog: one question (the title), Enter makes it, Esc walks away — then the card sits in 待跟进.
  const newDialog = useRef<HTMLDialogElement | null>(null);
  const [draft, setDraft] = useState('');
  /** The card being dragged (the Board's own mechanism: state, not the dataTransfer's contents). */
  const [dragging, setDragging] = useState<Requirement | null>(null);
  const [over, setOver] = useState<RequirementStage | null>(null);

  const submit = () => {
    const title = draft.trim();
    if (!title) {
      newDialog.current?.close();
      return;
    }
    setDraft('');
    newDialog.current?.close();
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
            {cards.length === 0 && <p className="ib-lane-empty">{archived ? '没有已归档的需求。' : stage.wants ? `还没有需求；此阶段产出${stage.wants}。` : '还没有需求。'}</p>}
          </section>
        );
      })}
    </div>
  );

  return (
    <section className="ib-bpage" aria-labelledby="ib-req-title" data-requirements-page="" data-requirements-view={archived ? 'archived' : 'board'}>
      {/* The board's own head (工坊, 已归档, 新建) is the board's: a requirement's page takes the whole panel, so
          the head rides only with the board. */}
      {!openId && (
        <div className="ib-bhead">
          <SidebarTrigger />
          {archived ? (
            <>
              <button type="button" className="ib-bback" data-requirements-back="" onClick={() => onView(false)}>
                <Icon name="chevL" size={16} />
                工坊
              </button>
              <h1 id="ib-req-title" tabIndex={-1}>
                已归档
              </h1>
            </>
          ) : (
            <>
              <h1 id="ib-req-title" tabIndex={-1}>
                工坊
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
                  setDraft('');
                  newDialog.current?.showModal();
                  clearError();
                }}
              >
                <Icon name="plus" size={15} />
                新建需求
              </button>
            </>
          )}
        </div>
      )}
      {error && (
        <div className="ib-error ib-bfail" role="alert">
          {error}
        </div>
      )}
      {openId ? (
        <div className="ib-bmain ib-req-main">
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

      <dialog
        ref={newDialog}
        className="ib-req-new"
        aria-labelledby="ib-req-new-title"
        onClose={() => setDraft('')}
      >
        <form
          method="dialog"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <h2 id="ib-req-new-title">新建需求</h2>
          <input
            ref={(node) => {
              if (node && newDialog.current?.open) queueMicrotask(() => node.focus());
            }}
            className="ib-req-new-input"
            aria-label="需求标题"
            placeholder="一句话说清要做什么"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
          <p className="ib-req-new-hint">回车创建；Esc 放弃。新需求先落在「待跟进」。</p>
          <div className="ib-req-new-act">
            <button type="button" className="ib-btn ib-sm" onClick={() => newDialog.current?.close()}>
              取消
            </button>
            <button type="submit" className="ib-btn ib-sm ib-req-new-ok" data-requirements-create="" disabled={!draft.trim()}>
              创建
            </button>
          </div>
        </form>
      </dialog>
    </section>
  );
}

/** A file as base64 for the JSON upload (the window's POSTs carry their session in the body). */
async function fileAsBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  return btoa(binary);
}

/** One line under a nav row's label: the newest thing that area holds, so the left list reads like the Inbox's. */
function navPreview(key: string, requirement: Requirement): string {
  if (key === 'overview') return requirement.suggestions.length > 0 ? `${requirement.suggestions.length} 条建议待采纳` : '开始做与建议';
  if (key === 'contexts') return requirement.contexts[0]?.name ?? '还没有背景材料';
  if (key === 'deliverables') return requirement.deliverables[0]?.title ?? requirement.deliverables[0]?.ref.split('/').pop() ?? '还没有产物';
  if (key === 'sessions') return requirement.threads.length > 0 ? '正在为它工作' : '还没有会话';
  return '这条需求的经历';
}

/** A group in the detail's left block: the Inbox's own band header (collapsible, count in its corner) and rows. */
function ReqGroup({ label, count, children }: { label: string; count: string; children: ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="ib-group">
      <GroupBand open={open} onToggle={() => setOpen(!open)}>
        {label} {count && <span className="ib-n">{count}</span>}
      </GroupBand>
      {open && children}
    </div>
  );
}

/** One row of the detail's left block: the Inbox's own .ib-row (height, hairline, hover, selection), scoped tracks. */
function ReqRow({ selected, icon, title, preview, onClick }: { selected: boolean; icon: string; title: string; preview: string; onClick: () => void }) {
  return (
    <div className="ib-rw">
      <button type="button" className={`ib-row ib-req-navrow${selected ? ' ib-sel' : ''}`} aria-current={selected ? 'true' : undefined} onClick={onClick}>
        <span className="ib-req-navico"><Icon name={icon as never} size={16} /></span>
        <span className="ib-subj ib-req-navsubj">
          <span className="ib-title" dir="auto">{title}</span>
          <span className="ib-req-navp" dir="auto">{preview}</span>
        </span>
      </button>
    </div>
  );
}
