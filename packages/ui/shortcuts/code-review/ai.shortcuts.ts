import { defineShortcutScope } from '../core';
import { createShortcutScopeHook } from '../runtime';

export const reviewAiShortcuts = defineShortcutScope({
  id: 'review-ai',
  title: 'AI 助手',
  shortcuts: {
    submit: {
      description: '发送消息',
      bindings: ['Mod+Enter'],
      section: 'AI 助手',
      hint: '在 AI 标签页和行内“询问 AI”输入框中可用。',
      displayOrder: 10,
    },
    cancel: {
      description: '取消行内 AI 输入',
      bindings: ['Escape'],
      section: 'AI 助手',
      hint: '在行内“询问 AI”输入框中可用。',
      displayOrder: 20,
    },
  },
});

export const useReviewAiShortcuts = createShortcutScopeHook(reviewAiShortcuts);
