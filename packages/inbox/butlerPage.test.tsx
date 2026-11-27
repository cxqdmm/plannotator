/**
 * 管家是一页（owner 2026-11-25「管家是一个单独的页面，不是弹框，现在一刷新就不见了」）：
 * `#butler` 可寻址——解析回 page 'butler'、写回还是 #butler，别的地址不受牵连；
 * 入口是侧栏品牌里的猫头鹰（无外圈），Butler 组件受控开（App 传 open/onOpenChange），
 * × 与 ESC 关都回报路由。
 *
 * DOM-gated: runs under DOM_TESTS=1 (happy-dom), from tests/dom-test-list.txt.
 */
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const hasDom = typeof document !== 'undefined';
const { Butler } = (hasDom ? await import('./components/Butler') : {}) as typeof import('./components/Butler');
const { routeOf } = (hasDom ? await import('./app/route') : {}) as typeof import('./app/route');
const { hashOf } = (hasDom ? await import('./app/writeRoute') : {}) as typeof import('./app/writeRoute');

let root: Root | null = null;
let host: HTMLElement | null = null;
let savedFetch: typeof fetch;

beforeEach(() => {
  if (!hasDom) return;
  savedFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const path = String(input);
    if (path.includes('/butler/history')) return Response.json({ history: [] });
    if (path.includes('/butler/approvals')) return Response.json({ approvals: { pending: [], decided: [] }, auto: {} });
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
});

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function renderButler(props: { open?: boolean; onOpenChange?: (open: boolean) => void } = {}) {
  host = document.createElement('div');
  document.body.appendChild(host);
  act(() => {
    root = createRoot(host!);
    root.render(<Butler open={props.open} onOpenChange={props.onOpenChange} />);
  });
  await settle();
}

const pane = () => host!.querySelector('.ib-butler-pane');
const closeBtn = () => host!.querySelector<HTMLButtonElement>('[aria-label="关闭管家"]');

if (hasDom) {
  test('#butler 解析成管家页，写回还是 #butler；别的地址不被牵连', () => {
    const route = routeOf('#butler');
    expect(route.page).toBe('butler');
    expect(hashOf(route)).toBe('#butler');
    // 带 query 的写法也认（但管家是整页，不吃别的参数）。
    expect(routeOf('#butler&x=1').page).toBe('butler');
    // 老地址照旧。
    expect(routeOf('').page).toBe('inbox');
    expect(routeOf('#thread=msg_1').page).toBe('inbox');
    expect(routeOf('#requirements').page).toBe('requirements');
  });

  test('受控开：open 即画面板，× 与 ESC 都回报 onOpenChange(false)', async () => {
    const turns: boolean[] = [];
    await renderButler({ open: true, onOpenChange: (open) => turns.push(open) });
    expect(pane()).not.toBeNull();
    await act(async () => closeBtn()!.click());
    expect(turns).toEqual([false]);
    // ESC 同样回报关闭（管家自己的窗口监听）。
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    await settle();
    expect(turns).toEqual([false, false]);
  });

  test('审批页签：待批的需求卡带完整文档，点批准发到审批路由', async () => {
    const approval = {
      id: 'apr_1',
      kind: 'butler-action',
      action: 'create-requirement',
      status: 'pending',
      title: '建需求卡《登录页改版》',
      summary: '旧版太慢 · 1 个上下文',
      detail: { card: '# 需求卡：登录页改版\n\n## 背景 / 为什么\n旧版太慢', contexts: [{ kind: 'link', name: 'PRD' }] },
      requested_at: new Date().toISOString(),
      decided_at: null,
      result: null,
      note: null,
    };
    const calls: { url: string; body: string | null }[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path.includes('/butler/history')) return Response.json({ history: [] });
      if (path.includes('/butler/approvals') && path.endsWith('/decide')) {
        calls.push({ url: path, body: typeof init?.body === 'string' ? init.body : null });
        return Response.json({ approval: { ...approval, status: 'approved' } });
      }
      if (path.includes('/butler/approvals')) return Response.json({ approvals: { pending: [approval], decided: [] }, auto: { 'create-requirement': false } });
      if (path.includes('/projects')) return Response.json({ projects: [{ id: 'prj_1', name: 'web', root: '/work/web' }] });
      return Response.json({});
    }) as typeof fetch;
    await renderButler({ open: true, onOpenChange: () => {} });
    const approvals = host!.querySelector<HTMLButtonElement>('button[aria-label^="审批"]');
    expect(approvals).not.toBeNull();
    await act(async () => approvals!.click());
    await settle();
    await settle();
    expect(host!.querySelector('.ib-butler-ap-card')).not.toBeNull();
    expect(host!.textContent).toContain('建需求卡《登录页改版》');
    // 审批卡的项目选择是需求卡同一个选择器（不是旧的原生 select）。
    const picker = host!.querySelector<HTMLButtonElement>('.ib-butler-ap-card .ib-req-project-btn');
    expect(picker).not.toBeNull();
    await act(async () => picker!.click());
    await settle();
    const webRow = [...document.querySelectorAll<HTMLButtonElement>('.ib-req-project-row')].find((row) => row.textContent?.includes('web'));
    expect(webRow).toBeTruthy();
    await act(async () => webRow!.click());
    await settle();
    expect(host!.textContent).toContain('旧版太慢');
    const approve = host!.querySelector<HTMLButtonElement>('.ib-butler-ap-approve');
    expect(approve).not.toBeNull();
    await act(async () => approve!.click());
    await settle();
    expect(calls.some((call) => call.url.includes('/decide') && call.body?.includes('"decision":"approve"') && call.body?.includes('"project_id":"prj_1"'))).toBe(true);
    // 授权开关在左侧菜单的「配置」一栏（内容区整体切换，不再有抽屉）。
    const config = [...host!.querySelectorAll<HTMLButtonElement>('.ib-butler-navbtn')].find((btn) => btn.textContent?.includes('配置'));
    expect(config).toBeTruthy();
    await act(async () => config!.click());
    await settle();
    expect(host!.querySelectorAll('.ib-butler-switch-row')).toHaveLength(4);
  });

  test('空场英雄态：问候 + 三条起步建议，点建议填进输入框', async () => {
    await renderButler({ open: true, onOpenChange: () => {} });
    await settle();
    expect(host!.querySelector('.ib-butler-hero')).not.toBeNull();
    expect(host!.querySelector('.ib-butler-hero-word')!.textContent).not.toBe('');
    const ideas = host!.querySelectorAll<HTMLButtonElement>('.ib-butler-idea');
    expect(ideas.length).toBeGreaterThanOrEqual(3);
    await act(async () => ideas[0]!.click());
    expect(host!.querySelector<HTMLTextAreaElement>('.ib-butler-input')!.value).toBe(ideas[0]!.textContent);
  });
}
