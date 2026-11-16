import { defineShortcutScope } from '../core';
import { createShortcutScopeHook } from '../runtime';

export const annotateSidebarShortcuts = defineShortcutScope({
  id: 'annotate-sidebar',
  title: '标注侧边栏',
  shortcuts: {
    toggleContents: {
      description: '切换目录侧边栏',
      bindings: ['Mod+B'],
      section: '侧边栏',
      displayOrder: 10,
      preventDefault: true,
    },
    toggleFiles: {
      description: '切换文件侧边栏',
      bindings: ['Mod+Shift+B'],
      section: '侧边栏',
      hint: '显示文件标签页时可用。',
      displayOrder: 20,
      preventDefault: true,
    },
    toggleAgentTui: {
      description: '切换 Agent TUI 侧边栏',
      bindings: ['Shift Shift'],
      section: '侧边栏',
      hint: '显示 Agent 控件时可用。',
      displayOrder: 30,
      preventDefault: true,
    },
  },
});

export const useAnnotateSidebarShortcuts = createShortcutScopeHook(annotateSidebarShortcuts);
