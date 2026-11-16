import { defineShortcutScope } from '../core';

// Heads-up for future migrators: these bindings (`Alt hold`, `Alt Alt`) are
// declarative metadata for the help modal and marketing docs. They do NOT
// dispatch through `useShortcutScope`. `Alt Alt` works via
// `useDoubleTapShortcuts`; `Alt hold` has no shared hook yet — it's wired
// today by the bespoke `useInputMethodSwitch` hook in
// `packages/editor/hooks/`. See the comment block above
// `useDoubleTapShortcuts` in `packages/ui/shortcuts/runtime.ts`.

export const inputMethodShortcuts = defineShortcutScope({
  id: 'input-method',
  title: '输入方式',
  shortcuts: {
    temporarySwitch: {
      description: '临时切换输入方式',
      bindings: ['Alt hold'],
      section: '输入方式',
      hint: '按住 Alt 在“选择”和“精准定位”之间切换，松开后恢复。',
      displayOrder: 10,
    },
    toggleSwitch: {
      description: '切换输入方式',
      bindings: ['Alt Alt'],
      section: '输入方式',
      hint: '双击 Alt 在“选择”和“精准定位”之间切换，直到再次切换。',
      displayOrder: 20,
    },
  },
});
