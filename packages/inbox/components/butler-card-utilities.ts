/**
 * 卡片沙箱内置的工具类（owner 2026-11-27「坚决不要自己写 class，全部用工具类」）。
 *
 * 卡片不能联网，所以不是引 CDN，而是把一套 Tailwind 兼容的子集直接内联进 iframe：
 * 模型只写 class="flex flex-col gap-3 p-4 rounded-xl" 这样的工具类，不写自定义 class、
 * 不写 <style>。颜色一律映射到页面主题变量，深浅色跟随。
 *
 * 这张表是**唯一**的样式词表：加词只加在这里（并同步 skill 的说明），卡片里不许另写。
 */

const SPACE = [4, 8, 12, 16, 20, 24]; // 1..6

function spacing(name: string, props: readonly string[]): string {
  return SPACE.map((px, index) => `.${name}-${index + 1}{${props.map((prop) => `${prop}:${px}px`).join(';')}}`).join('');
}

const UTILITIES = [
  // 布局
  '.block{display:block}',
  '.flex{display:flex}',
  '.flex-col{flex-direction:column}',
  '.flex-row{flex-direction:row}',
  '.flex-wrap{flex-wrap:wrap}',
  '.flex-1{flex:1 1 0%}',
  '.items-center{align-items:center}',
  '.items-start{align-items:flex-start}',
  '.justify-between{justify-content:space-between}',
  '.justify-center{justify-content:center}',
  '.justify-end{justify-content:flex-end}',
  '.grid{display:grid}',
  '.grid-cols-2{grid-template-columns:repeat(2,minmax(0,1fr))}',
  '.grid-cols-3{grid-template-columns:repeat(3,minmax(0,1fr))}',
  '.w-full{width:100%}',
  '.w-1\/2{width:50%}',
  '.w-2\/3{width:66.6667%}',
  '.w-3\/4{width:75%}',
  '.h-full{height:100%}',
  spacing('h', ['height']),
  '.min-w-0{min-width:0}',
  '.overflow-hidden{overflow:hidden}',
  '.relative{position:relative}',
  '.absolute{position:absolute}',
  // 间距（1..6 = 4..24px）
  spacing('p', ['padding']),
  spacing('px', ['padding-left', 'padding-right']),
  spacing('py', ['padding-top', 'padding-bottom']),
  spacing('pt', ['padding-top']),
  spacing('pb', ['padding-bottom']),
  spacing('m', ['margin']),
  spacing('mt', ['margin-top']),
  spacing('mb', ['margin-bottom']),
  spacing('ml', ['margin-left']),
  spacing('mr', ['margin-right']),
  spacing('gap', ['gap']),
  '.ml-auto{margin-left:auto}',
  '.mx-auto{margin-left:auto;margin-right:auto}',
  // 字
  '.text-xs{font-size:12px}',
  '.text-sm{font-size:13px}',
  '.text-base{font-size:14px}',
  '.text-lg{font-size:16px}',
  '.text-xl{font-size:18px}',
  '.text-2xl{font-size:20px}',
  '.font-medium{font-weight:500}',
  '.font-semibold{font-weight:600}',
  '.font-bold{font-weight:700}',
  '.leading-relaxed{line-height:1.65}',
  '.text-center{text-align:center}',
  '.truncate{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  // 颜色（主题变量）
  '.text-foreground{color:var(--foreground)}',
  '.text-muted{color:var(--muted-foreground)}',
  '.text-primary{color:var(--primary)}',
  '.text-primary-fg{color:var(--primary-foreground)}',
  '.bg-background{background:var(--background)}',
  '.bg-card{background:var(--card)}',
  '.bg-muted{background:var(--muted)}',
  '.bg-primary{background:var(--primary)}',
  '.border-border{border-color:var(--border)}',
  // 边框 / 圆角 / 阴影
  '.border{border:1px solid var(--border)}',
  '.border-t{border-top:1px solid var(--border)}',
  '.border-0{border:0}',
  '.border-dashed{border-style:dashed}',
  '.rounded-lg{border-radius:10px}',
  '.rounded-xl{border-radius:14px}',
  '.rounded-2xl{border-radius:18px}',
  '.rounded-full{border-radius:999px}',
  '.shadow-sm{box-shadow:0 1px 2px rgba(0,0,0,0.05),0 12px 28px -24px rgba(0,0,0,0.35)}',
  // 交互
  '.cursor-pointer{cursor:pointer}',
  '.transition{transition:background 150ms ease,border-color 150ms ease,color 150ms ease,opacity 150ms ease,transform 150ms ease}',
  '.hover\\:bg-muted:hover{background:var(--muted)}',
  '.hover\\:opacity-90:hover{opacity:0.9}',
  '.hover\\:underline:hover{text-decoration:underline}',
  '.opacity-70{opacity:0.7}',
  // 按钮：阿里的 C 端卡片——主按钮实心、次按钮描边，圆角 10、高度 36
  '.btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:36px;padding:0 16px;border-radius:10px;border:1px solid var(--border);background:var(--card);color:var(--foreground);font:inherit;font-size:13.5px;font-weight:500;cursor:pointer;transition:background 150ms ease,border-color 150ms ease,opacity 150ms ease}',
  '.btn:hover{opacity:0.9}',
  '.btn-primary{border-color:var(--primary);background:var(--primary);color:var(--primary-foreground)}',
  '.btn-disabled{opacity:0.45;cursor:not-allowed}',
  '.chip{display:inline-flex;align-items:center;gap:4px;border-radius:999px;padding:2px 9px;font-size:12px;background:var(--muted);color:var(--muted-foreground)}',
].join('');

/** 沙箱内联的整套工具类（一次性；模型看不到它，也不为它付 token）。 */
export const BUTLER_CARD_UTILITIES = `${UTILITIES}
[data-card]{display:block;color:var(--foreground)}
button{font-family:inherit}
a{color:var(--primary)}
`;
