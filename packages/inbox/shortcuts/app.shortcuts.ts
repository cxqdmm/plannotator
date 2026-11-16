import { defineShortcutScope, type ShortcutDefinition } from '@plannotator/ui/shortcuts';
import { INBOX_SHORTCUT_EXTRAS, type InboxShortcutExtras } from './extras';

/**
 * The window's own keys (App.tsx): the shortcut map, the sidebar, leaving a
 * focused page, and (an extra) going to the Inbox, the Board or Settings.
 * `?` is matched by its character (`event.key`), so it is Shift+/ on a US
 * keyboard and Shift+, on a French one.
 */
export type InboxAppAction = 'openMap' | 'goInbox' | 'goBoard' | 'goPulls' | 'goDrafts' | 'goSettings' | 'compose' | 'refresh' | 'toggleSidebar' | 'leavePage';

export function buildInboxAppShortcuts(extras: InboxShortcutExtras = INBOX_SHORTCUT_EXTRAS) {
  const goTo: Partial<Record<InboxAppAction, ShortcutDefinition>> = extras.goTo
    ? {
        goInbox: { description: '前往收件箱', bindings: ['G I'], section: '全局', hint: '焦点落在第一行，或已打开会话所在的那一行。', preventDefault: true, displayOrder: 2 },
        goBoard: { description: '前往看板', bindings: ['G B'], section: '全局', hint: '看板开启时。', preventDefault: true, displayOrder: 3 },
        // G P and G D (approval "inbox-keyboard-keys-2026-11-07", item 5): each only while its sidebar row shows.
        goPulls: { description: '前往评审（PR）', bindings: ['G P'], section: '全局', hint: '代码评审开启时。', preventDefault: true, displayOrder: 3.1 },
        goDrafts: { description: '前往草稿', bindings: ['G D'], section: '全局', hint: '有草稿时。', preventDefault: true, displayOrder: 3.2 },
        goSettings: { description: '前往设置', bindings: ['G S'], section: '全局', preventDefault: true, displayOrder: 4 },
      }
    : {};
  return defineShortcutScope({
    id: 'inbox-app',
    title: '全局',
    lettersByCode: true,
    shortcuts: {
      openMap: {
        description: '键盘快捷键',
        bindings: ['?'],
        section: '全局',
        hint: '再按一次或按 Escape 关闭。',
        preventDefault: true,
        displayOrder: 1,
      },
      ...goTo,
      compose: {
        // App.tsx: the sidebar pencil's path (approval "inbox-keyboard-keys-2026-11-07", item 4; Gmail's and Linear's C).
        description: '新消息',
        bindings: ['C'],
        section: '全局',
        hint: '打开一条发给 agent 的新消息。',
        preventDefault: true,
        displayOrder: 4.5,
      },
      refresh: {
        // App.tsx: the list header's ↻ (approval "inbox-refresh-key"; "R for refresh", beside ⌘R; plain R stays Reply).
        description: '刷新',
        bindings: ['Shift+R'],
        section: '全局',
        hint: '刷新屏幕上的收件箱或项目，与列表的 ↻ 相同。在看板和评审页则刷新该页面自身。',
        preventDefault: true,
        displayOrder: 4.6,
      },
      toggleSidebar: {
        // Wired in shell/sidebar.tsx (the sidebar primitive's own listener, unchanged); listed here for the map.
        description: '显示或隐藏侧边栏',
        bindings: ['Mod+B'],
        section: '全局',
        preventDefault: true,
        displayOrder: 5,
      },
      leavePage: {
        description: '关闭，一次一层',
        bindings: ['Escape'],
        section: '全局',
        hint: '设置和“最新动态”会返回你之前所在的位置。',
        displayOrder: 9,
      },
      // With an extra off its actions are simply absent: the registry lists entries, and a handler for an absent one never runs.
    } as Record<InboxAppAction, ShortcutDefinition>,
  });
}

export const inboxAppShortcuts = buildInboxAppShortcuts();
