/**
 * The picture at the top of "Choose how your list looks" (approval "inbox-rows-dialog", round 7b, take C): an Inbox
 * window with example projects, the sidebar open beside the list. As the dialog opens a short demo plays on it
 * (listIntro.ts `rowsIntroScene`): letter marks pop into the rows and the sidebar, the projects' logos land, the row
 * marks turn over to the projects and back to the stacked look (the thread's letters, the project's logo on its
 * corner), and a card in the notes look rises in at the bottom right. Then it holds.
 *
 * It follows the window's mode (the owner, q-fd707b9e: "follow the mode"). No agent icons. Not interactive and not
 * announced: the dialog's words say what it is. The example projects' logos are bundled (assets/rows-intro), so the
 * picture never asks anyone for anything.
 */
import type { CSSProperties } from 'react';
import { hueOf, markLetters } from '../letterMarks';
import type { RowsIntroScene } from '../listIntro';
import { Icon } from '../icons';
import { inboxSearchShortcuts } from '../search/searchShortcut';
import { ShortcutHint } from '../shortcuts/hint';
import plannotatorLogo from '../assets/rows-intro/plannotator.webp';
import bunLogo from '../assets/rows-intro/oven-sh.webp';
import supabaseLogo from '../assets/rows-intro/supabase.webp';
import viteLogo from '../assets/rows-intro/vitejs.webp';
import dockerLogo from '../assets/rows-intro/docker.webp';
import zedLogo from '../assets/rows-intro/zed-industries.webp';
import huggingfaceLogo from '../assets/rows-intro/huggingface.webp';
import redisLogo from '../assets/rows-intro/redis.webp';
import vercelLogo from '../assets/rows-intro/vercel.webp';

interface ExampleRow {
  project: string;
  title: string;
  preview: string;
  time: string;
  questions?: number;
  logo?: string;
}

const WAITING: readonly ExampleRow[] = [
  { project: 'plannotator', title: '评审收件箱页头改动', preview: '两种布局可选，都在会话里', questions: 1, time: '下午 2:41', logo: plannotatorLogo },
  { project: 'bun', title: '调高测试运行器的超时', preview: '在较慢的 CI 运行器上 bun test 会达到 5 秒', questions: 1, time: '下午 2:17', logo: bunLogo },
  { project: 'supabase', title: '添加行级策略示例', preview: '这个示例该用哪张表？', questions: 1, time: '下午 1:58', logo: supabaseLogo },
];
const NEW: readonly ExampleRow[] = [
  { project: 'vite', title: '把开发服务器升到 6.1', preview: '有两个插件需要新的 peer 范围', time: '下午 1:12', logo: viteLogo },
  { project: 'compose', title: '修正卷的挂载顺序', preview: '命名卷现在先于绑定挂载', time: '下午 12:46', logo: dockerLogo },
  { project: 'zed', title: '加快项目搜索', preview: '搜索 4 万个文件从 1.9 秒降到 0.4 秒', time: '上午 11:30', logo: zedLogo },
  { project: 'transformers', title: '更新分词器文档', preview: '快速分词器页面用的是旧参数', time: '上午 10:05', logo: huggingfaceLogo },
  { project: 'redis', title: '整理淘汰设置', preview: 'maxmemory-policy 移到 maxmemory 旁边', time: '上午 9:48', logo: redisLogo },
  { project: 'next.js', title: '修正图片加载器的缓存键', preview: '缓存键里少了宽度', time: '上午 9:20', logo: vercelLogo },
];
/** The sidebar's projects, in the order the Inbox lists them; `waiting`: threads waiting on you. Two have no logo. */
const PROJECTS: readonly { name: string; waiting?: number; logo?: string }[] = [
  { name: 'plannotator', waiting: 1, logo: plannotatorLogo },
  { name: 'bun', waiting: 1, logo: bunLogo },
  { name: 'supabase', waiting: 1, logo: supabaseLogo },
  { name: 'vite', logo: viteLogo },
  { name: 'dotfiles' },
  { name: 'compose', logo: dockerLogo },
  { name: 'zed', logo: zedLogo },
  { name: 'transformers', logo: huggingfaceLogo },
  { name: 'infra-terraform' },
  { name: 'redis', logo: redisLogo },
  { name: 'next.js', logo: vercelLogo },
];

/** The notes look's two invented threads (approval round 3: "Spring newsletter", waiting; "Trip plan: Lisbon", done). */
const NOTES: readonly { title: string; preview: string; time: string; status: 'waiting' | 'done' }[] = [
  { title: '春季简报', preview: '开头的导语还是太长。第二篇故事是删掉，还是挪到结尾？', time: '下午 3:12', status: 'waiting' },
  { title: '旅行计划：里斯本', preview: '机票和公寓都订好了。逐日行程已置顶在会话里。', time: '上午 11:05', status: 'done' },
];

/** The ids the marks' hues are keyed on (the production rule: the hue from the id). */
const threadSeed = (row: ExampleRow) => `thr_f_${row.project}_${row.title}`;
const projectSeed = (name: string) => `prj_${name}`;

/** A letter mark (letterMarks.tsx's rules and classes), its logo shown once `logos` is on. */
function Mark({ name, seed, size, logo, className, i }: { name: string; seed: string; size: 14 | 20 | 30; logo?: string; className?: string; i?: number }) {
  const letters = markLetters(name);
  return (
    <span className={`ib-lm${logo ? ' ib-rl-logo' : ''}${className ? ` ${className}` : ''}`} data-hue={hueOf(seed)} data-size={size} data-solid="" data-kind={letters.kind} data-n={letters.count} style={i === undefined ? undefined : ({ '--i': i } as CSSProperties)}>
      {letters.text}
      {logo && <img src={logo} alt="" decoding="async" />}
    </span>
  );
}

function Row({ row, i }: { row: ExampleRow; i: number }) {
  return (
    <div className="ib-rl-row" style={{ '--i': i } as CSSProperties}>
      <span className="ib-rl-av">
        <span className="ib-rl-pop">
          <span className="ib-rl-flip">
            <Mark name={row.title} seed={threadSeed(row)} size={30} className="ib-rl-face" />
            <Mark name={row.project} seed={projectSeed(row.project)} size={30} logo={row.logo} className="ib-rl-face ib-rl-back" i={i} />
          </span>
        </span>
        <Mark name={row.project} seed={projectSeed(row.project)} size={14} logo={row.logo} className="ib-rl-badge ib-rl-pop" i={i} />
      </span>
      <div className="ib-rl-l1">
        <span className="ib-rl-proj">{row.project}</span>
        <span className="ib-rl-time">{row.time}</span>
      </div>
      <div className="ib-rl-l2">{row.title}</div>
      <div className="ib-rl-l3">
        <span className="ib-rl-prev">{row.preview}</span>
        {row.questions ? (
          <span className="ib-rl-q">
            <Icon name="questionBubble" size={14} />
            {row.questions}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function StatusMark({ status }: { status: 'waiting' | 'done' }) {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="8" cy="8" r="6.25" />
      {status === 'waiting' ? <path d="M4.25 8.75h7.5a3.75 3.75 0 0 1-7.5 0Z" fill="currentColor" stroke="none" /> : <path d="m5.4 8.2 1.8 1.8 3.4-3.6" />}
    </svg>
  );
}

/**
 * The example window (`scene`'s marks and logos) in its frame. `moving`: the demo plays, so the marks pop, the logos
 * land and the marks turn with motion; otherwise each change is instant (reduced motion, the held picture after a
 * key or a click).
 */
export function RowsIntroWindow({ scene, moving }: { scene: RowsIntroScene; moving: boolean }) {
  const waiting = WAITING.length;
  return (
    <div className="ib-rl-comp" data-marks={scene.marks} data-logos={scene.logos ? '' : undefined} data-moving={moving ? '' : undefined}>
      <aside className="ib-rl-sb">
        <div className="ib-rl-brand">
          Plannotator<span>Inbox</span>
        </div>
        <div className="ib-rl-search">
          <span className="ib-rl-box">
            <Icon name="search" size={16} />
            搜索
            <ShortcutHint scope={inboxSearchShortcuts} action="openSearch" className="ib-kbd ib-rl-kbd" />
          </span>
          <span className="ib-rl-new">
            <Icon name="compose" size={16} />
          </span>
        </div>
        <div className="ib-rl-nav">
          <Icon name="inbox" size={17} />
          收件箱<span className="ib-rl-n">{waiting}</span>
        </div>
        <div className="ib-rl-phead">
          <Icon name="folder" size={17} />
          项目
        </div>
        {PROJECTS.map((project, j) => (
          <div className="ib-rl-prow" key={project.name}>
            <Mark name={project.name} seed={projectSeed(project.name)} size={20} logo={project.logo} className="ib-rl-sbm" i={j} />
            <span className="ib-rl-pn">{project.name}</span>
            {project.waiting ? <span className="ib-rl-n">{project.waiting}</span> : null}
          </div>
        ))}
      </aside>
      <div className="ib-rl-lp">
        <div className="ib-rl-lhead">
          <Icon name="panelsHide" size={18} />
          <span className="ib-rl-h">收件箱</span>
          <Icon name="dots" size={18} />
        </div>
        <div className="ib-rl-lbody">
          <div className="ib-rl-band">
            等你处理 <span className="ib-rl-n">{waiting}</span>
          </div>
          {WAITING.map((row, i) => (
            <Row key={row.title} row={row} i={i} />
          ))}
          <div className="ib-rl-band">
            自你上次查看后更新 <span className="ib-rl-n">{NEW.length}</span>
          </div>
          {NEW.map((row, i) => (
            <Row key={row.title} row={row} i={i + WAITING.length} />
          ))}
        </div>
      </div>
    </div>
  );
}

/** The notes look, stacked on the picture's bottom right (approval round 3): it rises in as the demo lands. */
export function RowsIntroNotes({ shown, moving }: { shown: boolean; moving: boolean }) {
  return (
    <div className="ib-rl-stack" data-off={shown ? undefined : ''} data-moving={moving ? '' : undefined} aria-hidden="true">
      {NOTES.map((note) => (
        <div className="ib-rl-nrow" data-status={note.status} key={note.title}>
          <div className="ib-rl-nt">{note.title}</div>
          <div className="ib-rl-np">{note.preview}</div>
          <div className="ib-rl-nb">
            <span>{note.time}</span>
            <span className="ib-rl-stm">
              <StatusMark status={note.status} />
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
