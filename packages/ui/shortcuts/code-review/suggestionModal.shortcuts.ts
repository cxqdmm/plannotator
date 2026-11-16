import { defineShortcutScope } from '../core';
import { createShortcutScopeHook } from '../runtime';

export const reviewSuggestionModalShortcuts = defineShortcutScope({
  id: 'review-suggestion-modal',
  title: '建议编辑器',
  shortcuts: {
    indent: {
      description: '缩进（插入空格）',
      bindings: ['Tab'],
      section: '建议编辑器',
      hint: '在展开的建议编辑器中可用。',
      displayOrder: 10,
    },
    close: {
      description: '关闭建议编辑器',
      bindings: ['Escape'],
      section: '建议编辑器',
      hint: '关闭弹窗；建议文本会保留在底层的评论上。',
      displayOrder: 20,
    },
  },
});

export const useReviewSuggestionModalShortcuts = createShortcutScopeHook(reviewSuggestionModalShortcuts);
