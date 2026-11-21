/**
 * The workshop (需求) panel's `requirement` tool: the one-line calls an agent working a
 * requirement uses to keep it current — see what it is (get/mine), tie the
 * work to it (link thread), attach what it just finished (deliver), leave a
 * word (say); stages move themselves (a delivered design doc enters review; the verdict moves it on) —
 * D1 of the approved lifecycle design). The rules live once, in the store
 * (packages/server/requirements.ts); this module maps the tool onto them, as
 * inbox-mcp-cards.ts maps `card`.
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

export const INBOX_REQUIREMENT_OPS = ["mine", "get", "link", "deliver", "say", "stage"] as const;
export type InboxRequirementOp = (typeof INBOX_REQUIREMENT_OPS)[number];

/** For raw MCP clients; the agent tool words its action line itself (INBOX_AGENT_ACTION_LEADS.requirement). */
export const REQUIREMENT_DESCRIPTION =
  'Work the person\'s requirements (the workshop board). op: mine (the requirements of a thread you are in: thread_id; without one, every active requirement), get (one requirement: requirement), link (tie this thread\'s work to it: thread_id), deliver (attach what you just finished: kind one of design-doc, test-report, link, file, and ref — a path, URL or PR; a link ref is a full http(s) URL; a design-doc ref is the document itself, a .md/.markdown/.txt/.html path or URL you saved, NEVER a session id like pn-…: the review opens the document, so anything else is refused), say (one line of progress, shown in its history), stage (move the requirement to a stage: requirement + stage; the one way a stage changes — design, design-review, dev, qa, code-review, done). Stages move themselves: deliver a design doc (kind design-doc, or an .md/.html file) and the requirement enters review on its own; the person\'s verdict there moves it on — never propose or move a stage yourself.';


/** One requirement as one line of text: every fact an agent acts on. */
export function requirementLineText(requirement: Requirement): string {
  const parts = [`- ${requirement.id}`, JSON.stringify(requirement.title), requirementStageLabel(requirement.stage)];
  if (requirement.threads.length > 0) parts.push(`threads ${requirement.threads.join(", ")}`);
  parts.push(`deliverables ${requirement.deliverables.length}`);
  return parts.join(" ");
}

/** One requirement as its full text answer: stage, threads, deliverables, notes. */
function requirementFullText(requirement: Requirement): string {
  const lines = [requirementLineText(requirement)];
  for (const deliverable of requirement.deliverables) {
    lines.push(`- ${DELIVERABLE_KIND_LABELS[deliverable.kind]}: ${deliverable.title ?? deliverable.ref}${deliverable.title ? ` (${deliverable.ref})` : ""}${deliverable.by ? ` by ${deliverable.by}` : ""}`);
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
  if (op === "link") {
    const threadId = typeof input.thread_id === "string" ? input.thread_id.trim() : "";
    if (!threadId) return { text: "thread_id: the thread to tie the requirement's work to." };
    const linked = store.link(requirementId, threadId, authorOf(input));
    return { text: `Linked. ${requirementLineText(linked)}` };
  }
  if (op === "deliver") {
    const deliverable = store.deliver(requirementId, {
      kind: input.kind as DeliverableKind,
      ref: input.ref as string,
      ...(typeof input.title === "string" ? { title: input.title } : {}),
      by: authorOf(input),
    });
    return { text: `Attached ${DELIVERABLE_KIND_LABELS[deliverable.kind]}: ${deliverable.title ?? deliverable.ref}` };
  }
  if (op === "stage") {
    const to = typeof input.stage === "string" ? (input.stage as RequirementStage) : null;
    if (!to || !isRequirementStage(to)) return { text: `stage: one of ${REQUIREMENT_STAGES.map((stage) => stage.label).join(", ")}.` };
    const before = found.requirement.stage;
    if (before === to) return { text: `Already ${requirementStageLabel(to)}.` };
    const moved = store.patch(requirementId, { stage: to });
    store.say(requirementId, `阶段：${requirementStageLabel(before)} → ${requirementStageLabel(to)}`, "阶段");
    return { text: `Stage: ${requirementStageLabel(before)} → ${requirementStageLabel(to)}. ${requirementLineText(moved)}` };
  }
  if (op === "say") {
    store.say(requirementId, input.note as string, authorOf(input));
    return { text: "Noted on the requirement's history." };
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
          thread_id: z.string().optional().describe("mine: the thread you are in. link: the thread to tie to the requirement."),
          kind: z.enum(DELIVERABLE_KINDS).optional().describe("deliver: design-doc | review | code-review | test-report | link | file."),
          ref: z.string().optional().describe("deliver: what it points at — a session id, owner/repo#123, a URL or a path."),
          title: z.string().optional().describe("deliver: the deliverable's name, a few words."),
          note: z.string().optional().describe("say: one line of progress."),
          stage: z.string().optional().describe("stage: the stage to move to (design, design-review, dev, qa, code-review, done)."),
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
