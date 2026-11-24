/**
 * 附加需求上下文（工坊会话详情专属，approval "session-reply-contexts"）：the reply box's
 * 「上下文」 button and its picker. Offered only when the workshop hands the pane the
 * session's requirement (ThreadPane `replyContexts`); the Inbox's own reply box never
 * passes it, so the button never draws there. 点选或**拖拽**一个材料 = 把它的内嵌
 * markdown 链接（`[名字](引用)`）插进回复文字（点选在光标处，拖放落在落点）——agent
 * 从回复里直接读材料，无需再查需求。
 */
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { Icon } from '../icons';
import { Tip } from './Tip';
import { replyContextMarkdown, type ReplyContextOption } from '../thread/replyContexts';

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
  onInsert,
  phone = false,
}: {
  contexts: readonly ReplyContextOption[];
  /** The requirement's title, for the picker's head line. */
  title: string;
  /** 把材料的内嵌链接插进回复文字（点选=光标处）。 */
  onInsert: (markdown: string) => void;
  phone?: boolean;
}) {
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const listId = useRef(`ib-rctx-${Math.random().toString(36).slice(2)}`).current;
  const [open, setOpen] = useState(false);
  const spot = useSpotAbove(buttonRef, open);

  // A press outside the button and its picker closes it; so does Escape, before anything else hears it.
  useEffect(() => {
    if (!open) return;
    const press = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (!target?.closest?.('[data-reply-contexts-toggle], [data-reply-contexts-picker]')) setOpen(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    };
    document.addEventListener('pointerdown', press);
    window.addEventListener('keydown', key, true);
    return () => {
      document.removeEventListener('pointerdown', press);
      window.removeEventListener('keydown', key, true);
    };
  }, [open, setOpen]);

  return (
    <div className="ib-rctx" data-reply-contexts-toggle="">
      <Tip content="附加需求上下文（点选或拖入回复）">
        <button
          ref={buttonRef}
          type="button"
          className="ib-ricon"
          aria-label="附加需求上下文"
          data-reply-contexts-button=""
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => setOpen(!open)}
        >
          <Icon name="book" size={phone ? 20 : 16} />
        </button>
      </Tip>
      {open && (
        <div className="ib-rctx-pop" id={listId} data-reply-contexts-picker="" role="group" aria-label={`${title}的上下文 · 点选插入，或拖进回复`} style={spot}>
          <div className="ib-rctx-head">
            「{title}」的上下文 · 点选插入，或拖进回复
          </div>
          {contexts.map((context) => {
            const markdown = replyContextMarkdown(context);
            return (
              <button
                key={context.id}
                type="button"
                className="ib-rctx-row"
                title={context.ref}
                draggable
                onDragStart={(event) => {
                  event.dataTransfer.setData('text/plain', markdown);
                  event.dataTransfer.effectAllowed = 'copy';
                }}
                onClick={() => onInsert(markdown)}
              >
                <Icon name={kindIcon(context.kind)} size={14} className="ib-rctx-ic" />
                <span className="ib-rctx-nm">{context.name}</span>
                <span className="ib-rctx-plus" aria-hidden="true">＋</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
