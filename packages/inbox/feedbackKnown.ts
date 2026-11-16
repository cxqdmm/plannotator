/**
 * Known answers (approval "inbox-feedback-faq", 2026-11-09): a hand-written list of what people write in about,
 * each with a short answer and one action. The Feedback form checks it first, in the window, and shows at most one,
 * as the first line of "These might help" ("Fixed in 0.28.52: the list holds still now · Use Simple list"). The
 * entries with `faq` are also Common questions, in this order (feedbackFaq.ts). Edit the words here.
 *
 * An action runs a setting the Inbox already has (the window wires each kind in App.tsx): `simple-list` is the
 * list's ⋮ menu → View → Simple list (listView.ts); `settings-<section>` opens that Settings section;
 * `settings-experimental` opens Capabilities on its Experimental group. A link opens real release notes or docs.
 *
 * Experimental features held until 0.29 (packages/server/inbox.ts `heldSwitch`: Code review, Shape, System) are
 * not here: their switches are hidden, so nothing may offer them.
 *
 * Matching is whole words and whole phrases, no stems: "moves" never finds "remove". An entry matches on one of its
 * `phrases`, or when every `near` group has a word that is not negated ("doesn't move" is praise) and they sit
 * within 8 words of each other. Text that reports something broken ("doesn't work", "crashes") matches only the
 * entries marked `whenBroken`: a "turn it on" answer to a bug report misleads.
 */
import type { SettingsSection } from './settingsRoute';

export type FeedbackAction = 'simple-list' | `settings-${SettingsSection}` | 'settings-experimental';

export interface KnownAnswer {
  /** Stable id, for tests, the open Common question and the window's list of answers it hides. */
  id: string;
  /** The short answer: the line's words, after "Fixed in 0.28.52: " or "Experimental: ". */
  answer: string;
  /** A complaint fixed in this release (without its "v"): the line starts "Fixed in {fixedIn}:". */
  fixedIn?: string;
  /** A switch in Settings → Capabilities → Experimental: the line starts "Experimental:". */
  experimental?: true;
  action?: { kind: FeedbackAction; label: string };
  /** The answer's words link here; with no action, the link is the action. */
  link?: { label: string; href: string };
  /** Also a Common question, asked and answered this way. */
  faq?: { question: string; answer: string };
  /** The hand-written feature in feedbackSearch.data.json this answer stands for: not listed again under it. */
  feature?: string;
  match: { phrases?: string[]; near?: string[][]; whenBroken?: true };
}

const RELEASE = 'https://github.com/backnotprop/plannotator/releases/tag/';
const DOCS = 'https://plannotator.ai/docs/reference/inbox/';

const AGENTS = ['agent', 'agents', 'claude', 'claude code', 'session', 'sessions'];

export const KNOWN_ANSWERS: readonly KnownAnswer[] = [
  {
    id: 'list-moves',
    answer: '列表不会再自动移动了',
    fixedIn: '0.28.52',
    action: { kind: 'simple-list', label: '使用简洁列表' },
    link: { label: '0.28.52 有哪些变化', href: `${RELEASE}v0.28.52` },
    faq: {
      question: '我阅读时列表会移动',
      answer:
        '已在 0.28.52 修复。新消息会停在列表顶部的“N 条新消息 · 显示”后面，只有你主动查看时行才会移动。你打开的那一行会留在原处。完全不想要分组？请使用简洁列表：一个列表，最新的在最前。',
    },
    match: {
      phrases: ['list moves', 'list jumps', 'rows jump', 'threads jump', 'keeps reordering'],
      near: [
        ['list', 'row', 'rows', 'thread', 'threads', 'inbox', 'item', 'items', 'order', 'message', 'messages', 'everything', 'stuff'],
        ['move', 'moves', 'moving', 'moved', 'jump', 'jumps', 'jumping', 'jumpy', 'jumped', 'shuffle', 'shuffles', 'shuffling', 'reorder', 'reorders', 'reordering', 'reordered', 'rearrange', 'rearranges', 'rearranging', 'shift', 'shifts', 'shifting', 'bounce', 'bounces', 'bouncing', 'resort', 'resorts', 'resorting', 'vanish', 'vanishes', 'disappear', 'disappears', 'disappearing', 'keeps changing', 'out from under', 'under me', "won't stay", "doesn't stay", 'stay still', 'stay put', 'hold still'],
      ],
    },
  },
  {
    id: 'simple-list',
    answer: '简洁列表：一个列表，最新的在最前',
    action: { kind: 'simple-list', label: '使用简洁列表' },
    faq: {
      question: '能不能不用分组，只要一个普通列表？',
      answer: '可以。列表上方的 ⋮ → 视图 → 简洁列表。行和标记都一样，最新的在最前。智能分组仍只需一次点击。',
    },
    match: {
      phrases: ['simple list', 'plain list', 'flat list', 'chronological', 'sort by date', 'sort by newest', 'newest first', 'sort by time', 'like email', 'like gmail', 'like an email'],
      near: [
        ['group', 'groups', 'grouping', 'section', 'sections', 'bands', 'categories', 'smart'],
        ['confusing', 'confused', 'confuse', 'too many', "don't need", 'do not need', "don't want", 'get rid', 'turn off', 'hide', 'remove', 'simpler', 'plain', 'flat', 'annoying', 'hate'],
      ],
    },
  },
  {
    id: 'rows',
    answer: '选择行的外观：极简、均衡或详细',
    action: { kind: 'settings-rows', label: '打开设置 → 行' },
    faq: {
      question: '行显示的内容太多或太少',
      answer:
        '设置 → 行里有三种外观：极简、均衡和详细，你还可以微调密度、预览和时间。你的选择会同步到每个浏览器。',
    },
    feature: 'Settings, Rows',
    match: {
      phrases: ['row density', 'list density', 'compact rows', 'compact list', 'smaller rows', 'tighter rows', 'denser list', 'preview lines', 'rows look'],
      near: [
        ['row', 'rows', 'list', 'sidebar'],
        ['cluttered', 'clutter', 'busy', 'noisy', 'too big', 'too tall', 'too much info', 'dense', 'denser', 'compact', 'minimal', 'smaller', 'cramped', 'bigger', 'spacing'],
      ],
    },
  },
  {
    id: 'done',
    answer: '从会话的 ⋯ 菜单归档',
    link: { label: '收件箱文档', href: `${DOCS}#what-you-see` },
    faq: {
      question: '怎样把会话标记为完成？',
      answer: '从会话的 ⋯ 菜单归档。如果 agent 再次写信，它会自动回来；取消归档即可重新打开。',
    },
    feature: 'Archive',
    match: {
      phrases: ['mark done', 'mark as done', 'mark it done', 'done button', 'archive'],
      near: [
        ['thread', 'threads', 'conversation', 'conversations'],
        ['done', 'finish', 'finished', 'delete', 'remove', 'dismiss', 'close', 'clear', 'trash', 'get rid'],
      ],
    },
  },
  {
    id: 'phone',
    answer: '通过你的 tailnet 在手机上使用收件箱',
    action: { kind: 'settings-devices', label: '打开设置 → 远程设备' },
    faq: {
      question: '我能在手机上使用收件箱吗？',
      answer: '可以，通过你的 tailnet：在手机上打开设置 → 远程设备中的地址。',
    },
    feature: 'Over your tailnet',
    match: {
      phrases: ['on my phone', 'from my phone', 'on my iphone', 'from my iphone', 'on my ipad', 'on mobile', 'from mobile', 'mobile app', 'phone app', 'iphone app', 'android app', 'ipad app', 'away from my desk', 'away from my computer', 'on the go', 'tailscale', 'tailnet'],
    },
  },
  {
    id: 'start-agents',
    answer: '新建消息可以替你启动 Claude Code 或 Pi',
    action: { kind: 'settings-agents', label: '打开设置 → agent' },
    link: { label: '0.28.52 有哪些变化', href: `${RELEASE}v0.28.52` },
    match: {
      whenBroken: true,
      phrases: [
        'start an agent', 'start agents', 'start a new agent', 'start new agents', 'launch an agent', 'launch agents', 'launch a new agent', 'spawn an agent', 'spawn agents',
        'start a session', 'start a new session', 'start sessions', 'start claude', 'launch claude', 'start pi', 'kick off an agent', 'start themselves', 'start by themselves',
      ],
      near: [['start', 'launch', 'spawn', 'kick off'], AGENTS, ['inbox', 'here', 'themselves', 'itself', 'new message', 'compose', 'own']],
    },
  },
  {
    id: 'notifications',
    answer: '开启通知和声音，并测试它们',
    action: { kind: 'settings-general', label: '打开设置 → 通用' },
    match: {
      whenBroken: true,
      phrases: ['notification', 'notifications', 'notify me', 'get notified', 'alert me', 'play a sound', 'a sound when', 'ping me', 'desktop alert', 'desktop alerts'],
    },
  },
  {
    id: 'theme',
    answer: '选择浅色或深色、文字大小和颜色',
    action: { kind: 'settings-general', label: '打开设置 → 通用' },
    feature: 'Settings, Appearance',
    match: {
      phrases: [
        'dark mode', 'light mode', 'dark theme', 'light theme', 'night mode', 'theme', 'themes', 'font size', 'text size', 'bigger text', 'smaller text', 'larger text',
        'bigger font', 'smaller font', 'larger font', 'text is too small', 'font is too small', 'color scheme', 'colour scheme', 'change the colors', 'change the colours', 'too bright',
      ],
    },
  },
  {
    id: 'keys',
    answer: '单键快捷键可以关闭',
    action: { kind: 'settings-general', label: '打开设置 → 通用' },
    match: {
      phrases: ['single key shortcuts', 'single letter shortcuts', 'turn off shortcuts', 'disable shortcuts', 'turn off keyboard shortcuts', 'disable keyboard shortcuts', 'turn off the shortcuts'],
      near: [
        ['key', 'keys', 'keyboard', 'shortcut', 'shortcuts', 'hotkey', 'hotkeys', 'letter', 'letters', 'keystrokes'],
        ['accident', 'accidentally', 'by mistake', 'triggers', 'triggered', 'fires', 'fired', 'while typing', 'when typing', 'turn off', 'disable', 'screen reader', 'dictation'],
      ],
    },
  },
  {
    id: 'bro-mode',
    answer: 'Bro 模式让 agent 用平实的语言给你写信',
    experimental: true,
    action: { kind: 'settings-experimental', label: '打开设置 → 功能' },
    match: {
      phrases: ['bro mode', 'plain english', 'plain language', 'plain words', 'explain like', 'eli5', 'too much jargon', 'less jargon', 'talk like a human'],
      near: [
        ['agent', 'agents', 'claude', 'message', 'messages', 'reply', 'replies', 'answers', 'writes', 'writing', 'text', 'tone'],
        ['jargon', 'technical', 'verbose', 'wordy', 'long winded', 'too long', 'too much text', 'hard to understand', 'hard to follow', 'simpler words'],
      ],
    },
  },
  {
    id: 'voice',
    answer: '用说的代替打字：开启语音',
    action: { kind: 'settings-voice', label: '打开设置 → 语音' },
    feature: 'Voice',
    match: {
      phrases: ['voice', 'dictate', 'dictation', 'speech to text', 'microphone', 'mic', 'talk instead of typing', 'speak instead of typing'],
    },
  },
  {
    id: 'machines',
    answer: '在这里查看你其他计算机上的 agent',
    action: { kind: 'settings-machines', label: '打开设置 → 计算机' },
    match: {
      phrases: [
        'other computer', 'other computers', 'another computer', 'second computer', 'two computers', 'multiple computers', 'other machine', 'other machines', 'another machine',
        'multiple machines', 'two machines', 'remote machine', 'remote machines', 'link machines', 'link my machines', 'link my computers', 'dev box', 'devbox',
      ],
    },
  },
  {
    id: 'snooze',
    answer: '从顶栏将会话设为稍后提醒',
    link: { label: '0.28.46 有哪些变化', href: `${RELEASE}v0.28.46` },
    feature: 'Snooze a thread',
    match: {
      phrases: ['snooze', 'snoozed', 'snoozing', 'remind me later', 'remind me tomorrow', 'remind me in', 'postpone', 'hide it until', 'hide until'],
    },
  },
  {
    id: 'star',
    answer: '从会话的 ⋯ 菜单星标会话',
    link: { label: '0.28.51 有哪些变化', href: `${RELEASE}v0.28.51` },
    feature: 'Star a thread',
    match: {
      phrases: [
        'star a thread', 'star threads', 'star thread', 'starred threads', 'starred thread', 'pin a thread', 'pin threads', 'pin thread', 'pinned threads', 'favorite a thread', 'favorite threads',
        'favourite a thread', 'favourite threads', 'mark as favorite', 'mark as favourite', 'bookmark a thread', 'bookmark threads',
      ],
    },
  },
  {
    id: 'unread',
    answer: '从行或标题栏把会话标记为未读',
    link: { label: '0.28.43 有哪些变化', href: `${RELEASE}v0.28.43` },
    feature: 'Mark unread',
    match: {
      phrases: ['mark unread', 'mark as unread', 'mark it unread', 'mark it as unread', 'keep unread', 'keep it unread', 'unread again', 'back to unread'],
    },
  },
  {
    id: 'checklist',
    answer: 'agent 可以在每个会话中保留步骤清单',
    action: { kind: 'settings-capabilities', label: '打开设置 → 功能' },
    match: {
      phrases: ['checklist', 'check list', 'todo list', 'to do list', 'todos', 'task list', 'list of steps'],
    },
  },
  {
    id: 'board',
    answer: '看板展示进行中的工作，每项工作一张卡片',
    action: { kind: 'settings-capabilities', label: '打开设置 → 功能' },
    match: {
      phrases: ['kanban', 'trello', 'project board', 'task board', 'board view', 'work in flight', 'what all my agents are doing', 'what every agent is doing', 'turn off the board', 'hide the board', 'disable the board'],
    },
  },
  {
    id: 'decision-mode',
    answer: '决策模式让你一次只回答一个决策',
    experimental: true,
    action: { kind: 'settings-experimental', label: '打开设置 → 功能' },
    match: {
      phrases: ['decision mode', 'too many questions', 'one question at a time'],
      near: [
        ['question', 'questions', 'decision', 'decisions'],
        ['one at a time', 'one by one', 'overwhelming', 'at once', 'step through', 'pile up', 'piling up'],
      ],
    },
  },
  {
    id: 'float-drafts',
    answer: '浮动回复草稿会把未发送的回复留在角落',
    experimental: true,
    action: { kind: 'settings-experimental', label: '打开设置 → 功能' },
    match: {
      phrases: ['float reply drafts', 'floating draft', 'floating drafts', 'floating reply', 'unsent reply', 'reply in a corner', 'draft in a corner'],
      near: [
        ['reply', 'replies', 'draft', 'drafts', 'what i typed', 'what i wrote'],
        ['lose', 'lost', 'losing', 'gone', 'switch threads', 'other thread', 'another thread', 'leave the thread', 'keep it open', 'while i read'],
      ],
    },
  },
  {
    id: 'plan-review-off',
    answer: 'Claude Code 中的计划评审可以关闭',
    link: { label: '0.28.52 中的方法', href: `${RELEASE}v0.28.52` },
    match: {
      whenBroken: true,
      phrases: ['turn off plan review', 'disable plan review', 'skip plan review', 'without plan review', 'no plan review', 'plan review off', 'planreview'],
      near: [
        ['plan review', 'plan reviews', 'plan mode', 'plan approval', 'exitplanmode'],
        ['turn off', 'disable', 'skip', 'bypass', 'opt out', 'every time', 'ssh', "don't want", 'do not want', 'annoying'],
      ],
    },
  },
  {
    id: 'updates',
    answer: 'Plannotator 可以自动保持最新',
    action: { kind: 'settings-about', label: '打开设置 → 关于' },
    match: {
      phrases: ['auto update', 'auto updates', 'autoupdate', 'automatic update', 'automatic updates', 'update automatically', 'updates automatically', 'keep it up to date', 'how do i update', 'how to update', 'how do i upgrade', 'how to upgrade', 'update plannotator', 'upgrade plannotator'],
    },
  },
  {
    id: 'prompts',
    answer: '更改 Plannotator 告诉 agent 的内容',
    action: { kind: 'settings-prompts', label: '打开设置 → 提示词' },
    match: {
      phrases: ['custom prompt', 'custom prompts', 'customize the prompt', 'edit the prompt', 'edit prompts', 'change the prompt', 'change the prompts', 'inbox reminder', 'agent instructions', 'custom instructions', 'what the agent is told', 'what agents are told'],
    },
  },
  {
    id: 'tour',
    answer: '重新进行两分钟导览',
    action: { kind: 'settings-general', label: '打开设置 → 通用' },
    match: {
      phrases: ['tour', 'onboarding', 'tutorial', 'walkthrough', 'how does this work', 'how does it work', 'how do i use this', 'how do i use it', 'getting started', 'where do i start'],
    },
  },
];

/** Lowercase, accents off, every run of other characters one space, a space at each end; apostrophes kept inside words ("doesn't"). */
function fold(text: string): string {
  const words = text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[’‘]/g, "'")
    .replace(/[^\p{L}\p{N}']+/gu, ' ')
    .replace(/'(?![\p{L}\p{N}])|(?<![\p{L}\p{N}])'/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return ` ${words} `;
}

/** A negation just before a word ("doesn't move", "no longer jumps"): praise, not a complaint. */
const NEGATED = /\b(doesn't|does not|don't|do not|never|no longer|not|stopped|stop)\s+(\S+\s+)?$/;
/** Something reported broken. */
const BROKEN =
  / (broken|broke|breaks|crash|crashes|crashed|crashing|error|errors|fails|failed|failing|bug|buggy|freezes|froze|frozen|hangs|blank)( |$)| (doesn't|does not|don't|do not|won't|will not|can't|cannot|can not|isn't|is not|aren't|are not|wasn't|stopped) (work|works|working|open|opens|load|loads|show|shows|showing|start|starts|run|runs|launch|appear|appears)( |$)/;
/** The subject and the symptom within this many words of each other. */
const WINDOW = 8;

/** Where each whole term starts, as word indexes, skipping negated ones. */
function positions(words: string[], terms: string[]): number[] {
  const found: number[] = [];
  for (const term of terms) {
    const parts = fold(term).trim().split(' ');
    for (let at = 0; at + parts.length <= words.length; at += 1) {
      if (parts.every((part, offset) => words[at + offset] === part) && !NEGATED.test(` ${words.slice(Math.max(0, at - 3), at).join(' ')} `.trimEnd() + ' ')) found.push(at);
    }
  }
  return found;
}

function matches(answer: KnownAnswer, folded: string, words: string[], broken: boolean): boolean {
  if (broken && !answer.match.whenBroken) return false;
  if (answer.match.phrases?.some((phrase) => folded.includes(fold(phrase)))) return true;
  const groups = answer.match.near;
  if (!groups?.length) return false;
  const found = groups.map((group) => positions(words, group));
  return found[0]!.some((start) => found.every((others) => others.some((at) => Math.abs(at - start) <= WINDOW)));
}

/** The one known answer for what is typed, or null. The first that matches wins; `hidden` ids are skipped (an answer this Inbox can't follow). */
export function knownAnswerFor(text: string, hidden: readonly string[] = []): KnownAnswer | null {
  const folded = fold(text.slice(0, 4000));
  if (!folded.trim()) return null;
  const words = folded.trim().split(' ');
  const broken = BROKEN.test(folded);
  return KNOWN_ANSWERS.find((answer) => !hidden.includes(answer.id) && matches(answer, folded, words, broken)) ?? null;
}

/**
 * The answers this Inbox can't follow, from its settings read: starting agents where it is not offered (Windows),
 * and a switch the Inbox does not report (an older Inbox). Nothing until settings load.
 */
export function hiddenKnownAnswers(
  settings: { launch?: { unsupported?: boolean }; board?: unknown; steps?: unknown; bro?: unknown; float_drafts?: unknown; experimental?: unknown } | null,
): string[] {
  if (!settings) return [];
  const missing = (value: unknown, id: string) => (value ? [] : [id]);
  return [
    ...(settings.launch?.unsupported ? ['start-agents'] : []),
    ...missing(settings.board, 'board'),
    ...missing(settings.steps, 'checklist'),
    ...missing(settings.bro, 'bro-mode'),
    ...missing(settings.float_drafts, 'float-drafts'),
    ...missing(settings.experimental, 'decision-mode'),
  ];
}
