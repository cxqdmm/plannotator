import { useState } from 'react';
import type { InboxRun } from '@plannotator/core/inbox-types';
import { INBOX_TURN_FAILED_WORDS } from '@plannotator/core/inbox-run-line';
import { copyTextToClipboard } from '@plannotator/ui/utils/clipboard';
import { InboxApiError, inboxApi } from '../api';
import { whenTime } from '../format';
import { Icon } from '../icons';
import { hostLabel } from '../compose/model';
import { Tip } from './Tip';
import { useMinuteClock } from './Undelivered';

/** "4 min" since `since`; nothing under a minute (never "1 min" a few seconds in). */
function minutesSince(since: string | null, now: number): string | null {
  if (!since) return null;
  const min = Math.floor((now - Date.parse(since)) / 60_000);
  return min >= 1 ? `${min} 分钟` : null;
}

/** `claude attach 4f1c9a2e` on screen; the command copied also changes into the folder first. */
const shownCommand = (command: string) => command.replace(/^cd .*? && /, '');

const STOP_TIP = '停止该会话。它已在后台启动的命令会继续运行。';


/**
 * A launched thread's run line (UX screens 05, 06, 08, 09, 11, 12, 14, 15): one
 * quiet line under the latest message, in place of the delivery line, saying
 * what the agent the person started is doing. It goes away while the agent
 * rests (`run` null: the thread draws nothing). Stop is a text button; the
 * bordered buttons are where something is blocked on the person: Open in
 * Terminal (a session waiting on Terminal, one that can't start; it is on no
 * menu, so it shows only then), and for an untrusted folder the owner's Trust
 * folder, which also works on a phone. No keyboard shortcuts.
 */
/**
 * `canOpen`: this window can open Terminal on this launch (the thread's rule: on the Inbox's computer, with
 * a session or a folder to trust). `canReaddress`: the waiting message can go to another session (Send to
 * another session is shown under the line).
 */
/**
 * `machine`: another machine's thread (remote launch): Stop, Try again and Trust folder go to that machine;
 * `machineName` names it in a clone's words ("Mac mini isn't signed in to github.com"). `onChangeUrl`: a clone no repo
 * answered (E5) offers Change the URL, which reopens New message with the URL in the filter.
 *
 * Clone from a git URL (approval "launch-create-clone", E1-E11): "Cloning acme/billing-api · Claude Code starts next"
 * with Cancel, git's percent and a thin bar after a few seconds; a failed clone says why (sign-in, no such repo,
 * network) and keeps the message, with Try again (and Copy clone command, or Change the URL); a cancelled one says
 * nothing was kept; a repo that brings hooks, MCP servers or settings waits for Trust and start.
 */
export function RunLine({
  run,
  canOpen,
  canReaddress = false,
  machine = null,
  machineName = null,
  onChanged,
  onChangeUrl,
}: {
  run: InboxRun;
  canOpen: boolean;
  canReaddress?: boolean;
  machine?: string | null;
  machineName?: string | null;
  onChanged: () => void;
  onChangeUrl?: (url: string) => void;
}) {
  const [busy, setBusy] = useState<null | 'stop' | 'open' | 'retry' | 'trust'>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [cloneCopied, setCloneCopied] = useState(false);
  const [whatsIn, setWhatsIn] = useState(false);
  const clone = run.clone ?? null;
  // The machine in a clone's words: its name, else this computer (a sentence's first word takes a capital).
  const where = machineName ?? '这台电脑';
  const Where = machineName ?? '这台电脑';
  const ticking = run.state === 'working' || run.state === 'waiting_answer' || run.state === 'waiting_terminal';
  const now = useMinuteClock(ticking);
  const name = hostLabel(run.agent);
  const minutes = ticking ? minutesSince(run.since, now) : null;

  const act = async (what: 'stop' | 'open' | 'retry' | 'trust') => {
    setBusy(what);
    setError(null);
    try {
      if (what === 'stop') await inboxApi.launchStop(run.launch_id, machine);
      else if (what === 'retry') await inboxApi.launchRetry(run.launch_id, machine);
      else if (what === 'trust') await inboxApi.launchTrust(run.launch_id, run.trust?.warning ?? null, machine);
      else await inboxApi.launchOpen(run.launch_id);
      onChanged();
    } catch (cause) {
      setError(cause instanceof InboxApiError ? cause.message : what === 'open' ? 'Terminal 没有打开；请改为复制命令。' : '没有成功；请重试。');
      // The folder changed since this line was read: draw the new warning for the next click.
      if (cause instanceof InboxApiError && cause.code === 'trust_warning_changed') onChanged();
    } finally {
      setBusy(null);
    }
  };
  /** E4: the clone as one command, to run by hand on that machine (git's own sign-in prompts work there). */
  const copyClone = async () => {
    if (!clone) return;
    const ok = await copyTextToClipboard(cloneCommand(clone));
    setCloneCopied(ok);
    if (ok) setTimeout(() => setCloneCopied(false), 1500);
    else setError('无法复制；请选中命令后手动复制。');
  };
  const copy = async () => {
    if (!run.attach_command) return;
    const ok = await copyTextToClipboard(run.attach_command);
    setCopied(ok);
    if (ok) setTimeout(() => setCopied(false), 1500);
    else setError('无法复制；请选中命令后手动复制。');
  };

  const stop = (
    <Tip content={STOP_TIP}>
      <button type="button" className="ib-run-btn" disabled={busy !== null} onClick={() => void act('stop')} data-run-stop="">
        停止
      </button>
    </Tip>
  );
  const openTerminal = (
    <button type="button" className="ib-btn ib-sm" disabled={busy !== null} onClick={() => void act('open')} data-run-open="">
      <Icon name="terminal" size={14} />
      在 Terminal 中打开
    </button>
  );
  const attach = run.attach_command && (
    <span className="ib-run-cmd" data-run-attach="">
      <code>{shownCommand(run.attach_command)}</code>
      <button type="button" className="ib-run-btn" onClick={() => void copy()} aria-label={`复制 ${shownCommand(run.attach_command)}`}>
        {copied ? '已复制' : '复制'}
      </button>
    </span>
  );

  let icon: 'spin' | 'warn' | 'stop' = 'spin';
  let text: React.ReactNode;
  let actions: React.ReactNode = null;
  const retry = (words: string) => (
    <button type="button" className="ib-btn ib-sm" disabled={busy !== null} onClick={() => void act('retry')} data-run-retry="">
      {words}
    </button>
  );
  const kept = '你的消息已保留。';
  let bar: number | null = null;
  switch (run.state) {
    case 'starting':
      text = run.again ? `正在再次启动 ${name}…` : (
        <>
          正在 <bdi>{run.project}</bdi> 中启动 {name}…
          {/* E11: the name was taken between the pick and the clone. */}
          {clone?.renamed_from && clone.folder_shown ? (
            <span className="ib-run-sub" data-run-clone-renamed="">
              已克隆到 {clone.folder_shown}：当时 {lastName(clone.renamed_from)} 这个名称已被占用。
            </span>
          ) : null}
        </>
      );
      break;
    case 'cloning':
      // E1, E2.
      text = (
        <>
          正在克隆 {clone?.slug ?? run.project}
          {clone?.pct != null ? ` · ${clone.pct}%` : ''} · 接下来启动 {name}
        </>
      );
      bar = clone?.pct ?? null;
      actions = (
        <button type="button" className="ib-run-btn" disabled={busy !== null} onClick={() => void act('stop')} data-run-clone-cancel="">
          取消
        </button>
      );
      break;
    case 'clone_failed': {
      icon = 'warn';
      const slug = clone?.slug ?? run.project;
      const host = clone?.host ?? '';
      const copyCommand = clone && (
        <button type="button" className="ib-btn ib-sm" onClick={() => void copyClone()} data-run-clone-copy="">
          {cloneCopied ? '已复制' : '复制克隆命令'}
        </button>
      );
      if (clone?.error === 'auth') {
        // E4.
        text = (
          <>
            <b>无法克隆 {slug}。</b>{Where} 尚未登录 {host}。{kept}
            <span className="ib-run-sub">
              请在 {where} 上登录 {host}，然后重试。
            </span>
          </>
        );
        actions = (
          <>
            {retry('重试')}
            {copyCommand}
          </>
        );
      } else if (clone?.error === 'not_found') {
        // E5.
        text = (
          <>
            <b>无法克隆 {slug}。</b>{host} 上没有这个仓库，或者 {where} 看不到它。{kept}
          </>
        );
        actions = (
          <>
            {onChangeUrl && clone && (
              <button type="button" className="ib-btn ib-sm" onClick={() => onChangeUrl(clone.url)} data-run-clone-change="">
                更改 URL
              </button>
            )}
            {retry('重试')}
          </>
        );
      } else if (clone?.error === 'network') {
        // E6.
        text = (
          <>
            <b>
              无法从 {where} 连接到 {host}。
            </b>{' '}
            {kept}
          </>
        );
        actions = retry('重试');
      } else {
        // git failed another way (or the Inbox closed during the clone): its own words, and the command to run by hand.
        text = (
          <>
            <b>无法克隆 {slug}。</b>{clone?.error_text ? `${clone.error_text.trim().split('\n').at(-1)} ` : ''}
            {kept}
          </>
        );
        actions = (
          <>
            {retry('重试')}
            {copyCommand}
          </>
        );
      }
      break;
    }
    case 'clone_cancelled':
      // E7.
      icon = 'stop';
      text = `你取消了克隆。${where} 上没有保留任何内容。你的回复会重新开始克隆。`;
      actions = (
        <button type="button" className="ib-run-btn" disabled={busy !== null} onClick={() => void act('retry')} data-run-retry="">
          再次克隆
        </button>
      );
      break;
    case 'working':
      text = (
        <>
          {name} 正在工作{minutes ? ` · ${minutes}` : ''}
        </>
      );
      actions = stop;
      break;
    case 'waiting_answer':
      // A permission prompt asked above, as a question card (screen 09): answering it is the action.
      text = (
        <>
          {name} 正在等待你的回答{minutes ? ` · ${minutes}` : ''}
        </>
      );
      actions = stop;
      break;
    case 'waiting_terminal':
      icon = 'warn';
      text = (
        <>
          <b>{name} 正在等待权限提示</b>
          {minutes ? ` · ${minutes}` : ''}
          {canOpen ? null : <span className="ib-run-sub">在你的 Mac 上的 Terminal 中回答：</span>}
        </>
      );
      actions = (
        <>
          {canOpen && openTerminal}
          {attach}
          {stop}
        </>
      );
      break;
    case 'stopped':
      icon = 'stop';
      // `cause`: the host's words for a stop that was not the person's (`LaunchHost.stoppedNote`). Anyone's reply starts it again.
      text =
        run.stopped_by_person && run.since
          ? `你在 ${whenTime(run.since)} 停止了 ${name}。你的回复会重新启动它。`
          : run.cause
            ? `${name} 已停止。${run.cause}`
            : `${name} 已停止。你的回复会重新启动它。`;
      break;
    case 'failed':
      icon = 'warn';
      if (run.turn_error) {
        text = (
          <>
            <b>
              {/* The agent's own error is the note above: the line says only that it couldn't answer, and that the message is kept. */}
              {name} {INBOX_TURN_FAILED_WORDS}。
            </b>{' '}
            {kept}
          </>
        );
        actions = retry('重试');
        break;
      }
      // E10: a cloned repo that brings hooks, MCP servers or settings starts once the person trusts it (decision 4a).
      if (clone?.brings && clone.brings.length > 0 && run.untrusted && run.trust) {
        text = (
          <>
            <b>
              <bdi>{run.project}</bdi> 自带 {bringsWords(clone.brings)}。
            </b>{' '}
            你信任该文件夹后，{name} 就会启动。
            {whatsIn && run.trust.warning ? (
              <span className="ib-run-sub" data-run-trust-warning="">
                {run.trust.warning}
              </span>
            ) : null}
          </>
        );
        actions = (
          <>
            <button type="button" className="ib-btn ib-sm" disabled={busy !== null} onClick={() => void act('trust')} data-run-trust="">
              信任并启动
            </button>
            {run.trust.warning && (
              <button type="button" className="ib-btn ib-sm" aria-expanded={whatsIn} onClick={() => setWhatsIn((open) => !open)} data-run-whats-in="">
                里面有什么
              </button>
            )}
          </>
        );
        break;
      }
      text = (
        <>
          <b>{name} 没有启动。</b>{run.cause ?? ''} 你的消息已保留。
          {/* Create a folder (E8): the folder the Send made is not taken away when the agent doesn't start. */}
          {run.made_folder ? (
            <span className="ib-run-sub" data-run-made-folder="">
              已创建 {run.made_folder}，它会保留。
            </span>
          ) : null}
          {run.trust?.warning ? (
            <span className="ib-run-sub" data-run-trust-warning="">
              {run.trust.warning}
            </span>
          ) : null}
          {run.untrusted && !run.trust ? (
            <span className="ib-run-sub" data-run-trust-howto="">
              {run.trust_covers_home ? (
                '无法信任此文件夹，因为信任范围会覆盖你的主文件夹。请在一个自带 git 仓库的项目文件夹中启动。'
              ) : run.home_folder ? (
                '无法信任你的主文件夹。请在它里面的一个文件夹中启动。'
              ) : (
                <>要信任它，请在收件箱所在电脑的终端里运行 {name}。</>
              )}
            </span>
          ) : null}
        </>
      );
      actions = (
        <>
          {run.trust && (
            <button type="button" className="ib-btn ib-sm" disabled={busy !== null} onClick={() => void act('trust')} data-run-trust="">
              信任文件夹
            </button>
          )}
          {canOpen && openTerminal}
          <button type="button" className="ib-btn ib-sm" disabled={busy !== null} onClick={() => void act('retry')} data-run-retry="">
            重试
          </button>
        </>
      );
      break;
    case 'missing':
      icon = 'warn';
      text = (
        <>
          <b>{name} 已不在这台电脑上。</b>你的回复正在等待。重新安装 {name} 后就会送达{canReaddress ? '，也可以把回复发送到另一个会话。' : '。'}
        </>
      );
      break;
  }

  return (
    <div className="ib-run" data-run={run.state} data-run-again={run.again ? '' : undefined} tabIndex={-1}>
      <span className="ib-run-main">
        {icon === 'spin' ? <span className="ib-run-spin" aria-hidden="true" /> : icon === 'warn' ? <Icon name="warn" size={14} /> : <span className="ib-run-stopmark" aria-hidden="true" />}
        <span className="ib-run-text" role={run.state === 'failed' || run.state === 'waiting_terminal' || run.state === 'clone_failed' ? 'status' : undefined}>
          {text}
          {bar !== null && (
            <span className="ib-run-bar" aria-hidden="true" data-run-clone-bar="">
              <i style={{ width: `${bar}%` }} />
            </span>
          )}
        </span>
      </span>
      {actions && <span className="ib-run-acts">{actions}</span>}
      {error && (
        <p className="ib-error" role="alert" data-run-error="">
          {error}
        </p>
      )}
    </div>
  );
}

/** "hooks and MCP servers", "hooks, MCP servers and settings": what a cloned repo brings (E10). */
function bringsWords(brings: readonly string[]): string {
  if (brings.length <= 1) return brings[0] ?? '';
  return `${brings.slice(0, -1).join('、')} 和 ${brings.at(-1)}`;
}

/** A path's last folder. */
const lastName = (path: string) => path.replace(/\/+$/, '').split('/').pop() ?? path;

/** E4's Copy clone command: the URL as git takes it, its branch, and the folder it was going to. */
export function cloneCommand(clone: { url: string; branch: string | null; folder_shown: string | null }): string {
  const quote = (text: string) => (/^[A-Za-z0-9_./:@~+-]+$/.test(text) ? text : `'${text.replace(/'/g, "'\\''")}'`);
  // `~/` stays outside the quotes, so the shell still reads it as home.
  const folder = (path: string) => (path.startsWith('~/') ? `~/${quote(path.slice(2))}` : quote(path));
  return ['git clone', ...(clone.branch ? ['--branch', quote(clone.branch)] : []), quote(clone.url), ...(clone.folder_shown ? [folder(clone.folder_shown)] : [])].join(' ');
}
