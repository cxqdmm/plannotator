import { defineShortcutScope } from './core';
import { createShortcutScopeHook } from './runtime';

export const historyShortcuts = defineShortcutScope({
  id: 'history',
  title: '历史记录',
  shortcuts: {
    undo: {
      description: '撤销标注更改',
      bindings: ['Mod+Z'],
      section: '历史记录',
      preventDefault: true,
      displayOrder: 10,
    },
    redo: {
      description: '重做标注更改',
      bindings: ['Mod+Shift+Z', 'Mod+Y'],
      section: '历史记录',
      preventDefault: true,
      displayOrder: 20,
    },
  },
});

export const useHistoryShortcuts = createShortcutScopeHook(historyShortcuts);
