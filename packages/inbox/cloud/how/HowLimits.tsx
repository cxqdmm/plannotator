import { HostMark, Icon, type IconName } from '../../icons';

const SEES: { host: string; why: string }[] = [
  { host: 'cloud-grok', why: '它创建的' },
  { host: 'claude-code', why: '其他 agent 的' },
  { host: 'codex', why: '其他项目' },
];

const CANNOT: { icon: IconName; label: string }[] = [
  { icon: 'questionBubble', label: '回答你的问题' },
  { icon: 'checkCircle', label: '批准任何操作' },
  { icon: 'terminal', label: '在你的计算机上运行任何东西' },
  { icon: 'folder', label: '打开你的文件' },
];

export function HowLimits() {
  return (
    <div className="ib-chow-p ib-chow-limits">
      <div className="ib-chow-col">
        <span className="ib-chow-col-t">它能看到</span>
        <div className="ib-chow-threads">
          {SEES.map((thread) => (
            <span key={thread.why} className="ib-chow-thread">
              <HostMark host={thread.host} />
              <span className="ib-chow-bar" />
              <span className="ib-chow-why">{thread.why}</span>
            </span>
          ))}
        </div>
      </div>
      <div className="ib-chow-col">
        <span className="ib-chow-col-t">它不能</span>
        <div className="ib-chow-cannot">
          {CANNOT.map((item) => (
            <span key={item.icon} className="ib-chow-no">
              <span className="ib-chow-no-i">
                <Icon name={item.icon} size={16} />
              </span>
              <span className="ib-chow-no-t">{item.label}</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
