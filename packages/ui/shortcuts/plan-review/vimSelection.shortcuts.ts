import { defineShortcutScope } from '../core';
import { createShortcutScopeHook } from '../runtime';

/**
 * Modal document-navigation commands shared by plan review and annotate mode.
 *
 * The bindings are active only while the opted-in document focus surface owns
 * focus; native controls and annotation composers remain outside this scope.
 */
export const vimSelectionShortcuts = defineShortcutScope({
  id: 'vim-selection',
  title: 'Vim 选择',
  shortcuts: {
    moveDown: {
      description: '下一个块或语义同级',
      bindings: ['J'],
      section: 'Vim 文档导航',
      displayOrder: 10,
    },
    moveUp: {
      description: '上一个块或语义同级',
      bindings: ['K'],
      section: 'Vim 文档导航',
      displayOrder: 20,
    },
    documentStart: {
      description: '文档开头',
      bindings: ['G G'],
      section: 'Vim 文档导航',
      displayOrder: 30,
      preventDefault: true,
    },
    documentEnd: {
      description: '文档结尾',
      bindings: ['Shift+G'],
      section: 'Vim 文档导航',
      displayOrder: 40,
    },
    moveOut: {
      description: '移到所在目标',
      bindings: ['H'],
      section: 'Vim 文档导航',
      displayOrder: 50,
    },
    refine: {
      description: '细化到子级或文本',
      bindings: ['L'],
      section: 'Vim 文档导航',
      displayOrder: 60,
    },
    visual: {
      description: '切换精确可视选择',
      bindings: ['V'],
      section: 'Vim 文档导航',
      displayOrder: 70,
    },
    visualBlock: {
      description: '切换整块可视选择',
      bindings: ['Shift+V'],
      section: 'Vim 文档导航',
      hint: '使用 j / k 按整块扩展。',
      displayOrder: 80,
    },
    wordForward: {
      description: '移到下一个词',
      bindings: ['W'],
      section: 'Vim 文本导航',
      displayOrder: 90,
    },
    wordBackward: {
      description: '移到上一个词',
      bindings: ['B'],
      section: 'Vim 文本导航',
      displayOrder: 100,
    },
    wordEnd: {
      description: '移到词尾',
      bindings: ['E'],
      section: 'Vim 文本导航',
      displayOrder: 110,
    },
    lineStart: {
      description: '移到行首',
      bindings: ['0'],
      section: 'Vim 文本导航',
      displayOrder: 120,
    },
    lineEnd: {
      description: '移到行尾',
      bindings: ['$'],
      section: 'Vim 文本导航',
      displayOrder: 130,
    },
    previousTextBlock: {
      description: '移到上一个文本块',
      bindings: ['{'],
      section: 'Vim 文本导航',
      displayOrder: 140,
    },
    nextTextBlock: {
      description: '移到下一个文本块',
      bindings: ['}'],
      section: 'Vim 文本导航',
      displayOrder: 150,
    },
    swapSelectionEnds: {
      description: '交换选区两端',
      bindings: ['O'],
      section: 'Vim 文本导航',
      displayOrder: 160,
    },
    activeAnnotation: {
      description: '使用当前标注模式',
      bindings: ['Enter'],
      section: 'Vim 标注操作',
      displayOrder: 170,
    },
    annotationMenu: {
      description: '打开标注操作',
      bindings: ['Space'],
      section: 'Vim 标注操作',
      displayOrder: 180,
    },
    comment: {
      description: '评论所选内容或目标',
      bindings: ['C'],
      section: 'Vim 标注操作',
      displayOrder: 190,
    },
    redline: {
      description: '将所选内容或目标标记为删除',
      bindings: ['D'],
      section: 'Vim 标注操作',
      displayOrder: 200,
    },
    markup: {
      description: '标记所选内容或目标',
      bindings: ['M'],
      section: 'Vim 标注操作',
      displayOrder: 210,
    },
    label: {
      description: '为所选内容或目标添加标签',
      bindings: ['T'],
      section: 'Vim 标注操作',
      displayOrder: 220,
    },
    copy: {
      description: '复制所选内容或目标',
      bindings: ['Y'],
      section: 'Vim 标注操作',
      displayOrder: 230,
    },
    cancel: {
      description: '取消当前 Vim 状态',
      bindings: ['Escape'],
      section: 'Vim 标注操作',
      displayOrder: 240,
    },
    help: {
      description: '切换键位图',
      bindings: ['?'],
      section: 'Vim 标注操作',
      displayOrder: 250,
    },
  },
});

/** Stable action identifiers emitted by the Vim selection shortcut scope. */
export type VimSelectionActionId = keyof typeof vimSelectionShortcuts.shortcuts;

/** Vim navigation state used to make HUD command descriptions contextual. */
export type VimSelectionHudContext =
  | 'inactive'
  | 'block'
  | 'inline'
  | 'text'
  | 'visual'
  | 'visual-block'
  | 'action';

/**
 * Return the user-facing HUD description for a handled Vim action.
 *
 * Contextual movement keys keep one registered shortcut while accurately
 * describing whether they moved by document structure, line, or character.
 */
export function describeVimSelectionAction(
  actionId: VimSelectionActionId,
  context: VimSelectionHudContext,
): string {
  switch (actionId) {
    case 'moveDown':
      if (context === 'inline') return '下一个语义同级';
      if (context === 'text' || context === 'visual') return '下一行';
      if (context === 'visual-block') return '扩展到下一个块';
      return '下一个块';
    case 'moveUp':
      if (context === 'inline') return '上一个语义同级';
      if (context === 'text' || context === 'visual') return '上一行';
      if (context === 'visual-block') return '扩展到上一个块';
      return '上一个块';
    case 'moveOut':
      return context === 'text' || context === 'visual'
        ? '向左移动一个字符'
        : '移到所在目标';
    case 'refine':
      return context === 'text' || context === 'visual'
        ? '向右移动一个字符'
        : '细化到子级或文本';
    case 'visual':
      return context === 'visual'
        ? '返回普通模式'
        : '开始可视选择';
    case 'visualBlock':
      return context === 'visual-block'
        ? '返回块导航'
        : '选中整个块';
    case 'documentStart':
    case 'documentEnd':
    case 'wordForward':
    case 'wordBackward':
    case 'wordEnd':
    case 'lineStart':
    case 'lineEnd':
    case 'previousTextBlock':
    case 'nextTextBlock':
    case 'swapSelectionEnds':
    case 'activeAnnotation':
    case 'annotationMenu':
    case 'comment':
    case 'redline':
    case 'markup':
    case 'label':
    case 'copy':
    case 'cancel':
    case 'help':
      return vimSelectionShortcuts.shortcuts[actionId].description;
  }
}

/** Parse an unknown bridge value into a registered Vim action identifier. */
export function isVimSelectionActionId(
  value: unknown,
): value is VimSelectionActionId {
  return typeof value === 'string'
    && Object.prototype.hasOwnProperty.call(vimSelectionShortcuts.shortcuts, value);
}

/** Bind Vim selection handlers to the opted-in document focus surface. */
export const useVimSelectionShortcuts = createShortcutScopeHook(vimSelectionShortcuts);
