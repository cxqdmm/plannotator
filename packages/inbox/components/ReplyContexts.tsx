/**
 * 附加需求上下文（工坊会话详情专属，approval "session-reply-contexts"）：the reply box's
 * 「上下文」 button and its picker. Offered only when the workshop hands the pane the
 * session's requirement (ThreadPane `replyContexts`); the Inbox's own reply box never
 * passes it, so the button never draws there. Picking marks chips over the box; the
 * Send appends the workshop compose template's 上下文材料 list to the words
 * (`replyContextSection`) — 名字（引用） per line, the agent reads the materials
 * straight from the reply.
 */
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { Icon } from '../icons';
import { Tip } from './Tip';
import type { ReplyContextOption } from '../thread/replyContexts';

const GAP = 8;
const LEAST = 96;
/** The picker's width (inbox.css's .ib-rctx-pop). */
const PICKER_WIDTH = 300;

/** Fixed spot for the picker: above the button when there is room (the reply box sits at the foot), else below. */
function useSpotAbove(buttonRef: RefObject<HTMLButtonElement | null>, open: boolean): CSSProperties | undefined {
  const [style, setStyle] = useState<CSSProperties | undefined>(undefined);
  const measure = () => {
    const button = buttonRef.current;
    if (!open || !button) {
      setStyle((current) => (current === undefined ? current : undefined));
      return;
    }
    const view = button.ownerDocument.defaultView ?? window;
    const rect = button.getBoundingClientRect();
    const width = Math.min(PICKER_WIDTH, view.innerWidth - 24);
    const left = Math.max(12, Math.min(rect.left, view.innerWidth - width - 12));
    const above = rect.top - GAP - 8;
    const next: CSSProperties = {
      position: 'fixed',
      left,
      width,
      ...(above >= LEAST
        ? { bottom: view.innerHeight - rect.top + GAP, top: 'auto', maxHeight: Math.round(above) }
        : { top: rect.bottom + GAP, bottom: 'auto', maxHeight: Math.round(Math.max(LEAST, view.innerHeight - rect.bottom - GAP - 8)) }),
    };
    setStyle((current) => (JSON.stringify(current) === JSON.stringify(next) ? current : next));
  };
  useLayoutEffect(measure);
  useEffect(() => {
    if (!open) return;
    const view = buttonRef.current?.ownerDocument.defaultView ?? window;
    const soon = () => measure();
    view.addEventListener('scroll', soon, true);
    view.addEventListener('resize', soon);
    const viewport = view.visualViewport;
    viewport?.addEventListener('resize', soon);
    viewport?.addEventListener('scroll', soon);
    return () => {
      view.removeEventListener('scroll', soon, true);
      view.removeEventListener('resize', soon);
      viewport?.removeEventListener('resize', soon);
      viewport?.removeEventListener('scroll', soon);
    };
  });
  return style;
}

/** The kind's small mark: a link's chain, everything else (files, images) the document mark. */
function kindIcon(kind: string): 'link' | 'doc' {
  return kind === 'link' ? 'link' : 'doc';
}

export function ReplyContextsButton({
  contexts,
  title,
  picked,
  onToggle,
  open,
  onOpen,
  phone = false,
}: {
  contexts: readonly ReplyContextOption[];
  /** The requirement's title, for the picker's head line. */
  title: string;
  picked: ReadonlySet<string>;
  onToggle: (id: string) => void;
  open: boolean;
  onOpen: (open: boolean) => void;
  phone?: boolean;
}) {
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const listId = useRef(`ib-rctx-${Math.random().toString(36).slice(2)}`).current;
  const spot = useSpotAbove(buttonRef, open);

  // A press outside the button and its picker closes it; so does Escape, before anything else hears it.
  useEffect(() => {
    if (!open) return;
    const press = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (!target?.closest?.('[data-reply-contexts-toggle], [data-reply-contexts-picker]')) onOpen(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      onOpen(false);
    };
    document.addEventListener('pointerdown', press);
    window.addEventListener('keydown', key, true);
    return () => {
      document.removeEventListener('pointerdown', press);
      window.removeEventListener('keydown', key, true);
    };
  }, [open, onOpen]);

  const count = picked.size;
  return (
    <div className="ib-rctx" data-reply-contexts-toggle="">
      <Tip content={count > 0 ? `已选 ${count} 个需求上下文` : '附加需求上下文'}>
        <button
          ref={buttonRef}
          type="button"
          className="ib-ricon"
          aria-label={`附加需求上下文${count > 0 ? `（已选 ${count} 个）` : ''}`}
          data-reply-contexts-button=""
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onOpen(!open)}
        >
          <Icon name="book" size={phone ? 20 : 16} />
          {count > 0 && (
            <span className="ib-rctx-n" aria-hidden="true">
              {count}
            </span>
          )}
        </button>
      </Tip>
      {open && (
        <div className="ib-rctx-pop" id={listId} data-reply-contexts-picker="" role="group" aria-label={`${title}的上下文 · 勾选随回复发出`} style={spot}>
          <div className="ib-rctx-head">
            「{title}」的上下文 · 勾选随回复发出
          </div>
          {contexts.map((context) => {
            const on = picked.has(context.id);
            return (
              <button
                key={context.id}
                type="button"
                className={`ib-rctx-row${on ? ' on' : ''}`}
                title={context.ref}
                aria-pressed={on}
                onClick={() => onToggle(context.id)}
              >
                <Icon name={kindIcon(context.kind)} size={14} className="ib-rctx-ic" />
                <span className="ib-rctx-nm">{context.name}</span>
                <span className="ib-rctx-tick" aria-hidden="true">
                  {on ? '✓' : ''}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** The picked contexts' removable chips over the reply field (the mock's chips row). */
export function ReplyContextsChips({
  contexts,
  picked,
  onRemove,
}: {
  contexts: readonly ReplyContextOption[];
  picked: ReadonlySet<string>;
  onRemove: (id: string) => void;
}) {
  const chosen = contexts.filter((context) => picked.has(context.id));
  if (chosen.length === 0) return null;
  return (
    <div className="ib-rctx-chips" data-reply-contexts-chips="">
      {chosen.map((context) => (
        <span key={context.id} className="ib-rctx-chip" title={context.ref}>
          <Icon name={kindIcon(context.kind)} size={12} />
          {context.name}
          <button
            type="button"
            className="ib-rctx-x"
            aria-label={`移除 ${context.name}`}
            onClick={() => onRemove(context.id)}
          >
            ×
          </button>
        </span>
      ))}
    </div>
  );
}
