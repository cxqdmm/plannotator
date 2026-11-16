import { defineShortcutScope } from '../core';
import { createShortcutScopeHook } from '../runtime';

export const goalSetupShortcuts = defineShortcutScope({
  id: 'goal-setup-surface',
  title: '目标设置',
  shortcuts: {},
});

export const useGoalSetupShortcuts = createShortcutScopeHook(goalSetupShortcuts);
