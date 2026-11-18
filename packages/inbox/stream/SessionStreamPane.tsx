/**
 * 会话「对话流」: the thread's agent session, working, as the pane over the
 * thread — the session's terminal in the window, and its own conversation:
 * what the person types at the bottom goes over Ask AI's channel (a question
 * the session answers in place — it never lands in the thread, whose own
 * reply box stays exactly as it was), and the pane merges the two streams by
 * time: the session's transcript (its words, its tool calls one line each
 * with input and result behind a click, its thoughts quiet) and the ask
 * conversation (the person's questions, Claude's answers as they stream).
 * The transcript is tail-read on open and polled while open, newest at the
 * bottom; scrolling up steps off the follow (回到最新 comes back); 加载更早
 * pages the beginning in.
 *
 * Entries key on their transcript line (`i`, the ask conversation on its
 * turn ids at 2¹-ish keys): a tool call whose result line has not arrived
 * yet draws as running and completes in place on a later poll — the same
 * entry, updated, never a second row. A sent question echoes at once and
 * steps aside when the ask conversation shows its own copy. A session that
 * takes no questions (can_ask false — nothing live to answer) says so and
 * points at the thread's reply, which wakes it. Styled only with the
 * window's tokens (packages/ui themes), so every palette carries it.
 */
import { useEffect, useRef, useState } from 'react';
import { generateId } from '@plannotator/ui/utils/generateId';
import { ChatMarkdown } from '@plannotator/ui/components/chat';
import { Icon } from '../icons';
import { inboxApi, type InboxStreamEntry, type InboxAskTurnWire } from '../api';
import { InboxApiError } from '../apiError';

/** How often an open pane asks what grew (localhost; the server's mtime guard answers unchanged for free). */
const POLL_MS = 1600;

/** Where the ask conversation's turns key, and past it the sent echo's (a transcript never has a milliard lines). */
const ASK_KEY = 2_000_000_000;
const ECHO_KEY = ASK_KEY + 1_000_000_000;

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
  const [words, setWords] = useState('');
  const [busy, setBusy] = useState(false);
  /** Whether the thread's owner takes Ask questions (the ask read says); null until the first read lands. */
  const [canAsk, setCanAsk] = useState<boolean | null>(null);
  /** The last sent question's turn, and its read-back state: a question nothing picked up must be seen. */
  const [askTurn, setAskTurn] = useState<string | null>(null);
  const [askState, setAskState] = useState<'sent' | 'waiting' | 'gone' | null>(null);
  const list = useRef<HTMLDivElement | null>(null);
  // Refs the poll reads: the interval outlives renders, so it must not be rebuilt on every entry.
  const cursorRef = useRef(0);
  const followingRef = useRef(true);
  followingRef.current = following;
  const echo = useRef(ECHO_KEY);
  const askTurnRef = useRef<string | null>(null);
  const askStateRef = useRef<'sent' | 'waiting' | 'gone' | null>(null);
  askTurnRef.current = askTurn;
  askStateRef.current = askState;

  /** Upsert by key, ordered by time (the line's, the turn's), oldest first: a tool's result updates its call in
   *  place, and the ask conversation rides the same order as the transcript it interleaves with. */
  const merge = (incoming: readonly InboxStreamEntry[]) => {
    if (incoming.length === 0) return;
    setEntries((held) => {
      const byKey = new Map(held.map((entry) => [entry.i, entry]));
      for (const entry of incoming) byKey.set(entry.i, { ...byKey.get(entry.i), ...entry });
      // The conversation shows the turn now: the echo of the same words steps aside.
      const landed = incoming.filter((entry) => entry.kind === 'you' && (entry.text ?? '').trim());
      if (landed.length > 0) {
        const retiring = held.filter((heldEntry: InboxStreamEntry) => heldEntry.i >= ECHO_KEY && landed.some((real) => (real.text ?? '').trim() === heldEntry.text));
        for (const echoEntry of retiring) byKey.delete(echoEntry.i);
      }
      return [...byKey.values()].sort((a, b) => (a.t ?? a.i) - (b.t ?? b.i) || a.i - b.i);
    });
  };

  const pinned = () => {
    const node = list.current;
    if (node) node.scrollTop = node.scrollHeight;
  };

  // The tail on open, then what grew — the transcript and the ask conversation together — while the pane is
  // open. A 404 that is no_transcript keeps polling: the session's file can appear on its next turn.
  useEffect(() => {
    let alive = true;
    const readStream = async (page: { after?: number; before?: number }, landing: boolean) => {
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
    // The ask conversation: the person's questions and Claude's answers, merged by time; can_ask gates the footer.
    const readAsk = async () => {
      try {
        const model = await inboxApi.askRead(threadId);
        if (!alive) return;
        setCanAsk(model.can_ask === true);
        const turns = model.conversation?.turns ?? [];
        const asEntries: InboxStreamEntry[] = [];
        turns.forEach((turn: InboxAskTurnWire, index: number) => {
          if (turn.question.trim()) asEntries.push({ i: ASK_KEY + index, t: Date.parse(turn.at), kind: 'you', text: turn.question });
          if (turn.answer) asEntries.push({ i: ASK_KEY + index + 0.5, t: turn.answered_at ? Date.parse(turn.answered_at) : Date.parse(turn.at), kind: 'text', text: turn.answer });
        });
        merge(asEntries);
        if (askTurnRef.current && askStateRef.current === 'sent') {
          const turn = turns.find((entry) => entry.id === askTurnRef.current);
          if (turn) {
            if (turn.failure === 'gone' || turn.failure === 'failed') setAskState('gone');
            else if (turn.answer) setAskState(null);
            else setAskState('waiting');
          }
        }
      } catch {
        // The ask read is a bonus, not the pane's spine: a failure here says nothing about the stream.
      }
    };
    void readStream({}, true);
    void readAsk();
    const timer = setInterval(() => {
      void readStream({ after: cursorRef.current }, false);
      void readAsk();
    }, POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [threadId]);

  // The footer's send: an Ask AI question — the session's own channel, never the thread's. The words echo at
  // once; the ask conversation's own copy retires the echo, and its answer streams in as a Claude entry.
  const send = async () => {
    const question = words.trim();
    if (!question || busy) return;
    setBusy(true);
    setWords('');
    try {
      const turnId = generateId('ask');
      await inboxApi.askSend(threadId, turnId, question);
      setAskTurn(turnId);
      setAskState('sent');
      merge([{ i: ++echo.current, t: Date.now(), kind: 'you', text: question }]);
      setFollowing(true);
      requestAnimationFrame(pinned);
    } catch (cause) {
      setWords(question);
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

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

      {canAsk === false ? (
        <p className="ib-sstr-askhint">这个会话现在不在这里接话——要唤醒它开工，在线程里回复它。</p>
      ) : (
        <form
          className="ib-sstr-ask"
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <input value={words} onChange={(event) => setWords(event.target.value)} placeholder="问它、吩咐它——这是你们俩的对话，不进线程…" aria-label="对话" disabled={busy} />
          <button type="submit" disabled={busy || !words.trim()}>
            发送
          </button>
        </form>
      )}
      {askState === 'waiting' && <p className="ib-sstr-asknote">已递出，它手头的活排在前面——做完这步就答你。</p>}
      {askState === 'gone' && <p className="ib-sstr-asknote">这句它没有接住；要它开工的话，在线程里回复它。</p>}
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
      {/* Claude's words are markdown (bold, code, lists) — the window's own sanitized renderer, not plain text. */}
      <div className="ib-sstr-words" dir="auto">
        <ChatMarkdown text={entry.text ?? ''} role="assistant" messageId={`stream-${entry.i}`} />
      </div>
    </div>
  );
}
