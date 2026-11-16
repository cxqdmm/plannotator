import { defineShortcutScope } from '../core';
import { createShortcutScopeHook } from '../runtime';

// Chords for the HTML and live-app annotate surfaces. Both are mirrored inside
// the sandboxed iframe by the bridge (focus usually lives in there on live
// apps) and forwarded to the parent, so they work regardless of which document
// owns the keyboard. No bare-letter binding: bare letters belong to
// type-to-comment and the page itself.
//
// `Mod+Shift+X` for the tools rather than a mnemonic letter: every mnemonic
// candidate is claimed by a browser (H = Chrome's Home / Firefox's history
// library, E/I/J/K/C = devtools, B/O = bookmarks, V = paste-as-plain-text,
// T = reopen tab), and a chord the browser eats is worse than an arbitrary
// one. X is unassigned in Chrome, Firefox, Safari and Edge on every platform.
export const htmlAnnotateShortcuts = defineShortcutScope({
  id: 'html-annotate',
  title: 'HTML 标注',
  shortcuts: {
    toggleAnnotateMode: {
      description: '切换标注模式',
      bindings: ['Mod+Shift+A'],
      section: '标注',
      hint: '在 HTML 和实时应用界面上：启用标注捕获，或把点击交还给页面。Esc 也会退出标注；此组合键是重新进入的方式。',
      preventDefault: true,
      displayOrder: 0,
    },
    toggleTools: {
      description: '显示或隐藏工具',
      bindings: ['Mod+Shift+X'],
      section: '标注',
      hint: '在 HTML 和实时应用界面上：顶栏的眼睛图标——显示或移除页面上所有浮动界面元素。HTML 界面打开时工具默认隐藏。',
      preventDefault: true,
      displayOrder: 1,
    },
  },
});

export const useHtmlAnnotateShortcuts = createShortcutScopeHook(htmlAnnotateShortcuts);
