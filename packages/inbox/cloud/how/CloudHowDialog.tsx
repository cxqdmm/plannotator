import { useId, useRef, useState, type ReactNode } from 'react';
import { Icon } from '../../icons';
import { Modal } from '../../components/Updates';
import { HowElsewhere } from './HowElsewhere';
import { HowLimits } from './HowLimits';
import { HowPairing } from './HowPairing';
import { HowRelay } from './HowRelay';
import { HowReplies } from './HowReplies';

type Panel = {
  id: string;
  picture: ReactNode;
  seen: string;
  title: string;
  line: string;
  note?: string;
};

const PANELS: Panel[] = [
  {
    id: 'elsewhere',
    picture: <HowElsewhere />,
    seen: '收件箱会话上方显示 Claude Code、Grok Bot、Muse、Hermes Agent 和 OpenClaw 的标记，该会话中夜间修复机器人发消息、你来回复。',
    title: '运行在别处的 agent',
    line: 'Claude Code 例行任务、Grok Bot、Muse，或 Hermes Agent、OpenClaw 服务器。它会向这个收件箱发消息，并读取你的回复。',
  },
  {
    id: 'pairing',
    picture: <HowPairing />,
    seen: '选择类型和名称，复制 Plannotator 只显示一次的消息，agent 就会连接。',
    title: '用一条消息完成配对',
    line: '选择类型和名称，然后把 Plannotator 显示的消息发给他。它会自行完成设置。Claude Code 例行任务则会获得三段简短的设置内容。',
  },
  {
    id: 'relay',
    picture: <HowRelay />,
    seen: '你的计算机和云端 agent 都主动连接中间的中继。中继中的消息是加密的。',
    title: '消息经过一个加密信箱',
    line: '你的计算机和 agent 都主动连接中继，因此你的计算机无需向互联网开放任何端口。只有双方持有密钥：中继读不到一个字。',
  },
  {
    id: 'limits',
    picture: <HowLimits />,
    seen: 'agent 能看到所有会话：它自己的、其他 agent 的以及其他项目中的。它不能回答你的问题、批准任何操作、在你的计算机上运行任何东西，也不能打开你的文件。',
    title: '它适用于你的整个收件箱',
    line: '任何项目中的任何会话：它都能读取、搜索和发消息，且始终以自己的名义。',
  },
  {
    id: 'replies',
    picture: <HowReplies />,
    seen: '设置唤醒地址后，你的计算机会调用 agent 自己的服务并启动一次运行。未设置时，它会在下次检查时读取你的回复。',
    title: '你一回复它就能收到',
    line: '设置唤醒地址后，你的计算机会在你回复后一分钟内启动它。未设置时，它会在下次检查时读取你的回复。',
    note: '唤醒请求会从你的计算机直接发往 agent 自己的服务（例如 Claude Code 例行任务对应 Anthropic，Grok Bot 对应 xAI），并把你的回复内容带过去。它不经过中继。',
  },
];

export function CloudHowDialog({ onClose }: { onClose: () => void }) {
  const uid = useId();
  const [at, setAt] = useState(0);
  const [dir, setDir] = useState<'next' | 'back'>('next');
  const panel = PANELS[at]!;
  const last = at === PANELS.length - 1;
  const next = useRef<HTMLButtonElement>(null);
  const go = (to: number) => {
    setDir(to > at ? 'next' : 'back');
    setAt(to);
    if (to === 0) requestAnimationFrame(() => next.current?.focus());
  };
  return (
    <Modal labelledBy={`${uid}-t`} testId="cloud-how" onClose={onClose} ownKeys initialFocus=".ib-chow-next" className="ib-chow">
      <div className="ib-chow-head">
        <h2 id={`${uid}-t`}>云端 agent 如何工作</h2>
        <button type="button" className="ib-btn ib-ghost ib-icon ib-chow-x" aria-label="关闭" onClick={onClose}>
          <Icon name="x" />
        </button>
      </div>
      <div className="ib-chow-body">
        <div key={panel.id} className="ib-chow-panel" data-dir={dir} data-cloud-how-panel={panel.id}>
          <div className="ib-chow-stage" role="img" aria-label={panel.seen}>
            {panel.picture}
          </div>
          <div className="ib-chow-words" aria-live="polite">
            <h3 className="ib-chow-t">{panel.title}</h3>
            <p className="ib-chow-l">{panel.line}</p>
            {panel.note && (
              <p className="ib-chow-note" data-cloud-how-note="">
                {panel.note}
              </p>
            )}
            {last && (
              <p className="ib-chow-end" data-cloud-how-end="">
                移除会立即断开。新的配对会让旧的失效。
              </p>
            )}
          </div>
        </div>
      </div>
      <div className="ib-chow-foot">
        <span className="ib-chow-dots">
          {PANELS.map((p, i) => (
            <i key={p.id} data-on={i === at ? '' : undefined} />
          ))}
          <span className="ib-chow-sr" data-cloud-how-step={at + 1}>
            {at + 1} / {PANELS.length}
          </span>
        </span>
        {at > 0 && (
          <button type="button" className="ib-btn ib-ghost ib-chow-back" onClick={() => go(at - 1)} data-cloud-how-back="">
            返回
          </button>
        )}
        <button ref={next} type="button" className="ib-btn ib-pri ib-chow-next" onClick={() => (last ? onClose() : go(at + 1))} data-cloud-how-next="">
          {last ? '完成' : '下一步'}
        </button>
      </div>
    </Modal>
  );
}
