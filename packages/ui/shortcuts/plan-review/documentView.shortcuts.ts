import { defineShortcutScope } from '../core';
import { createShortcutScopeHook } from '../runtime';

/**
 * Document-chrome view commands shared by plan review and annotate mode.
 *
 * Focus mode is the keyboard entry point to the same view state the document
 * card's `Focus` control drives: both side panels collapse in one press and the
 * previous arrangement comes back on the next one.
 *
 * Edit mode is its sibling: the same chord the card's `Edit` / `Done` control
 * drives, opening the markdown source editor in place and committing back to
 * the viewer — the scroll position survives both directions, so a mid-document
 * fix never costs a scroll to the top and back.
 */
export const documentViewShortcuts = defineShortcutScope({
  id: 'document-view',
  title: '文档视图',
  shortcuts: {
    toggleFocusMode: {
      description: '切换专注模式',
      bindings: ['Mod+.'],
      section: '视图',
      hint: '同时收起目录侧边栏和右侧面板；再次按下可恢复之前打开的内容。',
      displayOrder: 10,
      preventDefault: true,
    },
    toggleEditMode: {
      description: '切换编辑模式',
      bindings: ['Mod+E'],
      section: '视图',
      hint: '就地打开 Markdown 源编辑器，并保持滚动位置；再次按下会提交编辑并返回标注。',
      displayOrder: 20,
      preventDefault: true,
    },
  },
});

export const useDocumentViewShortcuts = createShortcutScopeHook(documentViewShortcuts);
