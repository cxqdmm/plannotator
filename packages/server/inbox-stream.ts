/**
 * Plannotator Inbox: 会话「对话流」— the thread's Claude Code session transcript,
 * read for the person's window. The session's own work stream (its words, its
 * tool calls and their results) as it happened, from the file Claude Code
 * always writes: `<config dir>/projects/<folder's name>/<session>.jsonl`. Any
 * Claude Code session the thread's owner is — launched from the Inbox, or
 * started in a terminal and connected by its plugin — has one.
 *
 *   GET /api/inbox/threads/:id/stream               the tail: `{ entries, cursor, more, session }`
 *   GET …/stream?after=<cursor>                     what grew past the cursor (the pane's live poll)
 *   GET …/stream?before=<cursor>                    the page before it (加载更早)
 *
 * An entry is one transcript line, keyed by its line index (`i`): a tool call
 * and the result a later line brings answer as the SAME `i`, so the window
 * upserts and a running call completes in place. Conversations are the
 * person's alone, so the route answers only the person's own window, reads
 * included (`403 window_only`, the browser's own `Sec-Fetch-Site`), as Ask
 * AI's routes do (inbox-ask.ts). No session resolvable answers `404
 * no_session`; a transcript that is gone or was never written `404
 * no_transcript` (the entry stays offerable: the session id names a file that
 * may appear on its next turn).
 *
 * Nothing here writes, keeps state, or wakes anything: the file is read when
 * asked, its mtime cached so an unchanged poll (the pane asks every second or
 * two) answers with no read at all. What a transcript holds too much of is
 * cut: entries to CLAUDE_STREAM_TEXT_MAX characters, tool results to
 * CLAUDE_STREAM_RESULT_MAX, and a line that is not one of ours (a summary, a
 * sidechain's thinking) is skipped, never guessed at.
 */

import { readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { InboxError } from "@plannotator/shared/inbox/schema";
import type { InboxStore } from "@plannotator/shared/inbox/store";
import type { AgentEnvironment } from "./inbox-agents";
import { claudeConfigDir } from "./inbox-agents";
import { claudeTranscriptPath } from "./inbox-launch-claude";

export const INBOX_STREAM_PATH = /^\/api\/inbox\/threads\/([A-Za-z0-9_]+)\/stream$/;

/** How much of a text entry (the person's, Claude's, a thought) is kept. */
export const CLAUDE_STREAM_TEXT_MAX = 4000;
/** How much of a tool's result is kept (the expanded view; the rest is Claude's to show). */
export const CLAUDE_STREAM_RESULT_MAX = 2000;
/** The tail's and each earlier page's most entries. */
export const CLAUDE_STREAM_PAGE = 120;

/** One transcript line as the pane draws it. */
export interface StreamEntry {
  /** The transcript line the entry is (its key; a tool's result lands on the same one). */
  i: number;
  kind: "you" | "text" | "think" | "tool";
  /** When the line was written (ms since the epoch), so the pane merges the transcript with the ask conversation by time. */
  t?: number;
  /** you / text / think: the words. */
  text?: string;
  /** tool: the call's name, and its input in one line (the row) and in full (the expand). */
  tool?: string;
  brief?: string;
  input?: string;
  /** tool: the result, when its line has arrived (absent: still running). */
  result?: string;
}

/** A transcript's brief for a tool's input: the field that names the call, never a JSON dump. */
export function toolBriefOf(name: string, input: unknown): string {
  const value = (key: string): unknown => (typeof input === "object" && input !== null && key in input ? (input as Record<string, unknown>)[key] : undefined);
  const one = (word: unknown): string | null => (typeof word === "string" && word.trim() ? word.trim().replace(/\s+/g, " ") : null);
  const clip = (word: string): string => (word.length > 90 ? `${word.slice(0, 89)}…` : word);
  const brief =
    name === "Bash" ? one(value("command")) :
    name === "Read" || name === "Write" || name === "Edit" || name === "NotebookEdit" ? one(value("file_path")) ?? one(value("notebook_path")) :
    name === "Grep" || name === "Glob" ? one(value("pattern")) :
    name === "WebFetch" ? one(value("url")) :
    name === "WebSearch" || name === "Task" ? one(value("query")) ?? one(value("description")) :
    name === "TodoWrite" ? (Array.isArray(value("todos")) ? `${(value("todos") as unknown[]).length} 项` : null) :
    Object.keys(typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {}).map((key) => `${key}: ${clip(String((input as Record<string, unknown>)[key] ?? ""))}`).slice(0, 2).join(" · ") || null;
  return clip(brief ?? "");
}

const clip = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max)}…` : text);

/** The entries of transcript lines, oldest first; `from`/`to` (to exclusive) bound the slice. */
export function streamEntriesOf(lines: readonly string[], from: number, to: number): StreamEntry[] {
  const entries: StreamEntry[] = [];
  // A tool call's line, by the tool_use id its result line names.
  const byUseId = new Map<string, StreamEntry>();
  for (let index = from; index < to && index < lines.length; index++) {
    let line: Record<string, unknown>;
    try {
      line = JSON.parse(lines[index]!) as Record<string, unknown>;
    } catch {
      continue;
    }
    // Sidechains (a subagent's own transcript entries) and bookkeeping lines are not the conversation.
    if (line.isSidechain === true || line.isMeta === true) continue;
    const at = typeof line.timestamp === "string" ? Date.parse(line.timestamp) : undefined;
    const when = Number.isFinite(at) ? { t: at } : {};
    const content = (line.message as { content?: unknown } | undefined)?.content;
    if (line.type === "user") {
      if (typeof content === "string") {
        entries.push({ i: index, kind: "you", ...when, text: clip(content, CLAUDE_STREAM_TEXT_MAX) });
        continue;
      }
      if (!Array.isArray(content)) continue;
      for (const block of content) {
        const part = block as { type?: string; text?: unknown; content?: unknown; tool_use_id?: unknown; is_error?: boolean };
        if (part.type === "text" && typeof part.text === "string" && part.text.trim()) entries.push({ i: index, kind: "you", ...when, text: clip(part.text, CLAUDE_STREAM_TEXT_MAX) });
        if (part.type === "tool_result" && typeof part.tool_use_id === "string") {
          const tool = byUseId.get(part.tool_use_id);
          const words = typeof part.content === "string" ? part.content : Array.isArray(part.content) ? part.content.map((piece) => (typeof (piece as { text?: unknown }).text === "string" ? (piece as { text: string }).text : "")).join("\n") : "";
          if (tool && words.trim()) tool.result = clip(words.trim(), CLAUDE_STREAM_RESULT_MAX) + (part.is_error ? " ⚠" : "");
        }
      }
      continue;
    }
    if (line.type === "assistant" && Array.isArray(content)) {
      for (const block of content) {
        const part = block as { type?: string; text?: unknown; thinking?: unknown; name?: unknown; id?: unknown; input?: unknown };
        if (part.type === "text" && typeof part.text === "string" && part.text.trim()) entries.push({ i: index, kind: "text", ...when, text: clip(part.text, CLAUDE_STREAM_TEXT_MAX) });
        if (part.type === "thinking" && typeof part.thinking === "string" && part.thinking.trim()) entries.push({ i: index, kind: "think", ...when, text: clip(part.thinking, CLAUDE_STREAM_TEXT_MAX) });
        if (part.type === "tool_use" && typeof part.name === "string") {
          const entry: StreamEntry = { i: index, kind: "tool", ...when, tool: part.name, brief: toolBriefOf(part.name, part.input), input: clip(JSON.stringify(part.input ?? {}, null, 1), 800) };
          entries.push(entry);
          if (typeof part.id === "string") byUseId.set(part.id, entry);
        }
      }
    }
  }
  return entries;
}

/** The transcript file of a thread's Claude Code session, or why there is none. */
export function claudeStreamFileOf(threadId: string, store: InboxStore, environment: AgentEnvironment): { file: string; session: string; folder: string } | { none: "thread" | "host" | "session" | "file" } {
  const thread = store.thread(threadId);
  const owner = thread ? store.threadOwner(threadId) : null;
  if (!thread || !owner) return { none: "thread" };
  if (owner.host !== "claude-code") return { none: "host" };
  // The mod's session ids can arrive tagged with their host (`claude-code:<id>`); the transcript's name is the id.
  const session = owner.session.replace(/^claude-code:/, "");
  const configDir = claudeConfigDir(environment);
  const direct = thread.project.root ? claudeTranscriptPath(configDir, thread.project.root, session) : null;
  // The folder a session started in is not always the thread's project (a session that moved, or never said): the
  // projects folders hold every one, and a session id names but one file among them.
  if (direct) {
    try {
      statSync(direct);
      return { file: direct, session, folder: thread.project.root };
    } catch {
      // Fall through to the search.
    }
  }
  try {
    const projects = join(configDir, "projects");
    for (const dir of readdirSync(projects)) {
      const candidate = join(projects, dir, `${session}.jsonl`);
      try {
        statSync(candidate);
        return { file: candidate, session, folder: thread.project.root };
      } catch {
        continue;
      }
    }
  } catch {
    // No projects folder at all.
  }
  return { none: "file" };
}

/** The mtime guard: an unchanged transcript answers with no read (the pane polls every second or two). */
const unchanged = new Map<string, { size: number; mtime: number }>();

/* ── opencode（v2 存储，设计 req_01M81EZN9 内交付的 design-doc-opencode-stream）：只读镜像它的 sqlite ── */

interface OpenCodePart {
  type?: string;
  text?: string;
  name?: string;
  state?: { status?: string; input?: unknown; content?: { type?: string; text?: string }[] };
}
interface OpenCodeMessage {
  type?: string;
  content?: OpenCodePart[];
  time?: { created?: number };
}

/** opencode 的数据目录（它自身的规则：`XDG_DATA_HOME` 优先，否则 `~/.local/share` 下）。不存在：null。 */
export function openCodeDataDir(): string | null {
  const base = process.env.XDG_DATA_HOME?.trim() || join(homedir(), ".local", "share");
  const dir = join(base, "opencode");
  try {
    statSync(dir);
    return dir;
  } catch {
    return null;
  }
}

/** opencode 会话（v2 sqlite）的流来源：库文件在就有流（会话没写过 → 空流）；库不在 → 无流。 */
export function openCodeStreamSource(session: string): { host: "opencode"; db: string; session: string } | { none: "dir" | "db" } {
  const dir = openCodeDataDir();
  if (!dir) return { none: "dir" };
  const db = join(dir, "opencode.db");
  try {
    statSync(db);
  } catch {
    return { none: "db" };
  }
  return { host: "opencode", db, session };
}

/** opencode v2 库里该会话的全部条目，最旧在前（`i` 为全局序）。只读连接，绝不写它的库。 */
export function openCodeStreamEntries(dbPath: string, session: string): StreamEntry[] {
  const db = new Database(dbPath, { readonly: true });
  try {
    const rows = db.query("SELECT type, data FROM session_message WHERE session_id = ? ORDER BY seq").all(session) as { type: string; data: string }[];
    const entries: StreamEntry[] = [];
    for (const row of rows) {
      let data: OpenCodeMessage;
      try {
        data = JSON.parse(row.data ?? "{}") as OpenCodeMessage;
      } catch {
        continue;
      }
      const at = data.time?.created;
      const when = typeof at === "number" && Number.isFinite(at) ? { t: at } : {};
      if (row.type === "user") {
        for (const part of data.content ?? []) {
          if (part.type === "text" && part.text?.trim()) entries.push({ i: entries.length, kind: "you", ...when, text: clip(part.text, CLAUDE_STREAM_TEXT_MAX) });
        }
        continue;
      }
      // assistant 以外的行（idle、model-switched、synthetic）不是对话内容。
      if (row.type !== "assistant") continue;
      for (const part of data.content ?? []) {
        if (part.type === "text" && part.text?.trim()) entries.push({ i: entries.length, kind: "text", ...when, text: clip(part.text, CLAUDE_STREAM_TEXT_MAX) });
        else if (part.type === "reasoning" && part.text?.trim()) entries.push({ i: entries.length, kind: "think", ...when, text: clip(part.text, CLAUDE_STREAM_TEXT_MAX) });
        else if (part.type === "tool") {
          const state = part.state ?? {};
          const done = state.status === "completed" || state.status === "error";
          const output = (state.content ?? []).map((piece) => piece.text ?? "").join("\n").trim();
          entries.push({
            i: entries.length,
            kind: "tool",
            ...when,
            tool: part.name ?? "",
            brief: toolBriefOf(part.name ?? "", state.input),
            input: clip(JSON.stringify(state.input ?? {}, null, 1), 800),
            ...(done ? { result: clip(output, CLAUDE_STREAM_RESULT_MAX) + (state.status === "error" ? " ⚠" : "") } : {}),
          });
        }
      }
    }
    return entries;
  } finally {
    db.close();
  }
}

/** 线程的流来源，按宿主分发：claude-code 的 transcript、opencode 的 v2 库，其余宿主无流。 */
export function streamSourceOf(
  threadId: string,
  store: InboxStore,
  environment: AgentEnvironment,
): { host: "claude-code"; file: string; session: string; folder: string } | { host: "opencode"; db: string; session: string } | { none: "thread" | "host" | "session" | "file" | "dir" | "db" } {
  const thread = store.thread(threadId);
  const owner = thread ? store.threadOwner(threadId) : null;
  if (!thread || !owner) return { none: "thread" };
  if (owner.host === "opencode") {
    const source = openCodeStreamSource(owner.session);
    return "none" in source ? { none: source.none } : { host: "opencode", db: source.db, session: source.session };
  }
  const claude = claudeStreamFileOf(threadId, store, environment);
  return "none" in claude ? claude : { host: "claude-code", file: claude.file, session: claude.session, folder: claude.folder };
}

export function createInboxStreamRoute(options: { store: InboxStore; environment: () => AgentEnvironment; json: (body: unknown, status?: number) => Response }): { route: (req: Request, url: URL) => Promise<Response | null> } {
  const fromWindow = (req: Request): boolean => req.headers.get("sec-fetch-site")?.trim().toLowerCase() === "same-origin";
  return {
    route: async (req, url) => {
      const match = INBOX_STREAM_PATH.exec(url.pathname);
      if (!match) return null;
      if (req.method !== "GET") return options.json({ error: "Use GET.", code: "method" }, 405);
      if (!fromWindow(req)) throw new InboxError("window_only", "The stream answers only the Inbox window.");
      const resolved = streamSourceOf(match[1]!, options.store, options.environment());
      if ("none" in resolved) {
        const code = resolved.none === "thread" || resolved.none === "host" ? "no_session" : "no_transcript";
        return options.json({ error: code === "no_session" ? "This thread's owner is not a session with a stream." : "This session has no transcript on this machine.", code }, 404);
      }
      if (resolved.host === "opencode") {
        // opencode（v2 sqlite）：库文件做变更守卫；条目按 seq 全量排出后窗口分页（一条消息可产多条）。
        let size = 0;
        let mtime = 0;
        try {
          const stat = statSync(resolved.db);
          size = stat.size;
          mtime = stat.mtimeMs;
        } catch {
          return options.json({ error: "This session has no transcript on this machine.", code: "no_transcript" }, 404);
        }
        const after = Number(url.searchParams.get("after") ?? Number.NaN);
        const before = Number(url.searchParams.get("before") ?? Number.NaN);
        const seen = unchanged.get(resolved.db);
        if (seen && seen.size === size && seen.mtime === mtime && Number.isSafeInteger(after) && after > 0) {
          return options.json({ entries: [], cursor: after, more: after > 0, session: { id: resolved.session, host: "opencode" } });
        }
        const entries = openCodeStreamEntries(resolved.db, resolved.session);
        unchanged.set(resolved.db, { size, mtime });
        const total = entries.length;
        const window = Number.isSafeInteger(before) && before > 0 ? { from: Math.max(0, before - CLAUDE_STREAM_PAGE), to: before } : { from: Math.max(0, total - CLAUDE_STREAM_PAGE), to: total };
        return options.json({
          entries: entries.slice(window.from, window.to),
          cursor: total,
          more: window.from > 0,
          session: { id: resolved.session, host: "opencode" },
        });
      }
      // The mtime guard: the file was not written since the last read, so nothing grew.
      let size = 0;
      let mtime = 0;
      try {
        const stat = statSync(resolved.file);
        size = stat.size;
        mtime = stat.mtimeMs;
      } catch {
        return options.json({ error: "This session has no transcript on this machine.", code: "no_transcript" }, 404);
      }
      const seen = unchanged.get(resolved.file);
      const after = Number(url.searchParams.get("after") ?? Number.NaN);
      const before = Number(url.searchParams.get("before") ?? Number.NaN);
      if (seen && seen.size === size && seen.mtime === mtime && Number.isSafeInteger(after) && after > 0) {
        return options.json({ entries: [], cursor: after, more: after > 0, session: { id: resolved.session, host: "claude-code" } });
      }
      const text = await Bun.file(resolved.file).text();
      const lines = text.split("\n");
      // A transcript is appended whole lines: one trailing empty segment is the file's last newline, not a line.
      if (lines.length > 0 && lines.at(-1) === "") lines.pop();
      unchanged.set(resolved.file, { size, mtime });
      // The tail, or a page before a cursor; the line count is the next poll's `after`.
      const total = lines.length;
      const window = Number.isSafeInteger(before) && before > 0 ? { from: Math.max(0, before - CLAUDE_STREAM_PAGE), to: before } : { from: Math.max(0, total - CLAUDE_STREAM_PAGE), to: total };
      return options.json({
        entries: streamEntriesOf(lines, window.from, window.to),
        cursor: total,
        more: window.from > 0,
        session: { id: resolved.session, host: "claude-code", project: resolved.folder },
      });
    },
  };
}
