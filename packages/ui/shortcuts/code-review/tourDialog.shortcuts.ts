import { defineShortcutScope } from '../core';
import { createShortcutScopeHook } from '../runtime';

export const reviewTourDialogShortcuts = defineShortcutScope({
  id: 'review-tour-dialog',
  title: '导览对话框',
  shortcuts: {
    close: {
      description: '关闭导览',
      bindings: ['Escape'],
      section: '导览',
      hint: '代码导览对话框打开时可用。',
      displayOrder: 10,
    },
  },
});

export const useReviewTourDialogShortcuts = createShortcutScopeHook(reviewTourDialogShortcuts);
