import { HostMark, Icon } from '../../icons';
import { HowWire } from './HowWire';

export function HowPairing() {
  return (
    <div className="ib-chow-p ib-chow-pair">
      <div className="ib-chow-step">
        <div className="ib-chow-card">
          <span className="ib-chow-tile">
            <HostMark host="cloud-grok" />
            Grok Bot
          </span>
          <span className="ib-chow-field">夜间修复机器人</span>
        </div>
        <span className="ib-chow-cap">类型和名称</span>
      </div>
      <HowWire toward="right" />
      <div className="ib-chow-step">
        <div className="ib-chow-card ib-chow-letter">
          <span className="ib-chow-letter-h">
            <span>仅显示一次</span>
            <span className="ib-chow-copy">
              <Icon name="copy" size={11} /> 复制
            </span>
          </span>
          <span className="ib-chow-letter-b">
            <span className="ib-chow-bar" />
            <span className="ib-chow-bar ib-short" />
            <span className="ib-chow-key">
              <Icon name="lock" size={11} />
              <i />
            </span>
          </span>
        </div>
        <span className="ib-chow-cap">一条消息</span>
      </div>
      <HowWire toward="right" />
      <div className="ib-chow-step">
        <div className="ib-chow-card ib-chow-done">
          <HostMark host="cloud-grok" big />
          <span className="ib-chow-ok">
            <i /> 已连接
          </span>
        </div>
        <span className="ib-chow-cap">它会自行完成设置</span>
      </div>
    </div>
  );
}
