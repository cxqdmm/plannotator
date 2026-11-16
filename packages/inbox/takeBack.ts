import { useState } from 'react';
import type { InboxDraft, InboxMessageWire, InboxReplyDraft } from '@plannotator/core/inbox-types';
import { InboxApiError, inboxApi } from './api';

export const TAKE_BACK_LABEL = '收回';

export interface TakeBackState {
  id: string;
  busy: boolean;
  line: string | null;
  note: string | null;
}

export function takeBackRefusal(error: unknown, name: string): string {
  if (error instanceof InboxApiError && error.code === 'agent_has_it') {
    return error.by === 'handing'
      ? `${name} 正在接收消息，暂时无法收回。请几秒后重试。`
      : `${name} 已经收到这条消息，无法收回。请在下方回复来修改。`;
  }
  if (error instanceof InboxApiError && (error.code === 'cannot_take_back' || error.code === 'taken_back')) return error.message;
  return '未能收回。请重试。';
}

/** A reply that sent answers (to questions or action items) is never taken back: the server refuses it. */
export const carriesAnswers = (message: InboxMessageWire, messages: readonly InboxMessageWire[]): boolean =>
  messages.some((m) => [...(m.questions ?? []), ...(m.actions ?? [])].some((q) => q.sent_reply_id === message.id));

export function takeBackOffered(message: InboxMessageWire, only: boolean, messages: readonly InboxMessageWire[]): boolean {
  if (message.author.kind !== 'person' || message.delivery || message.taken_back_at || message.read_by_agent || message.launch || message.handoff || message.review_verdict) return false;
  if (message.ack_of || message.tidy || (message.set_aside?.length ?? 0) > 0 || (message.reopened?.length ?? 0) > 0 || (message.reask?.length ?? 0) > 0) return false;
  if (message.tags?.some((tag) => tag.delivery || tag.read_at)) return false;
  if ((message.sent_annotations ?? 0) > 0 || carriesAnswers(message, messages)) return false;
  return message.id !== message.thread_id || only;
}

export function useTakeBack(host: {
  settle: () => Promise<boolean>;
  reload: () => Promise<InboxReplyDraft | null | undefined>;
  fill: (draft: InboxReplyDraft) => void;
  compose: (draft: InboxDraft) => void;
  changed: () => Promise<void>;
}) {
  const [state, setState] = useState<TakeBackState | null>(null);
  const take = async (id: string, name: string) => {
    setState({ id, busy: true, line: null, note: null });
    if (!(await host.settle())) {
      setState({ id, busy: false, line: '你的回复仍在保存中。请稍后再试。', note: null });
      return;
    }
    try {
      const answer = await inboxApi.takeBack(id);
      if (answer.compose) {
        setState(null);
        host.compose(answer.compose);
        return;
      }
      const draft = (await host.reload()) ?? answer.draft;
      if (draft) host.fill(draft);
      setState({ id, busy: false, line: null, note: `已收回。${name} 从未收到这条消息，准备好后再发送一次。` });
      await host.changed();
    } catch (error) {
      setState({ id, busy: false, line: takeBackRefusal(error, name), note: null });
    }
  };
  return { state, take, clear: () => setState(null) };
}
