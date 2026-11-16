import React, { useState } from 'react';
import { Menu } from '@base-ui/react/menu';
import { Tooltip } from '@plannotator/ui/components/Tooltip';
import type { DiffOption } from '@plannotator/shared/types';
import type { PickerTrigger } from './BaseBranchPicker';

interface DiffTypePickerProps {
  options: DiffOption[];
  activeDiffType: string;
  onSelect: (diffType: string) => void;
  isLoading?: boolean;
  hasBasePicker: boolean;
  /** The live active base (picker selection / server echo / --base flag). */
  activeBase?: string | null;
  /**
   * Draw the trigger as the caller's own button (the sidebar header's
   * sentence) instead of the field. The menu and its keyboard are the same.
   */
  trigger?: PickerTrigger;
}

/**
 * Long/full hex SHAs display as their 7-char prefix; branch names, tags, and
 * HEAD~N pass through unchanged (mirrors review-core's displayRef).
 */
export const displayRef = (ref: string): string =>
  /^[0-9a-f]{7,}$/i.test(ref) ? ref.slice(0, 7) : ref;

/**
 * Plain-English explanations shown in a tooltip next to each option.
 * Keep these short — they're hover hints, not docs.
 */
const OPTION_HINTS: Record<string, string> = {
  'since-base': "自分支从基线分出以来的全部内容——已提交、未提交和未跟踪的更改。这也是把所有内容提交并推送后 PR 会显示的内容。",
  'local-vs-remote': "本地分支和工作区与其远程跟踪分支的比较——自上次 fetch 以来已提交、未提交和未跟踪的差异。",
  uncommitted: "你本地尚未提交的所有更改。",
  staged: "仅包含你运行过 `git add` 的内容。",
  unstaged: "`git diff` 不带参数时显示的内容。",
  'last-commit': "仅显示最近一次 commit。",
  'workspace-current': "每个工作区仓库中当前的本地更改。",
  'workspace-staged': "每个工作区仓库中已暂存的 Git 更改。",
  'workspace-unstaged': "每个工作区仓库中未暂存的 Git 更改。",
  'workspace-last': "每个工作区仓库中最近一次已提交的 Git 更改，或上一个 jj 更改。",
  'jj-current': "当前 jj 更改中的内容。",
  'jj-last': "上一个 jj 更改中的内容。",
  'jj-line': "从所选 bookmark 或 revision 起你这条工作线上的更改。",
  'jj-evolog': "当前更改的两个演进版本之间的差异——展示你修正了什么。",
  'jj-all': "当前 jj 工作区中的每个已跟踪文件，以新增形式显示。",
  branch: "直接与基线分支（在下方选择）比较。如果基线有新 commit，也会显示不属于你的 commit。",
  'merge-base': "仅显示你在基线分支（在下方选择）之上新增的内容。与 GitHub 的 PR 视图一致。",
  all: "HEAD 上每个已跟踪文件，以新增形式显示。与“已提交”不同——后者显示相对基线的变更，而这里显示整个代码库。",
};

export const DiffTypePicker: React.FC<DiffTypePickerProps> = ({
  options,
  activeDiffType,
  onSelect,
  isLoading,
  hasBasePicker,
  activeBase,
  trigger,
}) => {
  const [open, setOpen] = useState(false);

  // When a base picker is wired up, strip branch names from the
  // base-dependent labels — the branch belongs in the picker.
  const displayLabel = (opt: DiffOption) => {
    if (!hasBasePicker) return opt.label;
    if (opt.id === 'merge-base') return '已提交的更改（PR 视图）';
    // getGitContext bakes the since-base label from the DETECTED default at
    // session start; render it from the live active base instead so the
    // dropdown agrees with the adjacent base picker after a base switch or a
    // --base launch.
    if (opt.id === 'since-base' && activeBase) return `自 ${displayRef(activeBase)} 的全部更改`;
    return opt.label;
  };

  const active = options.find((o) => o.id === activeDiffType);
  const activeLabel = active ? displayLabel(active) : '选择 Diff';

  return (
    <Menu.Root open={open} onOpenChange={setOpen}>
      {trigger ? (
        <Menu.Trigger
          render={
            <button type="button" disabled={isLoading} aria-label={trigger.ariaLabel} className={trigger.className} />
          }
        >
          {trigger.content}
        </Menu.Trigger>
      ) : (
        <Menu.Trigger
          render={
            <button
              type="button"
              disabled={isLoading}
              className="w-full flex items-center gap-1.5 px-2.5 py-1.5 bg-muted rounded text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 disabled:opacity-50 disabled:cursor-wait"
            />
          }
        >
            <span className="truncate flex-1 text-left">{activeLabel}</span>
            {isLoading ? (
              <svg className="w-3.5 h-3.5 text-muted-foreground animate-spin flex-shrink-0" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            ) : (
              <svg className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            )}
        </Menu.Trigger>
      )}
      <Menu.Portal>
        <Menu.Positioner side="bottom" align="start" sideOffset={4} className="z-50">
          <Menu.Popup className="min-w-[var(--anchor-width)] bg-popover text-popover-foreground border border-border rounded shadow-lg overflow-hidden py-1 origin-[var(--transform-origin)] transition-opacity data-starting-style:opacity-0 data-ending-style:opacity-0">
          {options.map((opt) => {
            const hint = OPTION_HINTS[opt.id];
            const isActive = opt.id === activeDiffType;
            return (
              <Menu.Item
                key={opt.id}
                onClick={() => onSelect(opt.id)}
                className={`flex items-center gap-2 mx-1 px-2 py-1.5 text-xs rounded cursor-pointer outline-none data-[highlighted]:bg-muted ${
                  isActive ? 'text-foreground font-medium' : 'text-foreground/80'
                }`}
              >
                <span className="w-3 flex-shrink-0">
                  {isActive && (
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </span>
                <span className="truncate flex-1">{displayLabel(opt)}</span>
                {hint && (
                  <Tooltip content={hint} side="right" wide>
                    <span
                      className="flex-shrink-0 text-muted-foreground hover:text-foreground"
                      onPointerDown={(e) => e.stopPropagation()}
                      onPointerUp={(e) => e.stopPropagation()}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {/* Heroicons information-circle (outline) */}
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
                      </svg>
                    </span>
                  </Tooltip>
                )}
              </Menu.Item>
            );
          })}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
};
