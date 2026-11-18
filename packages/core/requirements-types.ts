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
export type RequirementStage = 'triage' | 'design' | 'design-review' | 'dev' | 'qa' | 'code-review' | 'done';

/** The stages in order. `wants` names the deliverable the stage suggests (the gentle "not attached yet" line; null: none). */
export const REQUIREMENT_STAGES: readonly { id: RequirementStage; label: string; wants: string | null }[] = [
  { id: 'triage', label: '待跟进', wants: null },
  { id: 'design', label: '需求设计', wants: '设计文档' },
  { id: 'design-review', label: '设计评审', wants: '评审结论' },
  { id: 'dev', label: '需求开发', wants: null },
  { id: 'qa', label: '功能测试', wants: '测试报告' },
  { id: 'code-review', label: '代码评审', wants: '代码评审' },
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

/**
 * A stage's product, ATTACHED to the requirement (a reference, never a copy):
 * a design doc is an annotate session, a review conclusion a Plannotator
 * review — the module links the existing machinery, it does not rebuild it.
 */
export interface Deliverable {
  /** 'dlv_' + ULID. */
  id: string;
  kind: 'design-doc' | 'review' | 'code-review' | 'test-report' | 'link' | 'file';
  /** What it points at: a session id, a file path or a URL, by `kind`. */
  ref: string;
  title?: string;
  created_at: string;
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
  created_at: string;
  updated_at: string;
}

/** One line of a requirement's history (`requirement-events.json`). */
export interface RequirementEvent {
  id: string;
  req: string;
  at: string;
  kind: 'created' | 'stage' | 'field' | 'deleted';
  /** The changed field's name (`field`), or the stage it moved from/to (`stage`). */
  field?: string;
  from?: string;
  to?: string;
}
