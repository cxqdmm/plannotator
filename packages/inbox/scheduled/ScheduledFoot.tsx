/**
 * The mark at the right of a routine's Reply row: "Routine · next Mon 9:00 AM · Edit", which opens its
 * editor. A routine is managed on the computer that made it, so on a thread from another linked machine it
 * reads "Routine on <machine>. Manage it there." with no link (no way into a page that has nothing to show).
 */
import type { InboxMessageWire } from '@plannotator/core/inbox-types';
import { writeRoute } from '../app/writeRoute';
import { Icon } from '../icons';
import { useScheduled } from './store';
import { nextWhenWords } from './words';

function LocalFoot({ id }: { id: string }) {
  const { rows } = useScheduled();
  const row = rows?.find((r) => r.id === id);
  // Not in this computer's list (deleted, or the switch is off): nothing to edit, no mark.
  if (!row) return null;
  const next = row.next_run ? nextWhenWords(row.next_run) : null;
  const words = next ? `例行任务 · 下次 ${next}` : '例行任务';
  return (
    <button
      type="button"
      className="st-foot-mark"
      aria-label={`${next ? `例行任务，下次运行 ${next}` : '例行任务'}。编辑例行任务`}
      onClick={() => writeRoute({ page: 'scheduled', project: null, thread: null, scheduled: id })}
      data-scheduled-foot={id}
    >
      <Icon name="scheduled" size={14} />
      <span>{words}</span>
      <span aria-hidden="true">·</span>
      <span className="st-edit">编辑</span>
    </button>
  );
}

export function ScheduledFoot({ messages, machine }: { messages: readonly InboxMessageWire[]; machine: { name: string } | null }) {
  let latest: InboxMessageWire | undefined;
  for (let i = messages.length - 1; i >= 0 && !latest; i--) if (messages[i]!.scheduled_run) latest = messages[i];
  if (!latest) return null;
  if (machine)
    return (
      <span className="st-foot-mark st-far" data-scheduled-foot-far="">
        <Icon name="scheduled" size={14} />
        <span>{machine.name} 上的例行任务。请在那里管理。</span>
      </span>
    );
  return <LocalFoot id={latest.scheduled_run!.scheduled_id} />;
}
