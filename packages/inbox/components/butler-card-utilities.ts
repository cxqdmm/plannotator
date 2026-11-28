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
  '.text-3xl{font-size:24px}',
  '.text-4xl{font-size:28px}',
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
  '.rounded-2xl{border-radius:16px}',
  '.rounded-3xl{border-radius:20px}',
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
  '.h-11{height:44px}',
  '.gradient-primary{background:linear-gradient(135deg, var(--primary), color-mix(in oklch, var(--primary) 68%, white));color:var(--primary-foreground)}',
  '.gradient-text{background:linear-gradient(135deg, var(--primary), color-mix(in oklch, var(--primary) 55%, #ff8a65));-webkit-background-clip:text;background-clip:text;color:transparent}',
].join('');

/** 沙箱内联的整套工具类（一次性；模型看不到它，也不为它付 token）。 */

/* ── dt 设计系统（owner 2026-11-27 提供）：颜色/字号/间距/圆角/阴影 的工具类 ── */
const DT_SPACE: readonly [string, number][] = [
  ['1', 4], ['2', 8], ['3', 12], ['4', 16], ['5', 20], ['6', 24],
  ['7', 28], ['8', 32], ['10', 40], ['12', 48],
];

function dtSpacing(name: string, props: readonly string[]): string {
  return DT_SPACE.map(([key, px]) => `.${name}${key}{${props.map((prop) => `${prop}:${px}px`).join(';')}}`).join('');
}

const DT_UTILITIES = [
  // 背景
  '.bg-dt-bg-page{background:var(--dt-color-bg-page)}',
  '.bg-dt-bg-card{background:var(--dt-color-bg-card)}',
  '.bg-dt-bg-elevated{background:var(--dt-color-bg-elevated)}',
  '.bg-dt-bg-subtle{background:var(--dt-color-bg-subtle)}',
  // 文字
  '.text-dt-text-primary{color:var(--dt-color-text-primary)}',
  '.text-dt-text-secondary{color:var(--dt-color-text-secondary)}',
  '.text-dt-text-tertiary{color:var(--dt-color-text-tertiary)}',
  '.text-dt-text-placeholder{color:var(--dt-color-text-placeholder)}',
  '.text-dt-text-onPrimary{color:var(--dt-color-text-on-primary)}',
  '.text-dt-brand-primary{color:var(--dt-color-brand-primary)}',
  '.text-dt-success-base{color:var(--dt-color-success-base)}',
  '.text-dt-warning-base{color:var(--dt-color-warning-base)}',
  '.text-dt-danger-base{color:var(--dt-color-danger-base)}',
  '.text-dt-info-base{color:var(--dt-color-info-base)}',
  '.text-dt-icon-primary{color:var(--dt-color-icon-primary)}',
  '.text-dt-icon-secondary{color:var(--dt-color-icon-secondary)}',
  // 品牌底
  '.bg-dt-brand-primary{background:var(--dt-color-brand-primary)}',
  '.hover\\:bg-dt-brand-primaryHover:hover{background:var(--dt-color-brand-primary-hover)}',
  '.bg-dt-brand-primarySubtle{background:var(--dt-color-brand-primary-subtle)}',
  '.bg-dt-success-subtle{background:var(--dt-color-success-subtle)}',
  '.bg-dt-warning-subtle{background:var(--dt-color-warning-subtle)}',
  '.bg-dt-danger-subtle{background:var(--dt-color-danger-subtle)}',
  '.bg-dt-info-subtle{background:var(--dt-color-info-subtle)}',
  // 边框
  '.border-dt-border-default{border-color:var(--dt-color-border-default)}',
  '.border-dt-border-subtle{border-color:var(--dt-color-border-subtle)}',
  // 字号（dt 阶梯）
  '.text-dt-h1{font-size:var(--dt-font-h1);line-height:var(--dt-line-h-h1)}',
  '.text-dt-h2{font-size:var(--dt-font-h2);line-height:var(--dt-line-h-h2)}',
  '.text-dt-h3{font-size:var(--dt-font-h3);line-height:var(--dt-line-h-h3)}',
  '.text-dt-body-lg{font-size:var(--dt-font-body-lg);line-height:var(--dt-line-h-body-lg)}',
  '.text-dt-body{font-size:var(--dt-font-body);line-height:var(--dt-line-h-body)}',
  '.text-dt-body-sm{font-size:var(--dt-font-body-sm);line-height:var(--dt-line-h-body-sm)}',
  '.text-dt-caption{font-size:var(--dt-font-caption);line-height:var(--dt-line-h-caption);letter-spacing:0.01em}',
  // 间距（4..48，与通用 1..6 对齐之外多出的档位）
  dtSpacing('p-dt-', ['padding']),
  dtSpacing('px-dt-', ['padding-left', 'padding-right']),
  dtSpacing('py-dt-', ['padding-top', 'padding-bottom']),
  dtSpacing('pt-dt-', ['padding-top']),
  dtSpacing('pb-dt-', ['padding-bottom']),
  dtSpacing('m-dt-', ['margin']),
  dtSpacing('mt-dt-', ['margin-top']),
  dtSpacing('mb-dt-', ['margin-bottom']),
  dtSpacing('gap-dt-', ['gap']),
  // 圆角
  '.rounded-dt-xs{border-radius:4px}',
  '.rounded-dt-sm{border-radius:8px}',
  '.rounded-dt-md{border-radius:12px}',
  '.rounded-dt-lg{border-radius:16px}',
  '.rounded-dt-xl{border-radius:24px}',
  // 阴影
  '.shadow-dt-subtle{box-shadow:var(--dt-shadow-subtle)}',
  '.shadow-dt-raised{box-shadow:var(--dt-shadow-raised)}',
  '.shadow-dt-floating{box-shadow:var(--dt-shadow-floating)}',
  // 字族
  '.font-inter{font-family:"Inter",system-ui,-apple-system,"BlinkMacSystemFont",sans-serif}',
  /* 呼吸感覆盖（在基础词表之后，覆盖同名的紧档位）：区块间 16-20px，微间隙下限 6px */
  '.gap-1{gap:6px}',
  '.gap-3{gap:16px}',
  '.gap-4{gap:20px}',
  '.gap-dt-3{gap:16px}',
  '.gap-dt-4{gap:20px}',
  '.gap-dt-5{gap:24px}',
].join('');

/* ── 卡片部件（owner 2026-11-28 定案「B 柔」）──
   模型不再自己拼间距/字阶/颜色：只从这组部件里选，拼成一张卡。
   层次靠"极淡底块 + 排版"，不靠边框、阴影、彩色胶囊。
   颜色全部落到 --c-*（由 frameDoc 定义，跟随 dt 主题）。 */
const CARD_PARTS = [
  // 卡头：kicker → title → lede（整体一个单位，内部 9px）
  '.card-head{display:flex;flex-direction:column;gap:9px;margin:0}',
  '.kicker{margin:0;font-size:11px;font-weight:600;letter-spacing:.1em;color:var(--c-faint)}',
  '.title{margin:0;font-size:21px;font-weight:600;line-height:1.45;letter-spacing:-.012em;color:var(--c-ink);text-wrap:balance}',
  '.lede{margin:0;font-size:13.5px;line-height:1.85;color:var(--c-sub)}',
  // 极淡底块：装一条材料 / 一个条目的细节
  '.well{margin:0;padding:15px 17px;border-radius:14px;background:var(--c-wash)}',
  '.well-head{display:flex;align-items:baseline;gap:10px}',
  '.well-title{font-size:13.5px;font-weight:550;color:var(--c-ink);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.well-sub{margin:4px 0 0;font-size:12px;line-height:1.7;color:var(--c-faint)}',
  '.well-act{margin-left:auto;flex:none;border:0;background:none;padding:0;font:inherit;font-size:12px;color:var(--c-faint);cursor:pointer;transition:color 140ms ease}',
  '.well-act:hover{color:var(--c-ink)}',
  // 进度：4px 细轨 + 主色填充（宽度用 style="width:62%"）
  '.track{height:4px;border-radius:999px;background:#EFF0F2;overflow:hidden}',
  '.track>i{display:block;height:100%;border-radius:999px;background:var(--c-accent)}',
  // 细行：左右两端（左说明、右数值/时间）
  '.meta{display:flex;justify-content:space-between;gap:10px;font-size:12px;color:var(--c-faint);font-variant-numeric:tabular-nums}',
  '.tl{display:flex;align-items:baseline;gap:12px;font-size:13px;color:var(--c-sub)}',
  '.tl time{margin-left:auto;flex:none;font-size:11.5px;color:var(--c-faint);font-variant-numeric:tabular-nums}',
  // 单项状态（琥珀点 + 文字；全卡最多一处）
  '.status{display:inline-flex;align-items:center;font-size:12.5px;color:var(--c-sub)}',
  '.status .dot{flex:none;display:inline-block;width:5px;height:5px;border-radius:50%;background:var(--c-wait);margin-right:7px}',
  // 可选项（单选一行；选中态由 aria-checked 驱动）
  '.opt{display:flex;align-items:flex-start;gap:12px;width:100%;padding:15px 17px;border:0;border-radius:14px;background:var(--c-wash);font:inherit;text-align:left;cursor:pointer;transition:background 140ms ease}',
  '.opt:hover{background:#F1F2F4}',
  '.opt[aria-checked="true"]{background:color-mix(in oklab,var(--c-accent) 6%,var(--c-wash))}',
  '.opt-radio{flex:none;width:15px;height:15px;margin-top:2px;border-radius:50%;border:1.5px solid #D5D8DC;display:grid;place-items:center;transition:border-color 140ms ease}',
  '.opt[aria-checked="true"] .opt-radio{border-color:var(--c-accent)}',
  '.opt[aria-checked="true"] .opt-radio::after{content:"";width:7px;height:7px;border-radius:50%;background:var(--c-accent)}',
  '.opt-text{min-width:0;flex:1}',
  '.opt-text b{display:block;font-size:14px;font-weight:500;color:var(--c-ink)}',
  '.opt-text span{display:block;margin-top:3px;font-size:12.5px;line-height:1.7;color:var(--c-faint)}',
  // 按钮：一个主按钮（实心）+ 可选一个次要（纯文字）
  '.card-actions{display:flex;flex-direction:column;gap:2px;margin:0}',
  '.btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;width:100%;height:44px;padding:0 16px;border:0;border-radius:12px;background:none;color:var(--c-sub);font:inherit;font-size:13.5px;font-weight:500;cursor:pointer;transition:color 140ms ease,background 140ms ease,filter 140ms ease}',
  '.btn:hover{color:var(--c-ink);background:color-mix(in oklab,var(--c-ink) 4%,transparent)}',
  '.btn-primary{background:var(--c-accent);color:#fff;font-weight:600}',
  '.btn-primary:hover{filter:brightness(1.06);background:var(--c-accent)}',
  '.btn:disabled,.btn-disabled{opacity:.45;cursor:not-allowed}',
].join('');

export const BUTLER_CARD_UTILITIES = `${UTILITIES}
${DT_UTILITIES}
${CARD_PARTS}
[data-card]{display:block;width:100%;max-width:750px;margin:0 auto;background:transparent;color:var(--dt-color-text-primary);font-family:"Inter",system-ui,-apple-system,"BlinkMacSystemFont",sans-serif}
button{font-family:inherit}
a{color:var(--dt-color-brand-primary)}
`;
