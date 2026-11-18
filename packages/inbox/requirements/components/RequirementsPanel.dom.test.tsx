/**
 * The Requirements panel as the window draws it: a Board-style kanban — the
 * seven stage lanes in order with the system's SVG marks, the composer's
 * create flow, a drag between lanes PATCHing the stage, 归档 taking a card off
 * the board (and 恢复 bringing it back), and an optimistic write that fails
 * rolling the card back with its error line. The panel's api is stubbed at
 * fetch (its real module graph loads; only the network is fake), so nothing
 * here reads a real data dir.
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

const requirement = (id: string, title: string, stage: Requirement['stage'], archived = false): Requirement => ({
  id,
  title,
  notes: '',
  stage,
  priority: 'none',
  deliverables: [],
  threads: [],
  suggestions: [],
  archived_at: archived ? '2026-11-18T01:00:00.000Z' : null,
  created_at: '2026-11-18T00:00:00.000Z',
  updated_at: '2026-11-18T00:00:00.000Z',
});

/** The fake network: what each `METHOD path` answers (the two list pages have their own keys), and what it was asked. */
let answers: Record<string, { status: number; body: unknown }>;
let asked: { method: string; path: string; body: Record<string, unknown> }[];
let savedFetch: typeof fetch;

const board = (requirements: Requirement[], archived: number) => ({ requirements, archived });

beforeEach(() => {
  answers = {
    'GET /api/requirements': { status: 200, body: board([requirement('req_a', '登录页改版', 'design'), requirement('req_b', '导出报表', 'triage')], 1) },
    'GET /api/requirements?archived=1': { status: 200, body: board([requirement('req_g', '旧需求', 'done', true)], 1) },
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

  const draw = async (props: { archived?: boolean; openId?: string | null; onOpenThread?: (threadId: string) => void } = {}) => {
    if (root) act(() => root!.unmount());
    root = createRoot(host);
    await act(async () => {
      root!.render(
        <SidebarProvider>
          <RequirementsPanel on archived={props.archived} openId={props.openId ?? null} onView={() => {}} onOpen={() => {}} onOpenThread={props.onOpenThread ?? (() => {})} />
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

  test('draws the seven stage lanes in order, each headed by the system\'s SVG mark, with their cards', async () => {
    await draw();
    expect([...host.querySelectorAll('.ib-lane[data-lane]')].map((element) => element.getAttribute('data-lane'))).toEqual(['triage', 'design', 'design-review', 'dev', 'qa', 'code-review', 'done']);
    expect(host.querySelector('.ib-bpage[data-requirements-page]')).not.toBeNull();
    expect(host.querySelectorAll('.ib-lane-h .ib-req-lane-ico svg, .ib-lane-h .ib-req-lane-ico > *').length).toBe(7);
    expect(laneCards('design')).toEqual(['req_a']);
    expect(laneCards('triage')).toEqual(['req_b']);
    // No dots anywhere: the marks are icons, the cards carry no priority dot.
    expect(host.querySelector('.ib-lane-dot')).toBeNull();
    expect(host.querySelector('.ib-req-pri')).toBeNull();
    // The header's 已归档 link says the count.
    expect(host.querySelector('[data-requirements-link="archived"]')!.textContent).toContain('已归档 1');
  });

  test('新建需求 composes in the 待跟进 lane; Enter creates over POST and the card lands there', async () => {
    await draw();
    answers['POST /api/requirements'] = { status: 201, body: { requirement: requirement('req_new', '新需求', 'triage') } };
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
    answers['PATCH /api/requirements/req_b'] = { status: 500, body: { error: 'The data folder could not be written; nothing changed.' } };
    drag(lane('qa').querySelector('.ib-bcard[data-requirement-id="req_b"]')!, lane('dev'));
    await act(async () => {});
    expect(laneCards('dev')).toEqual([]);
    expect(laneCards('qa')).toEqual(['req_b']);
    expect(host.querySelector('[role="alert"]')!.textContent).toContain('The data folder could not be written');
  });

  test('opening a card shows the detail pane: its deliverables and threads, and adopting a suggestion moves the stage', async () => {
    const withDetail = requirement('req_d', '导出报表', 'design');
    withDetail.deliverables = [{ id: 'dlv_1', kind: 'design-doc', ref: 'sess_9', title: '方案', by: 'Claude Code', created_at: '2026-11-18T00:00:00.000Z' }];
    withDetail.threads = ['msg_t1'];
    withDetail.suggestions = [{ id: 'sug_1', stage: 'design-review', why: '方案已挂', by: 'Claude Code', at: '2026-11-18T00:00:00.000Z' }];
    answers['GET /api/requirements'] = { status: 200, body: board([requirement('req_a', '登录页改版', 'design'), withDetail], 0) };
    answers['GET /api/requirements/req_d'] = {
      status: 200,
      body: { requirement: withDetail, events: [{ id: 'evt_1', req: 'req_d', at: '2026-11-18T00:00:00.000Z', kind: 'suggestion', to: 'design-review', note: 'Claude Code: 方案已挂' }] },
    };
    await draw({ openId: 'req_d' });
    const detail = host.querySelector('[data-requirement-detail="req_d"]');
    expect(detail).not.toBeNull();
    expect(detail!.textContent).toContain('设计文档');
    // The session is a card in the list's language: its subject, never its id.
    expect(detail!.textContent).not.toContain('msg_t1');
    expect(detail!.querySelector('.ib-req-thread-row')).not.toBeNull();
    expect(detail!.textContent).toContain('建议 → 设计评审');
    // Adopt: the suggestion's adopt route, then the re-read (the stub still carries the suggestion; the
    // person-facing answer here is only that the call went out with the right id).
    answers['POST /api/requirements/req_d/suggestions/sug_1/adopt'] = { status: 200, body: { requirement: { ...withDetail, stage: 'design-review', suggestions: [] } } };
    act(() => {
      (detail!.querySelector<HTMLButtonElement>('.ib-req-sug-act button')!).click();
    });
    await act(async () => {});
    expect(asked.filter((call) => call.path.endsWith('/adopt')).length).toBe(1);
  });


  test('开始做 launches a session on the requirement, links the thread, and lands the person in it', async () => {
    const fresh = requirement('req_s', '优化admin-frontend技能', 'triage');
    answers['GET /api/requirements'] = { status: 200, body: board([fresh], 0) };
    answers['GET /api/requirements/req_s'] = { status: 200, body: { requirement: fresh, events: [] } };
    answers['GET /api/inbox/sessions'] = { status: 200, body: { serverSession: 'srv', home: '/home', projects: [], launch: { agents: [{ agent: 'claude-code', name: 'Claude Code' }], projects: [{ id: 'prj_1', name: 'plannotator', root: '/work/plannotator', exists: true }] } } };
    answers['POST /api/inbox/messages'] = { status: 200, body: { thread_id: 'msg_new_1', message: { id: 'msg_new_1' }, replayed: false } };
    answers['PATCH /api/requirements/req_s'] = { status: 200, body: { requirement: { ...fresh, threads: ['msg_new_1'] } } };
    const opened: string[] = [];
    await draw({ openId: 'req_s', onOpenThread: (threadId) => opened.push(threadId) });
    // The old way stays folded under the new one: the sentence for a session already running in a terminal.
    expect(host.querySelector('[data-requirements-handoff]')?.textContent).toContain('用 plannotator requirement 工具开始做「优化admin-frontend技能」');
    // The button opens the launch form with the requirement's own words in it.
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[data-requirements-start]')!.click();
    });
    const form = host.querySelector('[data-requirements-start-form]')!;
    expect(form.querySelector('select')?.textContent).toContain('plannotator');
    expect(form.querySelector('textarea')?.value).toContain('开始做「优化admin-frontend技能」');
    await act(async () => {
      form.querySelector<HTMLButtonElement>('[data-requirements-start-send]')!.click();
    });
    // The launch went out with the requirement's words; the new thread linked at once and opened.
    const posted = asked.find((call) => call.method === 'POST' && call.path.endsWith('/api/inbox/messages'));
    expect((posted?.body.to as { launch?: { agent?: string } })?.launch?.agent).toBe('claude-code');
    expect(posted?.body.body).toContain('优化admin-frontend技能');
    const patched = asked.find((call) => call.method === 'PATCH' && call.path.endsWith('/api/requirements/req_s'));
    expect(patched?.body.threads).toEqual(['msg_new_1']);
    expect(opened).toEqual(['msg_new_1']);
  });

  test('归档 takes a card off the board over PATCH; 恢复 brings it back on the archived page', async () => {
    await draw();
    // The server the refresh will read: req_b already archived.
    answers['GET /api/requirements'] = { status: 200, body: board([requirement('req_a', '登录页改版', 'design')], 2) };
    answers['GET /api/requirements?archived=1'] = { status: 200, body: board([requirement('req_g', '旧需求', 'done', true), requirement('req_b', '导出报表', 'done', true)], 2) };
    act(() => {
      host.querySelector<HTMLElement>('.ib-bcard[data-requirement-id="req_b"] [aria-label="归档"]')!.click();
    });
    await act(async () => {});
    const patch = asked.find((call) => call.method === 'PATCH');
    expect(patch?.body).toEqual({ archived: true });
    expect(laneCards('triage')).toEqual([]);
    // The archived page shows it, with 恢复 on its corner.
    await draw({ archived: true });
    expect(laneCards('done')).toEqual(['req_g', 'req_b']);
    answers['PATCH /api/requirements/req_b'] = { status: 200, body: { requirement: requirement('req_b', '导出报表', 'done') } };
    answers['GET /api/requirements?archived=1'] = { status: 200, body: board([requirement('req_g', '旧需求', 'done', true)], 1) };
    act(() => {
      host.querySelector<HTMLElement>('.ib-bcard[data-requirement-id="req_b"] [aria-label="恢复到看板"]')!.click();
    });
    await act(async () => {});
    expect(asked.filter((call) => call.method === 'PATCH').at(-1)!.body).toEqual({ archived: false });
    expect(laneCards('done')).toEqual(['req_g']);
  });
});
