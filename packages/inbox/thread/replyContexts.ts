/**
 * The workshop's requirement contexts offered beside a session's reply (approval
 * "session-reply-contexts", design doc delivered to 改造工坊): the person 点选或拖拽 a
 * material from the picker, and the insert lands in the reply's words as an inline
 * markdown link `[名字](引用)` — the agent reads the material straight from the
 * reply (a path it Reads, a URL it opens) without a round trip through the
 * requirement tool.
 */

/** One of the session's requirement's contexts, as ThreadPane's `replyContexts` prop takes them. */
export interface ReplyContextOption {
  id: string;
  kind: string;
  name: string;
  ref?: string;
  image?: boolean;
}

/** 材料的内嵌文本：markdown 链接 `[名字](引用)`——agent 直接读引用；无引用裸名。 */
export function replyContextMarkdown(context: ReplyContextOption): string {
  return context.ref ? `[${context.name}](${context.ref})` : context.name;
}
