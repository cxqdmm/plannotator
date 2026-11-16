import { defineShortcutScope } from '../core';
import { createShortcutScopeHook } from '../runtime';

export const annotationToolbarShortcuts = defineShortcutScope({
  id: 'annotation-toolbar',
  title: '标注工具栏',
  shortcuts: {
    typeToComment: {
      description: '开始评论',
      bindings: ['A-Z'],
      section: '标注',
      hint: '输入字母会用该字符打开评论编辑器。',
      displayOrder: 10,
    },
    applyQuickLabel: {
      description: '应用工具栏标签',
      bindings: ['Alt+1-0'],
      section: '标注',
      hint: '标注工具栏打开时，应用对应的预设标签。',
      displayOrder: 20,
    },
    applyQuickLabelFromPicker: {
      description: '应用选择器标签',
      bindings: ['1-0'],
      section: '标注',
      hint: '快速标签选择器打开时可用。',
      displayOrder: 30,
    },
    close: {
      description: '关闭工具栏',
      bindings: ['Escape'],
      section: '标注',
      hint: '标注工具栏打开时可用。',
      displayOrder: 40,
    },
  },
});

export const useAnnotationToolbarShortcuts = createShortcutScopeHook(annotationToolbarShortcuts);
