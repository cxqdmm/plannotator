import {
  annotationModeShortcuts,
  annotationPanelShortcuts,
  annotationToolbarShortcuts,
  annotateSidebarShortcuts,
  commentPopoverShortcuts,
  decisionControlShortcuts,
  createShortcutRegistry,
  createShortcutScopeHook,
  defineShortcutScope,
  documentViewShortcuts,
  goalSetupShortcuts,
  historyShortcuts,
  htmlAnnotateShortcuts,
  imageAnnotatorShortcuts,
  inputMethodShortcuts,
  viewerShortcuts,
  vimSelectionShortcuts,
  type ShortcutSurface,
} from '@plannotator/ui/shortcuts';

export const planEditorShortcuts = defineShortcutScope({
  id: 'plan-editor',
  title: '计划编辑器',
  shortcuts: {
    submitPlan: {
      description: '通过 / 发送反馈',
      bindings: ['Mod+Enter'],
      section: '操作',
      hint: '没有标注时通过，有标注时发送反馈。',
      displayOrder: 10,
    },
    submitAnnotations: {
      description: '完成 / 发送反馈（以顶栏显示为准）',
      bindings: ['Mod+Enter'],
      section: '操作',
      hint: '触发顶栏的主操作：无内容可发送时为“完成”（门禁模式下为“通过”），否则为“发送反馈”。',
      displayOrder: 10,
    },
    openDecisionNote: {
      description: '附带备注发送',
      bindings: ['Mod+Shift+Enter'],
      section: '操作',
      hint: '打开发送菜单的备注撰写框；随后按 Mod+Enter 会一并发送反馈和备注。',
      displayOrder: 15,
    },
    quickSave: {
      description: '保存到笔记应用',
      bindings: ['Mod+S'],
      section: '操作',
      hint: '未配置默认笔记应用时打开导出。',
      displayOrder: 20,
    },
    exitPlanDiff: {
      description: '关闭 Diff 视图',
      bindings: ['Escape'],
      section: '操作',
      hint: '计划 Diff 打开时可用。',
      displayOrder: 30,
    },
    printPlan: {
      description: '打印',
      bindings: ['Mod+P'],
      section: '操作',
      hint: '为当前文档打开浏览器打印对话框。',
      displayOrder: 40,
    },
  },
});

export const usePlanEditorShortcuts = createShortcutScopeHook(planEditorShortcuts);

const planReviewEditorSettingsShortcuts = defineShortcutScope({
  id: 'plan-review-editor-settings',
  title: '计划编辑器',
  shortcuts: {
    submitPlan: planEditorShortcuts.shortcuts.submitPlan,
    openDecisionNote: planEditorShortcuts.shortcuts.openDecisionNote,
    quickSave: planEditorShortcuts.shortcuts.quickSave,
    exitPlanDiff: planEditorShortcuts.shortcuts.exitPlanDiff,
    printPlan: planEditorShortcuts.shortcuts.printPlan,
  },
});

const annotateEditorSettingsShortcuts = defineShortcutScope({
  id: 'annotate-editor-settings',
  title: '标注编辑器',
  shortcuts: {
    submitAnnotations: planEditorShortcuts.shortcuts.submitAnnotations,
    openDecisionNote: planEditorShortcuts.shortcuts.openDecisionNote,
    quickSave: planEditorShortcuts.shortcuts.quickSave,
    printPlan: planEditorShortcuts.shortcuts.printPlan,
  },
});

const sharedPlanSurfaceShortcuts = [
  documentViewShortcuts,
  inputMethodShortcuts,
  htmlAnnotateShortcuts,
  annotationModeShortcuts,
  annotationToolbarShortcuts,
  viewerShortcuts,
  vimSelectionShortcuts,
  commentPopoverShortcuts,
  annotationPanelShortcuts,
  imageAnnotatorShortcuts,
  historyShortcuts,
] as const;

export const planReviewSettingsShortcutRegistry = createShortcutRegistry([
  planReviewEditorSettingsShortcuts,
  ...sharedPlanSurfaceShortcuts,
] as const);

export const annotateSettingsShortcutRegistry = createShortcutRegistry([
  annotateEditorSettingsShortcuts,
  annotateSidebarShortcuts,
  decisionControlShortcuts,
  ...sharedPlanSurfaceShortcuts,
] as const);

export const planReviewSurface: ShortcutSurface = {
  slug: 'plan-review',
  title: '计划评审',
  description: '计划评审界面中显示的快捷键。',
  registry: planReviewSettingsShortcutRegistry,
};

export const annotateSurface: ShortcutSurface = {
  slug: 'annotate-mode',
  title: '标注模式',
  description: '独立标注界面中显示的快捷键。',
  registry: annotateSettingsShortcutRegistry,
};

const goalSetupEditorSettingsShortcuts = defineShortcutScope({
  id: 'goal-setup-editor-settings',
  title: '目标设置',
  shortcuts: {
    submitGoalSetup: {
      description: '提交回答 / 事实',
      bindings: ['Mod+Enter'],
      section: '操作',
      hint: '提交内置的访谈或事实评审。',
      displayOrder: 10,
    },
  },
});

export const goalSetupSettingsShortcutRegistry = createShortcutRegistry([
  goalSetupEditorSettingsShortcuts,
  goalSetupShortcuts,
] as const);

export const goalSetupSurface: ShortcutSurface = {
  slug: 'goal-setup',
  title: '目标设置',
  description: '内置目标设置访谈和事实评审中显示的快捷键。',
  registry: goalSetupSettingsShortcutRegistry,
};
