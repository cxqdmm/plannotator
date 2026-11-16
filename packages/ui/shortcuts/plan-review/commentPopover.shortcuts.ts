import { defineShortcutScope } from '../core';

export const commentPopoverShortcuts = defineShortcutScope({
  id: 'comment-popover',
  title: '评论编辑器',
  shortcuts: {
    submit: {
      description: '提交评论',
      bindings: ['Mod+Enter'],
      hint: '开启设置 → 通用 → “Enter 保存评论”后，Enter 也可保存，Shift+Enter 会新增一行。',
      section: '标注',
      displayOrder: 30,
    },
    cancel: {
      description: '关闭评论',
      bindings: ['Escape'],
      section: '标注',
      hint: '评论编辑器打开时可用。',
      displayOrder: 40,
    },
    skillMenuOpen: {
      description: '引用 agent 技能（打开技能菜单）',
      bindings: ['/', '$'],
      section: '标注',
      hint: '在评论编辑器里于词首输入 / 或 $ 可打开技能菜单；继续输入可筛选。默认不预选任何项：在你用方向键选中一行（或点击一行）之前，Enter 始终是换行；选中后按 Enter 或 Tab 可插入。Escape 会关闭菜单。',
      displayOrder: 50,
    },
  },
});
