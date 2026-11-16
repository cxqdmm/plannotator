import React from 'react';
import { formatShortcutBindingText, getShortcutPlatform, resolveShortcutBindings, reviewExplorerShortcuts } from '@plannotator/ui/shortcuts';
import { navLocationLabel, type JumpCrumb as JumpCrumbData } from '../utils/explorerNavigation';

function viaLabel(via: JumpCrumbData['via']): string {
  if (via === 'definition') {
    const key = resolveShortcutBindings(reviewExplorerShortcuts.shortcuts.goToDefinition)[0];
    return `转到定义${key ? `（${formatShortcutBindingText(key, getShortcutPlatform())}）` : ''}`;
  }
  if (via === 'references') return '引用';
  return '转到文件';
}

/**
 * Where a jump came from, over the file it opened, with the way back
 * (approved design record "review-explorer", step 3).
 */
export const JumpCrumb: React.FC<{ crumb: JumpCrumbData; onBack?: () => void; right?: React.ReactNode }> = ({ crumb, onBack, right }) => {
  const back = resolveShortcutBindings(reviewExplorerShortcuts.shortcuts.navigateBack)[0];
  return (
    <div className="flex-none flex items-center gap-1.5 px-2 h-7 border-b border-border/40 text-xs text-muted-foreground min-w-0" data-jump-crumb>
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          className="p-0.5 rounded hover:bg-muted hover:text-foreground"
          title={`返回${back ? `（${formatShortcutBindingText(back, getShortcutPlatform())}）` : ''}`}
          aria-label="返回"
          data-jump-crumb-back
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true"><path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
      )}
      <span className="truncate">
        来自 <span className="text-foreground font-medium">{navLocationLabel(crumb.from)}</span> · {viaLabel(crumb.via)}
      </span>
      {right && <span className="ml-auto flex-none">{right}</span>}
    </div>
  );
};
