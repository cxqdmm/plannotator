/**
 * 抽屉「台账」（owner 2026-11-27「配置图标右侧加一个台账，点击也是侧边栏查看」）：管家对每个
 * 需求的记录——阶段、谁在等谁、下一步，点开一份看完整台账 + 交付物区块（owner 2026-11-28
 * 「台账加交付物模块」：工坊交付物同源，直达打开）。只读：事实源是收件箱，台账是它的投影。
 *
 * 联动（owner 2026-11-28）：概览行点击直达一份详情（pick 受控）；打开详情时回报
 * onOpenDetail——「新交付物」点与台账按钮徽标就地消除。在跑/等你状态直接展示在
 * 需求卡片上（owner 2026-11-28「在跑和全部的意义都不大」：过滤条取消）。
 *
 * 详情交互定案（原型 ?ledger-proto=c「分节详情」，owner 2026-11-28「我还是喜欢 C」）：
 * markdown 按 ## 拆成节页签（全部/进展/等你/…），交付物常驻顶部；每节不再是一坨裸
 * markdown——进展节渲染成工坊历史时间线（轨道点 + 右对齐时间），列表节是干净的条目，
 * 文字节是段落；标题 chrome（需求名/阶段/更新时间）由头部承担，markdown 里的 H1 与
 * 引用行剥掉不重说。
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

/** 台账 markdown → 节列表：剥掉 H1 与引用行（标题/阶段/更新时间由详情头部承担，不重说）。 */
function splitSections(markdown: string): { title: string; body: string }[] {
  const prepared = markdown
    .split('\n')
    .filter((line) => !line.startsWith('# ') && !line.startsWith('> '))
    .join('\n');
  return prepared
    .split(/^## /m)
    .map((part) => part.replace(/^\n+|\n+$/g, ''))
    .filter((part) => part.trim())
    .map((part) => {
      const newlineAt = part.indexOf('\n');
      if (newlineAt < 0) return { title: part.trim(), body: '' };
      return { title: part.slice(0, newlineAt).trim(), body: part.slice(newlineAt + 1) };
    });
}

/** 一节内容的行模型：进展/各清单是条目行（`- ` 开头），其余是文字行。 */
interface LedgerLine {
  kind: 'item' | 'prose';
  text: string;
}

function sectionLines(body: string): LedgerLine[] {
  return body
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => (line.startsWith('- ') ? { kind: 'item', text: line.slice(2) } : { kind: 'prose', text: line }));
}

/** 进展条目 `ISO时间　摘要` → 时间与正文分离（表格符是 renderLedger 的连接约定）。 */
function timelineSplit(text: string): { at: string; text: string } {
  const sep = text.indexOf('　');
  if (sep < 0) return { at: '', text };
  return { at: timeWord(text.slice(0, sep)), text: text.slice(sep + 1) };
}

/** 一节的排版（owner 2026-11-28「详情太丑」）：进展=轨道时间线；清单=干净条目；文字=段落。 */
function SectionView({ title, body }: { title: string; body: string }) {
  const lines = sectionLines(body);
  if (lines.length === 0) return null;
  if (title === '进展') {
    return (
      <div className="ib-butler-led-sec">
        <div className="ib-butler-led-sec-list is-timeline">
          {lines.map((line, index) => {
            const { at, text } = timelineSplit(line.text);
            return (
              <div key={index} className="ib-butler-led-tl">
                <span className="ib-butler-led-tl-dot" aria-hidden="true" />
                {at && <span className="ib-butler-led-tl-at">{at}</span>}
                <span className="ib-butler-led-tl-text">{text}</span>
              </div>
            );
          })}
        </div>
      </div>
    );
  }
  if (lines.every((line) => line.kind === 'item')) {
    return (
      <div className="ib-butler-led-sec">
        <ul className="ib-butler-led-items">
          {lines.map((line, index) => (
            <li key={index} dangerouslySetInnerHTML={{ __html: chatMarkdownHtml(line.text) }} />
          ))}
        </ul>
      </div>
    );
  }
  return (
    <div className="ib-butler-led-sec">
      {lines.map((line, index) => {
        const isNote = line.text.startsWith('（');
        return (
          <p
            key={index}
            className={isNote ? 'ib-butler-led-note' : undefined}
            dangerouslySetInnerHTML={{ __html: chatMarkdownHtml(line.text) }}
          />
        );
      })}
    </div>
  );
}

export function ButlerLedger({
  open,
  pick,
  onPick,
  reload,
  onOpenDetail,
}: {
  open: boolean;
  /** 受控的选中需求（概览行点击直达；null=列表）。 */
  pick: string | null;
  onPick: (req: string | null) => void;
  /** header 刷新（owner 2026-11-28）：计数变化即重读。 */
  reload?: number;
  /** 打开一份详情时回报（新交付物标记就地消除）。 */
  onOpenDetail: () => void;
}) {
  const [rows, setRows] = useState<InboxButlerLedgerRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ row: InboxButlerLedgerRow; markdown: string; deliverables: InboxDeliverableRef[] } | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [tab, setTab] = useState<string>('__all');

  useEffect(() => {
    // header 上的刷新：计数一变就重读（open 才读，与轮询同一入口）。
    if (open && reload) load();
  }, [reload, open]);

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
          // 看过即「新」消除（新交付物点、台账按钮徽标）。
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

  useEffect(() => {
    // 换一份详情回到「全部」；同一份里主人自己选的节不搅动。
    setTab('__all');
  }, [pick]);

  if (pick) {
    const sections = detail ? splitSections(detail.markdown) : [];
    const updated = detail?.row ? (detail.row as InboxButlerLedgerRow & { updated_at?: string }).updated_at : undefined;
    return (
      <div className="ib-butler-led">
        {/* 返回箭头与需求标题在抽屉 header 的大标题上（owner 2026-11-28）；这里只放阶段与更新时间。 */}
        {detail && (
          <div className="ib-butler-led-headfull">
            <span className="ib-butler-stagetext">{stageWord(detail.row.stage)}</span>
            <span className="ib-butler-led-spacer" />
            {updated && <span className="ib-butler-led-updated">更新 {timeWord(updated)}</span>}
          </div>
        )}
        {error && <p className="ib-butler-ap-error" role="alert">{error}</p>}
        {loadingDetail && !detail ? (
          <div className="ib-butler-ap-empty">正在读台账…</div>
        ) : detail ? (
          <>
            <DeliverablesBlock deliverables={detail.deliverables} />
            <div className="ib-butler-led-tabs" role="tablist" aria-label="台账分节">
              <button type="button" role="tab" aria-selected={tab === '__all'} data-on={tab === '__all'} onClick={() => setTab('__all')}>全部</button>
              {sections.map((section) => (
                <button key={section.title} type="button" role="tab" aria-selected={tab === section.title} data-on={tab === section.title} onClick={() => setTab(section.title)}>
                  {section.title}
                </button>
              ))}
            </div>
            <div className="ib-butler-led-sections">
              {sections
                .filter((section) => tab === '__all' || tab === section.title)
                .map((section) => (
                  <div key={section.title} className="ib-butler-led-secwrap">
                    {tab === '__all' && <div className="ib-butler-dlv-hh">{section.title}</div>}
                    <SectionView title={section.title} body={section.body} />
                  </div>
                ))}
              {sections.length === 0 && <div className="ib-butler-ap-empty">这份台账还没有内容。</div>}
            </div>
          </>
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
      {error && <p className="ib-butler-ap-error" role="alert">{error}</p>}
      {!rows ? (
        <div className="ib-butler-ap-empty">正在读台账…</div>
      ) : active.length === 0 ? (
        <div className="ib-butler-ap-empty">{rows.length === 0 ? '还没有台账。工坊里有了需求，管家就会开始记。' : '没有活跃的需求。'}</div>
      ) : (
        <>
          <div className="ib-butler-led-list">
            {active.map((row) => (
              <LedgerRow key={row.req} row={row} onOpen={() => onPick(row.req)} />
            ))}
          </div>
          {archived.length > 0 && (
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

/** 交付物区块（owner 2026-11-28）：工坊交付物同源直达。点条目系统默认程序打开，「显示」回资源管理器定位。 */
function DeliverablesBlock({ deliverables }: { deliverables: InboxDeliverableRef[] }) {
  if (deliverables.length === 0) {
    return (
      <div className="ib-butler-dlv is-empty">还没有交付物——执行会话交付后会出现在这里。</div>
    );
  }
  const open = (entry: InboxDeliverableRef, reveal: boolean) => {
    void inboxApi.butlerOpen(entry.ref, reveal).catch(() => {});
  };
  return (
    <div className="ib-butler-dlv">
      <div className="ib-butler-dlv-hh">交付物 · {deliverables.length} 件</div>
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
