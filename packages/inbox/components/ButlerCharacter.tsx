/**
 * 管家的活形象（owner 2026-11-27「不要睫毛似的小毛；是“倒八字”长眉，长出面部的那截就是
 * 耳朵」）：一只立在枝头的角鸮——心形面盘带羽边、琥珀色大眼；眉毛是一对长而缓的倒八字眉，
 * 从眉心外侧向上、向外延展，长出面部的那截就是耳簇（不再单独画耳朵），眉身里只有几根长毛丝；
 * 两片贴身折起的翅膀会成对扑腾（平时偶尔扑两下，开心时连续扑），头一直轻轻歪着晃。配色走
 * CSS 变量（--bc-*，inbox.css，深浅色同一套）。34px 侧栏品牌到 192px 首屏同一个，不放细碎装饰；
 * prefers-reduced-motion 一律静止。
 *
 * 形态即状态（owner 2026-11-28「用猫头鹰的形态来描述，别用绿点」）：
 * - idle：睁大眼睛立在枝头——在线；
 * - sleep：趴在枝背上打盹（闭眼、Zzz、胸口起伏）——空闲；
 * - gone：枝头空了，只剩枝叶——会话不可用；
 * - working / happy：扑翅忙碌 / 弯眼笑（临时表情，不表达在线状态）。
 * 树干两端各缀几片叶影，随微风轻颤。
 */
export type ButlerMood = 'idle' | 'working' | 'happy' | 'sleep' | 'gone';

export function ButlerCharacter({ size, mood = 'idle' }: { size: number; mood?: ButlerMood }) {
  const asleep = mood === 'sleep';
  const gone = mood === 'gone';
  const cls = [
    'ib-bc',
    mood === 'working' ? 'ib-bc-working' : '',
    mood === 'happy' ? 'ib-bc-happy' : '',
    asleep ? 'ib-bc-sleep' : '',
    gone ? 'ib-bc-gone' : '',
  ]
    .filter(Boolean)
    .join(' ');
  // 眼睛：sleep 闭目下垂；happy 弯成弧；其余是琥珀虹膜的大眼，会眨（偶尔连眨两下）
  const eyes =
    asleep || mood === 'happy' ? (
      <g
        stroke="var(--bc-ink, #24150f)"
        strokeWidth={asleep ? 1.7 : 2}
        strokeLinecap="round"
        fill="none"
      >
        {asleep ? (
          <>
            {/* 闭目：眼皮向下垂的小弧 */}
            <path d="M22.4 27.4 q4.2 2.8 8.4 0" />
            <path d="M33.2 27.4 q4.2 2.8 8.4 0" />
          </>
        ) : (
          <>
            <path d="M22.2 26.8 q4.4 -4 8.8 0" />
            <path d="M33 26.8 q4.4 -4 8.8 0" />
          </>
        )}
      </g>
    ) : (
      <g className="ib-bc-eyes">
        <circle cx="26.6" cy="27" r="5.5" fill="var(--bc-eye-white, #fff8e8)" />
        <circle cx="37.4" cy="27" r="5.5" fill="var(--bc-eye-white, #fff8e8)" />
        <circle cx="26.6" cy="27" r="4.1" fill="var(--bc-iris, #cf7f24)" />
        <circle cx="37.4" cy="27" r="4.1" fill="var(--bc-iris, #cf7f24)" />
        <circle cx="26.9" cy="27.2" r="2.1" fill="var(--bc-ink, #24150f)" />
        <circle cx="37.1" cy="27.2" r="2.1" fill="var(--bc-ink, #24150f)" />
        <circle cx="25.4" cy="25.6" r="1.25" fill="#fff" />
        <circle cx="35.9" cy="25.6" r="1.25" fill="#fff" />
        <circle cx="27.9" cy="28.8" r="0.6" fill="#fff" opacity="0.85" />
        <circle cx="38.4" cy="28.8" r="0.6" fill="#fff" opacity="0.85" />
      </g>
    );
  // 头（心形面盘、眉、眼、喙）——立姿与睡姿共用，外层摆放不同。
  const head = (
    <g className="ib-bc-head">
      <circle cx="32" cy="27" r="14.3" fill="var(--bc-fur, #b5824f)" />
      {/* 心形面盘 + 一圈羽边（猫头鹰的脸） */}
      <path d="M32 17.8 C36.6 17.8 42.2 20.7 43.8 26.4 C45.6 32.9 40.2 38.5 32 38.5 C23.8 38.5 18.4 32.9 20.2 26.4 C21.8 20.7 27.4 17.8 32 17.8 Z" fill="var(--bc-belly, #e6cfae)" />
      <path d="M32 17.8 C36.6 17.8 42.2 20.7 43.8 26.4 C45.6 32.9 40.2 38.5 32 38.5 C23.8 38.5 18.4 32.9 20.2 26.4 C21.8 20.7 27.4 17.8 32 17.8 Z" fill="none" stroke="var(--bc-fur-shade, #8c5d36)" strokeWidth="0.9" opacity="0.5" />
      {/* 眉毛（owner 2026-11-27：不要睫毛似的小毛；是“倒八字”长眉，长出面部的
          那截就是耳朵）：从眉心外侧向上、向外延展的羽毛带，外端高出面部形成耳簇；
          眉身里只有几根长毛丝，没有短睫毛。会轻轻挑。 */}
      <g className="ib-bc-brow-l" fill="var(--bc-fur-shade, #8c5d36)">
        <path d="M29 20.4 C25.4 16.8 21 14 17.2 12.6 C15.8 12.1 14.6 11.8 14 12 C15.6 13.2 18.2 15 21 17.2 C24 19.6 27 20.9 29 21.4 Z" />
        <path d="M28.2 20.8 C24.8 17.4 20.8 14.6 17 13.2 C15.8 12.8 14.8 12.4 14.4 12.2" stroke="var(--bc-fur, #b5824f)" strokeWidth="0.4" strokeLinecap="round" fill="none" opacity="0.55" />
        <path d="M28.6 21 C25.4 18.4 21.8 16 18.4 14.2 C16.8 13.4 15.4 12.8 14.6 12.6" stroke="var(--bc-ink, #24150f)" strokeWidth="0.35" strokeLinecap="round" fill="none" opacity="0.35" />
        <path d="M28.8 20.8 C27.2 19.8 25.4 18.8 23.8 18" stroke="var(--bc-ink, #24150f)" strokeWidth="0.32" strokeLinecap="round" fill="none" opacity="0.3" />
      </g>
      <g className="ib-bc-brow-r" fill="var(--bc-fur-shade, #8c5d36)">
        <path d="M35 20.4 C38.6 16.8 43 14 46.8 12.6 C48.2 12.1 49.4 11.8 50 12 C48.4 13.2 45.8 15 43 17.2 C40 19.6 37 20.9 35 21.4 Z" />
        <path d="M35.8 20.8 C39.2 17.4 43.2 14.6 47 13.2 C48.2 12.8 49.2 12.4 49.6 12.2" stroke="var(--bc-fur, #b5824f)" strokeWidth="0.4" strokeLinecap="round" fill="none" opacity="0.55" />
        <path d="M35.4 21 C38.6 18.4 42.2 16 45.6 14.2 C47.2 13.4 48.6 12.8 49.4 12.6" stroke="var(--bc-ink, #24150f)" strokeWidth="0.35" strokeLinecap="round" fill="none" opacity="0.35" />
        <path d="M35.2 20.8 C36.8 19.8 38.6 18.8 40.2 18" stroke="var(--bc-ink, #24150f)" strokeWidth="0.32" strokeLinecap="round" fill="none" opacity="0.3" />
      </g>
      {/* 腮红 */}
      <ellipse cx="21.6" cy="32.6" rx="2.9" ry="1.7" fill="var(--bc-blush, #cc6f60)" opacity="0.45" />
      <ellipse cx="42.4" cy="32.6" rx="2.9" ry="1.7" fill="var(--bc-blush, #cc6f60)" opacity="0.45" />
      {eyes}
      {/* 喙 + 一点笑意 */}
      <path d="M30.1 30.6 L33.9 30.6 L32 34.8 C31.5 35.4 30.6 35.2 30.4 34.6 Z" fill="var(--bc-beak, #d98a2b)" />
      <path d="M30.7 35.4 q1.3 1 2.6 0" stroke="var(--bc-beak-shade, #96591b)" strokeWidth="0.9" strokeLinecap="round" fill="none" opacity="0.75" />
    </g>
  );
  // 领结：管家的身份（酒红丝质领结，用管家自己的配色，不跟主题蓝紫）。
  const bow = (
    <g>
      <path d="M30.9 38.0 C29.3 37.1 27.4 36.5 26.0 36.5 C25.3 36.5 24.9 37.0 25.1 37.7 L25.1 39.9 C24.9 40.6 25.3 41.1 26.0 41.1 C27.4 41.1 29.3 40.5 30.9 39.6 C31.4 39.3 31.4 38.3 30.9 38.0 Z" fill="var(--bc-bow, #7b2d32)" />
      <path d="M33.1 38.0 C34.7 37.1 36.6 36.5 38.0 36.5 C38.7 36.5 39.1 37.0 38.9 37.7 L38.9 39.9 C39.1 40.6 38.7 41.1 38.0 41.1 C36.6 41.1 34.7 40.5 33.1 39.6 C32.6 39.3 32.6 38.3 33.1 38.0 Z" fill="var(--bc-bow, #7b2d32)" />
      <path d="M28.4 37.3 C27.7 38.2 27.7 39.4 28.4 40.3 M35.6 37.3 C36.3 38.2 36.3 39.4 35.6 40.3" stroke="var(--bc-bow-shade, #571b20)" strokeWidth="0.55" strokeLinecap="round" fill="none" opacity="0.55" />
      <path d="M26.1 36.8 C27.6 36.8 29.3 37.4 30.7 38.3 M37.9 36.8 C36.4 36.8 34.7 37.4 33.3 38.3" stroke="var(--bc-bow-light, #a44a4a)" strokeWidth="0.5" strokeLinecap="round" fill="none" opacity="0.65" />
      <rect x="30.7" y="37.5" width="2.6" height="2.7" rx="0.85" fill="var(--bc-bow-shade, #571b20)" />
      <path d="M32 38.0 L32 39.7" stroke="var(--bc-bow, #7b2d32)" strokeWidth="0.5" strokeLinecap="round" opacity="0.9" />
      <path d="M31.2 37.8 C31.6 37.5 32.4 37.5 32.8 37.8" stroke="var(--bc-bow-light, #a44a4a)" strokeWidth="0.45" strokeLinecap="round" fill="none" opacity="0.7" />
    </g>
  );
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      aria-hidden="true"
      className={cls}
    >
      {/* 枝头 + 两端叶影（睡姿与离枝时依然在，枝是家） */}
      <path d="M7 58 C19 55.2 45 55.2 57 57.2" stroke="var(--bc-branch, #7b5837)" strokeWidth="2.6" strokeLinecap="round" fill="none" />
      <g className="ib-bc-leaves" fill="var(--bc-leaf, #6f905c)">
        <path d="M50.4 55.4 C52.6 52.6 56 52.8 57.4 55 C55 56.2 52.4 56.2 50.4 55.4 Z" />
        <path d="M51.5 57.2 C53.5 59.2 56.6 59.6 58.6 58.2 C56.8 56.4 53.8 56.2 51.5 57.2 Z" opacity="0.85" />
        <path d="M13 55.8 C11.2 53 8.2 51.8 5.8 52.8 C7.2 55.2 10.2 56.4 13 55.8 Z" opacity="0.9" />
        <path d="M10.8 57.4 C9 59.2 8.6 61.6 9.6 63.2 C11.6 61.8 12.2 59.2 10.8 57.4 Z" opacity="0.75" />
      </g>
      {gone ? null : asleep ? (
        <g>
          {/* 睡姿：趴在枝背上。尾羽贴枝，身体压扁，翅膀收拢，头枕在身侧。 */}
          <g fill="var(--bc-fur-shade, #8c5d36)">
            <path d="M44 51.5 q7 -1 10 2.4 q-5 1.4 -8.8 -0.4 Z" />
            <path d="M44.6 54 q6 -0.6 8.2 2.2 q-4.6 0.8 -7.6 -1.2 Z" opacity="0.85" />
          </g>
          <g className="ib-bc-sleepbody">
            {/* 压扁的身体 + 胸脯羽纹 + 收拢的双翼 */}
            <ellipse cx="31" cy="50.5" rx="14" ry="7" fill="var(--bc-fur, #b5824f)" />
            <ellipse cx="31" cy="52.4" rx="9.6" ry="4.2" fill="var(--bc-belly, #e6cfae)" opacity="0.8" />
            <g stroke="var(--bc-fur-shade, #8c5d36)" strokeWidth="0.8" strokeLinecap="round" fill="none" opacity="0.55">
              <path d="M26 52.2 q2.3 1.8 4.6 0 q2.3 1.8 4.6 0" />
              <path d="M27.5 54.6 q2 1.6 4 0 q2 1.6 4 0" />
            </g>
            <path d="M20.5 45.5 C17.6 47.6 16.6 51.4 18.4 54.6 C19.3 56 21.6 55.8 22.5 54.2 C23.7 51.2 23.3 47.4 21.9 45.4 C21.4 44.8 21.1 44.9 20.5 45.5 Z" fill="var(--bc-fur-shade, #8c5d36)" />
            <path d="M19.4 49 C18.9 51 19.1 52.8 19.9 54.2 M21.4 47.8 C21 50 21.1 52.2 21.7 53.8" stroke="var(--bc-fur, #b5824f)" strokeWidth="0.7" strokeLinecap="round" fill="none" opacity="0.6" />
            <path d="M41.5 45.5 C44.4 47.6 45.4 51.4 43.6 54.6 C42.7 56 40.4 55.8 39.5 54.2 C38.3 51.2 38.7 47.4 40.1 45.4 C40.6 44.8 40.9 44.9 41.5 45.5 Z" fill="var(--bc-fur-shade, #8c5d36)" />
            <path d="M42.6 49 C43.1 51 42.9 52.8 42.1 54.2 M40.6 47.8 C41 50 40.9 52.2 40.3 53.8" stroke="var(--bc-fur, #b5824f)" strokeWidth="0.7" strokeLinecap="round" fill="none" opacity="0.6" />
          </g>
          {/* 头枕在身侧（静态摆放 + 内层还是同一颗会歪的头；睡时不再晃） */}
          <g transform="translate(8.5 14) rotate(15 32 34)">
            {head}
            {bow}
          </g>
          {/* Zzz：两枚小 z 轮番上飘 */}
          <g stroke="var(--bc-ink, #24150f)" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" fill="none">
            <path className="ib-bc-zzz" d="M46.5 21.5 h3.6 l-3.6 3.6 h3.6" opacity="0.5" />
            <path className="ib-bc-zzz ib-bc-zzz2" d="M51.5 13.5 h4.6 l-4.6 4.6 h4.6" opacity="0.35" />
          </g>
        </g>
      ) : (
        <g>
          {/* 立姿（在线/忙碌/开心共用）：尾羽、坐姿身体、胸羽、爪 */}
          <g fill="var(--bc-fur-shade, #8c5d36)">
            <path d="M42.4 48.6 q7.2 1 9.8 4.6 q-5.2 0.4 -8.6 -2.2 Z" />
            <path d="M42.8 52 q6 .8 8 3.6 q-4.4 0.4 -7.4 -1.8 Z" opacity="0.85" />
          </g>
          <ellipse cx="32" cy="45" rx="13.4" ry="11.6" fill="var(--bc-fur, #b5824f)" />
          <ellipse cx="32" cy="48.6" rx="8.8" ry="7" fill="var(--bc-belly, #e6cfae)" opacity="0.8" />
          <g stroke="var(--bc-fur-shade, #8c5d36)" strokeWidth="0.8" strokeLinecap="round" fill="none" opacity="0.55">
            <path d="M27.4 45.6 q2.3 2.2 4.6 0 q2.3 2.2 4.6 0" />
            <path d="M27.4 49.4 q2.3 2.2 4.6 0 q2.3 2.2 4.6 0" />
          </g>
          <ellipse cx="27.6" cy="55.4" rx="2.4" ry="1.5" fill="var(--bc-beak, #d98a2b)" />
          <ellipse cx="36.4" cy="55.4" rx="2.4" ry="1.5" fill="var(--bc-beak, #d98a2b)" />
          {/* 翅膀：贴着身体折起，肩羽盖住初级飞羽，双翅会成对扑腾 */}
          <g className="ib-bc-wing-l">
            <path d="M22.6 35.8 C18.6 36.8 15.6 40.2 14.5 44.6 C13.7 48 14.2 51.3 16 53.7 C16.9 54.6 18 54.5 18.6 53.4 C19.2 54.4 20.4 54.4 21 53.4 C21.7 54.1 22.8 53.8 23.3 52.9 C25 49.5 25.2 44.2 24.8 40.3 C24.5 37.9 23.6 35.6 22.6 35.8 Z" fill="var(--bc-fur-shade, #8c5d36)" />
            <path d="M18.8 40.2 C17.2 44 16.8 48.2 17.4 51.8 M21 39.4 C19.8 43.6 19.6 48 20.2 52 M22.8 39.2 C22.2 43.2 22.2 47.4 22.6 51.2" stroke="var(--bc-fur, #b5824f)" strokeWidth="0.75" strokeLinecap="round" fill="none" opacity="0.6" />
            <path d="M22.6 35.7 C20.5 36.1 18.9 37.3 17.9 39.2 C20.1 39.6 22.2 38.8 23.6 37.2 Z" fill="var(--bc-fur, #b5824f)" opacity="0.55" />
            <path d="M16 43 C18 44.4 20.4 44.8 22.8 44" stroke="var(--bc-fur, #b5824f)" strokeWidth="0.7" strokeLinecap="round" fill="none" opacity="0.5" />
          </g>
          <g className="ib-bc-wing-r">
            <path d="M41.4 35.8 C45.4 36.8 48.4 40.2 49.5 44.6 C50.3 48 49.8 51.3 48 53.7 C47.1 54.6 46 54.5 45.4 53.4 C44.8 54.4 43.6 54.4 43 53.4 C42.3 54.1 41.2 53.8 40.7 52.9 C39 49.5 38.8 44.2 39.2 40.3 C39.5 37.9 40.4 35.6 41.4 35.8 Z" fill="var(--bc-fur-shade, #8c5d36)" />
            <path d="M45.2 40.2 C46.8 44 47.2 48.2 46.6 51.8 M43 39.4 C44.2 43.6 44.4 48 43.8 52 M41.2 39.2 C41.8 43.2 41.8 47.4 41.4 51.2" stroke="var(--bc-fur, #b5824f)" strokeWidth="0.75" strokeLinecap="round" fill="none" opacity="0.6" />
            <path d="M41.4 35.7 C43.5 36.1 45.1 37.3 46.1 39.2 C43.9 39.6 41.8 38.8 40.4 37.2 Z" fill="var(--bc-fur, #b5824f)" opacity="0.55" />
            <path d="M48 43 C46 44.4 43.6 44.8 41.2 44" stroke="var(--bc-fur, #b5824f)" strokeWidth="0.7" strokeLinecap="round" fill="none" opacity="0.5" />
          </g>
          {head}
          {bow}
          {/* working：头顶右上方一颗小星光（避开眉羽） */}
          <path className="ib-bc-spark" d="M51.4 5.1 l1.1 3 l3 1.1 l-3 1.1 l-1.1 3 l-1.1 -3 l-3 -1.1 l3 -1.1 z" fill="var(--bc-spark, #e8b34b)" />
        </g>
      )}
    </svg>
  );
}
