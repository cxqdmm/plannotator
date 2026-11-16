import { defineShortcutScope } from '../core';
import { createShortcutScopeHook } from '../runtime';

export const viewerShortcuts = defineShortcutScope({
  id: 'viewer',
  title: '查看器',
  shortcuts: {
    copySelection: {
      description: '复制所选文本',
      bindings: ['Mod+C'],
      section: '标注',
      displayOrder: 25,
    },
    closeLightbox: {
      description: '关闭图片灯箱',
      bindings: ['Escape'],
      section: '标注',
      hint: '图片在灯箱中打开时可用。',
      displayOrder: 70,
    },
  },
});

export const useViewerShortcuts = createShortcutScopeHook(viewerShortcuts);
