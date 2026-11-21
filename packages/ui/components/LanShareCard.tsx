import React, { useState } from 'react';
import { copyTextToClipboard } from '../utils/clipboard';

/**
 * 分享到局域网卡片（方案 B）：开一个带令牌的内网入口，同网段同事浏览器直达本会话——
 * 看的是同一个会话，始终最新；对方只读（批注存他自己的浏览器），拍板留在主人手里。
 * 导出弹窗（ExportModal）与代码评审页共用这一张卡，改文案/行为只改这里。
 */
export function LanShareCard({ lanShareUrl, onToggle }: {
  /** 门开着的完整入口地址；null = 门关着。 */
  lanShareUrl: string | null;
  /** 开/关门（会话服务的 /api/lan-share）。 */
  onToggle: (on: boolean) => Promise<string | null> | string | null;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    if (!lanShareUrl) return;
    await copyTextToClipboard(lanShareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="border border-border rounded-lg p-4 bg-muted/40" data-lan-share={lanShareUrl ? 'on' : 'off'}>
      <label className="block text-xs font-medium text-muted-foreground mb-1">
        分享到局域网
      </label>
      <p className="text-[11px] text-muted-foreground mb-3">
        开一个带令牌的内网入口，把链接发给同网段的同事，对方浏览器直接打开本评审——看的是同一个会话，始终最新。
        对方是只读视图：可以自行批注，批注会自动存在链接上；你刷新页面或顶栏「同步批注」即取回。批准/否决仍只有你能做。
      </p>
      {lanShareUrl ? (
        <>
          <div className="flex items-center gap-2 mb-2">
            <input
              readOnly
              value={lanShareUrl}
              className="flex-1 bg-background border border-border rounded-lg px-3 py-2 text-xs font-mono focus:outline-none"
              onClick={e => (e.target as HTMLInputElement).select()}
              data-lan-share-url=""
            />
            <button
              onClick={() => void copy()}
              className="px-3 py-1.5 rounded-lg bg-background border border-border text-xs font-medium hover:bg-muted transition-colors"
            >
              {copied ? '已复制' : '复制链接'}
            </button>
          </div>
          <button
            onClick={() => void onToggle(false)}
            className="px-3 py-1.5 rounded-lg border border-border text-xs font-medium hover:bg-muted transition-colors"
            data-lan-share-stop=""
          >
            关闭共享
          </button>
        </>
      ) : (
        <button
          onClick={() => void onToggle(true)}
          className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:opacity-90 transition-opacity"
          data-lan-share-start=""
        >
          开启共享
        </button>
      )}
    </div>
  );
}
