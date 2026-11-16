import { defineShortcutScope } from '../core';
import { createShortcutScopeHook } from '../runtime';

export const annotationPanelShortcuts = defineShortcutScope({
  id: 'annotation-panel',
  title: '标注面板',
  shortcuts: {
    saveEdit: {
      description: '保存标注编辑',
      bindings: ['Mod+Enter'],
      section: '标注',
      hint: '在侧边栏编辑标注时可用。开启设置 → 通用 → “Enter 保存评论”后，Enter 也可保存。',
      displayOrder: 50,
    },
    cancelEdit: {
      description: '取消标注编辑',
      bindings: ['Escape'],
      section: '标注',
      hint: '在侧边栏编辑标注时可用。',
      displayOrder: 60,
    },
  },
});

export const useAnnotationPanelShortcuts = createShortcutScopeHook(annotationPanelShortcuts);
