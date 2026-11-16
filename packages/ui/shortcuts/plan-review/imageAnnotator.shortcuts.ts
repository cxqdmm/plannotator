import { defineShortcutScope } from '../core';
import { createShortcutScopeHook } from '../runtime';

export const imageAnnotatorShortcuts = defineShortcutScope({
  id: 'image-annotator',
  title: '图片标注器',
  shortcuts: {
    penTool: {
      description: '画笔工具',
      bindings: ['1'],
      section: '图片标注器',
      displayOrder: 10,
    },
    arrowTool: {
      description: '箭头工具',
      bindings: ['2'],
      section: '图片标注器',
      displayOrder: 20,
    },
    circleTool: {
      description: '圆形工具',
      bindings: ['3'],
      section: '图片标注器',
      displayOrder: 30,
    },
    undo: {
      description: '撤销',
      bindings: ['Mod+Z'],
      section: '图片标注器',
      preventDefault: true,
      displayOrder: 40,
    },
    redo: {
      description: '重做',
      bindings: ['Mod+Shift+Z', 'Mod+Y'],
      section: '图片标注器',
      preventDefault: true,
      displayOrder: 50,
    },
    save: {
      description: '保存并关闭标注器',
      bindings: ['Enter', 'Escape'],
      section: '图片标注器',
      preventDefault: true,
      hint: '图片名称输入框获得焦点时，Escape 会先使其失焦，Enter 会确认名称；其他情况下两者都会关闭标注器。',
      displayOrder: 60,
    },
  },
});

export const useImageAnnotatorShortcuts = createShortcutScopeHook(imageAnnotatorShortcuts);
