/**
 * 交互卡片的渲染层（owner 2026-11-27）：` ```html card ` 围栏 → 骨架屏 → 沙箱 iframe。
 *
 * - 流式途中（卡片还没收尾）：先画骨架屏，标题来自卡片首行的 `<!-- card: … -->`。
 * - 收尾后：校验（空/超限/外链/缺根标记）→ 通过就放进 sandbox="allow-scripts"（不给
 *   allow-same-origin）的 iframe，配 CSP：卡片拿不到父页面，也不能发网络请求。
 * - 卡片 → 页面：只认该 iframe 发来的两种消息——`plannotator:resize`（改高度）与
 *   `plannotator:send`（把点击结果作为一条对话消息发回管家）。卡片不直接执行任何动作，
 *   建卡/开工仍走审批。
 * - 校验不过或渲染失败：降级成代码块 + 原因，正文其余部分不受影响。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { chatMarkdownHtml } from '@plannotator/ui/components/chat';
import { cardSendText, parseButlerCards, cardProblem, cardWarnings, cardHeightOf, type ButlerCardMeta } from './butler-card-protocol';
import { BUTLER_CARD_UTILITIES } from './butler-card-utilities';

/** 一条助手回复：文字段按 markdown 画，卡片段交给 ButlerCard。 */
export function ButlerRichText({ text, streaming, onCardMessage }: { text: string; streaming: boolean; onCardMessage: (message: string) => void }) {
  const segments = useMemo(() => parseButlerCards(text), [text]);
  return (
    <>
      {segments.map((segment, index) =>
        segment.kind === 'text' ? (
          streaming ? (
            <span key={index}>{segment.text}</span>
          ) : (
            <div key={index} className="ib-butler-md" dangerouslySetInnerHTML={{ __html: chatMarkdownHtml(segment.text) }} />
          )
        ) : (
          <ButlerCard key={index} html={segment.html} meta={segment.meta} closed={segment.closed} onMessage={onCardMessage} />
        ),
      )}
    </>
  );
}

/** 页面主题 → 卡片能用的 CSS 变量（深浅色都跟随）。 */
function themeVars(): string {
  const names = ['--foreground', '--background', '--card', '--border', '--primary', '--primary-foreground', '--muted', '--muted-foreground', '--destructive', '--font-mono', '--font-sans'];
  const style = typeof window === 'undefined' ? null : getComputedStyle(document.documentElement);
  return names
    .map((name) => {
      const value = style?.getPropertyValue(name).trim();
      return value ? `${name}: ${value};` : '';
    })
    .filter(Boolean)
    .join(' ');
}

function clampHeight(value: number): number {
  return Math.min(900, Math.max(160, Math.round(value)));
}

function frameDoc(html: string, meta: ButlerCardMeta): string {
  const title = meta.title ?? '管家卡片';
  return `<!doctype html><html lang="zh"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:;">
<title>${title.replace(/[<>&]/g, '')}</title>
<style>
  :root { ${themeVars()} }
  ${BUTLER_CARD_UTILITIES}
  html, body { margin: 0; padding: 0; background: transparent; color: var(--foreground); font-family: var(--font-sans, system-ui, sans-serif); font-size: 14px; line-height: 1.6; }
  *, *::before, *::after { box-sizing: border-box; }
  ::selection { background: color-mix(in oklch, var(--primary) 30%, transparent); }
</style>
<script>
  (function () {
    var post = function (payload) { try { parent.postMessage(payload, '*'); } catch (e) {} };
    window.plannotator = {
      resize: function (height) { if (typeof height === 'number' && isFinite(height)) post({ type: 'plannotator:resize', height: height }); },
      // 卡片把点击结果交回对话：字符串就是一句话，对象带 label 更清楚。
      send: function (value) { post({ type: 'plannotator:send', value: value }); }
    };
    // 收尾后按内容报一次高度（卡片自己调 resize 可覆盖）。
    window.addEventListener('load', function () {
      var h = Math.ceil(document.documentElement.scrollHeight);
      if (h > 0) post({ type: 'plannotator:resize', height: h });
    });
  })();
</script>
</head><body>${html}</body></html>`;
}

function ButlerCard({ html, meta, closed, onMessage }: { html: string; meta: ButlerCardMeta; closed: boolean; onMessage: (message: string) => void }) {
  const [height, setHeight] = useState(() => cardHeightOf(meta));
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const problem = closed ? cardProblem(html) : null;
  const doc = useMemo(() => (closed && !problem ? frameDoc(html, meta) : ''), [closed, problem, html, meta]);

  useEffect(() => {
    if (!closed || problem) return;
    const onFrameMessage = (event: MessageEvent) => {
      if (!frameRef.current || event.source !== frameRef.current.contentWindow) return;
      const data = event.data as { type?: unknown; height?: unknown; value?: unknown } | null;
      if (!data || typeof data !== 'object') return;
      if (data.type === 'plannotator:resize' && typeof data.height === 'number' && Number.isFinite(data.height)) {
        setHeight(clampHeight(data.height));
        // 让对话列表知道自己变高了：贴着底部时跟着滚（M2）。
        window.dispatchEvent(new Event('butler:card-resize'));
        return;
      }
      if (data.type === 'plannotator:send') {
        const text = cardSendText(data.value);
        if (text) onMessage(`（来自卡片：${text}）`);
      }
    };
    window.addEventListener('message', onFrameMessage);
    return () => window.removeEventListener('message', onFrameMessage);
  }, [closed, problem, onMessage]);

  // 还没收尾：骨架屏（标题先占位，正文方块呼吸）。
  if (!closed) {
    return (
      <div className="ib-butler-card ib-butler-card-skel" aria-label={meta.title ? `正在绘制：${meta.title}` : '正在绘制卡片'} aria-busy="true">
        <div className="ib-butler-card-skel-head">
          <span className="ib-butler-card-skel-title">{meta.title ?? '正在绘制…'}</span>
          <i className="ib-spin" aria-hidden="true" />
        </div>
        <div className="ib-butler-card-skel-body">
          <span />
          <span />
          <span />
        </div>
      </div>
    );
  }

  if (problem) {
    return (
      <div className="ib-butler-card ib-butler-card-broken">
        <div className="ib-butler-card-broken-head">这张卡没能渲染：{problem}</div>
        <pre className="ib-butler-card-broken-raw">{html.slice(0, 600)}</pre>
      </div>
    );
  }

  const warnings = cardWarnings(html);
  return (
    <>
      {warnings.length > 0 && (
        <div className="ib-butler-card-warn" role="note">
          {warnings.map((warning) => (
            <span key={warning}>{warning}</span>
          ))}
        </div>
      )}
      <iframe
        ref={frameRef}
        className="ib-butler-card ib-butler-card-frame"
        title={meta.title ?? '管家卡片'}
        sandbox="allow-scripts"
        srcDoc={doc}
        style={{ height }}
      />
    </>
  );
}
