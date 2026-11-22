/**
 * The workshop's requirement contexts offered beside a session's reply (approval
 * "session-reply-contexts", design doc delivered to 改造工坊): the person picks a
 * few from the session's requirement, and the Send appends them to the reply's
 * words as the workshop compose template's 上下文材料 list — 名字（引用）per line,
 * so the agent reads the materials straight from the reply (a path it Reads, a
 * URL it opens) without a round trip through the requirement tool.
 */

/** One of the session's requirement's contexts, as ThreadPane's `replyContexts` prop takes them. */
export interface ReplyContextOption {
  id: string;
  kind: string;
  name: string;
  ref?: string;
  image?: boolean;
}

/** Same heading the workshop compose template writes (ComposeDialog `templateBody`). */
export const REPLY_CONTEXTS_HEADING = '## 上下文材料';

/**
 * The `## 上下文材料` section for the picked contexts, appended to the reply's
 * words: `- 名字（引用）` per line — a file's ref is its path (the agent Reads
 * it), a link's is the full URL (the agent opens it); a name alone would cost
 * the agent a `requirement get` round trip to even know what the material is.
 * Null when nothing is picked (no section, no trailing blank line).
 */
export function replyContextSection(contexts: readonly ReplyContextOption[], picked: ReadonlySet<string>): string | null {
  const chosen = contexts.filter((context) => picked.has(context.id));
  if (chosen.length === 0) return null;
  const lines = chosen.map((context) => `- ${context.name}${context.ref ? `（${context.ref}）` : ''}`);
  return `${REPLY_CONTEXTS_HEADING}\n\n${lines.join('\n')}`;
}
