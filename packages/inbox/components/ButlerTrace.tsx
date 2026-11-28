/**
 * 抽屉「行为」——管家自己的账，画成仓库提交图（owner 2026-11-28「像 github 那种
 * commit graph：节点 + 线条，main 在最左，每个需求一条分支」）：
 *
 *  - main 泳道（最左）：管家自身的全局流——唤醒、开口、打断、熔断、无归属事件；
 *  - 需求泳道：每个活跃需求一条，按最近活跃排在 main 右侧，至多三条；
 *  - 已归档泳道（最右，虚线）：其余需求合并一条，不占地方；
 *  - cause 因果 = 跨泳道的弯线（需求泳道的交付事件弯回 main 的管家开口，
 *    正是 git 里 PR 合并的画法）；节点即 trace 条目，点行展开全文与因果。
 *
 * 近单色纪律的例外就在这里：泳道必须有可区分的颜色（git graph 本身如此），
 * 用低饱和同明度的泳道色，节点与线同色；其余（类型胶囊/结果胶囊）维持灰阶。
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { inboxApi, type InboxButlerLedgerRow, type InboxButlerTraceEntry } from '../api';

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

/** 泳道几何：x 中心与整个泳道区宽度（main + 至多三条活跃 + 已归档折叠）。 */
const LANE_GAP = 15;
const RAIL_PAD = 10;
const laneX = (index: number) => RAIL_PAD + index * LANE_GAP;
const railWidth = (lanes: number) => RAIL_PAD + lanes * LANE_GAP + 3;

/** 泳道配色（低饱和同明度，main 用前景色）：与泳道图例、节点、线共用。 */
const LANE_HUES = [250, 150, 85];
function laneColor(index: number, kind: 'main' | 'req' | 'archive'): string {
  if (kind === 'main') return 'color-mix(in oklch, var(--foreground) 72%, transparent)';
  if (kind === 'archive') return 'color-mix(in oklch, var(--muted-foreground) 45%, transparent)';
  return `oklch(0.62 0.09 ${LANE_HUES[index % LANE_HUES.length]})`;
}

interface Lane {
  key: string;
  label: string;
  kind: 'main' | 'req' | 'archive';
}

export function ButlerTrace({ open, rows }: { open: boolean; rows: InboxButlerLedgerRow[] }) {
  const [entries, setEntries] = useState<InboxButlerTraceEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const lineRefs = useRef(new Map<string, HTMLElement>());
  const [geom, setGeom] = useState<{ y: Map<string, number>; height: number } | null>(null);

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

  // 泳道分配：main + 活跃需求（按最近活跃，至多三条）+ 已归档折叠。
  const archivedSet = new Set(rows.filter((row) => row.archived).map((row) => row.req));
  const titleOf = new Map(rows.map((row) => [row.req, row.title]));
  const active: { key: string; at: string }[] = [];
  for (const entry of entries ?? []) {
    const req = entry.refs?.requirement;
    if (!req || archivedSet.has(req) || active.some((lane) => lane.key === req)) continue;
    active.push({ key: req, at: entry.at });
  }
  const lanes: Lane[] = [{ key: '__main', label: '管家', kind: 'main' }];
  for (const lane of active.slice(0, 3)) {
    lanes.push({ key: lane.key, label: titleOf.get(lane.key) ?? '需求', kind: 'req' });
  }
  const hasOverflow = (entries ?? []).some((entry) => {
    const req = entry.refs?.requirement;
    return req && !lanes.some((lane) => lane.key === req);
  });
  if (hasOverflow) lanes.push({ key: '__arch', label: '已归档', kind: 'archive' });
  const laneKeyOf = (entry: InboxButlerTraceEntry): string => {
    const req = entry.refs?.requirement;
    if (!req) return '__main';
    const lane = lanes.find((candidate) => candidate.key === req);
    return lane ? lane.key : '__arch';
  };
  const laneIndexOf = (key: string) => Math.max(0, lanes.findIndex((lane) => lane.key === key));

  // 量几何：每条目节点的 y（行中心）与正文总高——展开/收起都会改行高，跟着重量。
  useLayoutEffect(() => {
    if (!entries) return;
    const body = bodyRef.current;
    if (!body) return;
    const bodyBox = body.getBoundingClientRect();
    const y = new Map<string, number>();
    for (const entry of entries) {
      const el = lineRefs.current.get(entry.id);
      if (!el) continue;
      const box = el.getBoundingClientRect();
      y.set(entry.id, box.top - bodyBox.top + box.height / 2);
    }
    setGeom({ y, height: body.scrollHeight });
  }, [entries, expanded, rows]);

  const rail = railWidth(lanes.length);

  if (!entries) {
    return <div className="ib-butler-trc">{error ? <p className="ib-butler-ap-error" role="alert">{error}</p> : <div className="ib-butler-ap-empty">正在读行为记录…</div>}</div>;
  }

  const groups: { day: string; rows: InboxButlerTraceEntry[] }[] = [];
  for (const entry of entries) {
    const day = dayWord(entry.at);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.rows.push(entry);
    else groups.push({ day, rows: [entry] });
  }

  // 图形：泳道线（泳道最新的节点向上延伸到顶，活着的分支一直开着）+ 节点 + 因果弯线。
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const graph: { lane: Lane; x: number; color: string }[] = lanes.map((lane, index) => ({ lane, x: laneX(index), color: laneColor(index, lane.kind) }));
  const spans = graph.map((g) => {
    const ys = entries.filter((entry) => laneKeyOf(entry) === g.lane.key).map((entry) => geom?.y.get(entry.id)).filter((value): value is number => typeof value === 'number');
    return { ...g, top: ys.length ? Math.max(0, Math.min(...ys) - 6) : null, bottom: ys.length ? Math.max(...ys) + 6 : null };
  });
  const edges: { d: string; child: string }[] = [];
  if (geom) {
    for (const entry of entries) {
      if (!entry.cause || expanded === entry.id) continue;
      const y1 = geom.y.get(entry.id);
      if (y1 === undefined) continue;
      const parent = byId.get(entry.cause);
      if (!parent) continue;
      const y2 = geom.y.get(parent.id);
      if (y2 === undefined || y2 <= y1) continue;
      const x1 = laneX(laneIndexOf(laneKeyOf(entry)));
      const x2 = laneX(laneIndexOf(parent.refs?.requirement ? laneKeyOf(parent) : '__main'));
      const mid = (y1 + y2) / 2;
      edges.push({ child: entry.id, d: `M ${x1} ${y1} C ${x1} ${mid}, ${x2} ${mid}, ${x2} ${y2}` });
    }
  }

  return (
    <div className="ib-butler-trc">
      <div className="ib-butler-trc-count">{entries.length > 0 ? `${entries.length} 条记录 · 最近 14 天` : '还没有记录'}</div>
      {error && <p className="ib-butler-ap-error" role="alert">{error}</p>}
      {entries.length === 0 ? (
        <div className="ib-butler-ap-empty">还没有行为记录——管家收到事件、开口、执行动作时都会记在这里。</div>
      ) : (
        <>
          {/* 泳道图例（与图中线的颜色一一对应）。 */}
          <div className="ib-butler-trc-lanes">
            {graph.map((g) => (
              <span key={g.lane.key} className="ib-butler-trc-lane-key" title={g.lane.label}>
                <i style={{ background: g.color }} aria-hidden="true" />
                {g.lane.label}
              </span>
            ))}
          </div>
          <div className="ib-butler-trc-body" ref={bodyRef} style={{ ['--trc-rail' as never]: `${rail}px` }}>
            {geom && geom.height > 0 && (
              <svg className="ib-butler-trc-svg" width={rail} height={geom.height} aria-hidden="true">
                {spans.map((span) =>
                  span.top === null || span.bottom === null ? null : (
                    <line key={span.lane.key} x1={span.x} y1={span.top} x2={span.x} y2={span.bottom} stroke={span.color} strokeWidth={span.lane.kind === 'main' ? 1.6 : 1.3} strokeDasharray={span.lane.kind === 'archive' ? '3 3' : undefined} opacity={span.lane.kind === 'main' ? 0.9 : 0.65} />
                  ),
                )}
                {geom &&
                  entries.map((entry) => {
                    const y = geom.y.get(entry.id);
                    if (y === undefined) return null;
                    const index = laneIndexOf(laneKeyOf(entry));
                    const mood = outcomeOf(entry)?.mood ?? (entry.type === 'fuse' ? 'warn' : 'mute');
                    const fill = mood === 'warn' ? 'var(--warning, oklch(0.75 0.15 85))' : laneColor(index, lanes[index]?.kind ?? 'main');
                    return <circle key={entry.id} cx={laneX(index)} cy={y} r={mood === 'mute' ? 4 : 4.6} fill={fill} stroke="var(--card)" strokeWidth={1.4} />;
                  })}
                {edges.map((edge) => (
                  <path key={edge.child} d={edge.d} fill="none" stroke="color-mix(in oklch, var(--foreground) 32%, transparent)" strokeWidth={1.1} />
                ))}
              </svg>
            )}
            {groups.map((group) => (
              <div key={group.day} className="ib-butler-trc-day">
                <div className="ib-butler-trc-day-hh">{group.day}</div>
                <div className="ib-butler-trc-list">
                  {group.rows.map((entry) => {
                    const outcome = outcomeOf(entry);
                    const mood = outcome?.mood ?? (entry.type === 'fuse' ? 'warn' : 'mute');
                    const open = expanded === entry.id;
                    const causeEntry = entry.cause ? byId.get(entry.cause) : undefined;
                    return (
                      <div key={entry.id} className="ib-butler-trc-row" data-mood={mood} data-open={open || undefined}>
                        <button
                          type="button"
                          className="ib-butler-trc-line"
                          ref={(el) => {
                            if (el) lineRefs.current.set(entry.id, el);
                            else lineRefs.current.delete(entry.id);
                          }}
                          onClick={() => setExpanded(open ? null : entry.id)}
                          aria-expanded={open}
                        >
                          <span className="ib-butler-trc-type">{TYPE_WORDS[entry.type]}</span>
                          <span className="ib-butler-trc-main">
                            <span className="ib-butler-trc-sum">{entry.summary}</span>
                            {outcome && <span className={`ib-butler-trc-out is-${outcome.mood}`}>{outcome.word}</span>}
                          </span>
                          <span className="ib-butler-trc-when">{timeWord(entry.at)}</span>
                        </button>
                        {open && (
                          <div className="ib-butler-trc-detail">
                            {/* 展开即全文：行内的省略号只是单行索引，展开后一字不裁。 */}
                            <p className="ib-butler-trc-full">{entry.summary}</p>
                            {entry.detail && <p>{entry.detail}</p>}
                            {entry.cause && (
                              <p className="ib-butler-trc-cause">
                                由{causeEntry ? <>「{TYPE_WORDS[causeEntry.type]}：{causeEntry.summary}」引发</> : <>事件 {entry.cause} 引发</>}
                              </p>
                            )}
                            {entry.refs?.requirement && <p className="ib-butler-trc-ref">泳道「{titleOf.get(entry.refs.requirement) ?? entry.refs.requirement}」</p>}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
