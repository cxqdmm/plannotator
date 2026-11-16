import type { InboxCloudAgentView } from '@plannotator/core/inbox-cloud';
import { relativeWords, useRelativeClock } from '../relativeTime';

export function CloudStatus({ agent }: { agent: InboxCloudAgentView }) {
  const now = useRelativeClock(agent.link.state === 'connected');
  const { state, last_seen_at } = agent.link;
  const text =
    state === 'connected'
      ? `已连接 · 最近一次活动：${last_seen_at ? relativeWords(last_seen_at, now) : '刚刚'}`
      : state === 'waiting'
        ? `正在等待 ${agent.name} 连接…`
        : state === 'relay_down'
          ? `这台计算机无法连接中继，因此 ${agent.name} 也无法连接。请确认这台计算机已联网。`
          : '未连接：这台计算机无法连接中继。等它恢复联网后，请重新配对。';
  return (
    <span className={`ib-cl-link-line ib-cl-${state}`} role="status" data-cloud-status={state}>
      <span className="ib-cl-dot" aria-hidden="true" />
      {text}
    </span>
  );
}
