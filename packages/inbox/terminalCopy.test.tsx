/**
 * 工坊会话详情工具栏的「复制在终端打开」（prop `terminalCopy`，工坊的 EmbeddedThread 开它）：
 * 服务端给了命令就画图标，点按复制并-toast 已复制、图标短暂变勾；服务端没给（404，不是引擎
 * 会话/宿主不认）就不画，工具栏不空占一位；收件箱自己的面板（不开 prop）不画也不取。
 *
 * DOM-gated: runs under DOM_TESTS=1 (happy-dom), from tests/dom-test-list.txt.
 */
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { InboxProject, InboxThread } from '@plannotator/core/inbox-types';
import type { InboxToastModel } from './components/Toast';

const hasDom = typeof document !== 'undefined';
// Viewer pulls in web-highlighter, which reads `window` at module-eval time.
const { ThreadPane } = (hasDom ? await import('./components/Thread') : {}) as typeof import('./components/Thread');

const PROJECT: InboxProject = { id: 'prj_1', key: 'ledger-abcdef', name: 'ledger', root: '/work/ledger', created_at: '2026-10-11T10:00:00.000Z' };
const ROOT = 'msg_01M4H6G73M9H3Z32T859E72DPY';
const COMMAND = "claude --resume 'f1ce850e-2e10-4b6b-a16f-b35819d6698f'";

function threadOf(): InboxThread {
  const root = {
    id: ROOT,
    project_id: PROJECT.id,
    thread_id: ROOT,
    reply_to: null,
    author: { kind: 'person' as const },
    subject: 'Look at the nightly sync',
    body: 'Find out why it retries forever.',
    created_at: '2026-10-11T10:41:00.000Z',
    resolved_at: null,
    idempotency_key: 'k',
  };
  return { thread_id: ROOT, project: PROJECT, subject: root.subject, thread_name: null, resolved_at: null, messages: [root] };
}

let root: Root | null = null;
let host: HTMLElement | null = null;
let savedFetch: typeof fetch;
let savedClipboard: PropertyDescriptor | undefined;
let terminalReads = 0;
let terminalAnswer: 'ok' | 'gone' = 'ok';
let clipboardText: string | null = null;
let toasts: Omit<InboxToastModel, 'id'>[] = [];

beforeEach(() => {
  if (!hasDom) return;
  savedFetch = globalThis.fetch;
  savedClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  terminalReads = 0;
  terminalAnswer = 'ok';
  clipboardText = null;
  toasts = [];
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: async (text: string) => { clipboardText = text; } },
  });
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    if (path.includes('/terminal')) {
      terminalReads++;
      return terminalAnswer === 'gone'
        ? new Response(JSON.stringify({ error: 'no session', code: 'no_session' }), { status: 404 })
        : Response.json({ command: COMMAND, dir: null });
    }
    if (init?.method === 'POST') return Response.json({ ok: true });
    if (path.includes('/attachments')) return Response.json({ serverSession: 's', attachments: [], annotations: [] });
    if (path.includes('/sessions')) return Response.json({ serverSession: 's', home: '/home/me', project: PROJECT, sessions: [] });
    return Response.json({});
  }) as typeof fetch;
});

afterEach(() => {
  if (!hasDom) return;
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  globalThis.fetch = savedFetch;
  if (savedClipboard) Object.defineProperty(navigator, 'clipboard', savedClipboard);
  else delete (navigator as unknown as Record<string, unknown>).clipboard;
});

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function render(props: { terminalCopy?: boolean } = {}) {
  host = document.createElement('div');
  document.body.appendChild(host);
  act(() => {
    root = createRoot(host!);
    root.render(
      <div className="pn-inbox">
        <ThreadPane
          thread={threadOf()}
          sent={null}
          onQuestions={() => {}}
          onChanged={async () => {}}
          onClose={() => {}}
          file={null}
          onOpenFile={() => {}}
          onOpenGuide={() => {}}
          terminalCopy={props.terminalCopy}
          onToast={(toast) => toasts.push(toast)}
        />
      </div>,
    );
  });
  await settle();
  await settle();
}

const button = () => host!.querySelector<HTMLButtonElement>('[data-terminal-copy]');

if (hasDom) {
  test('服务端给了命令：图标画出来，点按复制命令、toast 已复制、图标短暂变勾', async () => {
    await render({ terminalCopy: true });
    expect(terminalReads).toBe(1);
    expect(button()).not.toBeNull();
    await act(async () => button()!.click());
    await settle();
    expect(clipboardText).toBe(COMMAND);
    expect(toasts.some((t) => t.lead === '已复制' && t.detail === '在终端打开的命令')).toBe(true);
    expect(button()!.getAttribute('data-terminal-copy')).toBe('copied');
  });

  test('服务端没给（404）：没有图标，也不空占一位', async () => {
    terminalAnswer = 'gone';
    await render({ terminalCopy: true });
    expect(terminalReads).toBe(1);
    expect(button()).toBeNull();
  });

  test('收件箱自己的面板（不开 prop）：不取也不画', async () => {
    await render({});
    expect(terminalReads).toBe(0);
    expect(button()).toBeNull();
  });
}
