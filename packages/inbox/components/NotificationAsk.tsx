import type { ReactNode } from 'react';
import type { AskKind, TabSlept } from '../notify';
import { addressOf, browserName } from '../notifyStatus';
import { Icon } from '../icons';

/**
 * One line above the list: the icon, the words, the actions. The line is a
 * size container (inbox.css): beside an open thread the list is a 380 px
 * column, so the actions go on their own row under the words, lined up with
 * them, instead of squeezing the words into a narrow column between the icon
 * and the buttons. Only a wide line puts them side by side.
 */
function AskShell({
  className,
  icon,
  label,
  data,
  children,
  actions,
}: {
  className: string;
  icon: 'bell' | 'warn' | 'info';
  label: string;
  data: Record<string, string>;
  children: ReactNode;
  actions: ReactNode;
}) {
  return (
    <div className={className} role="region" aria-label={label} {...data}>
      <div className="ib-ask-in">
        <Icon name={icon} />
        <p className="ib-ask-text">{children}</p>
        <div className="ib-ask-acts">{actions}</div>
      </div>
    </div>
  );
}

/**
 * The line at the top of the list (record 6.1), in words that say why. It
 * stays on every load until it is resolved (askKind in notify.ts):
 * - `ask`: Turn on raises the browser's own prompt.
 * - `moved`: notifications were allowed at another address of this computer
 *   (the Inbox changed port, or was opened at 127.0.0.1), and this address has
 *   none. Drawn prominently: notifications are silently off until Allow.
 * - `blocked`: the browser blocked this address; a quiet line pointing at
 *   Settings, where the steps are.
 */
export function NotificationAsk({
  kind,
  onTurnOn,
  onNotNow,
  onSettings,
  movedFrom = null,
  soundOn = false,
  firstRun = false,
}: {
  kind: AskKind;
  onTurnOn: () => void;
  onNotNow: () => void;
  /** Settings → General, where the blocked steps are. */
  onSettings?: () => void;
  /** The address notifications were allowed at (`moved`). */
  movedFrom?: string | null;
  /** The question sound is on (sound.ts): a fresh install learns it here, not from a dialog. */
  soundOn?: boolean;
  /** Drawn on the first-run screen, before any agent wrote: the words speak of the first question. */
  firstRun?: boolean;
}) {
  const browser = browserName();
  if (kind === 'blocked') {
    return (
      <AskShell
        className="ib-askline ib-askquiet"
        icon="bell"
        label="桌面通知"
        data={{ 'data-notification-ask': kind }}
        actions={
          <>
            {onSettings && (
              <button type="button" className="ib-btn ib-ghost ib-sm" onClick={onSettings}>
                如何允许
              </button>
            )}
            <button type="button" className="ib-btn ib-ghost ib-sm" onClick={onNotNow}>
              隐藏
            </button>
          </>
        }
      >
        <span className="ib-mut">
          {browser === 'this browser' ? '此浏览器' : browser} 拦截了 {window.location.host} 的通知，因此 agent {firstRun ? '问你第一个问题时' : '停下来等你时'}，你不会收到提醒。
        </span>
      </AskShell>
    );
  }
  return (
    <AskShell
      className={kind === 'moved' ? 'ib-askline ib-askmoved' : 'ib-askline'}
      icon={kind === 'moved' ? 'warn' : 'bell'}
      label="桌面通知"
      data={{ 'data-notification-ask': kind }}
      actions={
        <>
          <button type="button" className="ib-btn ib-pri ib-sm" onClick={onTurnOn}>
            {kind === 'moved' ? '允许' : '开启'}
          </button>
          <button type="button" className="ib-btn ib-ghost ib-sm" onClick={onNotNow}>
            暂时不要
          </button>
        </>
      }
    >
      {kind === 'ask' && firstRun ? (
        <>
          <b>收到第一个问题时获得桌面通知。</b>{' '}
          <span className="ib-mut">
            先开启再试，这样此标签页在后台时也能收到 agent 的消息。浏览器只会询问一次。{soundOn && ' 声音已开启。'}
          </span>
        </>
      ) : kind === 'ask' ? (
        <>
          <b>agent 需要你时获得桌面通知。</b>{' '}
          <span className="ib-mut">
            当 agent 发起会话或向你提问时。浏览器只会询问一次。{soundOn && ' 声音已开启。'}
          </span>
        </>
      ) : (
        <>
          <b>此地址的通知已关闭。</b>{' '}
          <span className="ib-mut">
            你曾在 {movedFrom ? addressOf(movedFrom) : '另一个地址'} 允许通知；收件箱现在位于 {window.location.host}。请重新允许。请重新加载或关闭仍在旧地址打开的标签页，以免通知重复到达。
          </span>
        </>
      )}
    </AskShell>
  );
}

/**
 * The browser put this tab to sleep in the background, so it could not
 * notify (notify.ts `TabSlept`). Said once, with how to keep it awake.
 */
export function TabSleptLine({ slept, onDismiss }: { slept: Exclude<TabSlept, null>; onDismiss: () => void }) {
  const chrome = browserName() === 'Chrome' || browserName() === 'Edge';
  return (
    <AskShell
      className="ib-askline ib-askquiet"
      icon="info"
      label="通知已暂停"
      data={{ 'data-tab-slept': slept }}
      actions={
        <button type="button" className="ib-btn ib-ghost ib-sm" onClick={onDismiss}>
          知道了
        </button>
      }
    >
      <span className="ib-mut">
        {slept === 'discarded'
          ? '浏览器为节省内存关闭了后台的这个标签页，因此期间无法通知你。'
          : '浏览器在后台暂停了这个标签页，因此通知来晚了或没有送达。'}
        {chrome && ` 要保持它运行：设置 → 性能 → “始终保持这些网站处于活动状态” → 添加 ${window.location.hostname}。`}
      </span>
    </AskShell>
  );
}
