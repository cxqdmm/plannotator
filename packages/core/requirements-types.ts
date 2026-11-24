/**
 * The Requirements module's shared vocabulary (the「需求」panel): the stage
 * table, the record shapes, and the wire both sides speak. Pure data — the
 * window (packages/inbox/requirements) and the Bun server
 * (packages/server/requirements.ts) both import it, and nothing outside those
 * two directories names these types except the one-line wiring each
 * integration point needs (the design doc's §3.1 list).
 *
 * Browser-UI words are Simplified Chinese in place, this fork's rule; nothing
 * here is agent-facing text.
 */

/** One requirement's place in its lifecycle, in order. Fixed in v1 (no custom stages). */
/**
 * The lifecycle's stages. 待跟进 (triage) is gone (the person's call, 2026-11-19: a new requirement IS in
 * design): it stays in the union only as a legacy stored value, normalized to `design` on read — never offered,
 * never drawn.
 */
export type RequirementStage = 'design' | 'design-review' | 'dev' | 'qa' | 'code-review' | 'done' | 'triage';

/** The stages in order. `wants` names the deliverable the stage suggests (the gentle "not attached yet" line; null: none). */
export const REQUIREMENT_STAGES: readonly { id: RequirementStage; label: string; wants: string | null }[] = [
  { id: 'design', label: '需求设计', wants: '设计文档' }, // a fresh requirement starts here
  { id: 'design-review', label: '设计评审', wants: '设计文档' },
  { id: 'dev', label: '需求开发', wants: null },
  { id: 'qa', label: '功能测试', wants: '测试报告' },
  { id: 'code-review', label: '代码评审', wants: null },
  { id: 'done', label: '已完成', wants: null },
];

export const REQUIREMENT_STAGE_IDS: readonly RequirementStage[] = REQUIREMENT_STAGES.map((stage) => stage.id);

export function requirementStageLabel(stage: RequirementStage): string {
  return REQUIREMENT_STAGES.find((entry) => entry.id === stage)?.label ?? stage;
}

/** `value` is one of the stages (anything else is ignored, never guessed at). */
export function isRequirementStage(value: unknown): value is RequirementStage {
  return typeof value === 'string' && (REQUIREMENT_STAGE_IDS as readonly string[]).includes(value);
}

export type RequirementPriority = 'urgent' | 'high' | 'medium' | 'low' | 'none';

/** The deliverable kinds: what each stage's product is a reference TO. */
export const DELIVERABLE_KINDS = ['design-doc', 'test-report', 'link', 'file'] as const;

export function isDeliverableKind(value: unknown): value is DeliverableKind {
  return typeof value === 'string' && (DELIVERABLE_KINDS as readonly string[]).includes(value);
}

/** What a deliverable is, for its line in the detail pane (browser UI: Chinese, this fork's rule). */
export const DELIVERABLE_KIND_LABELS: Readonly<Record<DeliverableKind, string>> = {
  // 「提案」：提请人裁决的决策件（设计方案/计划/验收标准），不限于设计文档（approval "review-boundary"）。
  'design-doc': '提案',
  'test-report': '测试报告',
  link: '链接',
  file: '文件',
};

export const REQUIREMENT_PRIORITIES: readonly { id: RequirementPriority; label: string }[] = [
  { id: 'urgent', label: '紧急' },
  { id: 'high', label: '高' },
  { id: 'medium', label: '中' },
  { id: 'low', label: '低' },
  { id: 'none', label: '无' },
];

export function isRequirementPriority(value: unknown): value is RequirementPriority {
  return typeof value === 'string' && REQUIREMENT_PRIORITIES.some((entry) => entry.id === value);
}

/** A deliverable's kind: what it is a reference TO (the annotate/review machinery owns the thing itself). */
export type DeliverableKind = (typeof DELIVERABLE_KINDS)[number];

/**
 * A stage's product, ATTACHED to the requirement (a reference, never a copy):
 * a design doc is an annotate session, a review conclusion a Plannotator
 * review — the module links the existing machinery, it does not rebuild it.
 */
export interface Deliverable {
  /** 'dlv_' + ULID. */
  id: string;
  kind: DeliverableKind;
  /** What it points at: a session id, a file path or a URL, by `kind`. */
  ref: string;
  title?: string;
  /** Who attached it (an agent's name, or null for the person). */
  by?: string | null;
  /** The session that produced it ('msg_' id), recorded at deliver time. Absent (person-attached, or
   *  an older record): the session-row 去审阅 does not attach to it — a pill only hangs on its own session. */
  thread?: string;
  created_at: string;
  /** Computed on reads (never stored): this deliverable's latest review verdict — the design review's
   *  通过/退回 lands as a 审阅裁决 event; the window shows 已批准/已退回 from it. Absent: not reviewed yet. */
  verdict?: 'approved' | 'annotated';
}

/** An agent's (or an event bridge's) proposal to move the stage: the person adopts or dismisses it (D1: only the person moves). */
export interface RequirementSuggestion {
  /** 'sug_' + ULID. */
  id: string;
  stage: RequirementStage;
  /** One line of why. */
  why: string;
  /** Who proposed it (an agent's name, or an event bridge's name). */
  by: string;
  at: string;
}

/** One requirement. Created by the person by hand; the id is 'req_' + ULID, the msg_/lch_ family. */
export interface Requirement {
  id: string;
  title: string;
  /** Markdown. */
  notes: string;
  stage: RequirementStage;
  priority: RequirementPriority;
  deliverables: Deliverable[];
  /** The threads this requirement's work happens in (D3: many). 'msg_' ids. */
  threads: string[];
  /** Proposals waiting for the person (adopt moves the stage and drops it; dismiss just drops it). */
  suggestions: RequirementSuggestion[];
  /** The requirement's background material (需求上下文): references the requirement card carries — a link, or a
   *  file in the requirement's context folder (pasted text and uploads both land there as files). */
  contexts: RequirementContext[];
  /** Computed on reads (never stored): one of this requirement's sessions waits on the person (the thread's
   *  list section is Stopped/Holding/Waiting — the Board's 「You: …」 idea). */
  waiting?: true;
  /** With `waiting`: the first of the requirement's sessions whose thread waits on the person (its id), for the
   *  badge's jump straight into that conversation. Computed on reads, never stored. */
  waiting_thread?: string;
  /** Set when archived (归档): the card leaves the board until restored. Null while active. */
  archived_at?: string | null;
  created_at: string;
  updated_at: string;
}

/** One piece of a requirement's background: a link, or a file under `<dataDir>/requirements/contexts/<req>/`. */
export interface RequirementContext {
  /** 'ctx_' + ULID. */
  id: string;
  kind: 'link' | 'file';
  /** The person's name for it (「PRD」「登录接口」「竞品首页」). */
  name: string;
  /** kind=link: the URL. kind=file: the absolute path (inside the requirement's context folder). */
  ref: string;
  /** An image file (the card's reader can look at it directly). */
  image?: true;
  by: string | null;
  created_at: string;
}

/** One line of a requirement's history (`requirement-events.json`). */
export interface RequirementEvent {
  id: string;
  req: string;
  at: string;
  kind: 'created' | 'stage' | 'field' | 'deleted' | 'say' | 'deliverable' | 'suggestion' | 'context';
  /** The changed field's name (`field`), or the stage it moved from/to (`stage`). */
  field?: string;
  from?: string;
  to?: string;
  /** `say`: the note; `deliverable`: its title or ref; `suggestion`: its why. */
  note?: string;
  /** The session the event belongs to ('msg_' id), recorded when the acting call carries one
   *  (progress 的 stage/say；交付与裁决由读侧从交付物的 thread 回查). Absent: 工坊手动操作或旧事件，无归属. */
  thread?: string;
}
