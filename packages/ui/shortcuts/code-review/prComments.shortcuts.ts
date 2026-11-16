import { defineShortcutScope } from '../core';
import { createShortcutScopeHook } from '../runtime';

export const reviewPrCommentsShortcuts = defineShortcutScope({
  id: 'review-pr-comments',
  title: 'PR 评论',
  shortcuts: {
    focusSearch: {
      description: '聚焦 PR 评论搜索',
      bindings: ['Mod+Shift+F'],
      section: 'PR 评论',
      hint: '评审侧边栏中 PR 评论标签页打开时可用。',
      displayOrder: 10,
    },
  },
});

export const useReviewPrCommentsShortcuts = createShortcutScopeHook(reviewPrCommentsShortcuts);
