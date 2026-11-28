/**
 * 抽屉「台账」（owner 2026-11-27「配置图标右侧加一个台账，点击也是侧边栏查看」）：管家对每个
 * 需求的记录——阶段、谁在等谁、下一步，点开一份看完整台账（服务端渲染的 Markdown：背景、
 * 时间线、待办三栏、下一步）+ 产物区块（owner 2026-11-28「台账加产物模块」：工坊交付物
 * 同源，直达打开）。只读：事实源是收件箱，台账是它的投影。
 *
 * 联动（owner 2026-11-28）：概览行点击直达一份详情（pick 受控）；「在跑」块进来先过滤
 * （focus）；打开详情时回报 onOpenDetail——「新产物」点与台账按钮徽标就地消除。
 */
import { useEffect, useState } from 'react';
import { chatMarkdownHtml } from '@plannotator/ui/components/chat';
import { DELIVERABLE_KIND_LABELS, requirementStageLabel } from '@plannotator/core/requirements-types';
import type { RequirementStage } from '@plannotator/core/requirements-types';
import { inboxApi, type InboxButlerLedgerRow, type InboxDeliverableRef } from '../api';
import { Icon } from '../icons';

function stageWord(stage: string): string {
  try {
    return requirementStageLabel(stage as RequirementStage);
  } catch {
    return stage;
  }
}

/** 交付物的短时间：今天给钟点，往年月日都给。 */
function timeWord(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  const now = new Date();
  const hm = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
  const sameDay = at.toDateString() === now.toDateString();
  if (sameDay) return hm;
  const md = `${at.getMonth() + 1}-${at.getDate()}`;
  return at.getFullYear() === now.getFullYear() ? `${md} ${hm}` : `${at.getFullYear()}-${md} ${hm}`;
}

/** 交付物条目上显示的名字：标题，否则路径末段。 */
function deliverableTitle(entry: InboxDeliverableRef): string {
  if (entry.title && entry.title.trim()) return entry.title.trim();
  const tail = entry.ref.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? entry.ref;
  return tail || entry.ref;
}

function kindIcon(kind: InboxDeliverableRef['kind']) {
  if (kind === 'design-doc') return 'doc';
  if (kind === 'test-report') return 'checkCircle';
  if (kind === 'link') return 'link';
  return 'folderOpen';
}

export function ButlerLedger({
  open,
  pick,
  onPick,
  focus,
  onOpenDetail,
}: {
  open: boolean;
  /** 受控的选中需求（概览行点击直达；null=列表）。 */
  pick: string | null;
  onPick: (req: string | null) => void;
  /** 「在跑」块进来时的初始过滤。 */
  focus: 'running' | null;
  /** 打开一份详情时回报（新产物标记就地消除）。 */
  onOpenDetail: () => void;
}) {
  const [rows, setRows] = useState<InboxButlerLedgerRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ row: InboxButlerLedgerRow; markdown: string; deliverables: InboxDeliverableRef[] } | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [filter, setFilter] = useState<'all' | 'running'>(focus ? 'running' : 'all');

  useEffect(() => {
    // 焦点变了（再点一次「在跑」/点需求行清空）就跟手；平时不搅动主人自己选的过滤。
    setFilter(focus ? 'running' : 'all');
  }, [focus]);

  const load = () => {
    void inboxApi
      .butlerLedger()
      .then((answer) => {
        setRows(answer?.ledgers ?? []);
        setError(null);
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)));
  };

  useEffect(() => {
    if (!open) return;
    load();
    // 台账跟着事件走：开着的时候每 5 秒对一次，主人当场看到进展。
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  }, [open]);

  useEffect(() => {
    if (!pick) {
      setDetail(null);
      return;
    }
    let alive = true;
    setLoadingDetail(true);
    void inboxApi
      .butlerLedgerOf(pick)
      .then((answer) => {
        if (alive && answer) {
          setDetail({ row: answer.ledger, markdown: answer.markdown, deliverables: answer.deliverables ?? [] });
          // 看过即「新」消除（新产物点、台账按钮徽标）。
          onOpenDetail();
        }
      })
      .catch((cause: unknown) => {
        if (alive) setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (alive) setLoadingDetail(false);
      });
    return () => {
      alive = false;
    };
  }, [pick]);

  if (pick) {
    return (
      <div className="ib-butler-led">
        <div className="ib-butler-led-bar">
          <button type="button" className="ib-butler-led-back" onClick={() => onPick(null)}>
            <Icon name="chevL" size={13} /> 全部台账
          </button>
          {detail && <span className="ib-butler-led-stage">{stageWord(detail.row.stage)}</span>}
        </div>
        {error && <p className="ib-butler-ap-error" role="alert">{error}</p>}
        {loadingDetail && !detail ? (
          <div className="ib-butler-ap-empty">正在读台账…</div>
        ) : detail ? (
          <>
            <DeliverablesBlock deliverables={detail.deliverables} />
            <div className="ib-butler-md ib-butler-led-body" dangerouslySetInnerHTML={{ __html: chatMarkdownHtml(detail.markdown) }} />
          </>
        ) : (
          <div className="ib-butler-ap-empty">没读到这份台账。</div>
        )}
      </div>
    );
  }

  const active = (rows ?? []).filter((row) => !row.archived);
  const shown = filter === 'running' ? active.filter((row) => row.running > 0) : active;
  const archived = (rows ?? []).filter((row) => row.archived);
  return (
    <div className="ib-butler-led">
      <div className="ib-butler-ap-bar">
        <span className="ib-butler-ap-count">{rows ? `${active.length} 件在做 · ${archived.length} 件归档` : '正在读台账…'}</span>
        <button type="button" className="ib-butler-ap-refresh" onClick={load} aria-label="刷新台账">
          <Icon name="restart" size={13} /> 刷新
        </button>
      </div>
      <div className="ib-butler-led-filter" role="tablist" aria-label="台账过滤">
        <button type="button" role="tab" aria-selected={filter === 'all'} data-on={filter === 'all'} onClick={() => setFilter('all')}>全部</button>
        <button type="button" role="tab" aria-selected={filter === 'running'} data-on={filter === 'running'} onClick={() => setFilter('running')}>在跑</button>
      </div>
      {error && <p className="ib-butler-ap-error" role="alert">{error}</p>}
      {!rows ? (
        <div className="ib-butler-ap-empty">正在读台账…</div>
      ) : shown.length === 0 ? (
        <div className="ib-butler-ap-empty">{filter === 'running' ? '没有在跑的会话。' : rows.length === 0 ? '还没有台账。工坊里有了需求，管家就会开始记。' : '这一栏没有需求。'}</div>
      ) : (
        <>
          <div className="ib-butler-led-list">
            {shown.map((row) => (
              <LedgerRow key={row.req} row={row} onOpen={() => onPick(row.req)} />
            ))}
          </div>
          {filter === 'all' && archived.length > 0 && (
            <>
              <div className="ib-butler-ap-hh ib-butler-led-hh">已归档</div>
              <div className="ib-butler-led-list">
                {archived.map((row) => (
                  <LedgerRow key={row.req} row={row} onOpen={() => onPick(row.req)} />
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

/** 产物区块（owner 2026-11-28）：工坊交付物同源直达。点条目系统默认程序打开，「显示」回资源管理器定位。 */
function DeliverablesBlock({ deliverables }: { deliverables: InboxDeliverableRef[] }) {
  if (deliverables.length === 0) {
    return (
      <div className="ib-butler-dlv is-empty">还没有产物——执行会话交付后会出现在这里。</div>
    );
  }
  const open = (entry: InboxDeliverableRef, reveal: boolean) => {
    void inboxApi.butlerOpen(entry.ref, reveal).catch(() => {});
  };
  return (
    <div className="ib-butler-dlv">
      <div className="ib-butler-dlv-hh">产物 · {deliverables.length} 件</div>
      <div className="ib-butler-dlv-list">
        {deliverables.map((entry) => (
          <div key={entry.id} className="ib-butler-dlv-row">
            <Icon name={kindIcon(entry.kind)} size={13} />
            <span className="ib-butler-dlv-title" title={`${DELIVERABLE_KIND_LABELS[entry.kind]} · ${entry.ref}`}>
              {deliverableTitle(entry)}
              {entry.verdict === 'approved' && <span className="ib-butler-dlv-verdict ok">已批准</span>}
              {entry.verdict === 'annotated' && <span className="ib-butler-dlv-verdict back">已退回</span>}
            </span>
            <span className="ib-butler-dlv-when">{timeWord(entry.created_at)}</span>
            <span className="ib-butler-dlv-acts">
              {!/^https?:\/\//i.test(entry.ref) && (
                <button type="button" className="ib-butler-dlv-act" title="在文件夹中显示" onClick={() => open(entry, true)}>
                  <Icon name="folder" size={12} />
                </button>
              )}
              <button type="button" className="ib-butler-dlv-act" title="打开" onClick={() => open(entry, false)}>
                <Icon name="external" size={12} />
              </button>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function LedgerRow({ row, onOpen }: { row: InboxButlerLedgerRow; onOpen: () => void }) {
  return (
    <button type="button" className="ib-butler-led-row" onClick={onOpen} data-archived={row.archived}>
      <div className="ib-butler-led-head">
        <span className="ib-butler-led-title">{row.title}</span>
        <span className="ib-butler-stagetext">{stageWord(row.stage)}</span>
      </div>
      <div className="ib-butler-led-meta">
        {row.waiting > 0 && <span className="ib-butler-holdchip">需要你 {row.waiting}</span>}
        {row.running > 0 && <span className="ib-butler-runchip">在跑 {row.running}</span>}
        {row.next_action && row.next_action.text && <span className="ib-butler-led-next">{row.next_action.text}</span>}
      </div>
    </button>
  );
}
