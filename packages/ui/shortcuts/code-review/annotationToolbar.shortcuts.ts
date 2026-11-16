import { defineShortcutScope } from '../core';
import { createShortcutScopeHook } from '../runtime';

export const reviewAnnotationToolbarShortcuts = defineShortcutScope({
  id: 'review-annotation-toolbar',
  title: '评审标注工具栏',
  shortcuts: {
    submitComment: {
      description: '提交评论',
      bindings: ['Mod+Enter'],
      hint: '开启设置 → 通用 → “Enter 保存评论”后，Enter 也可保存，Shift+Enter 会新增一行。',
      section: '标注',
      displayOrder: 10,
    },
    indentSuggestedCode: {
      description: '缩进建议的代码',
      bindings: ['Tab'],
      section: '标注',
      displayOrder: 20,
    },
    cancel: {
      description: '关闭评论编辑器',
      bindings: ['Escape'],
      section: '标注',
      hint: '评审评论编辑器打开时可用。',
      displayOrder: 30,
    },
  },
});

export const useReviewAnnotationToolbarShortcuts = createShortcutScopeHook(reviewAnnotationToolbarShortcuts);
