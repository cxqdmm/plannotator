import { defineShortcutScope } from '../core';
import { createShortcutScopeHook } from '../runtime';

export const reviewFileTreeShortcuts = defineShortcutScope({
  id: 'review-file-tree',
  title: '文件导航',
  shortcuts: {
    nextFile: {
      description: '下一个文件',
      bindings: ['J', 'ArrowDown'],
      section: '文件导航',
      displayOrder: 10,
    },
    prevFile: {
      description: '上一个文件',
      bindings: ['K', 'ArrowUp'],
      section: '文件导航',
      displayOrder: 20,
    },
    firstFile: {
      description: '第一个文件',
      bindings: ['Home'],
      section: '文件导航',
      displayOrder: 30,
    },
    lastFile: {
      description: '最后一个文件',
      bindings: ['End'],
      section: '文件导航',
      displayOrder: 40,
    },
  },
});

export const useReviewFileTreeShortcuts = createShortcutScopeHook(reviewFileTreeShortcuts);
