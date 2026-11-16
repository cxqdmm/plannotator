/**
 * Every word of the "Star the repo" ask (approval "star-ask"), in one place so they can be swapped in one edit. The
 * owner's pick (q-bc8be138, 2026-11-06): the short words everywhere, the Inbox's corner card and the done screen's card
 * alike, with no "We'll only ask once." line.
 *
 * The art's words (`art`) are drawn in two subset faces (utils/starAskFonts.ts): lower-case a-z, space, "?", "." and
 * "!" for the big line, a-z, space and "·" for the small row. The big line is solved to the measure at run time, so a
 * new word still fills it.
 */
export const STAR_ASK_WORDS = {
  title: '给 Plannotator 点个 Star 吗？',
  body: '它免费且开源。一个 Star 能让更多人发现它，也能帮我们把它做下去。',
  notNow: '暂时不要',
  star: '在 GitHub 上加星标',
  starring: '加星标中…',
  /** gh starred it. */
  starred: '已加星标，谢谢！',
  /** The link opened GitHub in a new tab (no gh, or gh could not check). */
  opened: '谢谢！GitHub 已在新标签页中打开。',
  /** gh could not star it on the click (a token not allowed to star, the network): the link follows. */
  failed: '无法从这里加星标。',
  openGitHub: '打开 GitHub',
  close: '关闭',
  art: {
    label: 'plannotator · open source',
    ask: 'a small ask',
    after: 'decided · recorded',
    big: 'star it?',
    bigAfter: 'starred.',
  },
} as const;

export type StarAskWords = typeof STAR_ASK_WORDS;
