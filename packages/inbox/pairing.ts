/**
 * Pair a phone, step by step (design of record
 * `.product/approved/inbox-settings-tabs/`, section 4): the words and the
 * gate, kept pure so they are tested without a window.
 *
 * The owner's no-loop rule (approval, decision 5): the computer-side checks
 * are advisory, never a gate. A failing check shows its fix and the person
 * can still continue. The ONLY gate on the code is a way being switched on
 * (`canShowCode`), because a code with no address in it is what sent the
 * owner's phone nowhere.
 */

import type { LanState, PairingAttempt, PairingChecks, TailnetState } from './api';

export type CheckStatus = 'ok' | 'warn' | 'fail' | 'later';

export interface CheckLine {
  status: CheckStatus;
  text: string;
  /** The fix, in one line, for a check that is not ok. */
  fix?: string;
}

/** Which ways are switched on, as the person set them (on even while not working: the card says why). */
export function waysOn(lan: LanState | null, tailnet: TailnetState | null): { wifi: boolean; tailscale: boolean } {
  return { wifi: lan?.on === true, tailscale: tailnet?.on === true };
}

/**
 * The one gate on step 2: at least one way is switched on. Never a check:
 * a check can be wrong (a firewall that macOS asks about, a Wi-Fi name it
 * hides), and a person who knows better must never be held in step 1.
 */
export function canShowCode(lan: LanState | null, tailnet: TailnetState | null): boolean {
  const on = waysOn(lan, tailnet);
  return on.wifi || on.tailscale;
}

/** What this computer can tell about the Wi-Fi way. */
export function wifiCheckLines(checks: PairingChecks['wifi']): CheckLine[] {
  const lines: CheckLine[] = [];
  if (checks.address) {
    lines.push({ status: 'ok', text: checks.network ? `已连接到 Wi-Fi“${checks.network}”，地址 ${checks.address}` : `已连接到此网络，地址 ${checks.address}` });
  } else {
    lines.push({ status: 'fail', text: '这台计算机目前没有 Wi-Fi 或以太网地址。', fix: '请连接网络，然后再次检查。' });
  }
  if (checks.certificate || checks.openssl) lines.push({ status: 'ok', text: '可以为你的手机生成它要检查的证书' });
  else
    lines.push({
      status: 'fail',
      text: '未安装 openssl，收件箱无法生成你的手机要检查的证书。',
      fix: '请安装 OpenSSL（Debian 或 Ubuntu：sudo apt install openssl），然后再次检查。',
    });
  if (checks.bonjour) lines.push({ status: 'ok', text: '附近的手机可以通过名称找到它（Bonjour）' });
  else lines.push({ status: 'warn', text: '附近的手机不会按名称列出这台计算机。', fix: '扫描代码仍然可以配对。' });
  // Only the macOS application firewall can be read; elsewhere (`unknown`) nothing is claimed.
  if (checks.firewall === 'off') lines.push({ status: 'ok', text: 'macOS 防火墙已关闭' });
  else if (checks.firewall === 'on')
    lines.push({ status: 'warn', text: 'macOS 防火墙已开启。', fix: '如果 macOS 询问是否允许 Plannotator 接受传入连接，请选择“允许”。' });
  else if (checks.firewall === 'block_all')
    lines.push({
      status: 'warn',
      text: 'macOS 防火墙阻止传入连接。',
      fix: '在你于系统设置 → 网络 → 防火墙中允许 Plannotator 之前，手机无法连接。',
    });
  return lines;
}

/** What this computer can tell about the Tailscale way. */
export function tailscaleCheckLines(checks: PairingChecks['tailscale']): CheckLine[] {
  const installed: CheckLine = { status: 'ok', text: '已安装 Tailscale' };
  const later: CheckLine = { status: 'later', text: '它运行后，其余项会再检查。' };
  switch (checks.state) {
    case 'cli_missing':
      // ENOENT: no command on PATH and (on a Mac) no /Applications/Tailscale.app whose own CLI stands in for it.
      return [
        {
          status: 'fail',
          text: '找不到 tailscale 命令。',
          fix: '使用 Tailscale 应用时，请开启其命令行工具（Tailscale → Settings → Install CLI）；否则从 https://tailscale.com/download 安装 Tailscale，并用 tailscale up 登录。然后再次检查。',
        },
      ];
    case 'no_answer':
      return [{ status: 'warn', text: 'Tailscale 未及时响应。', fix: '请稍后再检查。' }];
    case 'stopped':
      return [installed, { status: 'fail', text: '这台计算机上的 Tailscale 没有运行。', fix: '打开 Tailscale，然后再次检查。' }, later];
    case 'signed_out':
      return [installed, { status: 'fail', text: '这台计算机上的 Tailscale 已退出登录。', fix: '打开 Tailscale 并登录，然后再次检查。' }, later];
    case 'needs_approval':
      return [installed, { status: 'fail', text: '这台计算机正在你的 tailnet 上等待批准。', fix: '在 Tailscale 管理控制台中批准它，然后再次检查。' }, later];
    case 'starting':
      return [installed, { status: 'warn', text: 'Tailscale 正在启动。', fix: '请稍后再检查。' }];
    case 'unknown':
      return [{ status: 'warn', text: '无法判断 Tailscale 的状态。', fix: checks.error ? `Tailscale 表示：${checks.error}` : '请稍后再检查。' }];
    case 'running': {
      const lines: CheckLine[] = [{ status: 'ok', text: checks.login ? `Tailscale 正在运行，已登录为 ${checks.login}` : 'Tailscale 正在运行' }];
      if (checks.https_certs === true) lines.push({ status: 'ok', text: '你的 tailnet 已开启 HTTPS 证书' });
      else if (checks.https_certs === false)
        lines.push({
          status: 'fail',
          text: '你的 tailnet 未开启 HTTPS 证书。',
          fix: '在 Tailscale 管理控制台（DNS）中开启 HTTPS Certificates，然后再次检查。',
        });
      if (checks.port_free === true) lines.push({ status: 'ok', text: `端口 ${checks.https_port ?? 8443} 可供收件箱使用` });
      else if (checks.port_free === false && checks.https_port != null)
        lines.push({
          status: 'fail',
          text: `另一个 tailscale serve 映射正在使用端口 ${checks.https_port}，而你的手机通过它访问此收件箱。`,
          fix: '如果没有其他程序需要该端口，请释放它（"tailscale serve status" 会列出）；或者关闭再开启 Tailscale 以获取新端口；之后你的手机需要重新配对。',
        });
      else if (checks.port_free === false)
        lines.push({
          status: 'fail',
          text: '其他 tailscale serve 映射占用了收件箱可用的所有端口（8443 到 8450）。',
          fix: '如果没有其他程序需要，请释放其中一个（"tailscale serve status" 会列出）。',
        });
      return lines;
    }
  }
}

export function hasFailure(lines: readonly CheckLine[]): boolean {
  return lines.some((line) => line.status === 'fail');
}

/** What the phone needs for the Wi-Fi way: what this computer cannot check. */
export function wifiPhoneNeeds(network: string | null): string[] {
  return [
    `连接到同一个 Wi-Fi${network ? `“${network}”` : '（与这台计算机相同）'}。访客网络通常会把设备隔开。`,
    '当 Plannotator 请求“本地网络”权限时，请选择允许（之后可在 iPhone 设置 → 隐私与安全性 → 本地网络 中查看）。',
  ];
}

/** What the phone needs for the Tailscale way. */
export function tailscalePhoneNeeds(login: string | null): string[] {
  return [`Tailscale 应用已登录到同一个 tailnet${login ? `（${login}）` : ''}并已开启。`];
}

/** The line beside Continue: what happens next, or what is missing. */
export function continueHint(on: { wifi: boolean; tailscale: boolean }, network: string | null): string {
  if (!on.wifi && !on.tailscale) return '请开启至少一种连接方式以继续。';
  const wifi = network ? `通过“${network}”` : '通过此 Wi-Fi';
  if (on.wifi && on.tailscale) return `你的手机可以${wifi}访问这台计算机，也可以在任何地方通过 Tailscale 访问。`;
  if (on.wifi) return `你的手机可以${wifi}访问这台计算机。`;
  return '你的手机可以在家里或外出时通过 Tailscale 访问这台计算机。';
}

const VIA: Record<PairingAttempt['via'], string> = { wifi: '通过 Wi-Fi', tailnet: '通过 Tailscale', local: '通过这台计算机自己的地址' };

/**
 * What the computer saw while the code showed, newest first, as notes: a
 * phone that came and failed says what to do. A pairing is not a note
 * (step 3 says it).
 */
export interface AttemptNote {
  key: string;
  kind: PairingAttempt['result'];
  via: PairingAttempt['via'];
  /** `wrong_code`: tries left on the code. */
  triesLeft?: number;
  title: string;
  text: string;
}

export function attemptNotes(attempts: readonly PairingAttempt[]): AttemptNote[] {
  const notes: AttemptNote[] = [];
  const seen = new Set<string>();
  for (const attempt of [...attempts].reverse()) {
    if (attempt.result === 'redeemed' || seen.has(attempt.result)) continue;
    seen.add(attempt.result);
    const key = `${attempt.result}-${attempt.at}`;
    if (attempt.result === 'wrong_code') {
      const left = attempt.tries_left ?? 0;
      notes.push({
        key,
        kind: attempt.result, via: attempt.via,
        triesLeft: left,
        title: `一台手机${VIA[attempt.via]}连接到了这台计算机，但六位数字不匹配。`,
        text: left > 0 ? `还剩 ${left} 次尝试。请核对数字，或改为扫描代码。` : '五次输错后，代码已关闭。请生成新代码。',
      });
    } else if (attempt.result === 'code_over_wifi') {
      notes.push({ key, kind: attempt.result, via: attempt.via, title: '一台手机通过 Wi-Fi 连接到了这台计算机，并输入了代码。', text: '通过 Wi-Fi 时只能通过扫描配对。请改为扫描代码。' });
    } else if (attempt.result === 'old_code') {
      notes.push({ key, kind: attempt.result, via: attempt.via, title: `一台手机用旧代码${VIA[attempt.via]}连接到了这台计算机。`, text: '请扫描当前屏幕上的代码。' });
    } else if (attempt.result === 'expired') {
      notes.push({ key, kind: attempt.result, via: attempt.via, title: `一台手机在代码关闭后${VIA[attempt.via]}连接到了这台计算机。`, text: '请生成新代码并扫描。' });
    }
  }
  return notes;
}

/** How the phone reached the computer, for step 3, from the pairing's own attempt. */
export function pairedVia(attempts: readonly PairingAttempt[]): PairingAttempt['via'] | null {
  return [...attempts].reverse().find((a) => a.result === 'redeemed')?.via ?? null;
}

/** The numbered list when the code expired and no phone reached this computer, for the ways that were on. */
export function troubleshooting(
  on: { wifi: boolean; tailscale: boolean },
  network: string | null,
  login: string | null,
): { key: string; title: string; text: string }[] {
  const items: { key: string; title: string; text: string }[] = [];
  if (on.wifi) {
    items.push({
      key: 'wifi',
      title: '在同一个 Wi-Fi 吗？',
      text: `请确认手机连接的是${network ? `“${network}”` : '与这台计算机相同的 Wi-Fi'}，而不是移动数据或访客网络。访客网络和办公网络通常会把设备隔开。`,
    });
    items.push({ key: 'local', title: '允许了本地网络吗？', text: '在 iPhone 上：设置 → 隐私与安全性 → 本地网络 → 打开 Plannotator。' });
    items.push({ key: 'vpn', title: '手机上开了 VPN 吗？', text: '某些 VPN 会隐藏本地网络。请暂时关闭，或改用 Tailscale。' });
  }
  if (on.tailscale) {
    items.push({
      key: 'tailscale',
      title: '手机上的 Tailscale 开启了吗？',
      text: `请在手机上打开 Tailscale，确认已连接${login ? `并以 ${login} 登录` : '且登录到同一个 tailnet'}。`,
    });
  }
  items.push({ key: 'app', title: '是在 Plannotator 中扫描的吗？', text: '请使用 Plannotator 应用扫描，而不是相机应用。' });
  return items;
}
