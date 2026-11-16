import React, { useEffect, useState } from 'react';
import { FAVICON_PNG_DATA_URL } from '@plannotator/core/favicon';
import { copyTextToClipboard } from '../../utils/clipboard';

interface HooksStatus {
  pfmReminder: { enabled: boolean };
  improvementHook: {
    present: boolean;
    filePath: string | null;
    fileSize: number | null;
    content: string | null;
  };
  composedLength: number | null;
}

function displayPath(filePath: string): string {
  const idx = filePath.indexOf('/.plannotator/');
  if (idx >= 0) return '~' + filePath.slice(idx);
  return filePath;
}

const CopyPathButton: React.FC<{ filePath: string }> = ({ filePath }) => {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    void copyTextToClipboard(filePath).then((ok) => {
      if (!ok) return;
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <button
      onClick={copy}
      title="复制路径"
      className="inline-flex items-center gap-1.5 mt-1.5 px-2 py-1 rounded bg-muted/60 hover:bg-muted border border-border/50 transition-colors group max-w-full"
    >
      <code className="text-[10px] text-muted-foreground font-mono truncate">
        {displayPath(filePath)}
      </code>
      <span className="flex-shrink-0 text-muted-foreground/60 group-hover:text-muted-foreground transition-colors">
        {copied ? (
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M13.25 4.75 6 12 2.75 8.75" /></svg>
        ) : (
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="5.5" y="5.5" width="8" height="8" rx="1.5" /><path d="M10.5 5.5V3a1.5 1.5 0 0 0-1.5-1.5H3A1.5 1.5 0 0 0 1.5 3v6A1.5 1.5 0 0 0 3 10.5h2.5" /></svg>
        )}
      </span>
    </button>
  );
};

export const HooksTab: React.FC = () => {
  const [status, setStatus] = useState<HooksStatus | null>(null);
  const [pfmEnabled, setPfmEnabled] = useState(false);
  const [hookExpanded, setHookExpanded] = useState(false);

  useEffect(() => {
    fetch('/api/hooks/status')
      .then(r => r.json())
      .then((data: HooksStatus) => {
        setStatus(data);
        setPfmEnabled(data.pfmReminder.enabled);
      })
      .catch(() => {});
  }, []);

  const togglePfm = async () => {
    const next = !pfmEnabled;
    setPfmEnabled(next);
    await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pfmReminder: next }),
    }).catch(() => setPfmEnabled(!next));
  };

  if (!status) {
    return <div className="text-sm text-muted-foreground py-4">加载 hook 状态…</div>;
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        这些 hook 会在规划 agent 编写计划前向其注入上下文。
      </p>

      {/* PFM Reminder Card */}
      <div className="rounded-lg border border-border bg-card p-4 space-y-3">
        <div className="flex items-start gap-3">
          <img
            src={FAVICON_PNG_DATA_URL}
            alt=""
            className="w-8 h-8 flex-shrink-0 object-contain"
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-foreground">Plannotator Flavored Markdown</h3>
              <button
                onClick={togglePfm}
                className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                  pfmEnabled ? 'bg-primary' : 'bg-muted'
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition-transform ${
                    pfmEnabled ? 'translate-x-4' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
              PFM 受 GitHub Flavored Markdown 启发，并扩展了交互表格、SVG 图表（自定义、Mermaid 和 Graphviz）、可在编辑器中打开的代码文件链接、标注块、任务列表等。此提醒会告诉规划 agent 渲染器支持哪些功能，以便它自然地使用这些特性。<strong>不增加额外 token</strong>——agent 仍像平常一样编写 markdown，只是使用 Plannotator 渲染得更丰富的增强语法。
            </p>
            <div className="mt-2">
              <span className={`inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full ${
                pfmEnabled
                  ? 'bg-primary/15 text-primary'
                  : 'bg-muted text-muted-foreground'
              }`}>
                <span className={`w-1.5 h-1.5 rounded-full ${pfmEnabled ? 'bg-primary' : 'bg-muted-foreground/50'}`} />
                {pfmEnabled ? '已启用' : '已停用'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Compound Improvement Hook Card */}
      <div className="rounded-lg border border-border bg-card p-4 space-y-3">
        <div className="flex items-start gap-3">
          <img
            src={FAVICON_PNG_DATA_URL}
            alt=""
            className="w-8 h-8 flex-shrink-0 object-contain"
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-foreground">改进 hook</h3>
              <span className={`inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full ${
                status.improvementHook.present
                  ? 'bg-primary/15 text-primary'
                  : 'bg-muted text-muted-foreground'
              }`}>
                <span className={`w-1.5 h-1.5 rounded-full ${status.improvementHook.present ? 'bg-primary' : 'bg-muted-foreground/50'}`} />
                {status.improvementHook.present ? '活跃' : '未找到'}
              </span>
            </div>

            {status.improvementHook.present ? (
              <>
                <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                  根据你的计划拒绝历史生成的纠正性规划指令。
                  {status.improvementHook.fileSize != null && (
                    <span className="text-muted-foreground/70"> · {(status.improvementHook.fileSize / 1024).toFixed(1)}KB</span>
                  )}
                </p>
                {status.improvementHook.filePath && (
                  <CopyPathButton filePath={status.improvementHook.filePath} />
                )}
                <p className="text-[11px] text-muted-foreground/70 mt-2 leading-relaxed">
                  直接编辑此文件即可自定义，或运行 <code className="text-[10px] bg-muted px-1 py-0.5 rounded">/plannotator-compound</code> 根据最近的拒绝历史重新生成。
                </p>
                <button
                  onClick={() => setHookExpanded(!hookExpanded)}
                  className="text-xs text-primary hover:text-primary/80 mt-1.5 transition-colors"
                >
                  {hookExpanded ? '▾ 隐藏内容' : '▸ 显示内容'}
                </button>
                {hookExpanded && status.improvementHook.content && (
                  <pre className="mt-2 p-3 rounded-md bg-muted/50 border border-border text-[11px] text-foreground/80 overflow-auto max-h-64 whitespace-pre-wrap font-mono leading-relaxed">
                    {status.improvementHook.content}
                  </pre>
                )}
              </>
            ) : (
              <>
                <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                  未找到改进 hook。此文件会在你的 agent 编写计划前注入纠正性规划指令——你评审得越多，agent 的计划就越好。
                </p>
                {status.improvementHook.filePath && (
                  <CopyPathButton filePath={status.improvementHook.filePath} />
                )}
                <p className="text-[11px] text-muted-foreground/70 mt-2 leading-relaxed">
                  运行 <code className="text-[10px] bg-muted px-1 py-0.5 rounded">/plannotator-compound</code> 根据拒绝历史自动生成，或在上方路径创建一个包含你自己指令的纯文本文件。{' '}
                  <a
                    href="https://plannotator.ai/blog/continuously-improve-claude-code-plans/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:text-primary/80 underline underline-offset-2"
                  >
                    了解更多
                  </a>
                </p>
              </>
            )}
          </div>
        </div>
      </div>

    </div>
  );
};
