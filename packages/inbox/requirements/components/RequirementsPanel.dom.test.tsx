/**
 * The Requirements panel as the window draws it: a Board-style kanban — the
 * seven stage lanes in order, the composer's create flow, a drag between
 * lanes PATCHing the stage, and an optimistic write that fails rolling the
 * card back with its error line. The panel's api is stubbed at fetch (its
 * real module graph loads; only the network is fake), so nothing here reads
 * a real data dir.
 *
 * DOM-gated: runs under DOM_TESTS=1 (happy-dom), from tests/dom-test-list.txt.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Requirement } from '@plannotator/core/requirements-types';

const hasDom = typeof document !== 'undefined';
const { RequirementsPanel } = (hasDom ? await import('./RequirementsPanel') : {}) as typeof import('./RequirementsPanel');
// The panel's header carries the sidebar toggle, which lives in the shell's provider (App always has one up the tree).
const { SidebarProvider } = (hasDom ? await import('../../shell/sidebar') : {}) as typeof import('../../shell/sidebar');

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
      root!.render(
        <SidebarProvider>
          <RequirementsPanel on />
        </SidebarProvider>,
      );
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

  /** A drag from one card to one lane, the way the Board's tests drive HTML5 DnD. */
  const drag = (card: Element, lane: Element) => {
    const transfer = { setData() {}, effectAllowed: 'move', dropEffect: 'move' };
    act(() => {
      card.dispatchEvent(Object.assign(new Event('dragstart', { bubbles: true }), { dataTransfer: transfer }));
    });
    act(() => {
      lane.dispatchEvent(Object.assign(new Event('dragover', { bubbles: true, cancelable: true }), { dataTransfer: transfer }));
    });
    act(() => {
      lane.dispatchEvent(Object.assign(new Event('drop', { bubbles: true, cancelable: true }), { dataTransfer: transfer }));
    });
  };

  const lane = (stage: string) => host.querySelector(`.ib-lane[data-lane="${stage}"]`)!;
  const laneCards = (stage: string) => [...lane(stage).querySelectorAll('.ib-bcard[data-requirement-id]')].map((card) => card.getAttribute('data-requirement-id'));

  test('draws the seven stage lanes in order with their cards, on the Board\'s own page classes', async () => {
    await draw();
    expect([...host.querySelectorAll('.ib-lane[data-lane]')].map((element) => element.getAttribute('data-lane'))).toEqual(['triage', 'design', 'design-review', 'dev', 'qa', 'code-review', 'done']);
    expect(host.querySelector('.ib-bpage[data-requirements-page]')).not.toBeNull();
    expect(laneCards('design')).toEqual(['req_a']);
    expect(laneCards('triage')).toEqual(['req_b']);
    expect(asked.filter((call) => call.method === 'GET').map((call) => call.path)).toEqual(['/api/requirements']);
  });

  test('新建需求 composes in the 待跟进 lane; Enter creates over POST and the card lands there', async () => {
    await draw();
    answers.POST = { status: 201, body: { requirement: requirement('req_new', '新需求', 'triage') } };
    act(() => {
      host.querySelector<HTMLButtonElement>('[data-requirements-new]')!.click();
    });
    const field = lane('triage').querySelector<HTMLInputElement>('input[aria-label="需求标题"]')!;
    await type(field, '新需求');
    await act(async () => {
      field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    const post = asked.find((call) => call.method === 'POST');
    expect(post?.path).toBe('/api/requirements');
    expect(post?.body.title).toBe('新需求');
    expect(laneCards('triage')).toContain('req_new');
  });

  test('dragging a card to another lane PATCHes the stage; a failed write rolls the card back and says why', async () => {
    await draw();
    drag(lane('triage').querySelector('.ib-bcard[data-requirement-id="req_b"]')!, lane('qa'));
    await act(async () => {});
    const patch = asked.find((call) => call.method === 'PATCH');
    expect(patch?.path).toBe('/api/requirements/req_b');
    expect(patch?.body.stage).toBe('qa');
    // Moved optimistically…
    expect(laneCards('qa')).toEqual(['req_b']);
    // …and a later drag the server refuses: the card goes back to where the last GOOD write left it,
    // never to the refused lane, and the error line shows.
    answers.PATCH = { status: 500, body: { error: 'The data folder could not be written; nothing changed.' } };
    drag(lane('qa').querySelector('.ib-bcard[data-requirement-id="req_b"]')!, lane('dev'));
    await act(async () => {});
    expect(laneCards('dev')).toEqual([]);
    expect(laneCards('qa')).toEqual(['req_b']);
    expect(host.querySelector('[role="alert"]')!.textContent).toContain('The data folder could not be written');
  });
});
