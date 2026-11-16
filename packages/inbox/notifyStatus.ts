/**
 * What the window says about notifications, in plain words (Settings →
 * General and the line above the list). Pure: the browser and the server's
 * report come in as arguments, so every state is testable.
 *
 * The states that make notifications fail silently, each named here:
 * - this address has no permission (`default`), maybe because the Inbox moved
 *   to another port or another spelling of this computer's name;
 * - the browser blocked this address (`denied`);
 * - the switch is off;
 * - no Inbox tab is open, or none the browser lets notify (the server's
 *   `notify_reach`: notifications come only from an open tab);
 * - the browser says yes but the system does not show them (macOS
 *   Notifications for the browser off, Focus): only a test shows that.
 */

import type { InboxNotifyReach } from '@plannotator/core/inbox-types';

export type PermissionState = NotificationPermission | 'unsupported';

/** The browser's name as a person knows it, from the user agent. */
export function browserName(userAgent: string = typeof navigator !== 'undefined' ? navigator.userAgent : ''): string {
  if (/\bEdg\//.test(userAgent)) return 'Edge';
  if (/\bFirefox\//.test(userAgent)) return 'Firefox';
  // Chrome, Chromium-based browsers that say Chrome (Arc, Brave), and headless Chrome ("HeadlessChrome/").
  if (/Chrome\//.test(userAgent)) return 'Chrome';
  if (/\bSafari\//.test(userAgent)) return 'Safari';
  return '此浏览器';
}

/** The browser's app name in macOS System Settings → Notifications. */
export function browserAppName(name: string): string {
  if (name === 'Chrome') return 'Google Chrome';
  if (name === 'Edge') return 'Microsoft Edge';
  return name === '此浏览器' ? '你的浏览器' : name;
}

export function isMac(platform: string = typeof navigator !== 'undefined' ? navigator.platform || navigator.userAgent : ''): boolean {
  return /Mac/i.test(platform);
}

/** `localhost:59812`: an origin as a person reads it. */
export function addressOf(origin: string): string {
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
}

/** The status under "Desktop notifications" in Settings. */
export type NotifyStatusKind = 'on' | 'off' | 'not-allowed' | 'blocked' | 'unsupported';

export function notifyStatusKind(enabled: boolean, permission: PermissionState): NotifyStatusKind {
  if (permission === 'unsupported') return 'unsupported';
  if (permission === 'denied') return 'blocked';
  if (permission === 'default') return 'not-allowed';
  return enabled ? 'on' : 'off';
}

export function notifyStatusText(kind: NotifyStatusKind, browser: string): string {
  switch (kind) {
    case 'on':
      return '已为此地址开启';
    case 'off':
      return '已关闭';
    case 'not-allowed':
      return `${browser} 不允许此地址`;
    case 'blocked':
      return `${browser} 已屏蔽此地址`;
    case 'unsupported':
      return '此浏览器无法显示通知';
  }
}

/** How to unblock this address, in the browser's own words. */
export function blockedSteps(browser: string, address: string): string {
  if (browser === 'Safari') return `在 Safari 中：设置 → 网站 → 通知 → ${address} → 允许。然后重新加载此页面。`;
  if (browser === 'Firefox') return `点击地址栏中 ${address} 左侧的图标 → 权限 → 发送通知 → 移除“已阻止”。然后重新加载此页面。`;
  return `点击地址栏中 ${address} 左侧的图标 → 网站设置 → 通知 → 允许。然后重新加载此页面。`;
}

/** Under the test button: why a test the browser accepted may still not show. */
export function testMissHint(browser: string, mac: boolean): string {
  const app = browserAppName(browser);
  return mac
    ? `没看到？请检查系统设置 → 通知 → ${app}，以及专注模式。`
    : `没看到？请检查系统对 ${app} 的通知设置，以及勿扰模式。`;
}

/**
 * "Notifications reach you": whether any open Inbox tab can show one now.
 * `here`: this tab may notify (switch on, browser allows). `reach`: the
 * server's count of open windows, this one included; null from an Inbox that
 * does not report it (then only this tab is known).
 */
export function reachText(input: { here: boolean; enabled: boolean; reach: InboxNotifyReach | null | undefined; origin: string }): { yes: boolean; text: string } {
  const { here, enabled, reach, origin } = input;
  if (!enabled) return { yes: false, text: '否：通知已关闭。' };
  if (!reach) return here ? { yes: true, text: '是，通过此标签页，只要它保持打开。' } : { yes: false, text: '否：此标签页可能无法发送通知。' };
  const others = Math.max(0, reach.allowed - (here ? 1 : 0));
  if (here) {
    return {
      yes: true,
      text: others > 0 ? `是，通过此标签页和另外 ${others} 个收件箱标签页，只要其中一个保持打开。` : '是，通过此标签页，只要它保持打开。',
    };
  }
  if (reach.allowed > 0) {
    const elsewhere = reach.allowed_origins.filter((o) => o !== origin).map(addressOf);
    return { yes: true, text: `是，通过另一个收件箱标签页${elsewhere.length > 0 ? `（${elsewhere.join('、')}）` : ''}。` };
  }
  if (reach.windows === 0) return { yes: false, text: '否：没有打开的收件箱标签页。' };
  return {
    yes: false,
    text: reach.windows > 1 ? `否：${reach.windows} 个打开的收件箱标签页均无法发送通知。` : '否：没有打开的收件箱标签页可以发送通知。',
  };
}
