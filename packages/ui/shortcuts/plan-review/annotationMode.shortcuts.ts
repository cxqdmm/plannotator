import { defineShortcutScope } from '../core';
import {
  useShortcutScope,
  type ShortcutHandlers,
  type UseShortcutScopeOptions,
} from '../runtime';

// Shift+digit rather than mnemonic letters: bare letters are swallowed by
// type-to-comment, bare digits by the label picker, Mod+digit by the browser's
// tab switching, and Mod+Shift+3/4 by macOS screenshots. Follows the toolstrip
// left to right.
export const annotationModeShortcuts = defineShortcutScope({
  id: 'annotation-mode',
  title: '标注模式',
  shortcuts: {
    selectMarkupMode: {
      description: '标记模式',
      bindings: ['Shift+1'],
      section: '标注',
      hint: '选中文本会打开标注工具栏。',
      preventDefault: true,
      displayOrder: 1,
    },
    selectCommentMode: {
      description: '评论模式',
      bindings: ['Shift+2'],
      section: '标注',
      hint: '选中文本会打开评论编辑器。',
      preventDefault: true,
      displayOrder: 2,
    },
    selectRedlineMode: {
      description: '删除线模式',
      bindings: ['Shift+3'],
      section: '标注',
      hint: '选中文本会将其标记为删除。',
      preventDefault: true,
      displayOrder: 3,
    },
    selectQuickLabelMode: {
      description: '标签模式',
      bindings: ['Shift+4'],
      section: '标注',
      hint: '选中文本会打开快速标签选择器。',
      preventDefault: true,
      displayOrder: 4,
    },
  },
});

// --- Type-to-comment capture guard (#1244 follow-up) ---
// Shift+1..4 produce printable characters (! @ # $). While a surface's
// type-to-comment listener owns printable keys (a selection exists and the
// annotation toolbar is open), those characters belong to the comment being
// started: a mode shortcut firing there both eats the character and silently
// re-arms the mode (Shift+3 arming Redline mid-thought). The toolbar
// registers its capture here; the scope hook refuses to dispatch while any
// capture is held.
let typeToCommentCaptures = 0;

/**
 * Held by AnnotationToolbar for the lifetime of its type-to-comment keydown
 * listener. Returns a release function; releasing more than once is safe.
 */
export function acquireTypeToCommentCapture(): () => void {
  typeToCommentCaptures += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    typeToCommentCaptures -= 1;
  };
}

type AnnotationModeScope = typeof annotationModeShortcuts;
type AnnotationModeOptions = Omit<UseShortcutScopeOptions<AnnotationModeScope>, 'scope'>;

export function useAnnotationModeShortcuts(options: AnnotationModeOptions): void {
  const guarded: ShortcutHandlers<AnnotationModeScope> = {};
  for (const actionId of Object.keys(options.handlers) as Array<keyof typeof options.handlers>) {
    const handler = options.handlers[actionId];
    if (!handler) continue;
    const config = typeof handler === 'function' ? { handle: handler } : handler;
    guarded[actionId] = {
      ...config,
      when: (event: KeyboardEvent) =>
        typeToCommentCaptures === 0 && (config.when ? config.when(event) : true),
    };
  }
  useShortcutScope({ scope: annotationModeShortcuts, ...options, handlers: guarded });
}
