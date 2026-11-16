/**
 * What the agent-note dialog, the connect line above the list and Settings →
 * Agents show, from `GET /api/inbox/agents` (the approved
 * "inbox-agent-awareness" design; "inbox-agent-note-dialog", which asked once
 * per agent in a dialog; and "inbox-agent-note-auto", which writes the note by
 * itself for the agents proven to load it, so the dialog asks only about the
 * others). Pure.
 */
import {
  INBOX_AGENT_LABELS,
  INBOX_NOTE_AGENT_IDS,
  INBOX_NOTE_AUTO_AGENT_IDS,
  inboxElsewhereText,
  inboxGrantText,
  type InboxAgentId,
  type InboxAgentRow,
  type InboxAgentsModel,
  type InboxConnectReport,
  type InboxNoteAgentId,
  type InboxNoteAutoAdd,
} from '@plannotator/core/inbox-types';

/** Agents that can take a note now: found, reaching the Inbox, no note yet, a file to put it in, and not failed this run. */
export function noteCandidates(model: InboxAgentsModel): InboxAgentRow[] {
  const failed = new Set(model.last_report?.failed.map((f) => f.agent) ?? []);
  return model.agents.filter(
    (row) => row.detected && row.note !== null && (row.note.state === 'absent' || row.note.state === 'manual') && row.reach.on && !failed.has(row.id),
  );
}

/** The agents already asked about the note. An Inbox of 0.28.18 or older says only whether it asked (once, in all). */
export function notesAskedOf(model: InboxAgentsModel): readonly InboxNoteAgentId[] {
  if (model.notes_asked) return model.notes_asked;
  return model.notes_offered ? INBOX_NOTE_AGENT_IDS : [];
}

/**
 * Who the dialog asks about: the candidates not asked yet (each agent is
 * asked once) whose note is not written by itself (the Inbox writes it for
 * the agents proven to load it, INBOX_NOTE_AUTO_AGENT_IDS; Qwen Code and
 * Cursor are still asked), Claude Code last as in the approved dialog ("Add
 * to Codex, Gemini CLI and Claude Code"). None with PLANNOTATOR_INBOX_NOTES=0.
 */
export function noteQuestionRows(model: InboxAgentsModel): InboxAgentRow[] {
  if (model.notes_env_off) return [];
  const asked = new Set<string>(notesAskedOf(model));
  const auto = new Set<string>(INBOX_NOTE_AUTO_AGENT_IDS);
  const rows = noteCandidates(model).filter((row) => !asked.has(row.id) && !auto.has(row.id));
  return [...rows.filter((row) => row.id !== 'claude-code'), ...rows.filter((row) => row.id === 'claude-code')];
}

/** Whether the dialog has anyone to ask about. */
export function noteQuestionOpen(model: InboxAgentsModel): boolean {
  return noteQuestionRows(model).length > 0;
}

/** The last run's news the person has not seen yet: the connect line's first lines. */
export function cardReport(model: InboxAgentsModel): InboxConnectReport | null {
  const report = model.last_report;
  if (!report || report.seen || report.skipped) return null;
  const news =
    report.added.length +
    report.failed.length +
    report.foreign.length +
    (report.manual_why?.length ?? 0) +
    (report.trusted?.length ?? 0) +
    (report.granted?.length ?? 0) +
    (report.trust_failed?.length ?? 0) +
    (report.elsewhere?.length ?? 0);
  return news > 0 ? report : null;
}

/**
 * What the connect line above the list says, or null for nothing: the last
 * run's news not seen yet (`cardReport`) and the notes the Inbox wrote by
 * itself that it has not said (`notes_auto`).
 */
export function connectLineNews(model: InboxAgentsModel): { report: InboxConnectReport | null; notes: InboxNoteAutoAdd[] } | null {
  const report = cardReport(model);
  const notes = model.notes_auto ?? [];
  return report || notes.length > 0 ? { report, notes } : null;
}

/**
 * The note line, "Added the Inbox note to Claude Code's instructions.", in
 * parts: the names (each path is its tooltip), and the files for a screen
 * reader (`files`, read before the full stop).
 */
export function notesAddedParts(notes: readonly InboxNoteAutoAdd[]): {
  before: string;
  names: { agent: InboxNoteAgentId; label: string; path: string }[];
  after: string;
  files: string;
} {
  const names = notes.map((note) => ({ agent: note.agent, label: INBOX_AGENT_LABELS[note.agent], path: note.path }));
  return names.length === 1
    ? { before: '已将收件箱说明添加到 ', names, after: ' 的指令中', files: names[0]!.path }
    : { before: '已将收件箱说明添加到这些 agent 的指令中：', names, after: '', files: names.map((name) => `${name.label}：${name.path}`).join('；') };
}

/** The band's lines (option A of the approved dialog): what was connected, who needs a person, what failed, whose entry is someone else's. */
export interface BandLines {
  connected: string | null;
  /** Agents this run registered Plannotator with as a trusted sender (Qwen Code): how far that reaches, and how to undo it. */
  trusted: string | null;
  granted: { agent: InboxAgentId; text: string }[];
  /** Agents whose trusted sender failed, or was removed in the agent: replies wait until they read the Inbox. */
  trustFailed: { agent: InboxAgentId; text: string }[];
  byHand: string | null;
  failed: { agent: InboxAgentId; text: string }[];
  foreign: { agent: InboxAgentId; text: string }[];
  /** Connected in another file than this Inbox's environment names (`QWEN_HOME` differs): left there; Settings moves it. */
  elsewhere: { agent: InboxAgentId; text: string }[];
}

export function bandLines(report: InboxConnectReport): BandLines {
  const label = (id: InboxAgentId) => INBOX_AGENT_LABELS[id];
  const manual = [...new Set((report.manual_why ?? []).map((m) => m.agent))];
  return {
    connected: report.added.length > 0 ? `已将 ${joinNames(report.added.map(label))} 连接到收件箱${report.first ? '' : '（这台计算机上新增）'}。` : null,
    trusted: report.trusted?.length
      ? `Plannotator 现在可以把你的回复直接发送到任何正在运行的 ${joinNames(report.trusted.map(label))} 会话，无需先询问你。可在“设置 → agent”中关闭。`
      : null,
    granted: (report.granted ?? []).map((grant) => ({ agent: grant.agent, text: inboxGrantText(grant) })),
    trustFailed: (report.trust_failed ?? []).map((f) => ({ agent: f.agent, text: `${label(f.agent)} 不会自行收到你的回复：${sentence(tidyReason(f.reason))}` })),
    byHand: manual.length > 0 ? `${joinNames(manual.map(label))} 需要你手动连接：` : null,
    failed: report.failed.map((f) => ({ agent: f.agent, text: `无法连接 ${label(f.agent)}：${sentence(tidyReason(f.reason))}` })),
    foreign: report.foreign.map((f) => ({ agent: f.agent, text: `${label(f.agent)} 有自己的 plannotator-inbox 条目${f.path ? `（在 ${f.path}）` : ''}；Plannotator 没有改动它。` })),
    elsewhere: (report.elsewhere ?? []).map((moved) => ({ agent: moved.agent, text: inboxElsewhereText(moved) })),
  };
}

/**
 * A reason as one tidy clause. An agent CLI's own message rides in
 * parentheses ("codex mcp add exited with code 3 (boom: … (permission
 * denied))"); when that message ends in a parenthesis of its own, the outer
 * pair is unwrapped to a colon, so the line never ends "))".
 */
export function tidyReason(reason: string): string {
  const text = reason.trim();
  if (!text.endsWith('))')) return text;
  let depth = 0;
  for (let i = text.length - 1; i >= 0; i--) {
    if (text[i] === ')') depth++;
    else if (text[i] === '(' && --depth === 0) {
      if (i === 0 || text[i - 1] !== ' ') return text;
      return `${text.slice(0, i - 1)}: ${text.slice(i + 1, -1)}`;
    }
  }
  return text;
}

/** A clause ended with one full stop (none added after ".", "!" or "?"). */
export function sentence(text: string): string {
  return /[。！？.!?]$/.test(text) ? text : `${text}。`;
}

/** "Codex", "Codex and Gemini CLI", "Codex, Gemini CLI and Claude Code". */
export function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names.join('');
  return names.join('、');
}

/** Who the primary names: up to three agents by name, "N agents" for four or more. */
export function whoLabel(names: readonly string[]): string {
  return names.length > 3 ? `${names.length} 个 agent` : joinNames(names);
}

/** The primary button: it names who it adds to; with nothing ticked it closes without adding. Never disabled. */
export function primaryAction(names: readonly string[]): { label: string; add: boolean } {
  if (names.length === 0) return { label: '不添加说明', add: false };
  return { label: `添加到 ${whoLabel(names)}`, add: true };
}

/** Where Cursor keeps its global rules (in the app, not a file). */
export const CURSOR_RULES_PLACE = 'Customize → Rules';

/**
 * A note the person copies by hand (Cursor: its rules live in the app, so
 * nothing is written; the note is shown to copy). Plannotator never adds,
 * sees or removes it.
 */
export function noteCopiedByHand(row: Pick<InboxAgentRow, 'note'>): boolean {
  return row.note?.state === 'manual';
}

/** The note without its marker lines: what a person copies by hand (the markers promise a removal that never happens there). */
export function noteWithoutMarkers(text: string): string {
  return text
    .split('\n')
    .filter((line) => !line.startsWith('<!-- plannotator-inbox:'))
    .join('\n');
}

/**
 * The dialog's primary with copy-by-hand agents among the ticked ones: it
 * names only the agents a note is written for ("Add to Codex"); with only
 * copy-by-hand agents ticked it shows the note to copy. Never disabled.
 */
export function notePrimaryAction(picked: readonly Pick<InboxAgentRow, 'label' | 'note'>[]): { label: string; add: boolean } {
  const written = picked.filter((row) => !noteCopiedByHand(row)).map((row) => row.label);
  if (written.length > 0) return primaryAction(written);
  if (picked.length > 0) return { label: '显示要复制的说明', add: true };
  return primaryAction([]);
}

/** Every agent in the dialog starts ticked (the owner's answer, 2026-10-13: Claude Code too). */
export function defaultPicks(rows: readonly InboxAgentRow[]): Record<string, boolean> {
  return Object.fromEntries(rows.map((row) => [row.id, true]));
}

/** What a note result shows in its row. */
export function noteResultLabel(result: { ok: true; action: string } | { ok: false }): '已创建' | '已添加' | '自行复制' | '未添加' {
  if (!result.ok) return '未添加';
  if (result.action === 'manual') return '自行复制';
  return result.action === 'created' ? '已创建' : '已添加';
}

/**
 * A path cut in the middle: the folders (`head`) shrink with "…"; the end of
 * the file name (`tail`, its last 22 characters when the name is long) always
 * shows. The whole path stays in the DOM.
 */
export function splitPath(path: string): { head: string; tail: string } {
  const slash = path.lastIndexOf('/') + 1;
  const name = path.length - slash;
  const keep = name > 28 ? 22 : name;
  return { head: path.slice(0, path.length - keep), tail: path.slice(path.length - keep) };
}
