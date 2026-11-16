import { defineShortcutScope } from '../core';
import { createShortcutScopeHook } from '../runtime';

/**
 * Moving around the repository in code review (approved design record
 * "review-explorer", step 3). VS Code's own default keys per system, so a
 * reviewer's hands already know them. None of them takes a key code review
 * used before; ⌘P / Ctrl+P is the browser's Print, replaced here in code
 * review only.
 */
export const reviewExplorerShortcuts = defineShortcutScope({
  id: 'review-explorer',
  title: '跳转',
  shortcuts: {
    goToFile: {
      description: '跳转到文件',
      bindings: ['Mod+P'],
      section: '跳转',
      hint: '在 Diff 读取的版本上对仓库中每个文件进行模糊搜索。更改过的文件会被标记，并在并列时优先；未输入内容时，显示你最近打开的文件。',
      preventDefault: true,
      displayOrder: 10,
    },
    goToDefinition: {
      description: '跳转到定义',
      bindings: ['F12', 'Mod+F12'],
      section: '跳转',
      hint: '指针下（或你最后点击）的符号。只有一个明确结果时，会在对应行打开其文件；有多个结果时打开引用面板。Mod+F12 适用于将 F12 留给开发者工具的浏览器。需要本地检出。',
      preventDefault: true,
      displayOrder: 20,
    },
    goToReferences: {
      description: '跳转到引用',
      bindings: ['Shift+F12'],
      section: '跳转',
      hint: '为指针下的符号打开引用面板。选择结果会在对应行打开其文件。',
      preventDefault: true,
      displayOrder: 30,
    },
    navigateBack: {
      description: '后退',
      bindings: ['Ctrl+-'],
      platformBindings: {
        mac: ['Ctrl+-'],
        windows: ['Alt+ArrowLeft'],
        linux: ['Ctrl+Alt+-'],
      },
      section: '跳转',
      hint: '回到上一次跳转（跳转到文件、跳转到定义、某个引用）开始的位置。始终停留在评审内。',
      preventDefault: true,
      displayOrder: 40,
    },
    navigateForward: {
      description: '前进',
      bindings: ['Ctrl+Shift+-'],
      platformBindings: {
        mac: ['Ctrl+Shift+-'],
        windows: ['Alt+ArrowRight'],
        linux: ['Ctrl+Shift+-'],
      },
      section: '跳转',
      displayOrder: 50,
      preventDefault: true,
    },
    nextChange: {
      description: '下一处更改',
      bindings: ['Alt+F5'],
      section: '跳转',
      hint: '当前文件中下一段连续更改的行；越过最后一段后，转到下一个有更改的文件。',
      preventDefault: true,
      displayOrder: 60,
    },
    previousChange: {
      description: '上一处更改',
      bindings: ['Shift+Alt+F5'],
      section: '跳转',
      preventDefault: true,
      displayOrder: 70,
    },
  },
});

export const useReviewExplorerShortcuts = createShortcutScopeHook(reviewExplorerShortcuts);
