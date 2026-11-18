/**
 * The Requirements panel (「需求」, Wave 1): the grouped list, the inline
 * composer, rename, stage moves and delete. Owns its data (useRequirements)
 * so App.tsx only mounts it — the module stays a plug-in. Wave 2 adds the
 * detail pane and deliverables; Wave 3 the board, drag and keyboard.
 *
 * Words are Simplified Chinese in place, this fork's rule. Semantic theme
 * classes only (bg-card, text-muted-foreground, …): the panel follows the
 * Inbox's light and dark themes with no styling of its own.
 */
import { useState } from 'react';
import { Icon } from '../../icons';
import { subscribeRequirementFrames } from '../frames';
import { useRequirements } from '../useRequirements';
import { REQUIREMENT_PRIORITIES, REQUIREMENT_STAGES, type Requirement, type RequirementPriority, type RequirementStage } from '@plannotator/core/requirements-types';

/** The priority dot's colour, from the theme's palette. */
const PRIORITY_CLASS: Record<RequirementPriority, string> = {
  urgent: 'bg-red-500',
  high: 'bg-orange-500',
  medium: 'bg-yellow-500',
  low: 'bg-blue-400',
  none: 'bg-transparent border border-border',
};

function priorityAfter(current: RequirementPriority): RequirementPriority {
  const order = REQUIREMENT_PRIORITIES.map((entry) => entry.id);
  return order[(order.indexOf(current) + 1) % order.length]!;
}

function priorityLabel(priority: RequirementPriority): string {
  return REQUIREMENT_PRIORITIES.find((entry) => entry.id === priority)?.label ?? priority;
}

/** One requirement's row: priority (click to cycle), title (click to rename), stage move, delete. */
function RequirementRow({ requirement, onPatch, onRemove }: { requirement: Requirement; onPatch: RequirementsPatch; onRemove: (id: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(requirement.title);

  const saveTitle = () => {
    setEditing(false);
    const next = title.trim();
    if (next && next !== requirement.title) void onPatch(requirement.id, { title: next });
    else setTitle(requirement.title);
  };

  return (
    <div className="group/req flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent" data-requirement-id={requirement.id}>
      <button
        type="button"
        className={`size-2.5 shrink-0 rounded-full ${PRIORITY_CLASS[requirement.priority]}`}
        title={`优先级：${priorityLabel(requirement.priority)}（点击切换）`}
        aria-label={`优先级：${priorityLabel(requirement.priority)}（点击切换）`}
        onClick={() => void onPatch(requirement.id, { priority: priorityAfter(requirement.priority) })}
      />
      {editing ? (
        <input
          autoFocus
          className="min-w-0 flex-1 rounded-sm bg-background px-1 py-0.5 text-sm outline-none ring-1 ring-primary"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onBlur={saveTitle}
          onKeyDown={(event) => {
            if (event.key === 'Enter') saveTitle();
            if (event.key === 'Escape') {
              setTitle(requirement.title);
              setEditing(false);
            }
          }}
          aria-label="需求标题"
        />
      ) : (
        <button type="button" className="min-w-0 flex-1 truncate text-left text-sm" title={requirement.title} onClick={() => setEditing(true)}>
          {requirement.title}
        </button>
      )}
      <select
        className="h-6 rounded-sm border-border bg-transparent px-1 text-xs text-muted-foreground opacity-0 transition-opacity group-hover/req:opacity-100 focus:opacity-100"
        value={requirement.stage}
        aria-label="阶段"
        onChange={(event) => void onPatch(requirement.id, { stage: event.target.value as RequirementStage })}
      >
        {REQUIREMENT_STAGES.map((stage) => (
          <option key={stage.id} value={stage.id}>
            {stage.label}
          </option>
        ))}
      </select>
      <button
        type="button"
        className="text-muted-foreground opacity-0 transition-opacity group-hover/req:opacity-100 hover:text-foreground"
        title="删除需求"
        aria-label="删除需求"
        onClick={() => onRemove(requirement.id)}
      >
        <Icon name="trash" />
      </button>
    </div>
  );
}

type RequirementsPatch = (id: string, patch: { title?: string; notes?: string; stage?: RequirementStage; priority?: RequirementPriority }) => Promise<boolean>;

/** The panel: header with 新建, the composer, and the seven stage groups. */
export function RequirementsPanel({ on }: { on: boolean }) {
  const { requirements, create, patch, remove, error, clearError } = useRequirements(on, subscribeRequirementFrames);
  const [composing, setComposing] = useState(false);
  const [draft, setDraft] = useState('');

  const submit = () => {
    const title = draft.trim();
    if (!title) {
      setComposing(false);
      return;
    }
    setDraft('');
    void create({ title });
  };

  const grouped = new Map<RequirementStage, Requirement[]>(REQUIREMENT_STAGES.map((stage) => [stage.id, [] as Requirement[]]));
  for (const requirement of requirements ?? []) grouped.get(requirement.stage)?.push(requirement);

  return (
    <div className="flex h-full min-w-0 flex-col bg-card" data-requirements-panel="">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <h1 className="text-base font-semibold">需求</h1>
        <span className="text-xs text-muted-foreground">{requirements === null ? '' : requirements.length > 0 ? requirements.length : ''}</span>
        <div className="flex-1" />
        <button
          type="button"
          className="flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-sm text-primary-foreground hover:opacity-90"
          onClick={() => {
            setComposing(true);
            clearError();
          }}
        >
          <Icon name="plus" />
          新建
        </button>
      </div>

      {composing && (
        <div className="border-b border-border px-4 py-2">
          <input
            // Not React's autoFocus: happy-dom's input value setter breaks on an element it has focused
            // (RequirementsPanel.dom.test.tsx), and the HTML attribute alone does the same job in a browser.
            autoFocus={undefined}
            ref={(node) => queueMicrotask(() => node?.focus())}
            className="w-full rounded-md bg-background px-2 py-1.5 text-sm outline-none ring-1 ring-border focus:ring-primary"
            aria-label="需求标题"
            placeholder="需求标题，回车创建（进入待跟进）"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={submit}
            onKeyDown={(event) => {
              if (event.key === 'Enter') submit();
              if (event.key === 'Escape') {
                setDraft('');
                setComposing(false);
              }
            }}
          />
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {requirements === null ? (
          <p className="px-2 py-8 text-center text-sm text-muted-foreground" aria-busy="true">
            读取需求中…
          </p>
        ) : (
          REQUIREMENT_STAGES.map((stage) => {
            const rows = grouped.get(stage.id) ?? [];
            return (
              <section key={stage.id} className="mb-3" data-stage={stage.id}>
                <header className="flex items-center gap-2 px-2 py-1 text-xs text-muted-foreground">
                  <span className={rows.length === 0 ? '' : 'font-medium text-foreground'}>{stage.label}</span>
                  <span>{rows.length}</span>
                </header>
                {rows.map((requirement) => (
                  <RequirementRow key={requirement.id} requirement={requirement} onPatch={patch} onRemove={(id) => void remove(id)} />
                ))}
              </section>
            );
          })
        )}
      </div>

      {error && (
        <p className="border-t border-border px-4 py-2 text-xs text-red-500" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
