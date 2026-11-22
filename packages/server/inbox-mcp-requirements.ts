/**
 * The workshop (需求) panel's `requirement` tool: the one-line calls an agent working a
 * requirement uses to keep it current — see what it is (get/mine), attach what it just
 * finished (deliver), and record progress with the agent's own judgment of the stage
 * (progress — one call replaces the old say + stage pair, so a natural "report when a
 * stretch is done" also keeps the stage honest). Stages otherwise move only by the
 * person's hand (the workshop's PATCH); a review verdict is recorded (已批准/已退回)
 * but never moves one.
 *
 * The agent never creates a requirement and never ties one to a thread: 立项与会话挂靠
 * are the person's moves, made in the workshop (a card-started session is tied on send
 * by the store). `create` and `link` were removed from the tool (owner decision,
 * req_01M81N2V88RZK9TX0T1VW0HHJW): an older client calling them gets the op-enum error
 * and nothing is written.
 *
 * Reached by the `plannotator_inbox` tool's action "requirement" (the Claude
 * Code mod, Pi, OpenCode), the stdio shim, and `plannotator requirement …`
 * (the CLI's thin client). Served only while the module is on (the store is
 * on the context only then).
 */

import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";
import { DELIVERABLE_KINDS, DELIVERABLE_KIND_LABELS, REQUIREMENT_STAGES, isRequirementStage, requirementStageLabel, type DeliverableKind, type Requirement, type RequirementStage } from "@plannotator/core/requirements-types";
import type { RequirementStore } from "./requirements";
import { guarded, okComplete } from "./inbox-mcp-result";

export const INBOX_REQUIREMENT_OPS = ["mine", "get", "deliver", "progress"] as const;
export type InboxRequirementOp = (typeof INBOX_REQUIREMENT_OPS)[number];

/** For raw MCP clients; the agent tool words its action line itself (INBOX_AGENT_ACTION_LEADS.requirement). */
export const REQUIREMENT_DESCRIPTION =
  'Work the person\'s requirements (the workshop board). Requirements are created and tied to threads by the person in the workshop — never by you. op: mine (the requirements of a thread you are in: thread_id; without one, every active requirement), get (one requirement: requirement — its stage, deliverables and their review verdicts), deliver (attach what you just finished: kind one of design-doc, test-report, link, file, and ref — a path, URL or PR; a link ref is a full http(s) URL; a design-doc ref is the document itself, a .md/.markdown/.txt/.html path or URL you saved, NEVER a session id like pn-…: the review opens the document, so anything else is refused), progress (record a line of progress and your judgment of the stage: note and/or stage — a changed stage lands as a stage event, an unchanged one just the note; call it whenever a stretch of work is done). Stages: design, design-review, dev, qa, code-review, done. They move by progress here or by the person in the workshop — a review verdict (已批准/已退回) is recorded but never moves one.';


/** One requirement as one line of text: every fact an agent acts on. */
export function requirementLineText(requirement: Requirement): string {
  const parts = [`- ${requirement.id}`, JSON.stringify(requirement.title), requirementStageLabel(requirement.stage)];
  if (requirement.threads.length > 0) parts.push(`threads ${requirement.threads.join(", ")}`);
  parts.push(`deliverables ${requirement.deliverables.length}`);
  return parts.join(" ");
}

/** One requirement as its full text answer: stage, threads, deliverables (with verdicts), notes. */
function requirementFullText(requirement: Requirement): string {
  const lines = [requirementLineText(requirement)];
  for (const deliverable of requirement.deliverables) {
    const verdict = deliverable.verdict === "approved" ? "（已批准）" : deliverable.verdict === "annotated" ? "（已退回）" : "";
    const of = deliverable.thread ? `（会话 ${deliverable.thread}）` : "";
    lines.push(`- ${DELIVERABLE_KIND_LABELS[deliverable.kind]}: ${deliverable.title ?? deliverable.ref}${deliverable.title ? ` (${deliverable.ref})` : ""}${deliverable.by ? ` by ${deliverable.by}` : ""}${verdict}${of}`);
  }
  if (requirement.notes.trim()) lines.push(`备注: ${requirement.notes.length > 300 ? `${requirement.notes.slice(0, 300)}…` : requirement.notes}`);
  return lines.join("\n");
}

/** The `by` an author-recording call signs with: the agent's name, else null (the person). */
function authorOf(input: { agent_name?: string }): string | null {
  return typeof input.agent_name === "string" && input.agent_name.trim() ? input.agent_name.trim() : null;
}

async function runRequirementCall(context: { requirements?: RequirementStore }, input: Record<string, unknown>): Promise<{ text: string }> {
  const store = context.requirements;
  if (!store) return { text: "requirements_off: The person's workshop panel is off, so nothing was read or written." };
  const op = input.op as InboxRequirementOp;
  const requirementId = typeof input.requirement === "string" ? input.requirement : null;

  if (op === "mine") {
    const threadId = typeof input.thread_id === "string" && input.thread_id.trim() ? input.thread_id.trim() : null;
    const { requirements } = store.list(false);
    const mine = threadId ? requirements.filter((requirement) => requirement.threads.includes(threadId)) : requirements;
    if (mine.length === 0) return { text: threadId ? "No requirement is tied to that thread." : "No active requirements." };
    return { text: mine.slice(0, 20).map(requirementLineText).join("\n") + (mine.length > 20 ? `\n… and ${mine.length - 20} more` : "") };
  }
  if (!requirementId) return { text: "requirement: the requirement's id (req_…), for every op but mine." };
  const found = store.get(requirementId);
  if (!found) return { text: `No such requirement: ${requirementId}` };

  if (op === "get") return { text: requirementFullText(found.requirement) };
  if (op === "deliver") {
    // 产出会话：shim/连接填的 agent_session（会话内 agent 交付时都有）记进交付物——
    // 工坊会话条的去审阅 只挂产出它的那条会话。
    const session = typeof input.agent_session === "string" && input.agent_session.trim() ? input.agent_session.trim() : null;
    const deliverable = store.deliver(requirementId, {
      kind: input.kind as DeliverableKind,
      ref: input.ref as string,
      ...(typeof input.title === "string" ? { title: input.title } : {}),
      by: authorOf(input),
      thread: session,
    });
    return { text: `Attached ${DELIVERABLE_KIND_LABELS[deliverable.kind]}: ${deliverable.title ?? deliverable.ref}` };
  }
  if (op === "progress") {
    const note = typeof input.note === "string" ? input.note.trim() : "";
    const to = typeof input.stage === "string" ? (input.stage as RequirementStage) : null;
    if (!note && to === null) return { text: "progress: a note and/or the stage you judge the work is at — one of them." };
    if (to !== null && !isRequirementStage(to)) return { text: `stage: one of ${REQUIREMENT_STAGES.map((stage) => stage.label).join(", ")}.` };
    // 调用会话（连接填的 agent_session）：进展与阶段事件记它，历史里才有会话归属。
    const session = typeof input.agent_session === "string" && input.agent_session.trim() ? input.agent_session.trim() : null;
    const from = found.requirement.stage;
    const moving: RequirementStage | null = to !== null && to !== from ? to : null;
    const moved = moving !== null ? store.patch(requirementId, { stage: moving }, { thread: session }) : null;
    if (moving !== null) store.say(requirementId, `阶段：${requirementStageLabel(from)} → ${requirementStageLabel(moving)}`, "阶段", session);
    if (note) store.say(requirementId, note, authorOf(input), session);
    const stageLine = moving !== null ? `Stage: ${requirementStageLabel(from)} → ${requirementStageLabel(moving)}.` : `Stage unchanged (${requirementStageLabel(from)}).`;
    return { text: `${note ? "Noted. " : ""}${stageLine} ${requirementLineText(moved ?? found.requirement)}` };
  }
  return { text: `op: one of ${INBOX_REQUIREMENT_OPS.join(", ")}.` };
}

export function registerInboxRequirementTool(server: McpServer, context: { requirements?: RequirementStore }): void {
  server.registerTool(
    "requirement",
    {
      title: "Work the person's requirements",
      description: REQUIREMENT_DESCRIPTION,
      inputSchema: z
        .object({
          op: z.enum(INBOX_REQUIREMENT_OPS),
          requirement: z.string().optional().describe("The requirement (req_…); every op but mine."),
          thread_id: z.string().optional().describe("mine: the thread you are in."),
          kind: z.enum(DELIVERABLE_KINDS).optional().describe("deliver: design-doc | review | code-review | test-report | link | file."),
          ref: z.string().optional().describe("deliver: what it points at — a session id, owner/repo#123, a URL or a path."),
          title: z.string().optional().describe("deliver: the deliverable's name."),
          note: z.string().optional().describe("progress: one line of progress."),
          stage: z.string().optional().describe("progress: the stage you judge the work is at (design, design-review, dev, qa, code-review, done); a changed one lands as a stage event."),
          agent_name: z.string().optional().describe("How the person sees you, e.g. \"Claude Code\"."),
          agent_host: z.string().optional().describe("Your agent host, e.g. claude-code, codex, cursor."),
          agent_session: z.string().optional().describe("Your session id; the `plannotator inbox mcp` shim fills it."),
        })
        .strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (input) =>
      guarded(async () => {
        const { text } = await runRequirementCall(context, input as unknown as Record<string, unknown>);
        return okComplete(text, {});
      }),
  );
}
