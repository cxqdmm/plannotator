/**
 * The 对话流 pane as the window draws it: the tail on open (your words,
 * Claude's, a tool call one line), a tool's click opening its input and
 * result, 加载更早 paging the beginning, and the footer's 插话 posting an Ask
 * AI question with the person's echo in place. The pane's api is stubbed at
 * fetch, as the Requirements panel's DOM tests do: the real module graph
 * loads, only the network is fake.
 *
 * DOM-gated: runs under DOM_TESTS=1 (happy-dom), from tests/dom-test-list.txt.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const hasDom = typeof document !== 'undefined';
const { SessionStreamPane } = (hasDom ? await import('./SessionStreamPane') : {}) as typeof import('./SessionStreamPane');

const model = (entries: unknown[], cursor: number, more = false) => ({ entries, cursor, more, session: { id: 'ses_x', host: 'claude-code' } });

/** The fake network: what each `METHOD path` answers, and what it was asked. */
let answers: Record<string, { status: number; body: unknown }>;
let asked: { method: string; path: string; body: Record<string, unknown> }[];
let savedFetch: typeof fetch;

beforeEach(() => {
  answers = {
    'GET /api/inbox/threads/thr_1/ask': { status: 200, body: { can_ask: true, conversation: { turns: [] } } },
    'GET /api/inbox/threads/thr_1/stream': {
      status: 200,
      body: model([
        { i: 4, kind: 'you', text: '开始做「登录页改版」。' },
        { i: 5, kind: 'tool', tool: 'Bash', brief: 'git status --short', input: '{\n "command": "git status --short"\n}', result: 'M packages/a.ts' },
        { i: 6, kind: 'tool', tool: 'Read', brief: '/work/SKILL.md', input: '{\n "file_path": "/work/SKILL.md"\n}' },
        { i: 7, kind: 'text', text: '工作区有一处改动，我先读技能文档。' },
      ], 8, true),
    },
  };
  asked = [];
  savedFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = (init?.method ?? 'GET').toUpperCase();
    const path = String(input);
    asked.push({ method, path, body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {} });
    const answer = answers[`${method} ${path}`] ?? { status: 200, body: {} };
    return new Response(JSON.stringify(answer.body), { status: answer.status, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = savedFetch;
});

describe(hasDom ? 'SessionStreamPane' : describe.skip, () => {
  let host: HTMLElement;
  let root: Root | null = null;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
  });
  afterEach(() => {
    act(() => root?.unmount());
    host.remove();
  });

  const draw = async () => {
    await act(async () => {
      root = createRoot(host);
      root.render(<SessionStreamPane threadId="thr_1" onClose={() => {}} />);
    });
  };

  test('draws the tail: your bubble, a tool with its result done, one without still running, 加载更早 when there is more', async () => {
    await draw();
    expect(host.textContent).toContain('开始做「登录页改版」。');
    expect(host.textContent).toContain('工作区有一处改动');
    expect(host.textContent).toContain('git status --short');
    const rows = host.querySelectorAll('[data-stream-pane] .ib-sstr-tool');
    expect(rows).toHaveLength(2);
    // The call whose result line has arrived is 完成; the one without is still running.
    expect(rows[0]!.textContent).toContain('完成');
    expect(rows[0]!.querySelector('.ib-spin')).toBeNull();
    expect(rows[1]!.querySelector('.ib-spin')).not.toBeNull();
    expect(host.querySelector('.ib-sstr-earlier')?.textContent).toContain('加载更早');
  });

  test('a tool row opens its input and result on click, and closes again', async () => {
    await draw();
    const row = host.querySelector<HTMLButtonElement>('.ib-sstr-tool-row')!;
    expect(host.querySelector('.ib-sstr-tool-detail')).toBeNull();
    await act(async () => {
      row.click();
    });
    const detail = host.querySelector('.ib-sstr-tool-detail');
    expect(detail?.textContent).toContain('git status --short');
    expect(detail?.textContent).toContain('M packages/a.ts');
    await act(async () => {
      row.click();
    });
    expect(host.querySelector('.ib-sstr-tool-detail')).toBeNull();
  });

  test('加载更早 asks for the page before the first line it holds', async () => {
    await draw();
    await act(async () => {
      host.querySelector<HTMLButtonElement>('.ib-sstr-earlier')!.click();
    });
    const earlier = asked.find((call) => call.path.includes('before='));
    expect(earlier?.path).toContain('/stream?before=4');
  });

  test('插话 posts an Ask AI question and echoes it in place', async () => {
    await draw();
    answers['POST /api/inbox/threads/thr_1/ask'] = { status: 200, body: { ok: true } };
    const input = host.querySelector<HTMLInputElement>('.ib-sstr-ask input')!;
    await act(async () => {
      // React's controlled input needs the native setter, or its tracker sees no change (happy-dom quirk).
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '先别动 SKILL.md');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      host.querySelector<HTMLButtonElement>('.ib-sstr-ask button')!.click();
    });
    const posted = asked.find((call) => call.method === 'POST' && call.path.endsWith('/ask'));
    expect(posted?.body.question).toBe('先别动 SKILL.md');
    expect(typeof posted?.body.turn_id).toBe('string');
    expect(host.textContent).toContain('先别动 SKILL.md');
  });

  test('a session that takes no questions right now shows the hint instead of a dead input', async () => {
    answers['GET /api/inbox/threads/thr_1/ask'] = { status: 200, body: { can_ask: false, conversation: { turns: [] } } };
    await draw();
    expect(host.querySelector('.ib-sstr-ask input')).toBeNull();
    expect(host.textContent).toContain('直接在线程里回复它');
  });

  test('a session with no transcript yet says so in the person’s words', async () => {
    answers['GET /api/inbox/threads/thr_1/stream'] = { status: 404, body: { error: 'none', code: 'no_transcript' } };
    await draw();
    expect(host.textContent).toContain('还没有留下对话记录');
  });
});
