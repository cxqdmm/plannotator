/**
 * The Requirements panel as the window draws it: the seven stage groups in
 * order, the composer's create flow, a stage move's PATCH, and an optimistic
 * write that fails rolling the row back with its error line. The panel's api
 * is stubbed at fetch (its real module graph loads; only the network is
 * fake), so nothing here reads a real data dir.
 *
 * DOM-gated: runs under DOM_TESTS=1 (happy-dom), from tests/dom-test-list.txt.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Requirement } from '@plannotator/core/requirements-types';

const hasDom = typeof document !== 'undefined';
const { RequirementsPanel } = (hasDom ? await import('./RequirementsPanel') : {}) as typeof import('./RequirementsPanel');

const requirement = (id: string, title: string, stage: Requirement['stage'], priority: Requirement['priority'] = 'none'): Requirement => ({
  id,
  title,
  notes: '',
  stage,
  priority,
  deliverables: [],
  created_at: '2026-11-18T00:00:00.000Z',
  updated_at: '2026-11-18T00:00:00.000Z',
});

/** The fake network: what each method answers, and what it was asked. */
let answers: Record<string, { status: number; body: unknown }>;
let asked: { method: string; path: string; body: Record<string, unknown> }[];
let savedFetch: typeof fetch;

beforeEach(() => {
  answers = { GET: { status: 200, body: { requirements: [requirement('req_a', '登录页改版', 'design'), requirement('req_b', '导出报表', 'triage')] } } };
  asked = [];
  savedFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = (init?.method ?? 'GET').toUpperCase();
    const path = String(input);
    asked.push({ method, path, body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {} });
    const answer = method === 'GET' ? answers.GET : (answers[method] ?? { status: 200, body: {} });
    return new Response(JSON.stringify(answer.body), { status: answer.status, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = savedFetch;
});

describe(hasDom ? 'RequirementsPanel' : describe.skip, () => {
  let host: HTMLElement;
  let root: Root | null = null;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
  });
  afterEach(() => {
    act(() => root?.unmount());
    host.remove();
    root = null;
  });

  const draw = async () => {
    root = createRoot(host);
    await act(async () => {
      root!.render(<RequirementsPanel on />);
    });
  };

  /** Type into a controlled input the way a person's keystrokes reach React (the native setter first; one act, as the house tests do). */
  const type = async (input: HTMLInputElement, value: string) => {
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  };

  /** Pick a select's option the way a real pick reaches React's onChange. */
  const pick = async (select: HTMLSelectElement, value: string) => {
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!;
      setter.call(select, value);
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
  };

  test('draws the seven stage groups in order with their rows; the list read is the module\'s own route', async () => {
    await draw();
    const stages = [...host.querySelectorAll<HTMLElement>('[data-requirements-panel] section[data-stage]')].map((section) => section.dataset.stage);
    expect(stages).toEqual(['triage', 'design', 'design-review', 'dev', 'qa', 'code-review', 'done']);
    expect(host.querySelector('section[data-stage="design"]')!.textContent).toContain('登录页改版');
    expect(host.querySelector('section[data-stage="triage"]')!.textContent).toContain('导出报表');
    expect(asked.filter((call) => call.method === 'GET').map((call) => call.path)).toEqual(['/api/requirements']);
  });

  test('新建 composes; Enter creates over POST and the row lands in 待跟进', async () => {
    await draw();
    answers.POST = { status: 201, body: { requirement: requirement('req_new', '新需求', 'triage') } };
    act(() => {
      (host.querySelector<HTMLButtonElement>('[data-requirements-panel] button')!).click();
    });
    const field = host.querySelector<HTMLInputElement>('input[aria-label="需求标题"]')!;
    await type(field, '新需求');
    await act(async () => {
      field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    const post = asked.find((call) => call.method === 'POST');
    expect(post?.path).toBe('/api/requirements');
    expect(post?.body.title).toBe('新需求');
    expect(host.querySelector('section[data-stage="triage"]')!.textContent).toContain('新需求');
  });

  test('a stage move PATCHes; a failed write rolls the row back and says why', async () => {
    await draw();
    const row = host.querySelector<HTMLElement>('[data-requirement-id="req_b"]')!;
    await pick(row.querySelector<HTMLSelectElement>('select[aria-label="阶段"]')!, 'qa');
    const patch = asked.find((call) => call.method === 'PATCH');
    expect(patch?.path).toBe('/api/requirements/req_b');
    expect(patch?.body.stage).toBe('qa');
    // Moved optimistically… (all seven groups always render; the row is what moves)
    expect(host.querySelector('section[data-stage="qa"]')!.textContent).toContain('导出报表');
    // …and the server refuses: the row goes back to where the last GOOD write left it (qa), never to dev,
    // and the error line shows.
    answers.PATCH = { status: 500, body: { error: 'The data folder could not be written; nothing changed.' } };
    await pick(host.querySelector<HTMLElement>('[data-requirement-id="req_b"]')!.querySelector<HTMLSelectElement>('select[aria-label="阶段"]')!, 'dev');
    expect(host.querySelector('section[data-stage="dev"]')!.textContent).not.toContain('导出报表');
    expect(host.querySelector('section[data-stage="qa"]')!.textContent).toContain('导出报表');
    expect(host.querySelector('[role="alert"]')!.textContent).toContain('The data folder could not be written');
  });
});
