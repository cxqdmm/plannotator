import { defineShortcutScope } from '../core';
import { createShortcutScopeHook } from '../runtime';

export const reviewMarkdownPreviewShortcuts = defineShortcutScope({
  id: 'review-markdown-preview',
  title: 'Markdown 文件',
  shortcuts: {
    cycleMarkdownView: {
      description: '将当前 Markdown 文件切换为源码、更改或阅读视图（下一个视图）',
      bindings: ['P'],
      section: 'Markdown 文件',
      hint: '作用于打开的文件；在“所有文件”中则为视图顶部的文件。新增和删除的文件没有“更改”视图。你未手动设置过的 Markdown 文件会跟随你的选择。',
      displayOrder: 10,
    },
  },
});

export const useReviewMarkdownPreviewShortcuts = createShortcutScopeHook(reviewMarkdownPreviewShortcuts);
