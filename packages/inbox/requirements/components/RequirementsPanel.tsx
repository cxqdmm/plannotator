/**
 * The Requirements panel (「需求」): a Board-style kanban — the seven lifecycle
 * stages as lanes, cards dragged between them — drawn with the Board's own
 * classes (ib-bpage/ib-blanes/ib-lane/ib-bcard, packages/inbox/inbox.css), so
 * it is the Inbox's look, rounded corners and all, in light and dark. Owns
 * its data (useRequirements) so App.tsx only mounts it: the module stays a
 * plug-in. Wave 2 adds the detail pane and deliverables; Wave 3 filters and
 * keyboard.
 *
 * Words are Simplified Chinese in place, this fork's rule.
 */
import { useState } from 'react';
import { Icon } from '../../icons';
import { SidebarTrigger } from '../../shell/sidebar';
import { subscribeRequirementFrames } from '../frames';
import { useRequirements } from '../useRequirements';
import { REQUIREMENT_PRIORITIES, REQUIREMENT_STAGES, type Requirement, type RequirementPriority, type RequirementStage } from '@plannotator/core/requirements-types';

function priorityAfter(current: RequirementPriority): RequirementPriority {
  const order = REQUIREMENT_PRIORITIES.map((entry) => entry.id);
  return order[(order.indexOf(current) + 1) % order.length]!;
}

function priorityLabel(priority: RequirementPriority): string {
  return REQUIREMENT_PRIORITIES.find((entry) => entry.id === priority)?.label ?? priority;
}

/** One requirement as a lane card: the title (click to rename), the priority dot (click to cycle), delete. */
function RequirementCard({
  requirement,
  dragging,
  onDragStart,
  onDragEnd,
  onPatch,
  onRemove,
}: {
  requirement: Requirement;
  dragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onPatch: (id: string, patch: { title?: string; stage?: RequirementStage; priority?: RequirementPriority }) => void;
  onRemove: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(requirement.title);

  const saveTitle = () => {
    setEditing(false);
    const next = title.trim();
    if (next && next !== requirement.title) onPatch(requirement.id, { title: next });
    else setTitle(requirement.title);
  };

  return (
    <li
      className="ib-bcard"
      data-card-id={requirement.id}
      data-requirement-id={requirement.id}
      data-stage={requirement.stage}
      data-dragging={dragging ? '' : undefined}
      draggable={editing ? undefined : true}
      onDragStart={(event) => {
        event.dataTransfer.setData('text/plain', requirement.id);
        event.dataTransfer.effectAllowed = 'move';
        onDragStart();
      }}
      onDragEnd={onDragEnd}
    >
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
      <span className="ib-bc-bot">
        <span className="ib-bc-line">
          <button
            type="button"
            className="ib-req-pri"
            data-priority={requirement.priority}
            title={`优先级：${priorityLabel(requirement.priority)}（点击切换）`}
            aria-label={`优先级：${priorityLabel(requirement.priority)}（点击切换）`}
            onClick={() => onPatch(requirement.id, { priority: priorityAfter(requirement.priority) })}
          />
          <span className="ib-req-act">
            <button type="button" className="ib-req-x" aria-label="删除需求" title="删除需求" onClick={() => onRemove(requirement.id)}>
              <Icon name="trash" size={13} />
            </button>
          </span>
        </span>
      </span>
    </li>
  );
}

/** The panel: a Board page whose lanes are the seven stages. */
export function RequirementsPanel({ on }: { on: boolean }) {
  const { requirements, create, patch, remove, error, clearError } = useRequirements(on, subscribeRequirementFrames);
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

  const lanes = new Map<RequirementStage, Requirement[]>(REQUIREMENT_STAGES.map((stage) => [stage.id, [] as Requirement[]]));
  for (const requirement of requirements ?? []) lanes.get(requirement.stage)?.push(requirement);

  return (
    <section className="ib-bpage" aria-labelledby="ib-req-title" data-requirements-page="">
      <div className="ib-bhead">
        <SidebarTrigger />
        <h1 id="ib-req-title" tabIndex={-1}>
          需求
        </h1>
        <span className="ib-bsp" />
        {requirements !== null && requirements.length > 0 && (
          <span className="ib-blinks" aria-label={`共 ${requirements.length} 条需求`}>
            {requirements.length} 条
          </span>
        )}
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
      </div>
      {error && (
        <div className="ib-error ib-bfail" role="alert">
          {error}
        </div>
      )}
      <div className="ib-blanes" data-dragging={dragging ? '' : undefined}>
        {REQUIREMENT_STAGES.map((stage) => {
          const cards = lanes.get(stage.id) ?? [];
          const target = dragging !== null && dragging.stage !== stage.id;
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
                <span className="ib-lane-dot" data-col={stage.id} aria-hidden="true" />
                <span className="ib-lane-l">{stage.label}</span>
                <span className="ib-lane-n">{cards.length}</span>
              </h2>
              <ul className="ib-lane-cards" aria-labelledby={`ib-req-lane-${stage.id}`}>
                {stage.id === 'triage' && composing && (
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
                    onDragStart={() => setDragging(requirement)}
                    onDragEnd={() => {
                      setDragging(null);
                      setOver(null);
                    }}
                    onPatch={(id, patchIn) => void patch(id, patchIn)}
                    onRemove={(id) => void remove(id)}
                  />
                ))}
              </ul>
              {cards.length === 0 && !(stage.id === 'triage' && composing) && <p className="ib-lane-empty">{stage.wants ? `还没有需求；此阶段产出${stage.wants}。` : '还没有需求。'}</p>}
            </section>
          );
        })}
      </div>
    </section>
  );
}
