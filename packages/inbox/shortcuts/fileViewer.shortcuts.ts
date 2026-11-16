import { defineShortcutScope, htmlAnnotateShortcuts } from '@plannotator/ui/shortcuts';

/**
 * The keys of an open file (AttachmentPane): beside the thread and full
 * screen. Wired with `useShortcutScope`; when each one stands down is in
 * `guards.ts`, `stepKeyIntent` (stepping.ts) and the Escape ladder
 * (escapeLadder.ts).
 */
export const inboxFileViewerShortcuts = defineShortcutScope({
  id: 'inbox-file-viewer',
  title: '打开文件',
  lettersByCode: true,
  shortcuts: {
    escape: {
      description: '关闭当前打开的内容，然后退出全屏',
      bindings: ['Escape'],
      section: '文件',
      hint: '每按一次只关闭一层，从最内层开始：菜单或文件列表、正在撰写的评论（文字会保留，再次打开文件时会回来）、评论抽屉、标注（HTML 会切换到交互）；然后全屏结束，文件回到会话旁（在手机上回到会话）。不会先询问。在交互模式下，页面自己使用的 Escape 仍归页面。',
      preventDefault: true,
      displayOrder: 0,
    },
    next: {
      description: '会话中的下一个文件',
      bindings: [']', 'ArrowRight'],
      section: '文件',
      hint: '输入文字时、菜单中，或方向键用于滚动或移动某处时不生效。在会话旁时，从文件内部也可用。',
      preventDefault: true,
      displayOrder: 1,
    },
    previous: {
      description: '会话中的上一个文件',
      bindings: ['[', 'ArrowLeft'],
      section: '文件',
      hint: '输入文字时、菜单中，或方向键用于滚动或移动某处时不生效。在会话旁时，从文件内部也可用。',
      preventDefault: true,
      displayOrder: 2,
    },
    toggleTools: {
      description: '隐藏或显示全屏工具栏',
      // The html-annotate chord, from its one definition: the same keys hide the tools in plan review.
      bindings: htmlAnnotateShortcuts.shortcuts.toggleTools.bindings,
      section: '文件',
      hint: 'HTML 文件全屏时。在页面内部也可用。',
      preventDefault: true,
      displayOrder: 3,
    },
    toggleAnnotate: {
      description: '标注或交互',
      // The html-annotate chord, as the tooltip says: from anywhere in the open HTML file, not only inside the page.
      bindings: htmlAnnotateShortcuts.shortcuts.toggleAnnotateMode.bindings,
      section: '文件',
      hint: 'HTML 文件：标注模式把点击用于评论，交互模式则把点击交给页面。',
      preventDefault: true,
      displayOrder: 4,
    },
  },
});
