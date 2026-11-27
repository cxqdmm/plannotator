/**
 * 管家页的「审批」页签（doc/管家审批与需求卡-方案.html）：the switch and the one place
 * where a butler action waits for the owner. It lives inside the butler pane — not a
 * page of its own — so approving is part of talking to the butler.
 *
 * Presentational: the pane in Butler.tsx fetches and decides; this file draws the
 * switch, the pending cards (each with the complete requirement-card document) and the
 * recent decisions. The document uses the same Markdown renderer as the chat.
 */
import { useState } from 'react';
import { chatMarkdownHtml } from '@plannotator/ui/components/chat';
import type { InboxButlerApproval, InboxButlerApprovalsModel } from '../api';
import { Icon } from '../icons';
import { RequirementAgentPicker, RequirementProjectPicker, type RequirementAgentChoice, type RequirementProjectChoice } from '../requirements/components/RequirementProjectPicker';

const ACTION_LABEL: Record<InboxButlerApproval['action'], string> = {
  'create-requirement': '建需求卡',
  'launch-session': '启动执行会话',
  'archive-requirement': '归档需求',
  'stop-session': '停止会话',
};

function timeOf(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function statusLabel(status: InboxButlerApproval['status']): string {
  if (status === 'approved') return '已批准';
  if (status === 'denied') return '已拒绝';
  if (status === 'failed') return '执行失败';
  return '待审批';
}

function ApprovalCard({
  approval,
  busy,
  projects,
  onProjectsChanged,
  agents,
  onDecide,
}: {
  approval: InboxButlerApproval;
  busy: boolean;
  projects: RequirementProjectChoice[];
  onProjectsChanged: (projects: RequirementProjectChoice[]) => void;
  /** 这台收件箱能开的 agent，给建卡审批选默认执行 agent。 */
  agents: RequirementAgentChoice[];
  onDecide: (id: string, decision: 'approve' | 'deny', always: boolean, projectId?: string | null, agent?: string | null, note?: string) => void;
}) {
  const [always, setAlways] = useState(false);
  const [note, setNote] = useState('');
  const [projectId, setProjectId] = useState(approval.detail.project_id ?? '');
  const [agent, setAgent] = useState<string | null>(approval.detail.agent ?? null);
  const card = approval.detail.card ?? '';
  const selectedProject = projects.find((project) => project.id === projectId)
    ?? (projectId && approval.detail.project_id === projectId
      ? { id: projectId, name: approval.detail.project_name ?? projectId, root: approval.detail.project_root ?? '' }
      : null);
  const noteId = `butler-ap-note-${approval.id}`;
  return (
    <article className="ib-butler-ap-card" data-action={approval.action}>
      <header className="ib-butler-ap-cardhead">
        <span className="ib-butler-ap-kind">
          <i aria-hidden="true" />
          {ACTION_LABEL[approval.action]}
        </span>
        <span className="ib-butler-ap-time">{timeOf(approval.requested_at)}</span>
      </header>
      <h3 className="ib-butler-ap-title">{approval.title}</h3>
      {approval.summary && <p className="ib-butler-ap-summary">{approval.summary}</p>}

      <dl className="ib-butler-ap-facts">
        {approval.detail.agent && <div><dt>agent</dt><dd>{approval.detail.agent}</dd></div>}
        {(approval.detail.project_name || approval.detail.project_id) && <div><dt>项目</dt><dd>{approval.detail.project_name ?? approval.detail.project_id}</dd></div>}
        {approval.detail.folder && <div><dt>文件夹</dt><dd>{approval.detail.folder}</dd></div>}
        {approval.detail.session && <div><dt>会话</dt><dd>{approval.detail.session}</dd></div>}
        {approval.detail.thread && <div><dt>线程</dt><dd>{approval.detail.thread}</dd></div>}
        {approval.detail.words && <div><dt>要说的话</dt><dd>{approval.detail.words}</dd></div>}
        {approval.detail.released !== undefined && <div><dt>释放会话</dt><dd>{approval.detail.released}</dd></div>}
      </dl>

      {approval.action === 'create-requirement' && (
        <div className="ib-butler-ap-pickers">
          <RequirementProjectPicker
            projects={projects}
            selected={selectedProject}
            onPick={(project) => setProjectId(project?.id ?? '')}
            onProjectsChanged={onProjectsChanged}
          />
          <RequirementAgentPicker agents={agents} selected={agent} onPick={setAgent} />
        </div>
      )}
      {approval.detail.contexts && approval.detail.contexts.length > 0 && (
        <div className="ib-butler-ap-ctx" aria-label="上下文">
          {approval.detail.contexts.map((context, index) => (
            <span key={`${context.kind}-${context.name}-${index}`} className="ib-butler-ap-chip">
              <Icon name={context.kind === 'link' ? 'book' : 'doc'} size={11} /> {context.name}
            </span>
          ))}
        </div>
      )}
      {approval.detail.warnings && approval.detail.warnings.length > 0 && (
        <p className="ib-butler-ap-warn">{approval.detail.warnings.join('；')}</p>
      )}
      {card && (
        <details className="ib-butler-ap-doc">
          <summary>
            <span>查看完整需求卡</span>
            <span className="ib-butler-ap-doc-caret" aria-hidden="true">›</span>
          </summary>
          <div className="ib-butler-md" dangerouslySetInnerHTML={{ __html: chatMarkdownHtml(card) }} />
        </details>
      )}

      {/* 补充话术（owner 2026-11-27）：批准或拒绝都能写一句，随决定送到管家。 */}
      <div className="ib-butler-ap-decide">
        <label className="ib-butler-ap-notelabel" htmlFor={noteId}>补充话术</label>
        <textarea
          id={noteId}
          className="ib-butler-ap-note"
          rows={2}
          dir="auto"
          placeholder="可选：说清理由、边界，或让管家下一步注意什么"
          value={note}
          disabled={busy}
          onChange={(event) => setNote(event.target.value)}
        />
        <div className="ib-butler-ap-actions">
          <button type="button" className="ib-butler-ap-approve" disabled={busy} onClick={() => onDecide(approval.id, 'approve', always, approval.action === 'create-requirement' ? projectId || null : undefined, approval.action === 'create-requirement' ? agent : undefined, note)}>
            批准
          </button>
          <button type="button" className="ib-butler-ap-deny" disabled={busy} onClick={() => onDecide(approval.id, 'deny', false, undefined, undefined, note)}>
            拒绝
          </button>
          <label className="ib-butler-ap-always">
            <input type="checkbox" checked={always} onChange={(event) => setAlways(event.target.checked)} disabled={busy} />
            以后直接允许
          </label>
        </div>
      </div>
    </article>
  );
}

/** 抽屉「待批事项」（owner 2026-11-26：审批不再是页签，而是右侧抽屉）。 */
export function ButlerApprovals({
  model,
  projects,
  onProjectsChanged,
  agents,
  error,
  busy,
  onDecide,
  onRefresh,
}: {
  model: InboxButlerApprovalsModel | null;
  error: string | null;
  /** The approval being decided now, or null. */
  projects: RequirementProjectChoice[];
  /** A folder became (or was found as) a project in the card's picker: keep it for the other cards. */
  onProjectsChanged: (projects: RequirementProjectChoice[]) => void;
  /** 这台收件箱能开的 agent（建卡审批选默认执行 agent 用）。 */
  agents: RequirementAgentChoice[];
  busy: string | null;
  onDecide: (id: string, decision: 'approve' | 'deny', always: boolean, projectId?: string | null, agent?: string | null, note?: string) => void;
  onRefresh: () => void;
}) {
  const pending = model?.approvals.pending ?? [];
  const decided = model?.approvals.decided ?? [];
  return (
    <div className="ib-butler-approvals">
      <div className="ib-butler-ap-bar">
        <span className="ib-butler-ap-count">
          {model ? (pending.length > 0 ? `${pending.length} 件待批` : '没有待批的事') : '正在读审批…'}
        </span>
        <button type="button" className="ib-butler-ap-refresh" onClick={onRefresh} aria-label="刷新审批">
          <Icon name="restart" size={13} /> 刷新
        </button>
      </div>

      {error && <p className="ib-butler-ap-error" role="alert">{error}</p>}

      {!model ? (
        <div className="ib-butler-ap-empty">正在读审批…</div>
      ) : pending.length === 0 ? (
        <div className="ib-butler-ap-empty">没有待批的事。管家请求建卡、派活、归档或停止时会出现在这里。</div>
      ) : (
        <div className="ib-butler-ap-list">
          {pending.map((approval) => (
            <ApprovalCard key={approval.id} approval={approval} projects={projects} onProjectsChanged={onProjectsChanged} agents={agents} busy={busy === approval.id} onDecide={onDecide} />
          ))}
        </div>
      )}

      {decided.length > 0 && (
        <div className="ib-butler-ap-history">
          <div className="ib-butler-ap-hh">已决定 · 最近</div>
          {decided.slice(0, 8).map((approval) => (
            <div key={approval.id} className="ib-butler-ap-hist">
              <span className="ib-butler-ap-hist-title">{approval.title}</span>
              <span className={`ib-butler-ap-status is-${approval.status}`}>{statusLabel(approval.status)}</span>
              <span className="ib-butler-ap-hist-time">{timeOf(approval.decided_at ?? approval.requested_at)}</span>
              {approval.note && <span className="ib-butler-ap-hist-note">{approval.note}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * 抽屉「配置」（owner 2026-11-26「再加一个配置按钮…侧边栏里是授权开关」）：四类管家动作的
 * 授权模式。窄栏里改成一列（说明在上、分段开关在下），比横排更好读。
 */
export function ButlerAuthSettings({
  model,
  error,
  onMode,
}: {
  model: InboxButlerApprovalsModel | null;
  error: string | null;
  onMode: (action: 'create-requirement' | 'launch-session' | 'archive-requirement' | 'stop-session', mode: 'ask' | 'auto') => void;
}) {
  const modeOf = (action: 'create-requirement' | 'launch-session' | 'archive-requirement' | 'stop-session'): 'ask' | 'auto' => (model?.auto[action] === true ? 'auto' : 'ask');
  return (
    <div className="ib-butler-config">
      <section className="ib-butler-switch" aria-label="授权开关">
        <div className="ib-butler-switch-head">
          <b>授权开关</b>
          <span>每次审批 / 直接允许</span>
        </div>
        {([
          { action: 'create-requirement' as const, label: '建需求卡', hint: '管家整理好的卡，先给您看还是直接创建' },
          { action: 'launch-session' as const, label: '启动执行会话', hint: '从需求卡开一个执行会话' },
          { action: 'archive-requirement' as const, label: '归档需求', hint: '退场并释放全部会话' },
          { action: 'stop-session' as const, label: '停止会话', hint: '打断正在跑的回合' },
        ]).map(({ action, label, hint }) => {
          const mode = modeOf(action);
          return (
            <div key={action} className="ib-butler-switch-row">
              <span className="ib-butler-switch-name">
                {label}
                <small>{hint}</small>
              </span>
              <div className="ib-butler-seg" role="group" aria-label={`${label}授权模式`}>
                <button type="button" className={mode === 'ask' ? 'is-on' : ''} aria-pressed={mode === 'ask'} onClick={() => onMode(action, 'ask')}>
                  每次审批
                </button>
                <button type="button" className={mode === 'auto' ? 'is-on' : ''} aria-pressed={mode === 'auto'} onClick={() => onMode(action, 'auto')}>
                  直接允许
                </button>
              </div>
            </div>
          );
        })}
        <p className="ib-butler-switch-note">所有需要您点头的管家动作都在这里；批准后立刻执行，结果送回管家。</p>
      </section>
      {error && <p className="ib-butler-ap-error" role="alert">{error}</p>}
    </div>
  );
}
