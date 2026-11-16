/**
 * Threads pinned to the sidebar (approval "inbox-pinned-threads",
 * .product/approved/inbox-pinned-threads/, variant Count): what a pinned row
 * shows, its name, the order a move makes, and the Unpin toast. Pure.
 *
 * A pin is window furniture: it changes nothing about the thread (its
 * section, routing, questions, delivery, counts or notifications), and agents
 * never see it. No limit on pins; an archived thread stays pinned.
 */

import { INBOX_SECTIONS, inboxRowArchived, type InboxListRow } from '@plannotator/core/inbox-types';
import { waitCount } from './format';
import { threadChipName } from './threadChip';

/** What a pinned row's state signal is (Count): a pill, a count, a dot, or nothing. */
export type PinnedStateKind = 'stop' | 'hold' | 'wait' | 'new' | 'sent' | 'quiet' | 'archived';

export interface PinnedState {
  kind: PinnedStateKind;
  /** The state in words, for the row's accessible name. */
  words: string;
  /** Holds N (hold) or the open questions (wait). */
  n: number;
  /** Nothing waits on the person: the row steps back, like a quiet project. */
  calm: boolean;
}

export function pinnedState(row: InboxListRow): PinnedState {
  if (inboxRowArchived(row)) return { kind: 'archived', words: '已归档', n: 0, calm: true };
  switch (row.section) {
    case 'stopped':
      return { kind: 'stop', words: '已停止', n: 0, calm: false };
    case 'holding': {
      const n = row.questions.holds_up.length;
      return { kind: 'hold', words: `阻碍 ${n} 项`, n, calm: false };
    }
    case 'waiting': {
      // The list row's own words for its count ("1 question, 1 action item"), so the two never disagree.
      const n = row.questions.open;
      return { kind: 'wait', words: waitCount(n, row.questions.actions ?? 0), n, calm: false };
    }
    case 'new':
      // Agent news the person has not looked at gets the dot; a row in New only for their own draft does not.
      return row.unseen > 0 ? { kind: 'new', words: '新增', n: 0, calm: false } : { kind: 'quiet', words: '草稿', n: 0, calm: true };
    case 'sent':
      return { kind: 'sent', words: '已发送', n: 0, calm: true };
    default:
      return { kind: 'quiet', words: (row.read_at ?? null) !== null ? '已读' : '安静', n: 0, calm: true };
  }
}

/**
 * What a pinned row calls its thread: the thread's name when it has one (by the
 * list's own rule, `threadChipName`: not when the subject already starts with
 * it), else the subject.
 */
export function pinnedLabel(row: InboxListRow): string {
  const subject = row.subject ?? '(无主题)';
  return (row.thread_name?.trim() ? threadChipName(row.thread_name, subject) : null) ?? subject;
}

/**
 * A pinned row's name: "label, project, state" ("Board names, plannotator, 3 questions"),
 * or "label, subject, project, state" when the label is the thread's name and
 * the subject says something else. `project`: the sidebar's name for it
 * (shortProjectNames); absent, the server's.
 */
export function pinnedRowName(row: InboxListRow, project: string = row.project.name): string {
  const label = pinnedLabel(row);
  const subject = row.subject ?? '(无主题)';
  return `${label}，${label === subject ? '' : `${subject}，`}${project}，${pinnedState(row).words}`;
}

/** The pins' order after moving one up (-1) or down (+1); unchanged at an end or for a thread not pinned. */
export function movePin(order: readonly string[], threadId: string, by: -1 | 1): string[] {
  const next = [...order];
  const at = next.indexOf(threadId);
  const to = at + by;
  if (at < 0 || to < 0 || to >= next.length) return next;
  next[at] = next[to]!;
  next[to] = threadId;
  return next;
}

/**
 * The stars one machine keeps, in its order: those of the machine `row` is on. The merged list carries every linked
 * machine's after this one's (approval "inbox-linked-marks"), and each machine orders and restores only its own.
 */
export function sameMachinePins(pins: readonly InboxListRow[], row: Pick<InboxListRow, 'machine'>): InboxListRow[] {
  return pins.filter((pin) => (pin.machine ?? null) === (row.machine ?? null));
}

/** Whether the star at `index` is first or last of its machine's: a move stops there. */
export function pinEnds(pins: readonly InboxListRow[], index: number): { first: boolean; last: boolean } {
  const machine = pins[index]?.machine ?? null;
  return { first: index === 0 || (pins[index - 1]!.machine ?? null) !== machine, last: index === pins.length - 1 || (pins[index + 1]!.machine ?? null) !== machine };
}

/** Where an unpinned thread still is, for the toast: "Still in Waiting on you", "Still in Archived". */
export function unpinnedWhere(row: InboxListRow | null | undefined): string {
  if (!row) return '仍在收件箱';
  if (inboxRowArchived(row)) return '仍在已归档';
  const label = INBOX_SECTIONS.find((section) => section.id === row.section)?.label;
  return label ? `仍在「${label}」` : '仍在收件箱';
}
