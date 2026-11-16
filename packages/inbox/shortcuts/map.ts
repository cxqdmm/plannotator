/**
 * The shortcut map's layout (components/ShortcutMap.tsx): which registry
 * actions share a row, in what order, in which group and column. The keys and
 * words come from the registry; this says only where they go.
 */
import type { ShortcutScopeDefinition } from '@plannotator/ui/shortcuts';
import { inboxAppShortcuts, inboxArtifactsShortcuts, inboxBoardShortcuts, inboxFileViewerShortcuts, inboxListShortcuts, inboxListPickShortcuts, inboxPrBoardShortcuts, inboxSearchShortcuts, inboxThreadShortcuts, inboxTileShortcuts } from './index';

export type Ref = { scope: ShortcutScopeDefinition<any>; action: string; only?: number };

export interface MapRow {
  /** The row's words; absent: the first action's description. */
  label?: string;
  /** The actions whose keys the row shows, in order (J K: next, then previous). */
  keys: Ref[];
  /** Actions the row stands for without showing their keys again (Escape in every scope). */
  also?: Ref[];
}

export interface MapGroup {
  title: string;
  rows: MapRow[];
}

const app = (action: string): Ref => ({ scope: inboxAppShortcuts, action });
const list = (action: string): Ref => ({ scope: inboxListShortcuts, action });
const thread = (action: string): Ref => ({ scope: inboxThreadShortcuts, action });
const file = (action: string, only?: number): Ref => ({ scope: inboxFileViewerShortcuts, action, only });
const grid = (action: string, only?: number): Ref => ({ scope: inboxArtifactsShortcuts, action, only });
const board = (action: string, only?: number): Ref => ({ scope: inboxBoardShortcuts, action, only });
const tiles = (action: string, only?: number): Ref => ({ scope: inboxTileShortcuts, action, only });
/** The four arrows of a move, each its own keycap with no "or" between them. */
const arrows = (ref: (action: string, only?: number) => Ref, action: string): Ref[] => [0, 1, 2, 3].map((i) => ref(action, i));

/**
 * Two columns: Everywhere and List on the left, Thread and Files on the right. Every key of an open file or of the
 * Artifacts grid is in Files (approval "inbox-keyboard-keys-2026-11-07", item 6), so Thread keeps movement and verbs.
 */
export const MAP_COLUMNS: MapGroup[][] = [
  [
    {
      title: '全局',
      rows: [
        { keys: [{ scope: inboxSearchShortcuts, action: 'openSearch' }] },
        { keys: [app('openMap')] },
        { keys: [app('compose')] },
        { keys: [app('refresh')] },
        { keys: [app('goInbox')] },
        { keys: [app('goBoard')] },
        { keys: [app('goPulls')] },
        { keys: [app('goDrafts')] },
        { keys: [app('goSettings')] },
        { keys: [app('toggleSidebar')] },
      ],
    },
    {
      title: '列表',
      rows: [
        { label: '在会话之间移动', keys: [list('previous'), list('next')] },
        { label: '第一个或最后一个会话', keys: [list('first'), list('last')] },
        { keys: [list('open')] },
        { keys: [thread('markRead')] },
        { keys: [thread('archive')] },
        { keys: [thread('snooze')] },
        { keys: [thread('undo')] },
        { label: '行、卡片或消息菜单', keys: [list('rowMenu')], also: [thread('messageMenu')] },
        { keys: arrows(board, 'move') },
        { keys: [board('ends')] },
      ],
    },
  ],
  [
    {
      title: '会话',
      rows: [
        { keys: [thread('reply')] },
        { label: '发送回复', keys: [thread('send')] },
        { label: '下一个或上一个会话', keys: [thread('nextThread'), thread('previousThread')] },
        { label: '下一条或上一条消息', keys: [thread('nextMessage'), thread('previousMessage')] },
        { keys: [thread('firstNew')] },
        { keys: [thread('openItems')] },
        { keys: [thread('close')], also: [app('leavePage'), file('escape'), { scope: inboxPrBoardShortcuts, action: 'leaveSelect' }, { scope: inboxListPickShortcuts, action: 'leavePicks' }] },
      ],
    },
    {
      title: '文件',
      rows: [
        { keys: [thread('openNewest')] },
        { keys: arrows(tiles, 'move') },
        { keys: [thread('artifacts')] },
        { keys: arrows(grid, 'move') },
        { keys: [grid('ends')] },
        { keys: [thread('fullScreen')] },
        { label: '下一个或上一个文件', keys: [file('next', 0), file('previous', 0)], also: [file('next'), file('previous')] },
        { keys: [file('toggleTools')] },
        { keys: [file('toggleAnnotate')] },
      ],
    },
  ],
];

export const present = (ref: Ref) => ref.scope.shortcuts[ref.action] !== undefined;

/** The map's rows as they are drawn now: a row whose actions are all absent (an extra that is off) is left out. */
export function mapColumns(columns: MapGroup[][] = MAP_COLUMNS): MapGroup[][] {
  return columns.map((groups) => groups.map((group) => ({ ...group, rows: group.rows.filter((row) => row.keys.some(present)) })).filter((group) => group.rows.length > 0));
}

