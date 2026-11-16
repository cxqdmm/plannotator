import { defineShortcutScope } from '@plannotator/ui/shortcuts';

/**
 * Escape leaves the Pull requests board's select mode (the owner's "Yes" on #3247), on that page and in Reviews' pane
 * only. It is the same Escape as everywhere ("Close, one layer at a time"), so the map lists it on that row and shows no
 * words of its own. SheetPage.tsx wires it on the document: what is inside the page (a menu, the filter's list, a
 * field) uses the key first, and App's ladder on the window stands down once it has acted.
 */
export const inboxPrBoardShortcuts = defineShortcutScope({
  id: 'inbox-pr-board',
  title: 'PR',
  shortcuts: {
    leaveSelect: { description: '关闭，一次一层', bindings: ['Escape'], section: '全局', preventDefault: true, displayOrder: 9 },
  },
});
