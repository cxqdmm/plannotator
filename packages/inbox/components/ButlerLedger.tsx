/**
 * 抽屉「台账」（owner 2026-11-27「配置图标右侧加一个台账，点击也是侧边栏查看」）：管家对每个
 * 需求的记录——阶段、谁在等谁、下一步，点开一份看完整台账（服务端渲染的 Markdown：背景、
 * 时间线、待办三栏、下一步）。只读：事实源是收件箱，台账是它的投影。
 */
import { useEffect, useState } from 'react';
import { chatMarkdownHtml } from '@plannotator/ui/components/chat';
import { requirementStageLabel } from '@plannotator/core/requirements-types';
import type { RequirementStage } from '@plannotator/core/requirements-types';
import { inboxApi, type InboxButlerLedgerRow } from '../api';
import { Icon } from '../icons';

function stageWord(stage: string): string {
  try {
    return requirementStageLabel(stage as RequirementStage);
  } catch {
    return stage;
  }
}

export function ButlerLedger({ open }: { open: boolean }) {
  const [rows, setRows] = useState<InboxButlerLedgerRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ row: InboxButlerLedgerRow; markdown: string } | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

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
    if (!picked) {
      setDetail(null);
      return;
    }
    let alive = true;
    setLoadingDetail(true);
    void inboxApi
      .butlerLedgerOf(picked)
      .then((answer) => {
        if (alive && answer) setDetail({ row: answer.ledger, markdown: answer.markdown });
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
  }, [picked]);

  if (picked) {
    return (
      <div className="ib-butler-led">
        <div className="ib-butler-led-bar">
          <button type="button" className="ib-butler-led-back" onClick={() => setPicked(null)}>
            <Icon name="chevL" size={13} /> 全部台账
          </button>
          {detail && <span className="ib-butler-led-stage">{stageWord(detail.row.stage)}</span>}
        </div>
        {error && <p className="ib-butler-ap-error" role="alert">{error}</p>}
        {loadingDetail && !detail ? (
          <div className="ib-butler-ap-empty">正在读台账…</div>
        ) : detail ? (
          <div className="ib-butler-md ib-butler-led-body" dangerouslySetInnerHTML={{ __html: chatMarkdownHtml(detail.markdown) }} />
        ) : (
          <div className="ib-butler-ap-empty">没读到这份台账。</div>
        )}
      </div>
    );
  }

  const active = (rows ?? []).filter((row) => !row.archived);
  const archived = (rows ?? []).filter((row) => row.archived);
  return (
    <div className="ib-butler-led">
      <div className="ib-butler-ap-bar">
        <span className="ib-butler-ap-count">{rows ? `${active.length} 件在做 · ${archived.length} 件归档` : '正在读台账…'}</span>
        <button type="button" className="ib-butler-ap-refresh" onClick={load} aria-label="刷新台账">
          <Icon name="restart" size={13} /> 刷新
        </button>
      </div>
      {error && <p className="ib-butler-ap-error" role="alert">{error}</p>}
      {!rows ? (
        <div className="ib-butler-ap-empty">正在读台账…</div>
      ) : rows.length === 0 ? (
        <div className="ib-butler-ap-empty">还没有台账。工坊里有了需求，管家就会开始记。</div>
      ) : (
        <>
          <div className="ib-butler-led-list">
            {active.map((row) => (
              <LedgerRow key={row.req} row={row} onOpen={() => setPicked(row.req)} />
            ))}
          </div>
          {archived.length > 0 && (
            <>
              <div className="ib-butler-ap-hh ib-butler-led-hh">已归档</div>
              <div className="ib-butler-led-list">
                {archived.map((row) => (
                  <LedgerRow key={row.req} row={row} onOpen={() => setPicked(row.req)} />
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

function LedgerRow({ row, onOpen }: { row: InboxButlerLedgerRow; onOpen: () => void }) {
  return (
    <button type="button" className="ib-butler-led-row" onClick={onOpen} data-archived={row.archived}>
      <div className="ib-butler-led-head">
        <span className="ib-butler-led-title">{row.title}</span>
        <span className="ib-butler-led-stage">{stageWord(row.stage)}</span>
      </div>
      <div className="ib-butler-led-meta">
        {row.waiting > 0 && <span className="ib-butler-led-chip is-waiting">等你 {row.waiting}</span>}
        {row.running > 0 && <span className="ib-butler-led-chip is-running">在跑 {row.running}</span>}
        {row.next_action && row.next_action.text && <span className="ib-butler-led-next">{row.next_action.text}</span>}
      </div>
    </button>
  );
}
