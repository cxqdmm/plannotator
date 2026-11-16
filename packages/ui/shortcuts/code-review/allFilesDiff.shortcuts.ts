import { defineShortcutScope } from '../core';
import { createShortcutScopeHook } from '../runtime';

export const reviewAllFilesDiffShortcuts = defineShortcutScope({
  id: 'review-all-files-diff',
  title: '所有文件 Diff 视图',
  shortcuts: {
    toggleCollapse: {
      description: '折叠/展开当前文件',
      bindings: ['X'],
      section: '所有文件视图',
      hint: '所有文件 Diff 面板处于活动状态时可用。',
      displayOrder: 10,
    },
    undoCollapse: {
      description: '重新展开最近折叠的文件',
      bindings: ['Z'],
      section: '所有文件视图',
      hint: '重新打开当前位置或上方最近的已折叠文件（切换“已查看”时也会触发折叠）。',
      displayOrder: 20,
    },
    addFileComment: {
      description: '添加文件级评论',
      bindings: ['C'],
      section: '所有文件视图',
      hint: '为当前文件打开文件级评论浮层。',
      displayOrder: 30,
    },
    nextFile: {
      description: '滚动到下一个文件',
      bindings: [']'],
      section: '所有文件视图',
      hint: '仅适用于所有文件面板。',
      displayOrder: 40,
    },
    prevFile: {
      description: '滚动到上一个文件',
      bindings: ['['],
      section: '所有文件视图',
      hint: '仅适用于所有文件面板。',
      displayOrder: 50,
    },
  },
});

export const useReviewAllFilesDiffShortcuts = createShortcutScopeHook(reviewAllFilesDiffShortcuts);
