import { HostMark, Icon } from '../../icons';
import { HowWire } from './HowWire';

function Lane({ wakes }: { wakes: boolean }) {
  return (
    <div className="ib-chow-lane" data-wakes={wakes ? '' : undefined}>
      <span className="ib-chow-lane-t">{wakes ? '设置唤醒地址时' : '未设置时'}</span>
      <span className="ib-chow-lane-r">
        <span className="ib-chow-you">发布吧。</span>
        <HowWire toward="right" tone={wakes ? 'ok' : 'quiet'} chip={<Icon name={wakes ? 'play' : 'clock'} size={12} />} />
        <span className="ib-chow-agent">
          <HostMark host="cloud-grok" big />
          <span className="ib-chow-cap">{wakes ? '它的服务启动一次运行' : '在下次检查时读取'}</span>
        </span>
      </span>
    </div>
  );
}

export function HowReplies() {
  return (
    <div className="ib-chow-p ib-chow-replies">
      <Lane wakes />
      <Lane wakes={false} />
    </div>
  );
}
