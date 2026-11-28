/**
 * 抽屉「等你的事」（owner 2026-11-28「都不知道什么含义…需要你点开看一份清单」）：
 * 把散在各处、轮到主人的事拢成一页——待批的审批在上（点击切去审批抽屉），每个需求
 * 的「需要你」条目在下（台账 on_person 的原文）。只读清单：点需求名进它的台账详情。
 */
import type { InboxButlerLedgerRow } from '../api';
import { Icon } from '../icons';

export function ButlerWaiting({
  rows,
  approvalsPending,
  onApprovals,
  onOpenReq,
}: {
  rows: InboxButlerLedgerRow[];
  approvalsPending: number;
  onApprovals: () => void;
  onOpenReq: (req: string) => void;
}) {
  const waiting = rows.filter((row) => row.waiting > 0 && (row.waiting_items?.length ?? 0) > 0);
  if (approvalsPending === 0 && waiting.length === 0) {
    return (
      <div className="ib-butler-wait">
        <div className="ib-butler-ap-empty">
          现在没有等您的事。
          <br />
          <span className="ib-butler-wait-sub">有需要您审阅或批准的，管家会先说。</span>
        </div>
      </div>
    );
  }
  return (
    <div className="ib-butler-wait">
      {approvalsPending > 0 && (
        <button type="button" className="ib-butler-wait-approvals" onClick={onApprovals}>
          <Icon name="checkCircle" size={15} />
          <span>
            <b>{approvalsPending}</b> 项待批 —— 管家的动作等您批准
          </span>
          <Icon name="chevR" size={13} />
        </button>
      )}
      {waiting.map((row) => (
        <div key={row.req} className="ib-butler-wait-req">
          <button type="button" className="ib-butler-wait-reqname" onClick={() => onOpenReq(row.req)} title="打开这份需求的台账">
            {row.title}
            <Icon name="chevR" size={12} />
          </button>
          <ul className="ib-butler-wait-items">
            {(row.waiting_items ?? []).map((item, index) => (
              <li key={index}>{item}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
