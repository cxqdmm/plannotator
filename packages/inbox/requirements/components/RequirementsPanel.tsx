/**
 * The Requirements panel (「需求」): a Board-style kanban — the seven lifecycle
 * stages as lanes, cards dragged between them — drawn with the Board's own
 * classes (ib-bpage/ib-blanes/ib-lane/ib-bcard, packages/inbox/inbox.css), so
 * it is the Inbox's look, rounded corners and all, in light and dark. Stage
 * headers carry the system's own SVG marks; there is no delete: a card is
 * 归档 (archived) from its hover corner, and the header's 已归档 link opens the
 * archived page, where a card restores. Owns its data (useRequirements) so
 * App.tsx only mounts it: the module stays a plug-in. Wave 2 adds the detail
 * pane and deliverables.
 *
 * Words are Simplified Chinese in place, this fork's rule.
 */
import { useState } from 'react';
import { Icon } from '../../icons';
import { SidebarTrigger } from '../../shell/sidebar';
import { subscribeRequirementFrames } from '../frames';
import { useRequirements } from '../useRequirements';
import { REQUIREMENT_STAGES, type Requirement, type RequirementStage } from '@plannotator/core/requirements-types';

/** Each stage's mark: the system's own SVG icons, the colour every other one draws in. */
const STAGE_ICON: Record<RequirementStage, Parameters<typeof Icon>[0]['name']> = {
  triage: 'inbox',
  design: 'pen',
  'design-review': 'eye',
  dev: 'code',
  qa: 'todo',
  'code-review': 'reviews',
  done: 'check',
};

/** One requirement as a lane card: the title (click to rename), 归档/恢复 from the hover corner. */
function RequirementCard({
  requirement,
  dragging,
  draggable,
  onDragStart,
  onDragEnd,
  onPatch,
}: {
  requirement: Requirement;
  dragging: boolean;
  draggable: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onPatch: (id: string, patch: { title?: string; stage?: RequirementStage; archived?: boolean }) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(requirement.title);

  const saveTitle = () => {
    setEditing(false);
    const next = title.trim();
    if (next && next !== requirement.title) onPatch(requirement.id, { title: next });
    else setTitle(requirement.title);
  };

  const archived = requirement.archived_at != null;

  return (
    <li
      className="ib-bcard"
      data-card-id={requirement.id}
      data-requirement-id={requirement.id}
      data-stage={requirement.stage}
      data-dragging={dragging ? '' : undefined}
      draggable={draggable && !editing ? true : undefined}
      onDragStart={(event) => {
        event.dataTransfer.setData('text/plain', requirement.id);
        event.dataTransfer.effectAllowed = 'move';
        onDragStart();
      }}
      onDragEnd={onDragEnd}
    >
      <button
        type="button"
        className="ib-req-corner"
        title={archived ? '恢复到看板' : '归档'}
        aria-label={archived ? '恢复到看板' : '归档'}
        onClick={() => onPatch(requirement.id, { archived: !archived })}
      >
        <Icon name={archived ? 'back' : 'archive'} size={14} />
      </button>
      <span className="ib-bc-top">
        {editing ? (
          <input
            // Not React's autoFocus: happy-dom's input value setter breaks on an element it has focused
            // (RequirementsPanel.dom.test.tsx); the microtask focus does the same job in a browser.
            ref={(node) => queueMicrotask(() => node?.focus())}
            className="ib-req-rename"
            aria-label="需求标题"
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
          />
        ) : (
          <button type="button" className="ib-bc-main" title={requirement.title} onClick={() => setEditing(true)}>
            <span className="ib-bc-t" dir="auto">
              {requirement.title}
            </span>
          </button>
        )}
      </span>
    </li>
  );
}

/** The panel: a Board page whose lanes are the seven stages; `archived` shows the 已归档 page instead. */
export function RequirementsPanel({ on, archived = false, onView }: { on: boolean; archived?: boolean; onView: (archived: boolean) => void }) {
  const { requirements, archived: archivedList, archivedCount, create, patch, error, clearError } = useRequirements(on, subscribeRequirementFrames);
  const [composing, setComposing] = useState(false);
  const [draft, setDraft] = useState('');
  /** The card being dragged (the Board's own mechanism: state, not the dataTransfer's contents). */
  const [dragging, setDragging] = useState<Requirement | null>(null);
  const [over, setOver] = useState<RequirementStage | null>(null);

  const submit = () => {
    const title = draft.trim();
    if (!title) {
      setComposing(false);
      return;
    }
    setDraft('');
    void create({ title });
  };

  const shown = archived ? (archivedList ?? []) : (requirements ?? []);
  const lanes = new Map<RequirementStage, Requirement[]>(REQUIREMENT_STAGES.map((stage) => [stage.id, [] as Requirement[]]));
  for (const requirement of shown) lanes.get(requirement.stage)?.push(requirement);

  return (
    <section className="ib-bpage" aria-labelledby="ib-req-title" data-requirements-page="" data-requirements-view={archived ? 'archived' : 'board'}>
      <div className="ib-bhead">
        <SidebarTrigger />
        {archived ? (
          <>
            <button type="button" className="ib-bback" data-requirements-back="" onClick={() => onView(false)}>
              <Icon name="chevL" size={16} />
              需求
            </button>
            <h1 id="ib-req-title" tabIndex={-1}>
              已归档
            </h1>
          </>
        ) : (
          <>
            <h1 id="ib-req-title" tabIndex={-1}>
              需求
            </h1>
            <span className="ib-bsp" />
            <nav className="ib-blinks" aria-label="已归档的需求">
              <a
                href="#requirements&archived"
                data-requirements-link="archived"
                onClick={(event) => {
                  event.preventDefault();
                  onView(true);
                }}
              >
                已归档 {archivedCount}
              </a>
            </nav>
            <button
              type="button"
              className="ib-btn ib-sm ib-bnew"
              data-requirements-new=""
              onClick={() => {
                setComposing(true);
                clearError();
              }}
            >
              <Icon name="plus" size={15} />
              新建需求
            </button>
          </>
        )}
      </div>
      {error && (
        <div className="ib-error ib-bfail" role="alert">
          {error}
        </div>
      )}
      <div className="ib-blanes" data-dragging={dragging ? '' : undefined}>
        {REQUIREMENT_STAGES.map((stage) => {
          const cards = lanes.get(stage.id) ?? [];
          const target = !archived && dragging !== null && dragging.stage !== stage.id;
          const dragOver = (event: React.DragEvent) => {
            if (!target) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = 'move';
            if (over !== stage.id) setOver(stage.id);
          };
          return (
            <section
              key={stage.id}
              className="ib-lane"
              aria-labelledby={`ib-req-lane-${stage.id}`}
              data-lane={stage.id}
              data-drop={target ? '' : undefined}
              data-over={target && over === stage.id ? '' : undefined}
              onDragOver={dragOver}
              onDragEnter={dragOver}
              onDragLeave={(event) => {
                if (!(event.currentTarget as HTMLElement).contains(event.relatedTarget as Node | null)) setOver((current) => (current === stage.id ? null : current));
              }}
              onDrop={(event) => {
                event.preventDefault();
                const card = dragging;
                setDragging(null);
                setOver(null);
                if (card && card.stage !== stage.id) void patch(card.id, { stage: stage.id });
              }}
            >
              <h2 className="ib-lane-h" id={`ib-req-lane-${stage.id}`} tabIndex={-1}>
                <Icon name={STAGE_ICON[stage.id]} size={15} className="ib-req-lane-ico" />
                <span className="ib-lane-l">{stage.label}</span>
                <span className="ib-lane-n">{cards.length}</span>
              </h2>
              <ul className="ib-lane-cards" aria-labelledby={`ib-req-lane-${stage.id}`}>
                {!archived && stage.id === 'triage' && composing && (
                  <li className="ib-bcard" data-composer="">
                    <span className="ib-bc-top">
                      <input
                        ref={(node) => queueMicrotask(() => node?.focus())}
                        className="ib-req-rename"
                        aria-label="需求标题"
                        placeholder="需求标题，回车创建"
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
                    </span>
                  </li>
                )}
                {cards.map((requirement) => (
                  <RequirementCard
                    key={requirement.id}
                    requirement={requirement}
                    dragging={dragging?.id === requirement.id}
                    draggable={!archived}
                    onDragStart={() => setDragging(requirement)}
                    onDragEnd={() => {
                      setDragging(null);
                      setOver(null);
                    }}
                    onPatch={(id, patchIn) => void patch(id, patchIn)}
                  />
                ))}
              </ul>
              {cards.length === 0 && !(!archived && stage.id === 'triage' && composing) && <p className="ib-lane-empty">{archived ? '没有已归档的需求。' : stage.wants ? `还没有需求；此阶段产出${stage.wants}。` : '还没有需求。'}</p>}
            </section>
          );
        })}
      </div>
    </section>
  );
}
