import { HostMark, Icon, PlannotatorMark } from '../../icons';
import { HowWire } from './HowWire';

function Sealed() {
  return (
    <>
      <Icon name="envelope" size={13} />
      <Icon name="lock" size={11} />
    </>
  );
}

export function HowRelay() {
  return (
    <div className="ib-chow-p ib-chow-relay">
      <span className="ib-chow-node">
        <span className="ib-chow-big">
          <Icon name="laptop" />
          <PlannotatorMark className="ib-chow-pmark" />
        </span>
        <span className="ib-chow-cap">你的计算机</span>
      </span>
      <HowWire toward="right" label="主动连接" chip={<Sealed />} />
      <span className="ib-chow-node ib-chow-box">
        <span className="ib-chow-big">
          <Icon name="mailOpen" />
          <span className="ib-chow-seal">
            <Icon name="lock" size={12} />
          </span>
        </span>
        <span className="ib-chow-cap">中继</span>
        <span className="ib-chow-sub">无法读取</span>
      </span>
      <HowWire toward="left" label="主动连接" chip={<Sealed />} />
      <span className="ib-chow-node">
        <span className="ib-chow-big">
          <HostMark host="cloud" />
        </span>
        <span className="ib-chow-cap">云端 agent</span>
      </span>
    </div>
  );
}
