/**
 * 管家的活形象（owner 2026-11-27「不要睫毛似的小毛；是“倒八字”长眉，长出面部的那截就是
 * 耳朵」→ 2026-11-28 三轮打磨定案）：一只立在枝头的角鸮。
 *
 * 画材（2026-11-28）：
 *  - 树干加粗到 4、两端出血（x -2/66 被画布裁掉，读作延伸到画外），底部暗面做圆柱感，
 *    两根小枝、八道长短不一的树皮纹、一处结疤（外圈+内芯+裂）；
 *  - 叶子左右各两片，叶柄长在小枝上（不悬空），叶身带叶脉；小尺寸（<70）减到每侧一片；
 *  - 眉毛：从眉心微斜、末端起翘收成钝头的耳羽（厚度 1.6，倾角约 14°，起翘约 40°）；
 *  - 嘴是倒水滴（圆顶、下收成钝尖，带一道高光与尖端阴影）；无腮红、无嘴下笑弧；
 *  - 开心/睡觉的眼睛是实心月牙（不是两条线）。
 *
 * 形态即状态（owner 2026-11-28「用猫头鹰的形态来描述，别用绿点」）：
 *  - idle：睁大眼睛立在枝头——在线；
 *  - working：**在枝上走来走去**（4s 一个来回，身体每步颠 0.7，两只爪子交替抬脚，
 *    翅膀收着不扑）——思考/说话中；电子宠物的第一步；
 *  - sleep：趴在枝背上打盹（闭眼、Zzz、胸口起伏）——空闲；
 *  - gone：枝头空了，只剩枝叶——会话不可用；
 *  - happy：弯眼笑 + 连扑翅（临时表情）。
 *  小尺寸（size < 70，侧栏 26/60）自动简化：无树皮纹与结疤、每侧一片叶、不走。
 *  prefers-reduced-motion 一律静止。
 */
export type ButlerMood = 'idle' | 'working' | 'happy' | 'sleep' | 'gone';

export function ButlerCharacter({ size, mood = 'idle' }: { size: number; mood?: ButlerMood }) {
  const asleep = mood === 'sleep';
  const gone = mood === 'gone';
  const simple = size < 70;
  const cls = [
    'ib-bc',
    mood === 'working' ? 'ib-bc-working' : '',
    mood === 'happy' ? 'ib-bc-happy' : '',
    asleep ? 'ib-bc-sleep' : '',
    gone ? 'ib-bc-gone' : '',
    simple ? 'ib-bc-simple' : '',
  ]
    .filter(Boolean)
    .join(' ');

  /* 眼睛：sleep 闭目月牙；happy 笑弯月牙；其余是琥珀虹膜的大眼，会眨 */
  const eyes =
    asleep || mood === 'happy' ? (
      <>
        {asleep ? (
          <>
            <path d="M21.8 26.6 C24.4 29.9 28.8 29.9 31.4 26.6 C28.8 28.7 24.4 28.7 21.8 26.6 Z" fill="var(--bc-ink)" />
            <path d="M32.6 26.6 C35.2 29.9 39.6 29.9 42.2 26.6 C39.6 28.7 35.2 28.7 32.6 26.6 Z" fill="var(--bc-ink)" />
          </>
        ) : (
          <>
            <path d="M21.6 27.2 C24.2 22.6 29.2 22.6 31.6 27.2 C29.2 25.3 24 25.3 21.6 27.2 Z" fill="var(--bc-ink)" />
            <path d="M32.4 27.2 C34.8 22.6 39.8 22.6 42.4 27.2 C40 25.3 34.8 25.3 32.4 27.2 Z" fill="var(--bc-ink)" />
          </>
        )}
      </>
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

  /* 一片叶子：叶身 + 叶脉（extra = 小尺寸时隐藏的那片） */
  const Leaf = ({ x, y, angle, scale, opacity, extra }: { x: number; y: number; angle: number; scale: number; opacity: number; extra?: boolean }) => (
    <g transform={`translate(${x} ${y}) rotate(${angle}) scale(${scale})`} className={extra ? 'ib-bc-leaf-extra' : undefined}>
      <path d="M0 0 C3.2 -3 7 -2.5 8.8 0 C5.9 1.9 2.6 1.6 0 0 Z" fill="var(--bc-leaf, #6f905c)" opacity={opacity} />
      <path d="M1.4 -.2 C3.8 -.9 6.2 -.8 7.9 0" stroke="var(--bc-leaf-vein, #4b6740)" stroke-width=".35" fill="none" opacity=".55" />
    </g>
  );

  /* 枝：主干出血 + 底部暗面 + 小枝 + 树皮 + 结疤（小尺寸整组隐藏） */
  const branch = (
    <g>
      <path d="M-2 59.8 C18 56.3 46 56.3 66 59.8" stroke="var(--bc-branch-shade, #5b3f24)" stroke-width="1.6" stroke-linecap="round" fill="none" opacity=".33" />
      <path d="M-2 58.5 C18 55 46 55 66 58.5" stroke="var(--bc-branch, #7b5837)" stroke-width="4" stroke-linecap="round" fill="none" />
      <path d="M6.2 57.9 C4.8 58.9 3.6 59.9 2.8 61.4" stroke="var(--bc-branch, #7b5837)" stroke-width="2" stroke-linecap="round" fill="none" />
      <path d="M57.4 56.9 C58 55.2 58.2 53 58.1 51.2" stroke="var(--bc-branch, #7b5837)" stroke-width="1.9" stroke-linecap="round" fill="none" />
      <g className="ib-bc-bark" stroke="var(--bc-branch-shade, #5b3f24)" stroke-width=".65" stroke-linecap="round" fill="none" opacity=".5">
        <path d="M4.6 57.2 q2 1.6 4 .5" />
        <path d="M15 56.3 q2.6 1.4 5 .2" />
        <path d="M24 55.8 q2 1 4 0" />
        <path d="M38 55.7 q2.2 1 4.2 .1" />
        <path d="M55 57.4 q2 1.4 4 .8" />
        <path d="M11.4 58.6 q1.6 1 3 .4" />
        <path d="M47 56.5 q1.8 1.2 3.6 .5" />
        <path d="M31 55.9 q1.4 .8 2.8 .1" />
      </g>
      <g className="ib-bc-bark">
        <ellipse cx="43.4" cy="57.3" rx="2.1" ry="1.25" fill="var(--bc-branch-shade, #5b3f24)" opacity=".5" />
        <ellipse cx="43.4" cy="57.3" rx=".85" ry=".45" fill="var(--bc-branch, #7b5837)" opacity=".75" />
        <path d="M41 57.9 q1.8 1.3 3.6 .2" stroke="var(--bc-branch-shade, #5b3f24)" stroke-width=".5" stroke-linecap="round" fill="none" opacity=".5" />
      </g>
    </g>
  );

  const leaves = (
    <g className="ib-bc-leaves">
      <Leaf x={4.6} y={58.8} angle={245} scale={1.12} opacity={0.95} />
      <Leaf x={3.0} y={60.4} angle={268} scale={0.98} opacity={0.85} extra />
      <Leaf x={57.9} y={53.8} angle={-52} scale={1.15} opacity={0.95} />
      <Leaf x={58.2} y={51.5} angle={-76} scale={1} opacity={0.85} extra />
    </g>
  );

  /* 头：面盘、眉（微斜、末端起翘的耳羽）、眼、倒水滴喙。睡姿整组平移+旋转复用。 */
  const head = (
    <g className="ib-bc-head">
      <circle cx="32" cy="27" r="14.3" fill="var(--bc-fur, #b5824f)" />
      <path d="M32 17.8 C36.6 17.8 42.2 20.7 43.8 26.4 C45.6 32.9 40.2 38.5 32 38.5 C23.8 38.5 18.4 32.9 20.2 26.4 C21.8 20.7 27.4 17.8 32 17.8 Z" fill="var(--bc-belly, #e6cfae)" />
      <path d="M32 17.8 C36.6 17.8 42.2 20.7 43.8 26.4 C45.6 32.9 40.2 38.5 32 38.5 C23.8 38.5 18.4 32.9 20.2 26.4 C21.8 20.7 27.4 17.8 32 17.8 Z" fill="none" stroke="var(--bc-fur-shade, #8c5d36)" stroke-width=".9" opacity=".5" />
      <g className="ib-bc-brow-l" fill="var(--bc-fur-shade, #8c5d36)">
        <path d="M27.8 20.6 C25.8 19.9 23.4 19 21.4 18.3 C19.9 17.75 19.2 17.3 18.9 16.8 C18.2 16.05 17.5 15.35 16.7 14.4 Q16.35 14.05 16.55 14.62 C17 15.6 17.9 16.9 18.9 18.4 C20 19.2 22.4 20.4 24.5 20.95 C25.6 21.3 26.9 21.6 27.8 21.7 Z" />
        <path d="M26.8 20.2 C24.9 19.6 23.1 19 21.6 18.5" stroke="var(--bc-fur, #b5824f)" stroke-width=".45" stroke-linecap="round" fill="none" opacity=".35" />
        <path d="M25.9 19.7 C24.3 19.2 22.6 18.7 21.4 18.4" stroke="var(--bc-ink, #24150f)" stroke-width=".24" stroke-linecap="round" fill="none" opacity=".2" />
      </g>
      <g className="ib-bc-brow-r" fill="var(--bc-fur-shade, #8c5d36)">
        <path d="M36.2 20.6 C38.2 19.9 40.6 19 42.6 18.3 C44.1 17.75 44.8 17.3 45.1 16.8 C45.8 16.05 46.5 15.35 47.3 14.4 Q47.65 14.05 47.45 14.62 C47 15.6 46.1 16.9 45.1 18.4 C44 19.2 41.6 20.4 39.5 20.95 C38.4 21.3 37.1 21.6 36.2 21.7 Z" />
        <path d="M37.2 20.2 C39.1 19.6 40.9 19 42.4 18.5" stroke="var(--bc-fur, #b5824f)" stroke-width=".45" stroke-linecap="round" fill="none" opacity=".35" />
        <path d="M38.1 19.7 C39.7 19.2 41.4 18.7 42.6 18.4" stroke="var(--bc-ink, #24150f)" stroke-width=".24" stroke-linecap="round" fill="none" opacity=".2" />
      </g>
      {eyes}
      {/* 喙：倒水滴（圆顶、下收成钝尖）+ 顶部高光 + 尖端阴影 */}
      <path d="M29.9 30.5 C31 29.9 33 29.9 34.1 30.5 C34.6 31.9 33.8 34.1 32.6 35.3 C32.3 35.6 31.7 35.6 31.4 35.3 C30.2 34.1 29.4 31.9 29.9 30.5 Z" fill="var(--bc-beak, #d98a2b)" />
      <path d="M30.8 31.2 C31.4 30.9 32.6 30.9 33.2 31.2" stroke="var(--bc-beak-shade, #96591b)" stroke-width=".45" stroke-linecap="round" fill="none" opacity=".35" />
      <path d="M32 33.6 C32.1 34.5 32.1 35.1 32 35.4" stroke="var(--bc-beak-shade, #96591b)" stroke-width=".5" stroke-linecap="round" fill="none" opacity=".45" />
    </g>
  );

  /* 领结：管家的身份（酒红丝质，用自己的配色，不跟主题） */
  const bow = (
    <g>
      <path d="M30.9 38.0 C29.3 37.1 27.4 36.5 26.0 36.5 C25.3 36.5 24.9 37.0 25.1 37.7 L25.1 39.9 C24.9 40.6 25.3 41.1 26.0 41.1 C27.4 41.1 29.3 40.5 30.9 39.6 C31.4 39.3 31.4 38.3 30.9 38.0 Z" fill="var(--bc-bow, #7b2d32)" />
      <path d="M33.1 38.0 C34.7 37.1 36.6 36.5 38.0 36.5 C38.7 36.5 39.1 37.0 38.9 37.7 L38.9 39.9 C39.1 40.6 38.7 41.1 38.0 41.1 C36.6 41.1 34.7 40.5 33.1 39.6 C32.6 39.3 32.6 38.3 33.1 38.0 Z" fill="var(--bc-bow, #7b2d32)" />
      <path d="M28.4 37.3 C27.7 38.2 27.7 39.4 28.4 40.3 M35.6 37.3 C36.3 38.2 36.3 39.4 35.6 40.3" stroke="var(--bc-bow-shade, #571b20)" stroke-width=".55" stroke-linecap="round" fill="none" opacity=".55" />
      <path d="M26.1 36.8 C27.6 36.8 29.3 37.4 30.7 38.3 M37.9 36.8 C36.4 36.8 34.7 37.4 33.3 38.3" stroke="var(--bc-bow-light, #a44a4a)" stroke-width=".5" stroke-linecap="round" fill="none" opacity=".65" />
      <rect x="30.7" y="37.5" width="2.6" height="2.7" rx="0.85" fill="var(--bc-bow-shade, #571b20)" />
      <path d="M32 38.0 L32 39.7" stroke="var(--bc-bow, #7b2d32)" stroke-width=".5" stroke-linecap="round" opacity=".9" />
      <path d="M31.2 37.8 C31.6 37.5 32.4 37.5 32.8 37.8" stroke="var(--bc-bow-light, #a44a4a)" stroke-width=".45" stroke-linecap="round" fill="none" opacity=".7" />
    </g>
  );

  const wings = (
    <>
      <g className="ib-bc-wing-l">
        <path d="M22.6 35.8 C18.6 36.8 15.6 40.2 14.5 44.6 C13.7 48 14.2 51.3 16 53.7 C16.9 54.6 18 54.5 18.6 53.4 C19.2 54.4 20.4 54.4 21 53.4 C21.7 54.1 22.8 53.8 23.3 52.9 C25 49.5 25.2 44.2 24.8 40.3 C24.5 37.9 23.6 35.6 22.6 35.8 Z" fill="var(--bc-fur-shade, #8c5d36)" />
        <path d="M18.8 40.2 C17.2 44 16.8 48.2 17.4 51.8 M21 39.4 C19.8 43.6 19.6 48 20.2 52 M22.8 39.2 C22.2 43.2 22.2 47.4 22.6 51.2" stroke="var(--bc-fur, #b5824f)" stroke-width=".75" stroke-linecap="round" fill="none" opacity=".6" />
        <path d="M22.6 35.7 C20.5 36.1 18.9 37.3 17.9 39.2 C20.1 39.6 22.2 38.8 23.6 37.2 Z" fill="var(--bc-fur, #b5824f)" opacity=".55" />
        <path d="M16 43 C18 44.4 20.4 44.8 22.8 44" stroke="var(--bc-fur, #b5824f)" stroke-width=".7" stroke-linecap="round" fill="none" opacity=".5" />
      </g>
      <g className="ib-bc-wing-r">
        <path d="M41.4 35.8 C45.4 36.8 48.4 40.2 49.5 44.6 C50.3 48 49.8 51.3 48 53.7 C47.1 54.6 46 54.5 45.4 53.4 C44.8 54.4 43.6 54.4 43 53.4 C42.3 54.1 41.2 53.8 40.7 52.9 C39 49.5 38.8 44.2 39.2 40.3 C39.5 37.9 40.4 35.6 41.4 35.8 Z" fill="var(--bc-fur-shade, #8c5d36)" />
        <path d="M45.2 40.2 C46.8 44 47.2 48.2 46.6 51.8 M43 39.4 C44.2 43.6 44.4 48 43.8 52 M41.2 39.2 C41.8 43.2 41.8 47.4 41.4 51.2" stroke="var(--bc-fur, #b5824f)" stroke-width=".75" stroke-linecap="round" fill="none" opacity=".6" />
        <path d="M41.4 35.7 C43.5 36.1 45.1 37.3 46.1 39.2 C43.9 39.6 41.8 38.8 40.4 37.2 Z" fill="var(--bc-fur, #b5824f)" opacity=".55" />
        <path d="M48 43 C46 44.4 43.6 44.8 41.2 44" stroke="var(--bc-fur, #b5824f)" stroke-width=".7" stroke-linecap="round" fill="none" opacity=".5" />
      </g>
    </>
  );

  const tail = (
    <g fill="var(--bc-fur-shade, #8c5d36)">
      <path d="M42.4 48.6 q7.2 1 9.8 4.6 q-5.2 .4 -8.6 -2.2 Z" />
      <path d="M42.8 52 q6 .8 8 3.6 q-4.4 .4 -7.4 -1.8 Z" opacity=".85" />
    </g>
  );

  /* 爪子：在 bob 之外（不跟着颠），走路时左右交替抬脚。 */
  const claws = (
    <>
      <g className="ib-bc-claw-l"><ellipse cx="27.6" cy="55.4" rx="2.4" ry="1.5" fill="var(--bc-beak, #d98a2b)" /></g>
      <g className="ib-bc-claw-r"><ellipse cx="36.4" cy="55.4" rx="2.4" ry="1.5" fill="var(--bc-beak, #d98a2b)" /></g>
    </>
  );

  /* 睡姿：压扁的身体 + 收拢的翅 + 枕在身侧的头 + Zzz */
  const sleepBody = (
    <>
      <g fill="var(--bc-fur-shade, #8c5d36)">
        <path d="M44 51.5 q7 -1 10 2.4 q-5 1.4 -8.8 -.4 Z" />
        <path d="M44.6 54 q6 -.6 8.2 2.2 q-4.6 .8 -7.6 -1.2 Z" opacity=".85" />
      </g>
      <g className="ib-bc-sleepbody">
        <ellipse cx="31" cy="50.5" rx="14" ry="7" fill="var(--bc-fur, #b5824f)" />
        <ellipse cx="31" cy="52.4" rx="9.6" ry="4.2" fill="var(--bc-belly, #e6cfae)" opacity=".8" />
        <g stroke="var(--bc-fur-shade, #8c5d36)" stroke-width=".8" stroke-linecap="round" fill="none" opacity=".55">
          <path d="M26 52.2 q2.3 1.8 4.6 0 q2.3 1.8 4.6 0" />
          <path d="M27.5 54.6 q2 1.6 4 0 q2 1.6 4 0" />
        </g>
        <path d="M20.5 45.5 C17.6 47.6 16.6 51.4 18.4 54.6 C19.3 56 21.6 55.8 22.5 54.2 C23.7 51.2 23.3 47.4 21.9 45.4 C21.4 44.8 21.1 44.9 20.5 45.5 Z" fill="var(--bc-fur-shade, #8c5d36)" />
        <path d="M41.5 45.5 C44.4 47.6 45.4 51.4 43.6 54.6 C42.7 56 40.4 55.8 39.5 54.2 C38.3 51.2 38.7 47.4 40.1 45.4 C40.6 44.8 40.9 44.9 41.5 45.5 Z" fill="var(--bc-fur-shade, #8c5d36)" />
      </g>
    </>
  );

  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" className={cls}>
      {branch}
      {leaves}
      {gone ? null : asleep ? (
        <g>
          {sleepBody}
          <g transform="translate(8.5 14) rotate(15 32 34)">
            {head}
            {bow}
          </g>
          <g stroke="var(--bc-ink, #24150f)" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round" fill="none">
            <path className="ib-bc-zzz" d="M46.5 21.5 h3.6 l-3.6 3.6 h3.6" opacity=".5" />
            <path className="ib-bc-zzz ib-bc-zzz2" d="M51.5 13.5 h4.6 l-4.6 4.6 h4.6" opacity=".35" />
          </g>
        </g>
      ) : (
        <g className="ib-bc-owl">
          {tail}
          <g className="ib-bc-bob">
            <ellipse cx="32" cy="45" rx="13.4" ry="11.6" fill="var(--bc-fur, #b5824f)" />
            <ellipse cx="32" cy="48.6" rx="8.8" ry="7" fill="var(--bc-belly, #e6cfae)" opacity=".8" />
            <g stroke="var(--bc-fur-shade, #8c5d36)" stroke-width=".8" stroke-linecap="round" fill="none" opacity=".55">
              <path d="M27.4 45.6 q2.3 2.2 4.6 0 q2.3 2.2 4.6 0" />
              <path d="M27.4 49.4 q2.3 2.2 4.6 0 q2.3 2.2 4.6 0" />
            </g>
            {wings}
            {head}
            {bow}
            {/* working：头顶右上方一颗小星光 */}
            <path className="ib-bc-spark" d="M51.4 5.1 l1.1 3 l3 1.1 l-3 1.1 l-1.1 3 l-1.1 -3 l-3 -1.1 l3 -1.1 z" fill="var(--bc-spark, #e8b34b)" />
          </g>
          {claws}
        </g>
      )}
    </svg>
  );
}
