import type { Dispatch, SetStateAction } from 'react';
import type { InboxAgent, InboxListRow, InboxListSection } from '@plannotator/core/inbox-types';
import type { InboxRowSnooze } from '@plannotator/core/inbox-snooze';
import { inboxApi } from './api';
import { deleteAgentSession, type AgentDeleted } from './agents/agentDelete';
import { markHeldRowArchived } from './held';
import { plural } from './format';
import { errorText, errorToast } from './toastError';
import type { InboxToastModel } from './components/Toast';

export interface AgentDeleteAsk {
  agent: InboxAgent;
  machine: string | null;
  threads: InboxListRow[];
}

interface AgentWritesHost {
  showToast: (toast: Omit<InboxToastModel, 'id'>) => void;
  dismissToast: () => void;
  setShown: Dispatch<SetStateAction<InboxListSection[] | null>>;
  afterWrite: (written?: readonly string[]) => Promise<unknown>;
  restoreSnooze: (threadId: string, snooze: InboxRowSnooze | null | undefined) => Promise<unknown>;
  say: (text: string) => void;
  refreshThread: (threadId: string) => Promise<unknown>;
  openThreadId: () => string | null;
}

export function agentWrites({ showToast, dismissToast, setShown, afterWrite, restoreSnooze, say, refreshThread, openThreadId }: AgentWritesHost) {
  const deleteAgent = async (asked: AgentDeleteAsk | null, archive: boolean) => {
    const launch = asked?.agent.launch;
    if (!asked || !launch) return;
    let done: AgentDeleted;
    try {
      done = await deleteAgentSession(launch.id, asked.machine, asked.threads.map((row) => row.thread_id), archive);
    } catch (cause) {
      showToast(errorToast(cause, '没有成功，请重试。'));
      return;
    }
    const archived = done.archived;
    if (archived.length > 0) {
      const at = new Date().toISOString();
      setShown((current) => (current ? archived.reduce((sections, id) => markHeldRowArchived(sections, id, at), current) : current));
    }
    await afterWrite(archived);
    const kept = done.scratchKept ? '已保留它的临时文件夹' : null;
    const took = archived.length > 0 ? `已归档 ${plural(archived.length, '个会话', '个会话')}` : null;
    const snoozes = asked.threads.filter((row) => archived.includes(row.thread_id)).map((row) => [row.thread_id, row.snoozed] as const);
    const failed = done.archiveError ? errorText(done.archiveError, '没有成功，请重试。') : null;
    showToast({
      icon: failed ? 'warn' : 'check',
      lead: '会话已删除',
      ...(failed ? { detail: failed, wrap: true } : kept || took ? { detail: [kept, took].filter(Boolean).join(' · ') } : {}),
      ...(archived.length > 0
        ? {
            onUndo: () => {
              void (async () => {
                try {
                  for (const id of archived) await inboxApi.resolve(id, false);
                } catch (cause) {
                  showToast(errorToast(cause, '没有成功，请重试。'));
                  return;
                }
                for (const [id, snooze] of snoozes) await restoreSnooze(id, snooze);
                await afterWrite(archived);
                dismissToast();
                say('已移回。');
              })();
            },
          }
        : {}),
    });
  };
  const stopAgent = async (agent: InboxAgent, machine: string | null) => {
    if (!agent.launch) return;
    try {
      await inboxApi.launchStop(agent.launch.id, machine);
    } catch (cause) {
      showToast(errorToast(cause, '没有成功，请重试。'));
      return;
    }
    if (openThreadId() === agent.launch.thread_id) void refreshThread(agent.launch.thread_id);
  };
  return { deleteAgent, stopAgent };
}
