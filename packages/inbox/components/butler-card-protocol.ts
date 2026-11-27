/**
 * 管家的交互卡片协议（owner 2026-11-27「管家要能生成可交互的界面」）：
 *
 *   ```html card
 *   <!-- card: {"title":"…","height":320} -->
 *   <div data-card> … </div>
 *   ```
 *
 * 只有信息串恰好是 `html card` 的围栏才是卡片——普通的 ```html 是代码示例，原样交给 markdown。
 * 围栏还没收尾（流式途中）也要认出来：前端先画骨架屏，收尾后再渲染。这里只做纯解析与校验，
 * 不碰 DOM。
 */

export interface ButlerCardMeta {
  title?: string;
  /** 初始高度（px，夹在 160–900 之间）。 */
  height?: number;
}

export type ButlerSegment =
  | { kind: 'text'; text: string }
  | { kind: 'card'; html: string; meta: ButlerCardMeta; closed: boolean };

/** 卡片 HTML 的上限（字节）：超过就降级成代码块，不渲染。 */
export const BUTLER_CARD_MAX_BYTES = 200 * 1024;
const HEIGHT_MIN = 160;
const HEIGHT_MAX = 900;

const META = /^<!--\s*card:\s*(\{[\s\S]*?\})\s*-->\s*$/i;

/** 一张卡片的首行元信息：标题给骨架屏用，高度给初始布局。坏 JSON 直接忽略。 */
export function cardMetaOf(html: string): ButlerCardMeta {
  const first = html.split('\n').find((line) => line.trim() !== '');
  if (!first) return {};
  const match = META.exec(first.trim());
  if (!match) return {};
  try {
    const value = JSON.parse(match[1]!) as Record<string, unknown>;
    const meta: ButlerCardMeta = {};
    if (typeof value.title === 'string' && value.title.trim()) meta.title = value.title.trim().slice(0, 80);
    if (typeof value.height === 'number' && Number.isFinite(value.height)) {
      meta.height = Math.min(HEIGHT_MAX, Math.max(HEIGHT_MIN, Math.round(value.height)));
    }
    return meta;
  } catch {
    return {};
  }
}

/**
 * 把一条回复切成「文字」与「卡片」两类段。未收尾的卡片以 closed=false 返回（画骨架）。
 *
 * 容错（现场 2026-11-27）：模型常把开标记写在句子末尾、结束标记挤在内容行尾——
 * `…全在这一张里：```html card … </div> ``` 后面接着说话`。围栏不必须独占一行：
 * 开标记可以在任何位置，结束标记是开标记之后的第一个三反引号。HTML 正文里因此不能再出现
 * 三反引号（卡片模板里也不会有）。
 */
export function parseButlerCards(text: string): ButlerSegment[] {
  const segments: ButlerSegment[] = [];
  let rest = text;
  for (;;) {
    const open = /```[ 	]*html[ 	]+card\b/i.exec(rest);
    if (!open) break;
    const before = rest.slice(0, open.index);
    if (before.trim() !== '') segments.push({ kind: 'text', text: before });
    const afterOpen = open.index + open[0].length;
    const close = rest.indexOf('```', afterOpen);
    if (close === -1) {
      const html = rest.slice(afterOpen).trim();
      segments.push({ kind: 'card', html, meta: cardMetaOf(html), closed: false });
      rest = '';
      break;
    }
    const html = rest.slice(afterOpen, close).trim();
    segments.push({ kind: 'card', html, meta: cardMetaOf(html), closed: true });
    rest = rest.slice(close + 3);
  }
  if (rest !== '' && (rest.trim() !== '' || segments.length === 0)) segments.push({ kind: 'text', text: rest });
  return segments;
}

/**
 * 渲染前的校验：没通过就降级成代码块，且明说原因。
 * 只挡确定会出事的东西（空卡、超限、外链、没有根标记），不追求把 HTML 洗干净——
 * 真正的隔离在 iframe 沙箱与 CSP。
 */
export function cardProblem(html: string): string | null {
  if (html.trim() === '') return '卡片是空的。';
  if (new TextEncoder().encode(html).length > BUTLER_CARD_MAX_BYTES) return '卡片太大了（超过 200KB）。';
  if (!/\bdata-card\b/i.test(html)) return '卡片缺少 data-card 根元素。';
  if (/<script\b[^>]*\bsrc\s*=/i.test(html) || /<link\b/i.test(html) || /@import\b/i.test(html)) return '卡片不能引用外部资源（脚本、样式、字体）。';
  return null;
}

/**
 * 渲染时的风格/交互提醒（不拦渲染，只在卡片上方提示一行）：
 * - 多选/多输入却没有确认按钮（owner 2026-11-27「主人点一个就发走了，必须能先选后确认」）；
 * - 用了 <style> 或自定义 class（铁律：只用内置工具类）。
 */
/** 卡片 HTML 的软上限（字节）：超过就提示精简——卡片是一句话的界面，不是整页应用。 */
export const BUTLER_CARD_SOFT_BYTES = 8 * 1024;

/** 卡片回话在对话里的固定前缀（主人点了卡片按钮时由页面加上）。 */
export const CARD_REPLY_PREFIX = '（来自卡片：';

/** 一条用户消息是不是卡片回话：是就返回里面的内容，页面用专门的样式画。 */
/**
 * 卡片 `plannotator.send(value)` 的取值变成对话里的一行。`label` 是标题/摘要，
 * `value` 里的每个字段都必须保留——只发 label 会让主人选好的答案整块丢失
 * （现场 2026-11-27：四选一卡只回「已选定四项」）。
 *
 * 约定形状 `{ label, value: { 字段: 值 } }`：label 作前缀，value 的字段平铺成
 * `key=value；…`；value 是标量时作 `label：value`；没有 label 的对象也照样平铺。
 * 嵌套对象/数组按 JSON / 顿号保留，宁可难读，也不丢字段。
 */
export function cardSendText(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.map(cardFieldText).filter((part) => part !== '').join('、');
  if (typeof value !== 'object') return String(value);
  const record = value as Record<string, unknown>;
  const label = typeof record.label === 'string' ? record.label.trim() : '';
  const entries = Object.entries(record).filter(([key]) => key !== 'label');
  if (entries.length === 0) return label;
  const fields = (input: Record<string, unknown>) => Object.entries(input).map(([key, item]) => `${key}=${cardFieldText(item)}`).join('；');
  // The documented shape: { label, value: { … } } — the answers are value's own fields.
  if (entries.length === 1 && entries[0]![0] === 'value') {
    const only = entries[0]![1];
    const body = only && typeof only === 'object' && !Array.isArray(only) ? fields(only as Record<string, unknown>) : cardFieldText(only);
    return [label, body].filter(Boolean).join(label ? '：' : '');
  }
  const body = entries
    .map(([key, item]) => (key === 'value' && item && typeof item === 'object' && !Array.isArray(item) ? fields(item as Record<string, unknown>) : `${key}=${cardFieldText(item)}`))
    .join('；');
  return [label, body].filter(Boolean).join(label ? '：' : '');
}

/** 一个字段的值：字符串原样，数组用顿号，其余对象用 JSON（字段一个不丢）。 */
function cardFieldText(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(cardFieldText).filter((part) => part !== '').join('、');
  if (value === null || value === undefined) return '';
  return JSON.stringify(value);
}

export function cardReplyOf(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith(CARD_REPLY_PREFIX) || !trimmed.endsWith('）')) return null;
  return trimmed.slice(CARD_REPLY_PREFIX.length, -1).trim() || null;
}

export function cardWarnings(html: string): string[] {
  const warnings: string[] = [];
  const sends = (html.match(/plannotator[.]send[(]/g) ?? []).length;
  const selects = /<input\b|<select\b|<textarea\b|role=["']?(checkbox|radio|switch)/i.test(html);
  if (selects && sends >= 2 && !/\bdata-card-confirm\b/.test(html)) {
    warnings.push('这张卡有多处选择却没有确认按钮：改成「先选好，再点确认」。');
  }
  if (/<style\b/i.test(html)) warnings.push('卡片里用了 <style>：请只用工具类（utility classes）。');
  const bytes = new TextEncoder().encode(html).length;
  if (bytes > BUTLER_CARD_SOFT_BYTES) {
    warnings.push(`卡片偏大（约 ${Math.round(bytes / 1024)}KB）：去掉注释、冗余包裹和重复样式，只留要给人看的。`);
  }
  return warnings;
}

/** 卡片的初始高度（骨架与 iframe 共用）。 */
export function cardHeightOf(meta: ButlerCardMeta): number {
  return meta.height ?? 320;
}
