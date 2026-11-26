/**
 * Context builders — translate Plannotator review state into system prompts
 * that give the AI session the right background for answering questions.
 *
 * These are provider-agnostic: any AIProvider implementation can use them
 * to build the system prompt it needs.
 */

import type { AIContext } from "./types.ts";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build a system prompt from the given context.
 *
 * The prompt tells the AI:
 * - What role it plays (plan reviewer, code reviewer, etc.)
 * - The content it should reference (plan markdown, diff patch, file)
 * - Any annotations the user has already made
 * - That it's operating inside Plannotator (not a general coding session)
 */
export function buildSystemPrompt(ctx: AIContext): string {
  switch (ctx.mode) {
    case "plan-review":
      return buildPlanReviewPrompt(ctx);
    case "code-review":
      return buildCodeReviewPrompt();
    case "annotate":
      return buildAnnotatePrompt(ctx);
    case "butler":
      return buildButlerPrompt();
  }
}

/** 管家的人设（approval "butler" 一期）：收件箱的数字总管，对话式陪伴与统筹入口。 */
export function buildButlerPrompt(): string {
  return [
    "You are 管家 (the Butler), the digital concierge of the Plannotator Inbox.",
    "",
    "Speak Chinese (the person's language), address them as 您, and keep a warm,",
    "professional butler tone — concise, unhurried, never servile.",
    "You are the entry point of the Inbox and the person's project manager for",
    "requirements: you know what each one is, where it stands, and who is",
    "waiting on whom. When something needs the person, you say so first.",
    "You never do the work yourself: real work runs in an execution session,",
    "which you can create through your action channel (below).",
    "",
    "Your own skills are ONLY your house specialties, the butler-* ones",
    "(需求受理, 收件箱向导). Anything else visible in the environment — the",
    "person's own skills (PPT, front-end, admin console, ...) — is NOT yours:",
    "never list, advertise, or present those as your abilities. When asked what",
    "you can do, answer with your house specialties and this concierge role.",
    "",
    "You keep a ledger of every requirement in the Inbox, in your own folder:",
    "ledger/<req_id>.md is the reading view (background, timeline, who is",
    "waiting on whom, the next step); ledger/<req_id>.json is the same facts",
    "for machines. When the person asks how something is going, read that",
    "requirement's ledger first and answer from it. A message that starts with",
    "【动态】 is what changed in the Inbox since you last looked: those lines",
    "come from the Inbox's own history. Every fact you state must trace to a",
    "ledger line, a 【动态】 line, or a requirement id; if it is not there, say",
    "you are not sure — never make up who delivered what, what stage something",
    "is in, or who is waiting.",
    "",
    "Your own conversation is a butler session in your folder, NOT an Inbox",
    "thread. A requirement is a Workshop card, not a thread; creating one",
    "does not put it on your chat. An execution session started from it gets",
    "its own thread, with the card as its opening words.",
    "",
    "Your action channel is the file action.json in your folder (cat it for",
    "the URL). POST JSON to it with curl: { \"action\": ...,",
    "\"idempotency_key\": ..., \"event_id\": ..., ... }. Actions:",
    "- create-requirement { title, notes, contexts?, priority?, thread?, project_id? }",
    "  notes IS the requirement-card document: a Markdown body with the six",
    "  sections (背景 / 为什么, 目标, 范围, 约束, 验收, 开放问题). Use your",
    "  butler-requirement-card skill to write it; contexts are { kind: link, name,",
    "  ref } or { kind: file, name, path } (a file path you can read, e.g. an",
    "  attachment under files/); thread is the conversation it came from.",
    "- launch-session { agent, requirement?, project_id or folder?, words?, thread_name? }",
    "  A launch with a requirement uses the card's project; name a project or folder",
    "  only when the card has none (or the owner wants another).",
    "- archive-requirement { requirement }",
    "  Archives the card and releases its sessions (an Inbox-started one is stopped).",
    "  It is a permission action like launch/stop: it may answer pending_approval,",
    "  and needs the owner's approval unless its switch is 直接允许.",
    "- tell-session { requirement? or thread? or session?, words }",
    "- stop-session { requirement? or thread? or session? }",
    "- remind { requirement?, text }",
    "Always send a fresh idempotency_key; reuse the same one when retrying.",
    "The owner approves actions in the 审批 tab of your own page (the tab bar",
    "对话 / 审批 at the top). create-requirement, launch-session, archive-requirement",
    "and stop-session may answer pending_approval: say it is in 管家页的审批 and wait for the result",
    "event; never say it was done before that event arrives. If the answer says",
    "ok: true, it was done; if it says ok: false, tell the owner exactly what it",
    "said. The 审批 tab has a switch for each action (每次审批 / 直接允许); the",
    "owner controls it there.",
    "",
    "Keep replies short (a few sentences unless detail is asked for).",
  ].join("\n");
}

/**
 * Build a compact context summary suitable for injecting into a fork prompt.
 *
 * When forking from a parent session, we don't need a full system prompt
 * (the parent's history already provides context). Instead, we inject a
 * short "you are now in Plannotator" preamble with the relevant content.
 */
export function buildForkPreamble(ctx: AIContext): string {
  const lines: string[] = [
    "The user is now reviewing your work in Plannotator and has a question.",
    "Answer the user's message directly and concisely based on the conversation " +
      "history and the context below. Do not re-review or summarize the work unless they ask.",
    "",
  ];

  switch (ctx.mode) {
    case "plan-review": {
      lines.push("## Current Plan Under Review");
      if (ctx.plan.version) {
        const total = ctx.plan.totalVersions ? ` of ${ctx.plan.totalVersions}` : "";
        lines.push(`Plan version: ${ctx.plan.version}${total}`);
      }
      if (ctx.plan.project) {
        lines.push(`Project: ${ctx.plan.project}`);
      }
      lines.push("");
      lines.push(bounded(ctx.plan.plan));
      if (ctx.plan.annotations) {
        lines.push("");
        lines.push("## User Annotations So Far");
        lines.push(ctx.plan.annotations);
      }
      break;
    }
    case "code-review": {
      if (ctx.review.filePath) {
        lines.push(`## Reviewing: ${ctx.review.filePath}`);
      }
      if (ctx.review.selectedCode) {
        lines.push("");
        lines.push("### Selected Code");
        lines.push("```");
        lines.push(ctx.review.selectedCode);
        lines.push("```");
      }
      if (ctx.review.lineRange) {
        const { start, end, side } = ctx.review.lineRange;
        lines.push(`Lines ${start}-${end} (${side} side)`);
      }
      lines.push("");
      lines.push("## Diff Patch");
      lines.push("```diff");
      lines.push(bounded(ctx.review.patch));
      lines.push("```");
      if (ctx.review.annotations) {
        lines.push("");
        lines.push("## User Annotations So Far");
        lines.push(ctx.review.annotations);
      }
      break;
    }
    case "annotate": {
      lines.push(`## Annotating: ${ctx.annotate.filePath}`);
      if (ctx.annotate.bundlePosition) {
        lines.push(`File ${ctx.annotate.bundlePosition.index} of ${ctx.annotate.bundlePosition.total} in a review of several files.`);
      }
      if (ctx.annotate.sourceInfo) {
        lines.push(`Source: ${ctx.annotate.sourceInfo}`);
      }
      if (ctx.annotate.renderAs) {
        lines.push(`Render mode: ${ctx.annotate.renderAs}`);
      }
      if (ctx.annotate.sourceConverted) {
        lines.push("Note: this content was converted before annotation, so source line numbers may not match the original document.");
      }
      lines.push("");
      lines.push(bounded(ctx.annotate.content));
      if (ctx.annotate.annotations) {
        lines.push("");
        lines.push("## User Annotations So Far");
        lines.push(ctx.annotate.annotations);
      }
      break;
    }
  }

  return lines.join("\n");
}

/**
 * Build the effective prompt for a query, prepending a preamble on the first
 * message. Used by providers that inject context via the prompt itself (Codex,
 * Pi) rather than a separate system-prompt channel (Claude).
 */
export function buildEffectivePrompt(
  userPrompt: string,
  preamble: string | null,
  firstQuerySent: boolean,
): string {
  if (!firstQuerySent && preamble) {
    return `${preamble}\n\n---\n\nUser question: ${userPrompt}`;
  }
  return userPrompt;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/**
 * The plan, document and diff go in whole up to this many characters (about
 * 75,000 tokens): every provider sends the prompt over a pipe or HTTP, and it
 * fits the smallest context the Ask AI agents run (128,000 tokens) with room
 * for the conversation. Past it the text is cut with a marker the model
 * reads, as before, so a document as big as annotate takes (2 MB) still gets
 * an answer instead of the provider's "too long" error. (Through 0.28.61 the
 * cut was at 60,000, and 40,000 for a diff.)
 */
const MAX_CONTEXT_CHARS = 300_000;

function bounded(text: string): string {
  if (text.length <= MAX_CONTEXT_CHARS) return text;
  return `${text.slice(0, MAX_CONTEXT_CHARS)}\n\n... [truncated for context window: ${MAX_CONTEXT_CHARS.toLocaleString("en-US")} of ${text.length.toLocaleString("en-US")} characters shown]`;
}

/**
 * Leading instruction for every Ask AI session. Ask AI is a chat assistant —
 * it must respond to the user's message, not launch an unprompted review of the
 * material it was given for context.
 */
const ANSWER_DIRECTLY =
  "You are a helpful assistant inside Plannotator. Respond to the user's message directly and concisely. " +
  "The material below is context for what the user is looking at — do NOT review, summarize, or critique it unless the user's message asks you to. " +
  "Only investigate further (read files, run git) if the user's question actually requires it.";

function buildPlanReviewPrompt(
  ctx: Extract<AIContext, { mode: "plan-review" }>
): string {
  const sections: string[] = [
    ANSWER_DIRECTLY,
    "",
    "The user is reviewing an implementation plan in Plannotator.",
    "",
    "## Plan Under Review",
  ];

  if (ctx.plan.version) {
    const total = ctx.plan.totalVersions ? ` of ${ctx.plan.totalVersions}` : "";
    sections.push(`Plan version: ${ctx.plan.version}${total}`);
  }

  if (ctx.plan.project) {
    sections.push(`Project: ${ctx.plan.project}`);
  }

  sections.push("");
  sections.push(bounded(ctx.plan.plan));

  if (ctx.plan.previousPlan) {
    sections.push("");
    sections.push("## Previous Plan Version (for reference)");
    sections.push(bounded(ctx.plan.previousPlan));
  }

  if (ctx.plan.annotations) {
    sections.push("");
    sections.push("## User Annotations");
    sections.push(ctx.plan.annotations);
  }

  return sections.join("\n");
}

/**
 * Code-review system prompt: role only. The actual changeset and how to inspect
 * it are NOT in the system prompt — they ride on the user's messages, where the
 * review server's shared agent-review prompt machine describes the *current*
 * view (a git command to run, or the diff inline for modes git can't reproduce)
 * and the client latches it on. See packages/server/review.ts
 * `buildCurrentAiReviewContext` and packages/ui/utils/aiPrompt.ts.
 */
function buildCodeReviewPrompt(): string {
  return [
    ANSWER_DIRECTLY,
    "",
    "The user is reviewing a set of code changes in Plannotator. Their messages " +
      "describe the changeset under review and how to inspect it — either a git " +
      "command to run, or the diff inline.",
  ].join("\n");
}

function buildAnnotatePrompt(
  ctx: Extract<AIContext, { mode: "annotate" }>
): string {
  const sections: string[] = [
    ANSWER_DIRECTLY,
    "",
    "The user is annotating a markdown document in Plannotator.",
    "",
    `## Document: ${ctx.annotate.filePath}`,
  ];

  if (ctx.annotate.bundlePosition) {
    sections.push(`File ${ctx.annotate.bundlePosition.index} of ${ctx.annotate.bundlePosition.total} in a review of several files.`);
  }

  if (ctx.annotate.sourceInfo) {
    sections.push(`Source: ${ctx.annotate.sourceInfo}`);
  }

  if (ctx.annotate.renderAs) {
    sections.push(`Render mode: ${ctx.annotate.renderAs}`);
  }

  if (ctx.annotate.sourceConverted) {
    sections.push("Note: this content was converted before annotation, so source line numbers may not match the original document.");
  }

  sections.push("");
  sections.push(bounded(ctx.annotate.content));

  if (ctx.annotate.annotations) {
    sections.push("");
    sections.push("## User Annotations");
    sections.push(ctx.annotate.annotations);
  }

  return sections.join("\n");
}
