import { defineShortcutScope } from './core';

/**
 * The header decision control's note composer (shortcuts root, not
 * plan-review/ or code-review/: both apps mount the identical control with
 * identical semantics).
 *
 * Documents ONLY the chords the control actually implements — bindings must
 * match shipped behavior (`DecisionControl.tsx`). Enter is a newline in the
 * note field and must never be documented as submit.
 */
export const decisionControlShortcuts = defineShortcutScope({
  id: 'decision-control',
  title: '决策控件',
  shortcuts: {
    submitNote: {
      description: '把备注随所选决策一起发送',
      bindings: ['Mod+Enter'],
      section: '操作',
      hint: '当决策控件的备注框打开时可用。Enter 会插入换行。',
      displayOrder: 12,
    },
    closeNote: {
      description: '返回决策菜单，并保留备注',
      bindings: ['Escape'],
      section: '操作',
      hint: '当决策控件的备注框打开时可用。',
      displayOrder: 14,
    },
  },
});
