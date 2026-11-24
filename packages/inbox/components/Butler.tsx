/**
 * 管家（approval "butler" 一期）：the Inbox's digital butler. A resident orb
 * (bottom-right, breathing glow) that expands — with an entry animation — into
 * the full-screen butler view: the butler's avatar up top, the dialog at the
 * bottom. The brain is the daemon's butler chat route (the configured model
 * with the butler persona; history persists in the butler folder).
 */
import { useEffect, useRef, useState } from 'react';
import { inboxApi } from '../api';

/** 管家徽标：礼帽+领结（SVG，随容器尺寸缩放）。 */
function ButlerBadge({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      {/* 礼帽 */}
      <rect x="14" y="8" width="20" height="12" rx="3" fill="currentColor" />
      <rect x="10" y="19" width="28" height="4" rx="2" fill="currentColor" />
      {/* 领结 */}
      <path d="M24 30 L15 25 L15 35 Z" fill="currentColor" />
      <path d="M24 30 L33 25 L33 35 Z" fill="currentColor" />
      <circle cx="24" cy="30" r="3" fill="currentColor" />
      {/* 单眼（单片眼镜的雅致感） */}
      <circle cx="24" cy="26.5" r="1.2" fill="var(--background, #fff)" />
    </svg>
  );
}

interface ButlerTurn {
  at: string;
  role: 'you' | 'butler';
  text: string;
}

export function Butler() {
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<ButlerTurn[]>([]);
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const loadedRef = useRef(false);

  // 打开时读历史（一次；此后本地追加）。
  useEffect(() => {
    if (!open || loadedRef.current) return;
    loadedRef.current = true;
    void inboxApi.butlerHistory().then((answer) => setTurns(answer.history ?? [])).catch(() => setTurns([]));
  }, [open]);

  // 新消息/流式追加时滚到底。
  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [turns, pending, open]);

  const send = async () => {
    const message = draft.trim();
    if (!message || pending) return;
    setDraft('');
    setTurns((current) => [...current, { at: new Date().toISOString(), role: 'you', text: message }]);
    setPending(true);
    try {
      const answer = await inboxApi.butlerChat(message);
      setTurns((current) => [...current, { at: new Date().toISOString(), role: 'butler', text: answer.reply }]);
    } catch (error) {
      const why = error instanceof Error ? error.message : String(error);
      setTurns((current) => [...current, { at: new Date().toISOString(), role: 'butler', text: `（管家没能回答：${why}）` }]);
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <button
        type="button"
        className={`ib-butler-orb${open ? ' ib-butler-orb-open' : ''}`}
        aria-label="管家"
        title="管家"
        onClick={() => setOpen((current) => !current)}
      >
        <ButlerBadge size={26} />
      </button>
      {open && (
        <div className="ib-butler-pane" role="dialog" aria-label="管家">
          <div className="ib-butler-top">
            <div className="ib-butler-avatar ib-butler-avatar-live">
              <ButlerBadge size={44} />
            </div>
            <div className="ib-butler-name">管家</div>
          </div>
          <div className="ib-butler-list" ref={listRef}>
            {turns.length === 0 && (
              <p className="ib-butler-empty">您好，我是管家。有什么需要，请吩咐。</p>
            )}
            {turns.map((turn, index) => (
              <div key={`${turn.at}-${index}`} className={`ib-butler-msg ib-butler-msg-${turn.role}`}>
                {turn.text}
              </div>
            ))}
            {pending && (
              <div className="ib-butler-msg ib-butler-msg-butler ib-butler-typing" aria-label="管家正在回复">
                <span className="ib-spin" aria-hidden="true" />
              </div>
            )}
          </div>
          <div className="ib-butler-inputrow">
            <input
              type="text"
              className="ib-butler-input"
              placeholder="对管家说点什么…"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && draft.trim() && !pending) void send();
              }}
            />
            <button type="button" className="ib-butler-send" aria-label="发送" onClick={() => void send()} disabled={pending || !draft.trim()}>
              发送
            </button>
          </div>
        </div>
      )}
    </>
  );
}
