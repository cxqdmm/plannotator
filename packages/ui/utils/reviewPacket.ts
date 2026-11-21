/**
 * 评审件（review packet）：把"素材 + 批注工具"装进一个自包含的 .html 文件，
 * 内网里当文件传（IM / 共享盘 / U 盘），对方双击离线打开、批注、交回意见。
 * 零网络、零服务器——这个 fork 的内网分享方案 A 的底座。
 *
 * 结构：导出时把本页自己的单文件 HTML 拿来，在 <head> 开口处注入
 * `<script id="plannotator-review-packet" type="application/json">{…}</script>`；
 * 打开时页面发现 window 里没有分享 hash 但有这个 packet，就走与分享链接
 * 完全相同的水合路径（packages/ui/hooks/useSharing.ts）载入素材与批注。
 *
 * 意见回流：审阅人在评审件里点「交回意见」，当前批注压成与分享链接同款
 * 的 base64 串，存成一个小 .txt；发起人把它（整文件内容或那一行）粘进
 * 现有的「导入」框即可合并——importFromShareUrl 本就按 #hash 解析。
 */

import type { ShareableAnnotation, SharePayload } from './sharing';

export const REVIEW_PACKET_ID = 'plannotator-review-packet';

/** 评审件里携带的内容：SharePayload（素材+批注）+ 一点元信息。 */
export interface ReviewPacket extends SharePayload {
  /** 导出人的标注（如 "cxq"），展示用。 */
  by?: string;
  /** 导出时间（ISO）。 */
  made?: string;
}

/** JSON 里把 `<` 转义，杜绝 `</script>` 提前闭合 script 岛。 */
function packetJson(packet: ReviewPacket): string {
  return JSON.stringify(packet).replace(/</g, '\\u003c');
}

/** 注入 <head> 开口处的 script 岛（type=application/json，不执行，仅携带数据）。 */
export function packetScriptTag(packet: ReviewPacket): string {
  return `<script id="${REVIEW_PACKET_ID}" type="application/json">${packetJson(packet)}</script>`;
}

/**
 * 把评审件数据注入一份完整的单文件页面 HTML。
 * 只替换第一个 <head …>（它之前不可能出现这个字面量），原页一字不动。
 */
export function injectReviewPacket(pageHtml: string, packet: ReviewPacket): string {
  const openHead = /<head[^>]*>/i.exec(pageHtml);
  if (!openHead) throw new Error('This page has no <head> to carry a review packet.');
  const at = openHead.index + openHead[0].length;
  return pageHtml.slice(0, at) + packetScriptTag(packet) + pageHtml.slice(at);
}

/** 从当前文档读出评审件数据；不是评审件（没有岛）返回 null。 */
export function readReviewPacket(): ReviewPacket | null {
  const node = document.getElementById(REVIEW_PACKET_ID);
  if (!node?.textContent) return null;
  try {
    const parsed = JSON.parse(node.textContent) as ReviewPacket;
    return typeof parsed.p === 'string' || (typeof parsed.h === 'string' && parsed.r === 'html') ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * 交回意见的 .txt 内容：机器可读的一行 `#<hash>`（整文件粘进导入框也能解析），
 * 前后包一点人读得懂的说明。
 */
export function verdictText(hash: string, title: string, by?: string): string {
  return [
    'Plannotator 评审意见',
    `评审件：${title || '（未命名）'}${by ? `　导出人：${by}` : ''}`,
    `时间：${new Date().toLocaleString()}`,
    '',
    '—— 把下面一行（或本文件全部内容）粘贴进 Plannotator 的「导入」框，意见即合并进原评审 ——',
    `#${hash}`,
    '',
  ].join('\n');
}

/** 浏览器端下载一个文本文件（评审件 .html / 意见 .txt 共用）。 */
export function downloadTextFile(name: string, content: string, type = 'text/plain;charset=utf-8'): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5_000);
}

/** 文件名安全化：去掉路径分隔与 Windows 保留字符，限长。 */
export function safeFileStem(title: string): string {
  const stem = title.trim().replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').replace(/\s+/g, ' ').slice(0, 60);
  return stem || '评审件';
}
