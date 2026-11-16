/**
 * The Inbox's update control (design of record:
 * .product/approved/plannotator-updates/, Workspaces' rules): one full-width
 * filled button above Settings, no motion, never a percentage, never the
 * error colour; the update dialog with Update now in the first step; the
 * restart and failure dialogs; the What's new page; Settings → About.
 */

import {
  UPDATE_EXIT_CHECKSUM_MISMATCH,
  UPDATE_EXIT_DOWNLOAD_FAILED,
  UPDATE_OTHER_TMPDIR_COMMAND,
  updateStagingAdvice,
} from '@plannotator/core/update-exit-codes';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Viewer } from '@plannotator/ui/components/Viewer';
import { ImageResolverContext, type ImageResolution } from '@plannotator/ui/components/ImageResolverContext';
import { parseMarkdownToBlocks } from '@plannotator/ui/utils/parser';
import type { InboxHealth } from '@plannotator/core/inbox-types';
import type { UpdateCheckFailing, UpdateDetails, UpdateSwitches, WhatsNewModel, WhatsNewReleasesModel } from '../api';
import { whatsNewImageUrl } from '../data/whatsNewImage';
import { clockTime, dayWords, formatCount, tildePath, whenTime } from '../format';
import { Icon } from '../icons';
import { CopyButton } from './ConnectPicker';
import { SidebarTrigger } from '../shell/sidebar';
import { releasesBetween } from '../whatsNew';
import { useBackdropClose } from '../parts/backdropClose';
import { KnownLine, NotesMissing, ReleasesPanel, ReleasesSheet, TldrLedger, centerRow } from './WhatsNewReleases';

type Update = NonNullable<InboxHealth['update']>;

const NO_ANNOTATIONS: never[] = [];
const noop = () => {};

/** a > b for X.Y.Z versions (anything else: false). */
function newerThan(a: string, b: string): boolean {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  if (pa.length !== 3 || pb.length !== 3 || [...pa, ...pb].some((n) => !Number.isInteger(n))) return false;
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i]! > pb[i]!;
  return false;
}

/** "Oct 9", from an ISO date. */
function releasedOn(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format(date);
}

// ───────────────────────────── The sidebar button ─────────────────────────────

export interface UpdateButtonProps {
  update: InboxHealth['update'];
  /** Set by the page after Restart (or Update now's restart): "Restarting…". */
  restarting: boolean;
  /** This run started on a newer version: the quiet "What's new in X" link instead of a button. */
  updated: string | null;
  onPress: () => void;
  onWhatsNew: (version: string) => void;
}

const LABEL: Record<Update['state'], string> = {
  available: '更新',
  ready: '更新',
  updating: '正在更新…',
  failed: '更新失败',
};

function tipFor(update: Update, restarting: boolean): string {
  if (restarting) return `正在重启到 ${update.version}`;
  switch (update.state) {
    case 'available':
      return `Plannotator ${update.version} 已可更新`;
    case 'ready':
      return `Plannotator ${update.version} 已就绪`;
    case 'updating':
      return `正在安装 Plannotator ${update.version}`;
    case 'failed':
      return `Plannotator ${update.version} 未能安装`;
  }
}

/**
 * Up to date: nothing. Available and Ready: the filled Update. Updating and
 * Restarting: the same button, disabled, with a small spinner. Failed: a
 * neutral outline button. Updated: no button, a quiet link for this run.
 */
export function UpdateButton({ update, restarting, updated, onPress, onWhatsNew }: UpdateButtonProps) {
  if (!update) {
    return updated ? (
      <button type="button" className="ib-nav ib-quiet" data-whats-new-link={updated} onClick={() => onWhatsNew(updated)}>
        <Icon name="book" />
        {updated} 的新功能
      </button>
    ) : null;
  }
  const busy = restarting || update.state === 'updating';
  // Available and Ready name their version ("Update to 0.28.22"), so the sidebar's
  // Update and the What's new page's are not two bare "Update"s.
  const label = restarting
    ? '正在重启…'
    : update.state === 'available' || update.state === 'ready'
      ? `更新到 ${update.version}`
      : LABEL[update.state];
  const tip = tipFor(update, restarting);
  // The name contains the visible words (WCAG 2.5.3 Label in Name: "click Update to 0.28.22" works by voice);
  // "Plannotator X" stays in the tooltip.
  const aria = update.state === 'failed' && !restarting ? `更新失败：Plannotator ${update.version} 未能安装` : label;
  return (
    <div className="ib-upd" data-update-state={restarting ? 'restarting' : update.state}>
      <button
        type="button"
        className={`ib-upd-btn${update.state === 'failed' && !restarting ? ' ib-outline' : ''}`}
        disabled={busy}
        aria-label={aria}
        aria-describedby="ib-upd-tip"
        onClick={onPress}
      >
        {busy && <span className="ib-spin" aria-hidden="true" />}
        <span className="ib-upd-l">{label}</span>
      </button>
      <span className="ib-upd-tip" id="ib-upd-tip" role="tooltip">
        {tip}
      </span>
    </div>
  );
}

// ───────────────────────────── Dialogs ─────────────────────────────

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface ModalProps {
  /** The accessible name, when no element labels the dialog (`labelledBy`). */
  label?: string;
  labelledBy?: string;
  describedBy?: string;
  onClose: () => void;
  children: ReactNode;
  testId: string;
  /**
   * The dialog handles Tab and Escape itself: Tab cycles inside it (the
   * native modal leaves the browser's own chrome in the cycle), and Escape
   * closes it without reaching the page's own Escape (which closes a thread).
   */
  ownKeys?: boolean;
  /** What takes focus as it opens (a selector inside the dialog); the first enabled primary button by default. */
  initialFocus?: string;
  /** Where focus goes on close when nothing focusable opened the dialog (the page heading). */
  fallbackFocus?: () => HTMLElement | null;
  /** A class beside `ib-dlg` (the agent-note dialog is wider, with a pinned footer). */
  className?: string;
}

/** A native modal dialog: focus stays inside, Escape closes, focus returns to what opened it. */
export function Modal({ label, labelledBy, describedBy, onClose, children, testId, ownKeys, initialFocus, fallbackFocus, className }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const backdrop = useBackdropClose(ref, onClose);
  const opener = useRef<Element | null>(null);
  const fallback = useRef(fallbackFocus);
  fallback.current = fallbackFocus;
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    opener.current = document.activeElement;
    if (typeof dialog.showModal === 'function' && !dialog.open) {
      try {
        dialog.showModal();
      } catch {
        dialog.setAttribute('open', '');
      }
    } else dialog.setAttribute('open', '');
    (dialog.querySelector(initialFocus ?? '.ib-btn.ib-pri:not([disabled])') as HTMLElement | null)?.focus();
    return () => {
      if (opener.current instanceof HTMLElement && opener.current !== document.body && document.contains(opener.current)) opener.current.focus();
      else fallback.current?.()?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={className ? `ib-dlg ${className}` : 'ib-dlg'}
      aria-label={labelledBy ? undefined : label}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      aria-modal={ownKeys ? 'true' : undefined}
      data-dialog={testId}
      onKeyDown={
        ownKeys
          ? (event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                onClose();
                return;
              }
              if (event.key !== 'Tab') return;
              // Never an element under `inert` (the list options dialog's picture of real rows) or `hidden` (a tab panel not shown),
              // or one Tab skips (a tab list's other tabs, tabindex -1): none of them takes focus from Tab.
              const items = [...(ref.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])].filter((el) => !el.closest('[inert], [hidden]') && el.tabIndex >= 0);
              if (items.length === 0) return;
              const first = items[0]!;
              const last = items[items.length - 1]!;
              const active = document.activeElement;
              if (!ref.current?.contains(active)) {
                event.preventDefault();
                first.focus();
              } else if (event.shiftKey && active === first) {
                event.preventDefault();
                last.focus();
              } else if (!event.shiftKey && active === last) {
                event.preventDefault();
                first.focus();
              }
            }
          : undefined
      }
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      {...backdrop}
    >
      <div className="ib-dlg-in">{children}</div>
    </dialog>
  );
}

function CommandRow({ text }: { text: string }) {
  return (
    <div className="ib-cmd">
      <code>{text}</code>
      <CopyButton text={text} />
    </div>
  );
}

export interface UpdateDialogProps {
  details: UpdateDetails | null;
  update: Update;
  error: string | null;
  busy: boolean;
  onUpdateNow: () => void;
  onRemindTomorrow: () => void;
  onCancel: () => void;
  onWhatsNew: () => void;
  onAutoUpdate: (next: boolean) => void;
}

/** The open sessions the dialog names; the rest are counted. */
const SESSIONS_SHOWN = 5;

/** Available → press. Update now in the first step (the owner's answer 4). */
export function UpdateDialog({ details, update, error, busy, onUpdateNow, onRemindTomorrow, onCancel, onWhatsNew, onAutoUpdate }: UpdateDialogProps) {
  const released = releasedOn(details?.latest?.published_at ?? update.publishedAt);
  const managed = update.action === 'script';
  const auto = details?.auto_update;
  return (
    <Modal label={`更新到 Plannotator ${update.version}`} onClose={onCancel} testId="update">
      <h2>更新到 Plannotator {update.version}</h2>
      <p className="ib-sub">
        当前版本为 {update.current}
        {released ? ` · 发布于 ${released}` : ''}
      </p>
      {details?.summary && <p className="ib-sum">{details.summary}</p>}
      <button type="button" className="ib-lnk" onClick={onWhatsNew}>
        <Icon name="book" size={14} />
        {update.version} 的新功能
      </button>
      {managed ? (
        <>
          <h3>将会发生什么</h3>
          <ul className="ib-what">
            <li>
              <Icon name="restart" />
              <span>
                运行 v{update.version} 的安装脚本
                {details && details.flags.length > 0 ? (
                  <>
                    ，沿用上次安装时的选择：<code>{details.flags.join(' ')}</code>。
                  </>
                ) : (
                  '。'
                )}
              </span>
            </li>
            <li>
              <Icon name="doc" />
              <span>
                已打开的评审会继续在 {update.current} 上运行，直到你完成它们；新评审会在 {update.version} 上打开。
                {details && details.sessions.length > 0 && (
                  // The first few, then how many more: thirty open reviews never push Update now off the dialog (decision 7).
                  <ul className="ib-sess">
                    {details.sessions.slice(0, SESSIONS_SHOWN).map((s) => (
                      <li key={`${s.label}-${s.started_at}`}>
                        {s.project} · {s.mode === 'review' ? '代码评审' : s.mode}，打开于 {whenTime(s.started_at)}
                      </li>
                    ))}
                    {details.sessions.length > SESSIONS_SHOWN && <li data-sessions-more="">还有 {formatCount(details.sessions.length - SESSIONS_SHOWN)} 个</li>}
                  </ul>
                )}
              </span>
            </li>
            <li>
              <Icon name="inbox" />
              <span>更新完成后收件箱会重启。你的选择、草稿和会话都已保存。</span>
            </li>
          </ul>
        </>
      ) : (
        <>
          <h3>自行更新此副本</h3>
          <p className="ib-sum" style={{ marginTop: 0 }}>
            此 Plannotator 副本不是通过安装脚本安装的，因此无法自行更新。请运行：
          </p>
          {details && <CommandRow text={details.command} />}
        </>
      )}
      {details?.plugin_command ? (
        <>
          <h3>需单独更新</h3>
          <p className="ib-sum" style={{ margin: 0 }}>
            Claude Code 插件。请在终端中运行，然后重启 Claude Code：
          </p>
          <CommandRow text={details.plugin_command} />
        </>
      ) : (
        managed && (
          <p className="ib-sum ib-quietline">
            它还会在已安装时更新 Claude Code 插件，以及 OpenCode 的缓存插件：之后请重新加载这些 agent（设置中的 agent
            页面会说明是哪个）。Pi：运行 <code>pi update --extensions</code>，然后 <code>/reload</code>。
          </p>
        )
      )}
      {managed && auto?.supported && (
        <label className="ib-opt">
          <input
            type="checkbox"
            checked={auto.on}
            // Auto-update needs update checks: with them off it could never act (as Settings → About says).
            disabled={auto.env !== null || details?.check.on === false}
            onChange={(event) => onAutoUpdate(event.target.checked)}
            data-auto-update-checkbox=""
          />
          <span>
            自动安装新版本
            <small>
              {details?.check.on === false
                ? `需要更新检查，但检查已关闭${details.check.env === false ? '：此收件箱启动时设置了 PLANNOTATOR_UPDATE_CHECK=0' : ''}。`
                : auto.env !== null
                  ? `此收件箱的环境中设置了 PLANNOTATOR_AUTO_UPDATE，因此自动更新处于${auto.env ? '开启' : '关闭'}状态。`
                  : '每天最多一次，且不会在其他评审打开时进行。可在设置中更改。'}
            </small>
          </span>
        </label>
      )}
      {error && <div className="ib-error">{error}</div>}
      <div className="ib-acts-row">
        <button type="button" className="ib-btn ib-ghost ib-left" onClick={onRemindTomorrow}>
          明天提醒我
        </button>
        <button type="button" className="ib-btn" onClick={onCancel}>
          取消
        </button>
        {managed && (
          <button type="button" className="ib-btn ib-pri" onClick={onUpdateNow} disabled={busy} data-update-now="">
            立即更新
          </button>
        )}
      </div>
    </Modal>
  );
}

/** Ready → press with a reply in the box: say what a restart loses. */
export function RestartDialog({ update, subject, onRestart, onCancel }: { update: Update; subject: string; onRestart: () => void; onCancel: () => void }) {
  return (
    <Modal label="重启收件箱以完成更新？" onClose={onCancel} testId="restart">
      <h2>重启收件箱以完成更新？</h2>
      <p className="ib-sub">
        Plannotator {update.version} 已安装。收件箱仍在运行 {update.current}。
      </p>
      <ul className="ib-what" style={{ marginTop: 14 }}>
        <li>
          <Icon name="info" />
          <span>粘贴到你对“{subject}”的回复中的文件未保存，将会丢失。其中的文字、选择和评论会保留为草稿。</span>
        </li>
      </ul>
      <div className="ib-acts-row">
        <button type="button" className="ib-btn" onClick={onCancel}>
          取消
        </button>
        <button type="button" className="ib-btn ib-pri" onClick={onRestart}>
          立即重启
        </button>
      </div>
    </Modal>
  );
}

/** Failed → press: the plain reason, the log, Try Again. */
export function FailedDialog({
  update,
  details,
  home,
  onRetry,
  onClose,
  machineName,
  error,
}: {
  update: Pick<Update, 'current' | 'releaseUrl'>;
  details: Pick<UpdateDetails, 'failure' | 'log' | 'command'> | null;
  home: string | null;
  onRetry: () => void;
  onClose: () => void;
  /** The update failed on this linked machine: the same reasons, said about it. */
  machineName?: string;
  /** Try Again was refused. */
  error?: string | null;
}) {
  const code = details?.failure?.exit_code;
  const tls = details?.failure?.tls;
  // Safe updates (step 1): the download didn't match the checksum Plannotator
  // fetched, or the connection presented a revoked certificate (a blocked
  // key). Neither offers the `curl | bash` line: it would go through the same
  // connection, and curl trusts it. Any other failed download can be a lasting
  // local condition (a proxy, a network that inspects HTTPS), so it keeps the
  // way out: the install command and the release page.
  const mismatch = code === UPDATE_EXIT_CHECKSUM_MISMATCH;
  const couldNotDownload = code === UPDATE_EXIT_DOWNLOAD_FAILED;
  const revoked = couldNotDownload && tls === 'revoked';
  // Downloaded, but the temp folder could not hold it: not a network problem, so no way out by curl either.
  const prepare = couldNotDownload ? details?.failure?.prepare : undefined;
  const sub = prepare
    ? `Plannotator 无法准备更新：${prepare}。没有做任何更改；Plannotator ${update.current} 仍可正常使用。${updateStagingAdvice(prepare)}，然后重试。`
    : mismatch
      ? `下载内容与 Plannotator 获取的校验和不匹配。没有做任何更改；Plannotator ${update.current} 仍可正常使用。请稍后重试，或换一个网络。`
      : revoked
        ? `连接提供的证书已被吊销，因此 Plannotator 未下载任何内容。Plannotator ${update.current} 仍可正常使用。请勿在此网络下安装 Plannotator；请换一个网络重试。`
        : couldNotDownload
          ? `Plannotator 无法下载更新。没有做任何更改；Plannotator ${update.current} 仍可正常使用。请稍后重试。`
          : `Plannotator 仍为 ${update.current}。${code !== undefined ? `安装脚本退出，代码 ${code}。` : ''}`;
  return (
    <Modal label={mismatch ? '更新已停止' : '更新未能安装'} onClose={onClose} testId="failed">
      <h2>{mismatch ? '更新已停止' : '更新未能安装'}{machineName ? `（${machineName}）` : ''}</h2>
      <p className="ib-sub">{sub}</p>
      {details && (
        <>
          {details.log && (
            <>
              <p className="ib-sum">{machineName ? `在 ${machineName} 上，` : ''}{mismatch || couldNotDownload ? '详情见日志：' : '日志说明了出错原因：'}</p>
              <CommandRow text={tildePath(details.log, home)} />
            </>
          )}
          {prepare && (
            <>
              <p className="ib-sum">或在终端中使用另一个临时文件夹更新：</p>
              <CommandRow text={UPDATE_OTHER_TMPDIR_COMMAND} />
            </>
          )}
          {couldNotDownload && !revoked && !prepare && (
            <>
              {tls === 'untrusted' && (
                <>
                  <p className="ib-sum">如果你的网络用自己的证书检查 HTTPS，请将 NODE_EXTRA_CA_CERTS 指向该证书，并从终端更新：</p>
                  <CommandRow text="NODE_EXTRA_CA_CERTS=/path/to/its-root.pem plannotator update" />
                </>
              )}
              {details.failure?.release_first ? (
                // macOS curl still trusts emSign G3: should a network holding a
                // leaked key read as "untrusted", the release page comes first.
                <>
                  <p className="ib-sum">
                    如果持续出现此问题，请从
                    <a href={update.releaseUrl} target="_blank" rel="noopener noreferrer" data-failed-release="">
                      发布页面
                    </a>
                    下载。
                  </p>
                  <p className="ib-sum">或自行运行安装脚本：</p>
                  <CommandRow text={details.command} />
                </>
              ) : (
                <>
                  <p className="ib-sum">
                    如果持续出现此问题，请自行安装，或从
                    <a href={update.releaseUrl} target="_blank" rel="noopener noreferrer" data-failed-release="">
                      发布页面
                    </a>
                    下载：
                  </p>
                  <CommandRow text={details.command} />
                </>
              )}
            </>
          )}
          {!mismatch && !couldNotDownload && (
            <>
              <p className="ib-sum">或自行运行安装脚本：</p>
              <CommandRow text={details.command} />
            </>
          )}
        </>
      )}
      {error && <div className="ib-error">{error}</div>}
      <div className="ib-acts-row">
        <button type="button" className="ib-btn" onClick={onClose}>
          关闭
        </button>
        <button type="button" className="ib-btn ib-pri" onClick={onRetry}>
          重试
        </button>
      </div>
    </Modal>
  );
}

// ───────────────────────────── What's new ─────────────────────────────

/** "Nov 8, 2026", from an ISO date. */
function releasedLong(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', year: 'numeric' }).format(date);
}

const STABLE = /^\d+\.\d+\.\d+$/;

/**
 * Where the person stands relative to the release the page shows (the
 * heading's meta): on it, on a development build, behind it (with the
 * releases in between, which the meta jumps to in the panel), or past it.
 */
export type WhatsNewStanding =
  | { kind: 'current' }
  | { kind: 'dev' }
  | { kind: 'behind'; current: string; between: number }
  | { kind: 'ahead'; current: string };

/**
 * `versions`: the releases this computer knows of (the panel's rows); the
 * releases in between are counted from them and from the notes' own list of
 * skipped releases.
 */
export function whatsNewStanding(model: Pick<WhatsNewModel, 'version' | 'current' | 'skipped'>, versions: readonly string[] = []): WhatsNewStanding {
  if (!STABLE.test(model.current)) return { kind: 'dev' };
  if (model.current === model.version) return { kind: 'current' };
  if (newerThan(model.version, model.current)) {
    return { kind: 'behind', current: model.current, between: releasesBetween(model.current, model.version, [...versions, ...model.skipped.map((s) => s.version)]) };
  }
  return { kind: 'ahead', current: model.current };
}

/** The page's Update: only for the release it shows, and only while that release can be installed today. */
export function whatsNewCanUpdate(model: Pick<WhatsNewModel, 'version'> | null, update: InboxHealth['update']): boolean {
  return !!model && !!update && update.version === model.version && (update.state === 'available' || update.state === 'ready');
}

function Standing({ standing, onJump }: { standing: WhatsNewStanding; onJump: (() => void) | null }) {
  switch (standing.kind) {
    case 'current':
      return (
        <span className="ib-wn-st" data-whats-new-standing="current">
          <i className="ib-wn-dot ib-wn-d-yours" aria-hidden="true" />
          你正在使用此版本
        </span>
      );
    case 'dev':
      return (
        <span className="ib-wn-st" data-whats-new-standing="dev">
          开发版
        </span>
      );
    case 'ahead':
      return (
        <span className="ib-wn-st" data-whats-new-standing="ahead">
          你使用的是 <span className="ib-wn-mono">{standing.current}</span>
        </span>
      );
    case 'behind':
      // Nothing known in between: the version alone. No row of yours to go to: the same words, not a link.
      if (standing.between === 0 || !onJump) {
        return (
          <span className="ib-wn-st" data-whats-new-standing="behind">
            你使用的是 <span className="ib-wn-mono">{standing.current}</span>
            {standing.between > 0 && ` · 中间有 ${formatCount(standing.between)} 个版本`}
          </span>
        );
      }
      return (
        <button type="button" className="ib-wn-st ib-wn-lk" data-whats-new-standing="behind" onClick={onJump}>
          你使用的是 <span className="ib-wn-mono">{standing.current}</span> · 中间有 {formatCount(standing.between)} 个版本
        </button>
      );
  }
}

/** The panel shows beside the notes from this window width; under it, the bar's version picker opens the sheet. */
const PANEL_MEDIA = '(min-width: 1100px)';
function panelFits(): boolean {
  return typeof window.matchMedia === 'function' ? window.matchMedia(PANEL_MEDIA).matches : true;
}

/** Why the notes are not on the page (the What's new route's refusal). */
export interface WhatsNewError {
  message: string;
  /** `notes_unreachable`: GitHub could not be reached; `notes_not_found`: no source has them. */
  code: string | null;
}

/**
 * The What's new page (design of record `.product/approved/inbox-whats-new-tldr/`,
 * round 2; the bar from `.product/approved/inbox-whats-new-header/`, variant
 * Toolbar): a sticky bar with the way back on the left (`‹ Inbox | What's
 * new`) and the release link and Update on the right; then "Plannotator
 * 0.28.53" with its date and where the person stands on one baseline, the
 * release's TL;DR, and its notes; beside them the releases panel, or a
 * version picker in the bar where it does not fit.
 */
export function WhatsNewPage({
  version: routeVersion,
  model: loaded,
  error,
  releases,
  update,
  onBack,
  onUpdate,
  onOpenRelease,
  onRetry,
  onTakeTour,
}: {
  /** The release the page shows (`#whats-new=0.28.53`); the model's when absent. */
  version?: string | null;
  model: WhatsNewModel | null;
  error: string | WhatsNewError | null;
  /** The releases panel's model; null while it loads (or when it could not be read). */
  releases?: WhatsNewReleasesModel | null;
  update: InboxHealth['update'];
  onBack: () => void;
  onUpdate: () => void;
  /** A release picked in the panel or the sheet. */
  onOpenRelease?: (version: string) => void;
  /** Try again, when GitHub could not be reached. */
  onRetry?: () => void;
  /**
   * The quiet line under the notes (approval "inbox-onboarding-tour",
   * returning users: no dialog): "New: a 2-minute tour…". The window passes
   * it while the tour was never taken. Absent: no line.
   */
  onTakeTour?: () => void;
}) {
  const version = routeVersion ?? loaded?.version ?? null;
  // The model of another release (the one before a switch) is never drawn under this one's heading.
  const model = loaded && (!version || loaded.version === version) ? loaded : null;
  const blocks = useMemo(() => parseMarkdownToBlocks(model?.notes ?? '', { frontmatter: false }), [model?.notes]);
  // The notes' images load from the copies the Inbox saved (never from GitHub:
  // the window's CSP allows only its own origin). One not saved is drawn as
  // its alt text in a quiet chip, never a broken image.
  const storedImages = useMemo(() => new Set(model?.images ?? []), [model?.images]);
  const modelVersion = model?.version;
  const resolveImage = useCallback(
    (src: string): ImageResolution | null => {
      if (/^(data|blob):/i.test(src)) return null;
      if (modelVersion && storedImages.has(src)) return { kind: 'src', src: whatsNewImageUrl(modelVersion, src) };
      return { kind: 'unavailable', title: '此图片未保存在这台电脑上。它位于 GitHub 上的发布中。' };
    },
    [modelVersion, storedImages],
  );
  const rows = releases?.releases ?? [];
  const row = (version && rows.find((r) => r.version === version)) || null;
  const current = model?.current ?? releases?.current ?? null;
  const released = releasedLong(model?.published_at ?? row?.published_at);
  const canUpdate = whatsNewCanUpdate(model, update);
  const standing = model ? whatsNewStanding(model, rows.map((r) => r.version)) : current && version ? whatsNewStanding({ version, current, skipped: [] }, rows.map((r) => r.version)) : null;
  const releaseUrl = model?.release_url ?? (version ? `https://github.com/backnotprop/plannotator/releases/tag/v${version}` : null);
  const err: WhatsNewError | null = typeof error === 'string' ? { message: error, code: null } : error;
  const missing = !model && err && (err.code === 'notes_unreachable' || err.code === 'notes_not_found');
  const loading = !model && !err && !!version;

  const [sheet, setSheet] = useState<{ focus: string | null } | null>(null);
  const page = useRef<HTMLDivElement>(null);
  const panelScroll = useRef<HTMLDivElement>(null);
  // A switch to another release starts at its top.
  useEffect(() => {
    if (page.current) page.current.scrollTop = 0;
  }, [version]);
  // The panel is as tall as the pane under its bar: the pane's height, measured (--ib-wn-h).
  useEffect(() => {
    const el = page.current;
    if (!el || typeof ResizeObserver !== 'function') return;
    const measure = () => el.style.setProperty('--ib-wn-h', `${el.clientHeight}px`);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const mine = current && rows.some((r) => r.version === current) ? current : null;
  const jumpToMine = mine
    ? () => {
        if (!panelFits()) {
          setSheet({ focus: mine });
          return;
        }
        const reduce = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        // The panel's list scrolls; the notes stay where they are.
        centerRow(panelScroll.current, mine, !reduce)?.focus({ preventScroll: true });
      }
    : null;
  const open = (next: string) => {
    if (next !== version) onOpenRelease?.(next);
  };
  return (
    <div className="ib-wn" aria-label="新功能" tabIndex={-1} data-whats-new-page={model?.version ?? version ?? ''} ref={page}>
      <div className="ib-wn-bar">
        <SidebarTrigger />
        <button type="button" className="ib-pback" onClick={onBack} data-whats-new-back="">
          <Icon name="chevL" size={16} />
          <span className="ib-pback-l">收件箱</span>
        </button>
        <span className="ib-wn-div" aria-hidden="true" />
        <span className="ib-wn-title">新功能</span>
        <div className="ib-wn-acts">
          {version && rows.length > 0 && (
            <button
              type="button"
              className="ib-wn-picker"
              aria-haspopup="dialog"
              aria-label={`版本 ${version}。显示所有版本`}
              onClick={() => setSheet({ focus: null })}
              data-whats-new-picker=""
            >
              <span className="ib-wn-mono">{version}</span>
              <Icon name="chevD" />
            </button>
          )}
          {releaseUrl && (
            <a className="ib-wn-gh" href={releaseUrl} target="_blank" rel="noopener noreferrer" data-whats-new-github="">
              <Icon name="github" />
              <span className="ib-wn-gh-l">GitHub</span>
              <span className="ib-sr"> 发布页面（在新标签页中打开）</span>
            </a>
          )}
          {model && canUpdate && (
            <button type="button" className="ib-btn ib-pri" onClick={onUpdate} aria-label={`更新到 ${model.version}`} data-whats-new-update="">
              <span>更新</span>
              {/* Dropped on the narrowest phones; the button's name keeps the version. */}
              <span className="ib-wn-to">到 {model.version}</span>
            </button>
          )}
        </div>
      </div>
      <div className={rows.length > 0 ? 'ib-wn-grid ib-wn-has-panel' : 'ib-wn-grid'}>
        <div className="ib-wn-read">
          <div className="ib-wn-in">
            <header className="ib-wn-hero">
              <div className="ib-wn-hrow">
                <h1>
                  <span className="ib-wn-prod">Plannotator</span> <span className="ib-wn-v">{version ?? '…'}</span>
                </h1>
                {(released || standing) && (
                  <p className="ib-wn-meta">
                    {released && (
                      <span>
                        发布于 <span className="ib-wn-mono">{released}</span>
                      </span>
                    )}
                    {standing && <Standing standing={standing} onJump={jumpToMine} />}
                  </p>
                )}
              </div>
            </header>
            {model ? (
              <>
                {model.tldr && model.tldr.length > 0 ? <TldrLedger lines={model.tldr} /> : <div className="ib-wn-gap" />}
                {model.notes ? (
                  <div className="ib-body ib-wn-body">
                    <ImageResolverContext.Provider value={resolveImage}>
                      <Viewer
                        blocks={blocks}
                        markdown={model.notes}
                        annotations={NO_ANNOTATIONS}
                        onAddAnnotation={noop}
                        onSelectAnnotation={noop}
                        selectedAnnotationId={null}
                        mode="selection"
                        taterMode={false}
                        maxWidth={null}
                        stickyActions={false}
                        disableCodePathValidation
                        answerOnly
                        readOnly
                      />
                    </ImageResolverContext.Provider>
                  </div>
                ) : (
                  <p className="ib-sum">此版本没有发布说明。可在 GitHub 上查看。</p>
                )}
                {onTakeTour && (
                  <p className="ib-wn-tour" data-whats-new-tour="">
                    新内容：2 分钟导览，看看我们如何用收件箱构建收件箱。{' '}
                    <button type="button" className="ib-lnk" onClick={onTakeTour}>
                      开始导览
                    </button>
                  </p>
                )}
              </>
            ) : missing && version ? (
              <>
                <KnownLine row={row} loading={false} />
                <NotesMissing
                  version={version}
                  unreachable={err!.code === 'notes_unreachable'}
                  message={err!.message}
                  releaseUrl={releaseUrl!}
                  {...(onRetry && { onRetry })}
                />
              </>
            ) : err ? (
              <div className="ib-error">{err.message}</div>
            ) : loading ? (
              <>
                <KnownLine row={row} loading />
                <div className="ib-wn-loading" data-whats-new-loading="">
                  <p className="ib-wn-wait" role="status">
                    <span className="ib-wn-spin" aria-hidden="true" />
                    正在从 GitHub 获取发布说明
                  </p>
                  {[92, 84, 88, 36, 0, 70, 90, 82, 56].map((w, i) =>
                    w ? <span key={i} className="ib-wn-sk" style={{ width: `${w}%` }} /> : <span key={i} className="ib-wn-sk-gap" />,
                  )}
                </div>
              </>
            ) : null}
          </div>
        </div>
        {releases && rows.length > 0 && <ReleasesPanel releases={releases} showing={version} onOpen={open} scrollRef={panelScroll} />}
      </div>
      {sheet && releases && rows.length > 0 && (
        <ReleasesSheet releases={releases} showing={version} focusVersion={sheet.focus} onOpen={open} onClose={() => setSheet(null)} />
      )}
    </div>
  );
}


// ──────────────────────── Checking for updates is failing ────────────────────────

/** "can't check for updates since 9:14 AM (GitHub API rate-limited)", from the server's failing record. */
export function checkFailingWords(failing: UpdateCheckFailing): string {
  const day = dayWords(failing.since);
  const when = day === 'today' ? clockTime(failing.since) : day === 'yesterday' ? `昨天 ${clockTime(failing.since)}` : day;
  return `自 ${when} 起无法检查更新（${failing.error}）`;
}

/**
 * The command that updates without the check (the install script finds the
 * newest release by itself), shown wherever checking is failing.
 */
export function CheckFailingCommand({ command }: { command: string }) {
  return (
    <div className="ib-chkfail" data-update-check-failing="">
      <span>安装脚本会自行查找最新版本。要立即更新，请运行：</span>
      <CommandRow text={command} />
    </div>
  );
}

/**
 * The sidebar's quiet row while checking for updates has failed for hours
 * and no Update button shows: "Can't check for updates", opening Settings →
 * About, which says why and gives the command. Never the error colour.
 */
export function CheckFailingRow({ failing, onOpen }: { failing: UpdateCheckFailing; onOpen: () => void }) {
  return (
    <button type="button" className="ib-nav ib-quiet ib-rw-restart" data-update-check-failing-row="" onClick={onOpen}>
      <Icon name="info" />
      <span className="ib-rw-label">无法检查更新</span>
      <span className="ib-sr">。{checkFailingWords(failing)}。打开设置中的关于。</span>
    </button>
  );
}

/** "today 2:57 PM", "yesterday 2:57 PM", "Oct 3": when something happened. */
function whenWords(iso: string): string {
  const day = dayWords(iso);
  return day === 'today' || day === 'yesterday' ? `${day} ${clockTime(iso)}` : day;
}

/**
 * "Can't check for updates since 9:14 AM (…) · last tried 2:50 PM": the
 * failing line as Settings → General and About both show it.
 */
function checkFailingStatus(failing: UpdateCheckFailing, details: UpdateDetails | null): string {
  const tried = details?.check.last_attempt_at ? ` · 上次尝试 ${whenWords(details.check.last_attempt_at)}` : '';
  return `${checkFailingWords(failing).replace(/^./, (c) => c.toUpperCase())}${tried}`;
}

/** A successful check this recent backs "Up to date". */
export const UP_TO_DATE_FRESH_MS = 24 * 60 * 60 * 1000;

/**
 * What the last checks say, in words that claim nothing they cannot back:
 * "Up to date" only after a recent successful check with checks on; else
 * checks off, failing for hours (with when it last tried), the last check
 * failed, when it last checked, or not checked yet. `news`: an update is
 * known or in progress, so never "Up to date".
 */
export function checkStatusWords(details: UpdateDetails | null, news: boolean, now: number = Date.now()): string {
  if (!details) return '';
  const check = details.check;
  if (!check.on) return '更新检查已关闭';
  if (check.failing) return checkFailingStatus(check.failing, details);
  if (check.last_failed_at) return `上次检查失败于 ${whenWords(check.last_failed_at)}${check.error ? `（${check.error}）` : ''}`;
  const ok = details.latest?.fetched_at ?? null;
  const okAt = ok ? Date.parse(ok) : NaN;
  if (ok && Number.isFinite(okAt) && now - okAt < UP_TO_DATE_FRESH_MS && okAt - now < 60_000) {
    return news ? `已检查：${whenWords(ok)}` : `已是最新 · 已检查：${whenWords(ok)}`;
  }
  if (ok) return `上次检查：${whenWords(ok)}`;
  return '尚未检查';
}

// ───────────────────────────── Settings → General ─────────────────────────────

/**
 * Why update checks are off and how to turn them back on (null: they are on).
 * Off stops only the automatic checks: Check now and Update still work.
 */
export function checksOffWords(details: UpdateDetails | null): ReactNode {
  if (!details || details.check.on) return null;
  if (details.check.env === false)
    return (
      <>
        更新检查已关闭：此收件箱启动时设置了 <code>PLANNOTATOR_UPDATE_CHECK=0</code>。去掉该设置后重启即可重新开启。
      </>
    );
  return '更新检查已关闭。请在设置 → 关于中开启“有新版本时通知我”，即可重新检查。';
}

/**
 * The first row of Settings → General (the owner, 2026-10-26: "the update
 * button to also show up in the general part of settings"): the version this
 * Inbox runs and the same action the sidebar's Update button offers, plus
 * Check now; the failing-check line with the install command when checking
 * fails.
 */
export function GeneralUpdateRow({
  version,
  details,
  update,
  restarting,
  checking,
  failing,
  onCheckNow,
  onUpdate,
  onWhatsNew,
}: {
  version: string;
  details: UpdateDetails | null;
  update: InboxHealth['update'];
  restarting: boolean;
  checking: boolean;
  failing: UpdateCheckFailing | null;
  onCheckNow: () => void;
  onUpdate: () => void;
  onWhatsNew: (version: string) => void;
}) {
  const known = details?.latest && newerThan(details.latest.version, version) ? details.latest.version : null;
  const busy = restarting || update?.state === 'updating';
  // Checks off: say why and how to turn them back on, under whatever the row offers.
  const off = version === 'dev' ? null : checksOffWords(details);
  let offLine = !!off;
  let status: ReactNode;
  if (version === 'dev') status = '开发版';
  else if (restarting && update) status = `正在重启到 ${update.version}…`;
  else if (update?.state === 'updating') status = `正在安装 ${update.version}…`;
  else if (update?.state === 'ready') status = `${update.version} 已安装 · 重启后使用`;
  else if (update?.state === 'failed') status = `${update.version} 未能安装`;
  else if (update?.state === 'available')
    status = (
      <>
        {update.version} 已可更新 ·{' '}
        <button type="button" className="ib-lnk" onClick={() => onWhatsNew(update.version)}>
          新功能
        </button>
      </>
    );
  else if (failing) status = checkFailingStatus(failing, details);
  else if (off) {
    // Nothing to offer: the reason is the status (a snoozed release still says it exists).
    offLine = false;
    status = (
      <>
        {known && `${known} 已可更新 · `}
        {off}
      </>
    );
  }
  // A newer release known but not offered (Remind me tomorrow): never "Up to date".
  else status = [checkStatusWords(details, !!known), known && `${known} 已可更新`].filter(Boolean).join(' · ');
  const label = restarting
    ? '正在重启…'
    : update?.state === 'updating'
      ? '正在更新…'
      : update?.state === 'failed'
        ? '更新失败…'
        : update
          ? `更新到 ${update.version}`
          : null;
  return (
    <section className="ib-sgroup ib-sgroup-first" data-settings-update="" data-update-state={restarting ? 'restarting' : (update?.state ?? (failing ? 'check-failing' : 'none'))} aria-label="Plannotator 版本">
      <div className="ib-card">
        <div className="ib-prow">
          <span className="ib-tile">
            <Icon name="inbox" />
          </span>
          <span className="ib-txt">
            <span className="ib-l">Plannotator {version}</span>
            <span className="ib-desc" data-general-update-status="">
              {status}
            </span>
            {offLine && (
              <span className="ib-desc" data-general-checks-off="">
                {off}
              </span>
            )}
          </span>
          <span className="ib-ctl">
            {label && (
              <button
                type="button"
                className={`ib-btn ib-sm${update?.state === 'failed' ? '' : ' ib-pri'}`}
                onClick={onUpdate}
                disabled={busy}
                data-general-update=""
              >
                {busy && <span className="ib-spin" aria-hidden="true" />}
                {label}
              </button>
            )}
            {!busy && (
              <button type="button" className="ib-btn ib-sm" onClick={onCheckNow} disabled={checking || version === 'dev'} data-general-check="">
                {checking ? '正在检查…' : '立即检查'}
              </button>
            )}
          </span>
        </div>
      </div>
      {failing && !update && details && <CheckFailingCommand command={details.command} />}
    </section>
  );
}

// ───────────────────────────── Settings → About ─────────────────────────────

/**
 * Settings → About (design of record `.product/approved/inbox-settings-tabs/`):
 * the version with its status, Check now, Update now when a release is
 * available, the two update switches, and where things are on this computer.
 */
export function AboutBlock({
  version,
  details,
  switches,
  checking,
  error,
  onCheckNow,
  onToggle,
  update,
  onUpdate,
  onWhatsNew,
  where,
  updates = true,
  whatsNewRunning = false,
}: {
  /**
   * False until the settings are read: the block shows the version and
   * What's new in it, and no Update, Check now or update switch.
   */
  updates?: boolean;
  /**
   * A page over the tailnet: also a link to What's new in the
   * release this Inbox runs (none for a development build).
   */
  whatsNewRunning?: boolean;
  version: string;
  details: UpdateDetails | null;
  switches: UpdateSwitches | undefined;
  checking: boolean;
  error: string | null;
  onCheckNow: () => void;
  onToggle: (change: { update_check?: boolean; auto_update?: boolean }) => void;
  /** The sidebar's update state: Update now while a release is available, ready or failed. */
  update?: InboxHealth['update'];
  onUpdate?: () => void;
  onWhatsNew?: (version: string) => void;
  /** "Where things are": the data folder and the MCP address and command. */
  where?: { data: string; mcpUrl: string; mcpCommand: string } | null;
}) {
  const latest = details?.latest;
  const failing = details?.check.failing ?? null;
  // What is happening with the version, beside what the checks say (checkStatusWords).
  let status = '';
  if (version === 'dev') status = '开发版';
  else if (details?.update?.state === 'updating') status = `正在安装 ${details.update.version}`;
  else if (details?.update?.state === 'ready') status = `${details.update.version} 已安装；重启后使用`;
  else if (latest && newerThan(latest.version, version)) status = `${latest.version} 已可更新`;
  const checked = version === 'dev' ? '尚未检查' : checkStatusWords(details, status !== '');
  const checks = switches?.update_check;
  const auto = switches?.auto_update;
  const autoSupported = details?.auto_update.supported ?? false;
  const available = update?.version ?? (latest && newerThan(latest.version, version) ? latest.version : null);
  const updateLabel = update?.state === 'ready' ? '重启以更新' : update?.state === 'failed' ? '更新失败…' : '立即更新';
  const locked = (checks?.env !== null && checks?.env !== undefined) || (auto?.env !== null && auto?.env !== undefined);
  // The running release's notes; a development build has none to name.
  const running = whatsNewRunning && onWhatsNew && STABLE.test(version) ? version : null;
  if (!updates) {
    return (
      <>
        <section className="ib-sgroup ib-sgroup-first" data-settings-about="tailnet" aria-label="版本">
          <div className="ib-card">
            <div className="ib-prow">
              <span className="ib-tile">
                <Icon name="inbox" />
              </span>
              <span className="ib-txt">
                <span className="ib-l">Plannotator {version}</span>
                {running && (
                  <span className="ib-desc">
                    <button type="button" className="ib-lnk" data-about-whats-new={running} onClick={() => onWhatsNew!(running)}>
                      What&apos;s new in {running}
                    </button>
                  </span>
                )}
              </span>
            </div>
          </div>
        </section>
        <AboutPrivacy />
        {where && <AboutWhere where={where} />}
      </>
    );
  }
  return (
    <>
      <section className="ib-sgroup ib-sgroup-first" data-settings-about="" aria-label="版本与更新">
        <div className="ib-card">
          <div className="ib-prow">
            <span className="ib-tile">
              <Icon name="inbox" />
            </span>
            <span className="ib-txt">
              <span className="ib-l">
                Plannotator {version}
                {available && update?.state !== 'updating' && <span className="ib-chip ib-chip-pri">{available} 已可更新</span>}
              </span>
              <span className="ib-desc" data-update-status="">
                {[checked, status]
                  .filter(Boolean)
                  .join(' · ')
                  .replace(/^./, (first) => first.toUpperCase())}
                {available && onWhatsNew && (
                  <>
                    {' · '}
                    <button type="button" className="ib-lnk" onClick={() => onWhatsNew(available)}>
                      {available} 的新功能
                    </button>
                  </>
                )}
                {running && (
                  <>
                    {' · '}
                    <button type="button" className="ib-lnk" data-about-whats-new={running} onClick={() => onWhatsNew!(running)}>
                      What&apos;s new in {running}
                    </button>
                  </>
                )}
              </span>
            </span>
            <span className="ib-ctl">
              {update && onUpdate && (
                <button type="button" className="ib-btn ib-sm ib-pri" onClick={onUpdate} disabled={update.state === 'updating'} data-about-update="">
                  {update.state === 'updating' ? '正在更新…' : updateLabel}
                </button>
              )}
              <button type="button" className="ib-btn ib-sm" onClick={onCheckNow} disabled={checking || version === 'dev'}>
                {checking ? '正在检查…' : '立即检查'}
              </button>
            </span>
          </div>
          <div className="ib-prow">
            <span className="ib-txt">
              <span className="ib-l" id="ib-upd-check">
                有新版本时通知我
              </span>
              <span className="ib-desc">每隔几分钟，从此电脑检查</span>
            </span>
            <span className="ib-ctl">
              <button
                type="button"
                role="switch"
                className="ib-sw"
                aria-checked={checks?.on ?? true}
                aria-labelledby="ib-upd-check"
                disabled={!checks || checks.env !== null}
                onClick={() => onToggle({ update_check: !(checks?.on ?? true) })}
              />
            </span>
          </div>
          <div className="ib-prow">
            <span className="ib-txt">
              <span className="ib-l" id="ib-upd-auto">
                保持 Plannotator 为最新
              </span>
              <span className="ib-desc">
                {!autoSupported ? '仅适用于安装脚本管理的二进制文件' : checks && !checks.on ? '需要更新检查' : '自动安装新版本'}
              </span>
            </span>
            <span className="ib-ctl">
              <button
                type="button"
                role="switch"
                className="ib-sw"
                aria-checked={auto?.on ?? false}
                aria-labelledby="ib-upd-auto"
                disabled={!auto || auto.env !== null || !autoSupported || (checks !== undefined && !checks.on)}
                onClick={() => onToggle({ auto_update: !(auto?.on ?? false) })}
              />
            </span>
          </div>
        </div>
        <div className="ib-note">
          <Icon name="info" />
          {locked
            ? checks?.env !== null && checks?.env !== undefined
              ? `此收件箱的环境中设置了 PLANNOTATOR_UPDATE_CHECK，因此更新检查处于${checks.env ? '开启' : '关闭'}状态。去掉该设置后重启收件箱即可更改。${checks.env ? '' : '“立即检查”和“更新”仍然可用。'}`
              : `此收件箱的环境中设置了 PLANNOTATOR_AUTO_UPDATE，因此自动更新处于${auto?.env ? '开启' : '关闭'}状态。`
            : '关闭后完全不会向 GitHub 发起请求。“立即检查”总会询问。'}
        </div>
        {failing && details && <CheckFailingCommand command={details.command} />}
        {error && <div className="ib-error">{error}</div>}
      </section>
      <AboutPrivacy />
      {where && <AboutWhere where={where} />}
    </>
  );
}

/**
 * The daily ping (packages/shared/daily-ping.ts), in words. There is no switch:
 * NO_ANON_PING is the one way to turn it off, so it is the one named.
 */
function AboutPrivacy() {
  return (
    <section className="ib-sgroup" aria-labelledby="ib-g-privacy" data-settings-privacy="">
      <h2 id="ib-g-privacy">隐私</h2>
      <p>
        每天一次，你使用的每个 Plannotator 工具（收件箱、计划评审、代码评审、批注，最后）会发送一条匿名 ping：工具名称、
        版本，以及这台电脑首次使用 Plannotator 以来的周数。其中没有 ID，也没有任何关于你或你的工作的内容。它帮助我们了解有多少人在使用
        Plannotator，以及该把精力放在哪里。
      </p>
      <p>
        要关闭它，请设置 <code>NO_ANON_PING=1</code> 并重启 Plannotator。{' '}
        <a className="ib-lnk" href="https://plannotator.ai/privacy" target="_blank" rel="noreferrer">
          隐私政策
        </a>
      </p>
    </section>
  );
}

function AboutWhere({ where }: { where: { data: string; mcpUrl: string; mcpCommand: string } }) {
  return (
    <section className="ib-sgroup" aria-labelledby="ib-g-where">
      <h2 id="ib-g-where">各项位置</h2>
      <div className="ib-card">
        <div className="ib-prow">
          <span className="ib-txt">
            <span className="ib-l">数据</span>
            <span className="ib-desc">
              <code>{where.data}</code>
            </span>
          </span>
        </div>
        <div className="ib-prow">
          <span className="ib-txt">
            <span className="ib-l">供其他 agent 使用的 MCP</span>
            <span className="ib-desc">
              <code>{where.mcpUrl}</code> · 或命令 <code>{where.mcpCommand}</code>
            </span>
          </span>
        </div>
      </div>
    </section>
  );
}
