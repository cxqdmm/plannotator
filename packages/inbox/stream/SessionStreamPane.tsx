/**
 * 会话「对话流」: the thread's Claude Code session, working, as the pane over
 * the thread. The session's own transcript — its words, its tool calls one
 * line each (click: input and result), its thoughts quiet — tail-read on open
 * and polled while open, newest at the bottom. Scrolling up steps off the
 * follow (回到最新 comes back); 加载更早 pages the beginning in. The footer's
 * 插话 is Ask AI's question in the same box (it queues behind the session's
 * work), so watching and steering are one pane.
 *
 * Entries key on their transcript line (`i`): a tool call whose result line
 * has not arrived yet draws as running and completes in place on a later poll
 * — the same entry, updated, never a second row. Styled only with the
 * window's tokens (packages/ui themes), so every palette carries it.
 */
import { useEffect, useRef, useState } from 'react';
import { generateId } from '@plannotator/ui/utils/generateId';
import { Icon } from '../icons';
import { inboxApi, type InboxStreamEntry } from '../api';
import { InboxApiError } from '../apiError';

/** How often an open pane asks what grew (localhost; the server's mtime guard answers unchanged for free). */
const POLL_MS = 1600;

/** A refusal the person reads in their words (the pane is browser UI; the codes are the server's). */
function wordsOf(cause: unknown): string {
  if (cause instanceof InboxApiError && cause.code === 'no_transcript') return '这个会话还没有留下对话记录；它开工后会出现在这里。';
  if (cause instanceof InboxApiError && cause.code === 'no_session') return '这个线程不属于一个 Claude Code 会话。';
  return cause instanceof Error ? cause.message : String(cause);
}

export function SessionStreamPane({ threadId, onClose }: { threadId: string; onClose: () => void }) {
  const [entries, setEntries] = useState<InboxStreamEntry[]>([]);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [empty, setEmpty] = useState(false);
  const [openTools, setOpenTools] = useState<ReadonlySet<number>>(new Set());
  const [following, setFollowing] = useState(true);
  const [askWords, setAskWords] = useState('');
  const [askBusy, setAskBusy] = useState(false);
  const list = useRef<HTMLDivElement | null>(null);
  // Refs the poll reads: the interval outlives renders, so it must not be rebuilt on every entry.
  const cursorRef = useRef(0);
  const followingRef = useRef(true);
  followingRef.current = following;
  const askEcho = useRef(0);

  /** Upsert by line index, oldest first: a tool's result updates its call in place. */
  const merge = (incoming: readonly InboxStreamEntry[]) => {
    if (incoming.length === 0) return;
    setEntries((held) => {
      const byIndex = new Map(held.map((entry) => [entry.i, entry]));
      for (const entry of incoming) byIndex.set(entry.i, { ...byIndex.get(entry.i), ...entry });
      return [...byIndex.values()].sort((a, b) => a.i - b.i);
    });
  };

  const pinned = () => {
    const node = list.current;
    if (node) node.scrollTop = node.scrollHeight;
  };

  // The tail on open, then what grew, while the pane is open. A 404 that is no_transcript keeps polling: the
  // session's file can appear on its next turn; no_session never will.
  useEffect(() => {
    let alive = true;
    const read = async (page: { after?: number; before?: number }, landing: boolean) => {
      try {
        const model = await inboxApi.streamRead(threadId, page);
        if (!alive) return;
        setError(null);
        setEmpty(model.entries.length === 0 && landing);
        cursorRef.current = model.cursor;
        setMore(model.more);
        merge(model.entries);
        if (landing || followingRef.current) requestAnimationFrame(pinned);
      } catch (cause) {
        if (!alive) return;
        setError(wordsOf(cause));
      }
    };
    void read({}, true);
    const timer = setInterval(() => void read({ after: cursorRef.current }, false), POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [threadId]);

  const earlier = async () => {
    const first = entries[0]?.i ?? 0;
    if (first <= 0) return setMore(false);
    try {
      const model = await inboxApi.streamRead(threadId, { before: first });
      merge(model.entries);
      setMore(model.more);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const ask = async () => {
    const question = askWords.trim();
    if (!question || askBusy) return;
    setAskBusy(true);
    setAskWords('');
    try {
      await inboxApi.askSend(threadId, generateId('ask'), question);
      // The echo keys past any real line (a transcript never has a milliard): it rides at the bottom until the
      // session's own copy of the question arrives from the transcript with its true index.
      merge([{ i: 1_000_000_000 + askEcho.current++, kind: 'you', text: question }]);
      setFollowing(true);
      requestAnimationFrame(pinned);
    } catch (cause) {
      setAskWords(question);
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setAskBusy(false);
    }
  };

  const onScroll = () => {
    const node = list.current;
    if (!node) return;
    const atBottom = node.scrollHeight - node.scrollTop - node.clientHeight < 28;
    if (atBottom !== following) setFollowing(atBottom);
  };

  return (
    <div className="ib-sstr" aria-label="会话对话流" data-stream-pane="">
      <div className="ib-sstr-top">
        <button type="button" className="ib-sstr-back" onClick={onClose}>
          <Icon name="chevL" size={14} />
          <span>收起</span>
        </button>
        <span className="ib-sstr-title">对话流</span>
        <span className="ib-sstr-sess">claude</span>
        <span className="ib-sp" />
        <button type="button" className={`ib-sstr-follow${following ? ' on' : ''}`} onClick={() => { setFollowing(!following); if (!following) requestAnimationFrame(pinned); }} aria-pressed={following}>
          跟随最新
        </button>
      </div>

      <div className="ib-sstr-list" ref={list} onScroll={onScroll}>
        {more && (
          <button type="button" className="ib-sstr-earlier" onClick={() => void earlier()}>
            加载更早
          </button>
        )}
        {empty && !error && <p className="ib-sstr-empty">这个会话还没有写下任何内容。它开工后，这里会跟着长出来。</p>}
        {error && <p className="ib-sstr-error" role="alert">{error}</p>}
        {entries.map((entry) => (
          <StreamRow key={entry.i} entry={entry} open={openTools.has(entry.i)} onToggle={() => setOpenTools((held) => { const next = new Set(held); if (next.has(entry.i)) next.delete(entry.i); else next.add(entry.i); return next; })} />
        ))}
      </div>

      {!following && (
        <button type="button" className="ib-sstr-catchup" onClick={() => { setFollowing(true); requestAnimationFrame(pinned); }}>
          <Icon name="chevD" size={11} /> 回到最新
        </button>
      )}

      <form
        className="ib-sstr-ask"
        onSubmit={(event) => {
          event.preventDefault();
          void ask();
        }}
      >
        <input value={askWords} onChange={(event) => setAskWords(event.target.value)} placeholder="插一句话，排在它手头工作后面…" aria-label="插话" disabled={askBusy} />
        <button type="submit" disabled={askBusy || !askWords.trim()}>
          发送
        </button>
      </form>
    </div>
  );
}

function StreamRow({ entry, open, onToggle }: { entry: InboxStreamEntry; open: boolean; onToggle: () => void }) {
  if (entry.kind === 'tool') {
    const running = entry.result === undefined;
    return (
      <div className={`ib-sstr-tool${open ? ' open' : ''}`}>
        <button type="button" className="ib-sstr-tool-row" onClick={onToggle} aria-expanded={open}>
          <Icon name={open ? 'chevD' : 'chevR'} size={10} />
          <span className="ib-sstr-tool-name">{entry.tool}</span>
          <span className="ib-sstr-tool-brief" dir="auto">{entry.brief}</span>
          <span className={`ib-sstr-tool-state${running ? '' : ' done'}`}>{running ? <span className="ib-spin" aria-label="运行中" /> : '完成'}</span>
        </button>
        {open && (
          <div className="ib-sstr-tool-detail">
            {entry.input && <pre className="ib-sstr-tool-in">{entry.input}</pre>}
            <pre className="ib-sstr-tool-out">{entry.result ?? '…'}</pre>
          </div>
        )}
      </div>
    );
  }
  if (entry.kind === 'think') {
    return (
      <details className="ib-sstr-think">
        <summary>思考</summary>
        <p dir="auto">{entry.text}</p>
      </details>
    );
  }
  if (entry.kind === 'you') {
    return (
      <div className="ib-sstr-you">
        <div className="ib-sstr-mark">你</div>
        <div className="ib-sstr-bubble" dir="auto">{entry.text}</div>
      </div>
    );
  }
  return (
    <div className="ib-sstr-text">
      <div className="ib-sstr-mark">Claude</div>
      <div className="ib-sstr-words" dir="auto">{entry.text}</div>
    </div>
  );
}
