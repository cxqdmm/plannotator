import { useId } from 'react';
import { Icon } from '../icons';
import { SidebarTrigger } from '../shell/sidebar';

/**
 * A `#board` link while the Board is off (approval "inbox-board", 2026-10-26:
 * the Board is something the person turns on). It says so, what turning it on
 * does, and offers the one way: Turn it on (Settings → Capabilities has the
 * same switch, and the page links there). Nothing of the Board shows while it is off; its cards are kept.
 */
export function BoardOff({ onTurnOn, error }: { onTurnOn: () => void; error: string | null }) {
  const titleId = useId();
  return (
    <section className="ib-bpage" aria-labelledby={titleId} data-board-page="" data-board-view="off">
      <div className="ib-bhead">
        <SidebarTrigger />
        <h1 id={titleId} tabIndex={-1}>
          看板
        </h1>
      </div>
      <div className="ib-boff" data-board-off="">
        <span className="ib-boff-icon" aria-hidden="true">
          <Icon name="board" size={22} />
        </span>
        <h2>看板已关闭</h2>
        <p>
          开启后会有一页进行中的工作：每项工作一张卡片，按阶段放在对应的列里，由你的 agent 保持更新。agent 会在下一次会话中开始使用它。再次关闭时，所有卡片都会保留。
        </p>
        <button type="button" className="ib-btn ib-pri" onClick={onTurnOn} data-board-turn-on="">
          开启
        </button>
        <p className="ib-boff-note" data-board-settings-link="">
          同一个开关也位于<a href="#settings/capabilities">设置 → 能力</a>。
        </p>
        {error && (
          <p className="ib-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}
