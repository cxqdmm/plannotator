/**
 * 需求卡文档（doc/管家审批与需求卡-方案.html）：the requirement card is ONE Markdown
 * document. Its body is the requirement's `notes`; its context section is rendered from
 * the structured `contexts`; the launch card, the approval preview and the Workshop all
 * read this same renderer, so the person approves exactly what the session receives.
 *
 * The six sections are the format's spine. The butler's `butler-requirement-card` skill,
 * the create action's missing-section warning, the Workshop editor's template and the
 * card renderer all read this module — never a second copy of the format.
 *
 * The words here are browser/agent text in Simplified Chinese in place (this fork's rule):
 * the card is read by the person and by the execution agent.
 */
import {
  REQUIREMENT_PRIORITIES,
  requirementStageLabel,
  type Requirement,
  type RequirementContext,
  type RequirementProject,
} from "./requirements-types";
import { INBOX_HOST_NAMES } from "./inbox-types";

/** The fixed sections, in order. `hint` is what the skill tells the butler to write there. */
export const REQUIREMENT_CARD_SECTIONS: readonly { id: string; heading: string; hint: string }[] = [
  { id: "background", heading: "背景 / 为什么", hint: "现状、问题、为什么现在做。" },
  { id: "goals", heading: "目标", hint: "可验证的结果。" },
  { id: "scope", heading: "范围", hint: "做什么、不做什么。" },
  { id: "constraints", heading: "约束", hint: "技术、时间、兼容性，不能动的东西。" },
  { id: "acceptance", heading: "验收", hint: "可以检查的通过条件。" },
  { id: "open", heading: "开放问题", hint: "需要主人拍板的点；不知道就先写待补充。" },
];

export const REQUIREMENT_CARD_TITLE_PREFIX = "# 需求卡：";

/** The blank document a new card starts from (the Workshop's template, the skill's skeleton). */
export function requirementCardTemplate(): string {
  return REQUIREMENT_CARD_SECTIONS.map((section) => `## ${section.heading}\n\n（待补充：${section.hint}）`).join("\n\n") + "\n";
}

/** The body headings a notes text actually has (## / ###), trimmed. */
export function requirementCardHeadings(notes: string): string[] {
  return [...notes.matchAll(/^#{2,3}\s+(.+)$/gm)].map((match) => match[1]!.trim());
}

/** The fixed section headings the notes do not cover yet. A plain note (no headings) counts as background only. */
export function missingRequirementCardSections(notes: string): string[] {
  const headings = requirementCardHeadings(notes).map((heading) => heading.split(" / ")[0]!.trim());
  // A plain note (no `##`) becomes the background paragraph in the document, so that section is covered.
  const plainBackground = notes.trim().length > 0 && headings.length === 0;
  return REQUIREMENT_CARD_SECTIONS.filter((section) => {
    if (plainBackground && section.id === "background") return false;
    const names = [section.heading, section.heading.split(" / ")[0]!];
    return !headings.some((heading) => names.includes(heading));
  }).map((section) => section.heading);
}

/** The body of the card: the notes as written. A plain note (no `##`) is kept as the background, so old cards stay readable. */
export function requirementCardBody(notes: string): string {
  const text = notes.trim();
  // A new card shows the whole skeleton, so the owner and the session see every section.
  if (!text) return requirementCardTemplate().trim();
  return /^#{2,3}\s+\S/m.test(text) ? text : `## ${REQUIREMENT_CARD_SECTIONS[0]!.heading}\n\n${text}`;
}

export interface RequirementCardInput {
  id: string;
  title: string;
  notes: string;
  stage: Requirement["stage"];
  priority: Requirement["priority"];
  project?: RequirementProject | null;
  /** The card's default launch agent (`claude-code`, `opencode`, …); shown on the card when set. */
  agent?: string | null;
  contexts: readonly RequirementContext[];
}

/** The card document, exactly as the execution session receives it. */
export function renderRequirementCard(input: RequirementCardInput): string {
  const priority = REQUIREMENT_PRIORITIES.find((entry) => entry.id === input.priority)?.label ?? "无";
  const lines: string[] = [
    `${REQUIREMENT_CARD_TITLE_PREFIX}${input.title}`,
    "",
    `**需求 ID**：\`${input.id}\`　**阶段**：${requirementStageLabel(input.stage)}　**优先级**：${priority}`,
    ...(input.project ? ["", `**项目**：${input.project.name}（\`${input.project.root}\`）`] : []),
    ...(input.agent ? [`**执行 agent**：${INBOX_HOST_NAMES[input.agent] ?? input.agent}`] : []),
    "",
    requirementCardBody(input.notes),
  ];
  if (input.contexts.length > 0) {
    lines.push("", "## 相关上下文", "", "> 以下都是引用：链接直接访问，文件按路径读取（图片可直接看）。动手前先读一遍。", "");
    for (const context of input.contexts) {
      lines.push(context.kind === "link" ? `- 链接：${context.ref} —— ${context.name}` : `- 文件：${context.ref} —— ${context.name}`);
    }
  }
  lines.push(
    "",
    "## 开始吧",
    "",
    "1. 读完上下文再动手；有不清楚的先用 Ask 提问，不要猜；",
    "2. 阶段性产出用 deliver 挂回本需求；较大进展完成时（如每个大步骤落地）用 progress 汇报一句；该进下一阶段时 suggest，由人采纳。",
    `（本会话已自动挂到需求 \`${input.id}\`，无需再 link。）`,
  );
  return lines.join("\n");
}

/** The card for a stored requirement. */
export function requirementCardFromRecord(requirement: Requirement): string {
  return renderRequirementCard({
    id: requirement.id,
    title: requirement.title,
    notes: requirement.notes,
    stage: requirement.stage,
    priority: requirement.priority,
    project: requirement.project ?? null,
    agent: requirement.agent ?? null,
    contexts: requirement.contexts,
  });
}

/** What the butler's skill shows as the document skeleton (headings + hints). */
export function requirementCardGuide(): string {
  return REQUIREMENT_CARD_SECTIONS.map((section, index) => `${index + 1}. ## ${section.heading} —— ${section.hint}`).join("\n");
}
