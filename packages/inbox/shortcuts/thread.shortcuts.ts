import { defineShortcutScope } from '@plannotator/ui/shortcuts';

/**
 * The thread's keys. Mark read and Undo (App.tsx) also act on the list's
 * focused row; the rest act on the open thread (Thread.tsx). Every single key
 * stands down while typing, while an input method composes, under a dialog or
 * menu, and when single-key shortcuts are off (guards.ts `bareKeyAllowed`).
 */
export const inboxThreadShortcuts = defineShortcutScope({
  id: 'inbox-thread',
  title: '会话',
  lettersByCode: true,
  shortcuts: {
    markRead: {
      description: '标记已读，或移回原位',
      bindings: ['E'],
      section: '列表',
      hint: '作用于键盘所在的行，否则作用于打开的会话。仅在有内容等你处理时可用。',
      preventDefault: true,
      displayOrder: 5,
    },
    undo: {
      description: '撤销',
      bindings: ['Z'],
      section: '列表',
      hint: '当提示条显示“撤销”时可用。',
      preventDefault: true,
      displayOrder: 6,
    },
    // Shift+E and H (approval "inbox-keyboard-keys-2026-11-07", items 2 and 3). Snooze is H, not Gmail's B: B is the
    // second key of G B (Go to the Board), so a G that lapsed would turn into a snooze; H is the approval's fallback.
    archive: {
      // App.tsx, beside E: the row the keyboard is on, else the open thread; Z undoes, as the toast's Undo.
      description: '归档',
      bindings: ['Shift+E'],
      section: '列表',
      hint: '作用于键盘所在的行，否则作用于打开的会话。按 Z 撤销。',
      preventDefault: true,
      displayOrder: 5.1,
    },
    snooze: {
      // InboxList.tsx (a row the keyboard is on: its menu at the times) and Thread.tsx (the header ⋯ menu at the times).
      description: '稍后提醒…',
      bindings: ['H'],
      section: '列表',
      hint: '打开稍后提醒的时间选项；它不会自行稍后提醒。仅在“稍后提醒”可见处可用。',
      preventDefault: true,
      displayOrder: 5.2,
    },
    reply: {
      description: '回复',
      bindings: ['R'],
      section: '会话',
      hint: '打开回复框（或已保留的草稿），光标置于其中。在文件中也可用。',
      preventDefault: true,
      displayOrder: 0,
    },
    send: {
      // The reply box's and compose's own keydown (Thread.tsx, ComposeDialog.tsx) match this binding, and so does
      // Thread.tsx's handler for the closed foot's Send (from any focus in the thread), the full-screen composer's card,
      // and the Reviews stack view's Reply box (pulls/PullsPage.tsx).
      description: '发送',
      bindings: ['Mod+Enter'],
      section: '会话',
      hint: '在打开的会话中任何显示“发送”的位置（你的选择、备注、回复框）、新消息中，以及评审下 PR 的回复中。菜单或对话框打开时不生效。',
      preventDefault: true,
      displayOrder: 1,
    },
    // J / K are threads, Shift+J / Shift+K messages (approval "inbox-keyboard-shortcuts", J/K swap addendum
    // 2026-10-27: the owner moves between threads far more often than between messages; Gmail and Superhuman agree).
    nextThread: {
      // App.tsx: the list's order as shown, folded Quiet left out; no wrap; replaces the thread in history. With no
      // thread open, J / K move along the list's rows as ↓ ↑ do (nothing opens).
      description: '下一个会话',
      bindings: ['J'],
      section: '会话',
      hint: '有会话打开时，打开下方那一条，方式同 Enter；返回仍回到列表。否则移到下一行。',
      preventDefault: true,
      displayOrder: 2,
    },
    previousThread: {
      description: '上一个会话',
      bindings: ['K'],
      section: '会话',
      preventDefault: true,
      displayOrder: 3,
    },
    nextMessage: {
      description: '下一条消息',
      bindings: ['Shift+J'],
      section: '会话',
      hint: '在列表中也可用：焦点会移入打开的会话。',
      preventDefault: true,
      displayOrder: 3.1,
    },
    previousMessage: {
      description: '上一条消息',
      bindings: ['Shift+K'],
      section: '会话',
      preventDefault: true,
      displayOrder: 3.2,
    },
    firstNew: {
      description: '第一条新消息',
      bindings: ['N'],
      section: '会话',
      preventDefault: true,
      displayOrder: 4,
    },
    openNewest: {
      description: '打开最新的文件',
      bindings: ['O'],
      section: '会话',
      hint: '以你上次选择的视图打开；随后用 ] 和 [ 逐个切换其他文件。',
      preventDefault: true,
      displayOrder: 5,
    },
    artifacts: {
      // Thread.tsx: the header's Artifacts button (approval "inbox-keyboard-keys-2026-11-07", item 1). O's sibling.
      description: '产物：会话中的每个文件',
      bindings: ['Shift+O'],
      section: '文件',
      hint: '打开网格，再按一次回到会话。方向键可在磁贴之间移动。',
      preventDefault: true,
      displayOrder: 5.1,
    },
    openItems: {
      // Thread.tsx: the same list the "N open questions" button opens, with focus on its first row. Only where that
      // button shows; with the list open, Q is the menu's type-ahead (guards.ts: a key from inside a menu is its own).
      description: '打开的问题和行动项',
      bindings: ['Q'],
      section: '会话',
      hint: '打开此会话中仍未处理内容的列表；然后用 ↑ ↓ 和 Enter 跳转到某一项。仅在其按钮可见处可用。',
      preventDefault: true,
      displayOrder: 5.5,
    },
    fullScreen: {
      // Thread.tsx: never saved as the view files open in (only the Full screen button is a choice).
      description: '全屏',
      bindings: ['F'],
      section: '会话',
      hint: '已打开的文件，否则为最新的文件。再按 F 或按 Escape 返回。',
      preventDefault: true,
      displayOrder: 6,
    },
    messageMenu: {
      // CopyMenus.tsx MessageMenu: a message's ⋯ menu from its head (the context-menu key too), as rows and cards.
      description: '消息菜单',
      bindings: ['Shift+F10'],
      section: '会话',
      displayOrder: 8,
    },
    close: {
      // App.tsx: a guided review, then the Artifacts view, then full screen, then the thread.
      description: '关闭，一次一层',
      bindings: ['Escape'],
      section: '全局',
      displayOrder: 9,
    },
  },
});
