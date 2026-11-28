/**
 * 抽屉「行为」（owner 2026-11-28「管家接收到哪些事件、做了什么，要有关联的记录」）：
 * 管家自己的账——事件入账、唤醒的处置（开口/延迟/静默·为什么）、开口摘要、动作与结果
 * （参数/错误码）、熔断与自愈。平铺时间线 + 因果引用：点开一条看它的 detail 与
 * 「由哪笔事件引发」。工坊历史时间线同款 DNA：近单色，只有失败/熔断行有颜色。
 */
import { useEffect, useState } from 'react';
import { inboxApi, type InboxButlerTraceEntry } from '../api';
import { Icon } from '../icons';

const TYPE_WORDS: Record<InboxButlerTraceEntry['type'], string> = {
  event: '事件',
  wake: '唤醒',
  turn: '开口',
  action: '动作',
  fuse: '熔断',
};

const OUTCOME_WORDS: Record<string, { word: string; mood: 'ok' | 'warn' | 'mute' }> = {
  spoken: { word: '已开口', mood: 'ok' },
  deferred: { word: '已延迟', mood: 'mute' },
  suppressed: { word: '已静默', mood: 'warn' },
  ok: { word: '成功', mood: 'ok' },
  'no-op': { word: '无事发生', mood: 'mute' },
};

function outcomeOf(entry: InboxButlerTraceEntry): { word: string; mood: 'ok' | 'warn' | 'mute' } | null {
  if (!entry.outcome) return null;
  if (entry.outcome.startsWith('error')) {
    return { word: `失败 · ${entry.outcome.slice(6) || '出错'}`, mood: 'warn' };
  }
  return OUTCOME_WORDS[entry.outcome] ?? { word: entry.outcome, mood: 'mute' };
}

function dayWord(at: string): string {
  const day = new Date(at);
  const now = new Date();
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diff = (startOf(now) - startOf(day)) / 86_400_000;
  if (diff < 1) return '今天';
  if (diff < 2) return '昨天';
  return `${day.getMonth() + 1}月${day.getDate()}日`;
}

function timeWord(at: string): string {
  const day = new Date(at);
  if (Number.isNaN(day.getTime())) return '';
  return `${String(day.getHours()).padStart(2, '0')}:${String(day.getMinutes()).padStart(2, '0')}`;
}

export function ButlerTrace({ open }: { open: boolean }) {
  const [entries, setEntries] = useState<InboxButlerTraceEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const load = () => {
      void inboxApi
        .butlerTrace()
        .then((answer) => {
          setEntries((answer?.entries ?? []).slice().reverse());
          setError(null);
        })
        .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)));
    };
    load();
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  }, [open]);

  if (!entries) {
    return <div className="ib-butler-trc">{error ? <p className="ib-butler-ap-error" role="alert">{error}</p> : <div className="ib-butler-ap-empty">正在读行为记录…</div>}</div>;
  }

  // 按天分组（最新在上）；cause 能在本页找到时，展开显示「由哪笔事件引发」。
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const groups: { day: string; rows: InboxButlerTraceEntry[] }[] = [];
  for (const entry of entries) {
    const day = dayWord(entry.at);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.rows.push(entry);
    else groups.push({ day, rows: [entry] });
  }

  return (
    <div className="ib-butler-trc">
      <div className="ib-butler-ap-bar">
        <span className="ib-butler-ap-count">{entries.length > 0 ? `${entries.length} 条记录 · 最近 14 天` : '还没有记录'}</span>
      </div>
      {error && <p className="ib-butler-ap-error" role="alert">{error}</p>}
      {entries.length === 0 ? (
        <div className="ib-butler-ap-empty">还没有行为记录——管家收到事件、开口、执行动作时都会记在这里。</div>
      ) : (
        groups.map((group) => (
          <div key={group.day} className="ib-butler-trc-day">
            <div className="ib-butler-trc-day-hh">{group.day}</div>
            <div className="ib-butler-trc-list">
              {group.rows.map((entry) => {
                const outcome = outcomeOf(entry);
                const mood = outcome?.mood ?? (entry.type === 'fuse' ? 'warn' : 'mute');
                const expandable = Boolean(entry.detail || entry.cause);
                const open = expanded === entry.id;
                const causeEntry = entry.cause ? byId.get(entry.cause) : undefined;
                return (
                  <div key={entry.id} className="ib-butler-trc-row" data-mood={mood} data-open={open || undefined}>
                    <button
                      type="button"
                      className="ib-butler-trc-line"
                      onClick={() => expandable && setExpanded(open ? null : entry.id)}
                      aria-expanded={expandable ? open : undefined}
                    >
                      <span className="ib-butler-trc-rail" aria-hidden="true"><i /></span>
                      <span className="ib-butler-trc-type">{TYPE_WORDS[entry.type]}</span>
                      <span className="ib-butler-trc-main">
                        <span className="ib-butler-trc-sum">{entry.summary}</span>
                        {outcome && <span className={`ib-butler-trc-out is-${outcome.mood}`}>{outcome.word}</span>}
                      </span>
                      <span className="ib-butler-trc-when">{timeWord(entry.at)}</span>
                    </button>
                    {open && (
                      <div className="ib-butler-trc-detail">
                        {entry.detail && <p>{entry.detail}</p>}
                        {entry.cause && (
                          <p className="ib-butler-trc-cause">
                            由{causeEntry ? <>「{TYPE_WORDS[causeEntry.type]}：{causeEntry.summary}」引发</> : <>事件 {entry.cause} 引发</>}
                          </p>
                        )}
                        {entry.refs?.requirement && <p className="ib-butler-trc-ref">需求 {entry.refs.requirement}</p>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))
      )}
      {entries.length > 0 && (
        <p className="ib-butler-trc-foot">
          <Icon name="info" size={12} /> 开口的正文在对话里；动作的审计短句在对应需求的台账时间线里。
        </p>
      )}
    </div>
  );
}
