/**
 * 会话「对话流」: the thread's agent session, working, as the pane over the
 * thread — the session's terminal in the window, and its own conversation.
 * The transcript renders with the window's own ChatTranscript (the Ask AI
 * module's renderer: user and assistant rows, markdown, a live pending line),
 * so it reads exactly like every other conversation in the product; tool calls
 * and thoughts ride along as quiet custom parts (no bordered cards, no rule
 * lines). What the person types at the bottom goes over Ask AI's channel (a
 * question the session answers in place — it never lands in the thread), and
 * the pane merges the two streams by time. The transcript is tail-read on
 * open and polled while open, newest at the bottom; 加载更早 pages the
 * beginning in.
 *
 * Entries key on their transcript line (`i`, the ask conversation on its
 * turn ids at 2¹-ish keys): a tool call whose result line has not arrived
 * yet draws as running and completes in place on a later poll — the same
 * entry, updated, never a second row. A sent question echoes at once and
 * steps aside when the ask conversation shows its own copy. A session that
 * takes no questions (can_ask false — nothing live to answer) says so and
 * points at the thread's reply, which wakes it.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { ChatTranscript, type ChatMessage, type ChatMessagePart, type ChatStatus } from '@plannotator/ui/components/chat';
import { isImeCompositionKey } from '@plannotator/ui/utils/commentSubmitKey';
import type { InboxRunState } from '@plannotator/core/inbox-types';
import { Icon } from '../icons';
import { inboxApi, type InboxStreamEntry, type InboxAskTurnWire } from '../api';
import { InboxApiError } from '../apiError';

/** How often an open pane asks what grew. Idle: 1.6s; while the session works: 0.7s (localhost; the server's
 *  mtime guard answers unchanged for free). */
const POLL_MS = 1600;
const POLL_FAST_MS = 700;

/** Where the ask conversation's turns key, and past it the sent echo's (a transcript never has a milliard lines). */
const ASK_KEY = 2_000_000_000;
const ECHO_KEY = ASK_KEY + 1_000_000_000;

/** A tool call as a transcript part: one quiet line, its input and result behind a click. */
interface StreamToolPart extends ChatMessagePart {
  readonly type: 'tool';
  readonly tool: string;
  readonly brief: string;
  readonly input?: string;
  readonly result?: string;
  readonly key: number;
}
/** A thought as a transcript part: folded, there when the person wants it. */
interface StreamThinkPart extends ChatMessagePart {
  readonly type: 'think';
  readonly text: string;
}

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
  const [atBottom, setAtBottom] = useState(true);
  const [words, setWords] = useState('');
  const [busy, setBusy] = useState(false);
  /** The thread's run line (the product's own working state): 'none' when the thread has no run (not a launched session). */
  const [runState, setRunState] = useState<InboxRunState | 'none' | null>(null);
  /** The writer session's live `busy` (the sessions read, `wrote_thread` first): true = a turn runs now. */
  const [sessionBusy, setSessionBusy] = useState<boolean | null>(null);
  /** The ask conversation's own word: a turn is being answered (askRead's `running`). */
  const [askRunning, setAskRunning] = useState(false);
  const list = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  // Refs the poll reads: the interval outlives renders, so it must not be rebuilt on every entry.
  const cursorRef = useRef(0);
  const echo = useRef(ECHO_KEY);
  const busyRef = useRef<boolean | null>(null);
  const askRunningRef = useRef(false);
  const workingRef = useRef(false);
  busyRef.current = sessionBusy;
  askRunningRef.current = askRunning;

  /** Upsert by key, ordered by time (the line's, the turn's), oldest first: a tool's result updates its call in
   * place, and the ask conversation rides the same order as the transcript it interleaves with. */
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
        setAskRunning(model.running !== null);
        const turns = model.conversation?.turns ?? [];
        const asEntries: InboxStreamEntry[] = [];
        turns.forEach((turn: InboxAskTurnWire, index: number) => {
          if (turn.question.trim()) asEntries.push({ i: ASK_KEY + index, t: Date.parse(turn.at), kind: 'you', text: turn.question });
          if (turn.answer) asEntries.push({ i: ASK_KEY + index + 0.5, t: turn.answered_at ? Date.parse(turn.answered_at) : Date.parse(turn.at), kind: 'text', text: turn.answer });
        });
        merge(asEntries);
      } catch {
        // The ask read is a bonus, not the pane's spine: a failure here says nothing about the stream.
      }
    };
    // The thread's run line (launched sessions) and its writer session's live busy: the product's own answers to
    // "is it working" — the sessions read is per-thread and light ("the thread's own writers first").
    const readRun = async () => {
      try {
        const read = await inboxApi.thread(threadId);
        if (!alive) return;
        setRunState(read.run ? read.run.state : 'none');
      } catch {
        // The stream itself says when it cannot be read; the run line is a bonus.
      }
      try {
        const model = await inboxApi.sessions(threadId);
        if (!alive) return;
        const writer = model.sessions.find((s) => s.wrote_thread) ?? model.sessions[0] ?? null;
        setSessionBusy(writer ? writer.busy : null);
      } catch {
        // Bonus, not the spine.
      }
    };
    void readStream({}, true);
    void readAsk();
    void readRun();
    // 终端手感：会话在跑时快轮询（stdout 跟手），空闲时放慢（省钱也够用）。
    const tick = () => {
      void readStream({ after: cursorRef.current }, false);
      void readAsk();
      void readRun();
      const fast = busyRef.current === true || askRunningRef.current || workingRef.current;
      timer = setTimeout(tick, fast ? POLL_FAST_MS : POLL_MS);
    };
    let timer = setTimeout(tick, POLL_MS);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [threadId]);

  // The footer's send: the terminal's stdin. The words ALWAYS go as the thread's reply — the one channel
  // that is the session's own next turn (it wakes a resting session; while it runs, they queue as typed-ahead
  // input, consumed when the turn ends). No channel guessing, no dead ends: this is exactly what typing in
  // the Claude Code terminal does.
  const send = async () => {
    const question = words.trim();
    if (!question || busy) return;
    setBusy(true);
    setWords('');
    try {
      await sendAsReply(question);
      merge([{ i: ++echo.current, t: Date.now(), kind: 'you', text: question }]);
      setAtBottom(true);
    } catch (cause) {
      setWords(question);
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  /** The resting-session path: the thread's reply, addressed to its newest agent message. It wakes the session;
   *  the words then show in the thread too — that is the reply's own record, not this pane's doing. */
  const sendAsReply = async (question: string) => {
    const read = await inboxApi.thread(threadId);
    const messages = read.thread.messages ?? [];
    const last = [...messages].reverse().find((message) => message.author?.kind === 'agent');
    if (!last) throw new Error('这个线程里还没有会话消息可回复。');
    await inboxApi.reply(last.id, { idempotency_key: crypto.randomUUID(), words: question, questions: [] });
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

  // Entries → the transcript's messages (the Ask AI renderer). Tool calls and thoughts are quiet custom parts.
  const messages = useMemo<ChatMessage<ChatMessagePart>[]>(() => {
    return entries.map((entry) => {
      if (entry.kind === 'tool') {
        return {
          id: `s-${entry.i}`,
          role: 'assistant' as const,
          parts: [{ type: 'tool', tool: entry.tool ?? '', brief: entry.brief ?? '', input: entry.input, result: entry.result, key: entry.i } as StreamToolPart],
        };
      }
      if (entry.kind === 'think') {
        return {
          id: `s-${entry.i}`,
          role: 'assistant' as const,
          parts: [{ type: 'think', text: entry.text ?? '' } as StreamThinkPart],
        };
      }
      if (entry.kind === 'you') {
        return { id: `s-${entry.i}`, role: 'user' as const, parts: [{ type: 'text' as const, text: entry.text ?? '', state: 'done' as const }] };
      }
      return { id: `s-${entry.i}`, role: 'assistant' as const, parts: [{ type: 'text' as const, text: entry.text ?? '', state: 'done' as const }] };
    });
  }, [entries]);

  // 运行中: the product's own signals, in order — the run line (launched sessions), the writer session's live
  // busy, the ask conversation's `running`; a tool call still without its result is the last fallback.
  const toolRunning = entries.some((entry) => entry.kind === 'tool' && entry.result === undefined);
  const working =
    runState === 'working' || runState === 'starting' ||
    sessionBusy === true ||
    askRunning ||
    ((runState === 'none' || runState === null) && toolRunning);
  workingRef.current = working;
  const status: ChatStatus = working ? 'streaming' : 'ready';
  /** The top bar's state pill: always a word for where the session stands, never a guess. */
  const runPill = (() => {
    if (working) return { cls: 'live', node: <><span className="ib-spin" aria-hidden="true" /> 运行中</> };
    switch (runState) {
      case 'waiting_answer': return { cls: 'hold', node: <><Icon name="clock" size={11} /> 等你回复</> };
      case 'waiting_terminal': return { cls: 'hold', node: <><Icon name="clock" size={11} /> 等终端输入</> };
      case 'stopped': return { cls: 'off', node: <>已停止</> };
      case 'failed': return { cls: 'off', node: <>失败</> };
      case 'missing': return { cls: 'off', node: <>不在运行</> };
      default:
        // No run line (not a launched session): the live connection still said something.
        if (sessionBusy === false) return { cls: 'off', node: <>空闲</> };
        return null;
    }
  })();

  const renderPart = (part: ChatMessagePart): React.ReactNode | undefined => {
    if (part.type === 'tool') {
      const tool = part as StreamToolPart;
      const open = openTools.has(tool.key);
      const live = tool.result === undefined;
      return (
        <div className={`ib-sstr-toolrow${live ? ' live' : ''}`}>
          <button type="button" className="ib-sstr-toolrow-head" onClick={() => setOpenTools((held) => { const next = new Set(held); if (next.has(tool.key)) next.delete(tool.key); else next.add(tool.key); return next; })} aria-expanded={open}>
            <Icon name={open ? 'chevD' : 'chevR'} size={10} />
            <span className="ib-sstr-toolrow-name">{tool.tool}</span>
            <span className="ib-sstr-toolrow-brief" dir="auto">{tool.brief}</span>
            <span className="ib-sstr-toolrow-state">{live ? <span className="ib-spin" aria-label="运行中" /> : '✓'}</span>
          </button>
          {open && (
            <div className="ib-sstr-toolrow-detail">
              {tool.input && <pre className="ib-sstr-toolrow-io">{tool.input}</pre>}
              <pre className="ib-sstr-toolrow-io">{tool.result ?? '…'}</pre>
            </div>
          )}
        </div>
      );
    }
    if (part.type === 'think') {
      return (
        <details className="ib-sstr-thinkrow">
          <summary>思考</summary>
          <p dir="auto">{(part as StreamThinkPart).text}</p>
        </details>
      );
    }
    return undefined;
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
        {runPill && <span className={`ib-sstr-live ib-sstr-pill-${runPill.cls}`}>{runPill.node}</span>}
        <span className="ib-sp" />
        <button type="button" className="ib-sstr-x" aria-label="关闭对话流" onClick={onClose}>
          <Icon name="x" size={16} />
        </button>
      </div>

      <div className="ib-sstr-list" ref={list} onScroll={() => {
        const node = list.current;
        if (!node) return;
        const bottom = node.scrollHeight - node.scrollTop - node.clientHeight < 28;
        if (bottom !== atBottom) setAtBottom(bottom);
      }}>
        {more && (
          <button type="button" className="ib-sstr-earlier" onClick={() => void earlier()}>
            加载更早
          </button>
        )}
        {empty && !error && <p className="ib-sstr-empty">这个会话还没有写下任何内容。它开工后，这里会跟着长出来。</p>}
        {error && <p className="ib-sstr-error" role="alert">{error}</p>}
        <ChatTranscript
          messages={messages}
          status={status}
          agentName="Claude"
          userName="你"
          label="会话对话流"
          scrollRef={list}
          renderPart={renderPart}
          pending={working ? <span className="ib-sstr-pending">会话正在工作…</span> : false}
        />
      </div>

      {!atBottom && (
        <button type="button" className="ib-sstr-catchup" onClick={() => {
          setAtBottom(true);
          const node = list.current;
          if (node) node.scrollTop = node.scrollHeight;
        }}>
          <Icon name="chevD" size={11} /> 回到最新
        </button>
      )}

      {/* 发送区：Ask AI 的 ib-askfoot 同款（rbox/rtext/askq 全局样式直接复用） */}
      <div className="ib-askfoot" data-ask-box="">
        <div
          className="ib-rbox ib-askbox"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              event.preventDefault();
              composerRef.current?.focus();
            }
          }}
        >
          <div className="ib-rscroll">
            <textarea
              ref={composerRef}
              className="ib-rtext"
              rows={2}
              dir="auto"
              value={words}
              disabled={busy}
              placeholder="问它、吩咐它…"
              aria-label="对话"
              onChange={(event) => setWords(event.target.value)}
              onKeyDown={(event) => {
                const enter = event.key === 'Enter';
                if (enter) event.stopPropagation();
                if (isImeCompositionKey(event) || !enter) return;
                if (event.shiftKey) return;
                event.preventDefault();
                if (!busy) void send();
              }}
            />
          </div>
          <button
            type="button"
            className="ib-askq"
            data-ready={words.trim() ? '' : undefined}
            onClick={() => void send()}
            disabled={busy || !words.trim()}
            aria-label="发送"
          >
            {busy ? <span className="ib-spin" aria-hidden="true" /> : <SendGlyph />}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Ask AI 的回车箭头（AskChat 的 AskEnterGlyph 同款）。 */
function SendGlyph() {
  return (
    <svg className="ib-ic" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M19 5v6a4 4 0 0 1-4 4H5" />
      <path d="M9 11l-4 4 4 4" />
    </svg>
  );
}
