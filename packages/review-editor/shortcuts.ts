import {
  createDoubleTapShortcutsHook,
  createShortcutRegistry,
  createShortcutScopeHook,
  decisionControlShortcuts,
  defineShortcutScope,
  historyShortcuts,
  reviewAiShortcuts,
  reviewAllFilesDiffShortcuts,
  reviewAnnotationToolbarShortcuts,
  reviewFileTreeShortcuts,
  reviewPrCommentsShortcuts,
  reviewSuggestionModalShortcuts,
  reviewTourDialogShortcuts,
  reviewMarkdownPreviewShortcuts,
  reviewExplorerShortcuts,
  type ShortcutSurface,
} from '@plannotator/ui/shortcuts';
import { reviewCallTreeShortcuts } from './components/callTree/callTree.shortcuts';

export const reviewEditorShortcuts = defineShortcutScope({
  id: 'review-editor',
  title: '评审编辑器',
  shortcuts: {
    submit: {
      description: '通过 / 发送反馈，取决于顶部当前显示的操作',
      bindings: ['Mod+Enter'],
      section: '操作',
      hint: '触发顶部自适应主操作：没有标注时通过，否则发送反馈。',
      displayOrder: 10,
    },
    openDecisionNote: {
      description: '附备注发送',
      bindings: ['Mod+Shift+Enter'],
      section: '操作',
      hint: '打开发送菜单中的备注撰写框；随后按 Mod+Enter 会一并发送评审和备注。',
      displayOrder: 15,
    },
    copyFeedback: {
      description: '复制反馈到剪贴板',
      bindings: ['Mod+Shift+Y'],
      section: '操作',
      displayOrder: 20,
    },
    focusSearch: {
      description: '聚焦搜索',
      bindings: ['Mod+F'],
      section: '搜索',
      hint: '文件树中显示搜索栏时可用。',
      displayOrder: 10,
    },
    nextSearchMatch: {
      description: '下一个搜索结果',
      bindings: ['Enter', 'F3'],
      section: '搜索',
      displayOrder: 20,
    },
    prevSearchMatch: {
      description: '上一个搜索结果',
      bindings: ['Shift+Enter', 'Shift+F3'],
      section: '搜索',
      displayOrder: 30,
    },
    clearSearch: {
      description: '清除搜索 / 关闭面板',
      bindings: ['Escape'],
      section: '搜索',
      displayOrder: 40,
    },
    toggleDestination: {
      description: '切换评审去向',
      bindings: ['Alt Alt'],
      section: '操作',
      hint: '在 PR 评审模式下双击，可在平台和 agent 之间切换。',
      displayOrder: 30,
    },
    toggleFileTree: {
      description: '切换文件树',
      bindings: ['Mod+B'],
      section: '布局',
      displayOrder: 10,
    },
    toggleSidebar: {
      description: '切换评审侧边栏',
      bindings: ['Mod+.'],
      section: '布局',
      displayOrder: 20,
    },
    toggleTour: {
      description: '切换演示导览对话框',
      bindings: ['Mod+Shift+T'],
      section: '布局',
      hint: '仅在开发构建中可用。',
      displayOrder: 30,
    },
    toggleGuide: {
      description: '切换引导式评审',
      bindings: ['Mod+Shift+G'],
      section: '布局',
      hint: '打开或关闭引导式评审全屏界面。',
      displayOrder: 40,
    },
    toggleViewed: {
      description: '切换文件的已查看状态',
      bindings: ['V'],
      section: '文件操作',
      hint: '将当前 Diff 文件标记为已查看（在全部文件视图中会自动折叠）。',
      displayOrder: 10,
    },
    stageFile: {
      description: '暂存当前文件',
      bindings: ['A'],
      section: '文件操作',
      hint: '支持暂存时可用（PR 评审模式下不可用）。',
      displayOrder: 20,
    },
    nextChange: {
      description: '下一处更改',
      bindings: ['N'],
      section: '文件导航',
      hint: '滚动到下一段更改行：在当前打开的文件中，或在“全部文件”的已展开文件中。已折叠的文件和以渲染方式显示的 Markdown 文件会被跳过。',
      displayOrder: 50,
    },
    prevChange: {
      description: '上一处更改',
      bindings: ['Shift+N'],
      section: '文件导航',
      hint: '滚动到上一段更改行。',
      displayOrder: 60,
    },
  },
});

export const useReviewEditorShortcuts = createShortcutScopeHook(reviewEditorShortcuts);
export const useReviewEditorDoubleTap = createDoubleTapShortcutsHook(reviewEditorShortcuts);

export const reviewSettingsShortcutRegistry = createShortcutRegistry([
  reviewEditorShortcuts,
  decisionControlShortcuts,
  historyShortcuts,
  reviewFileTreeShortcuts,
  reviewExplorerShortcuts,
  reviewCallTreeShortcuts,
  reviewAllFilesDiffShortcuts,
  reviewMarkdownPreviewShortcuts,
  reviewAnnotationToolbarShortcuts,
  reviewSuggestionModalShortcuts,
  reviewAiShortcuts,
  reviewPrCommentsShortcuts,
  reviewTourDialogShortcuts,
] as const);

export const codeReviewSurface: ShortcutSurface = {
  slug: 'code-review',
  title: '代码评审',
  description: '代码评审界面中显示的快捷键。',
  registry: reviewSettingsShortcutRegistry,
};
