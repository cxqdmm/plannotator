/**
 * The mod in sessions that are not interactive, through the real registered hooks on a fake `$` (the engine
 * harness in apps/hook/tests needs `claude plugin test`). The panel hosts (Claude Code's VS Code extension, #3111;
 * Orca, #3325) host Claude Code through the Agent SDK, so `session.start` says `isInteractive: false` and
 * `surface: null`; they run the CLI with `CLAUDE_CODE_ENTRYPOINT` `claude-vscode` or `orca`.
 * What can regress: a panel host left without `plannotator_inbox` or the wake; a Plannotator plan review opened
 * beside Orca's own plan card; any other session (`claude -p`, an Agent SDK app, Claude Desktop, a `claude -p`
 * started from inside a panel) left with no Inbox tool, or promised a wake its run may not live to deliver;
 * Plannotator's own Ask AI child or the switch turned off reaching the Inbox; and a wake the SDK host refuses
 * being lost or tried again in a loop.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { removeStubbedHtml, stubHookDistHtml } from '../../../../tests/helpers/hook-dist-stub'
import { NO_BROWSER } from '../../../../tests/helpers/no-browser'
import { inboxRegistryPathOf, inboxSessionDirOf, INBOX_OWNER_WAIT_MS, INBOX_TICK_MS } from './inbox'
import { INBOX_BRIDGE_EVENT_PATH, INBOX_BRIDGE_POLL_PATH } from './inbox-contract'

type Hook = ($: unknown, e: unknown, next: (e: unknown) => unknown) => unknown

async function freshHooks(name: string) {
  const { register } = (await import(`./register?${name}`)) as typeof import('./register')
  const held = new Map<string, Hook>()
  register(((event: string, ...args: unknown[]) => {
    if (!held.has(event)) held.set(event, args.at(-1) as Hook)
  }) as Parameters<typeof import('./register').register>[0])
  return (event: string) => held.get(event)!
}

async function settle() {
  for (let spin = 0; spin < 50; spin += 1) await new Promise((resolve) => setTimeout(resolve, 0))
}

const SESSION = 'sess-vscode'
const DATA = '/data'
const PORT = 5150
const REGISTRY = JSON.stringify({ v: 1, pid: 4242, port: PORT, token: 't'.repeat(40), serverSession: 'srv', url: `http://127.0.0.1:${PORT}` })
/** What the VS Code extension's chat panel starts the CLI with (read in the 2.1.322 extension). */
const PANEL = { CLAUDE_CODE_ENTRYPOINT: 'claude-vscode' }
/** What Orca's chat starts the CLI with (#3325). */
const ORCA = { CLAUDE_CODE_ENTRYPOINT: 'orca' }
/** Every panel host: a person reads its chat, a plugin's turn shows there. */
const PANEL_HOSTS = [PANEL, ORCA]

/** How the engine raises `session.start` for an Agent SDK host, the VS Code extension's included. */
const SDK_START = { isInteractive: false, surface: null, cwd: '/w' }
/** How the engine raises `session.start` for a person at Claude Code's own prompt. */
const TERMINAL_START = { isInteractive: true, surface: 'terminal', cwd: '/w' }
const REPLY = { type: 'reply', id: 'msg_reply', thread_id: 'msg_1', reply_to: 'msg_1', subject: 'Ship it?', body: 'Yes, after the freeze.', url: `http://localhost:${PORT}/#thread=msg_1` }



/** What two processes on one machine share: the data dir and the Inbox. */
function machine() {
  return {
    files: new Map<string, string>([
      ['/bin/sh', ''],
      [inboxRegistryPathOf(DATA), REGISTRY],
    ]),
    /** Ids the Inbox heard `delivered` for. */
    delivered: [] as string[],
    /** The person's reply waits in the Inbox: every poll hands it out until it is delivered. */
    replyWaiting: true,
  }
}

/** The engine beneath the mod: env, files, a clock the test moves, the timers it arms, and an Inbox on PORT. */
function engine(
  extraEnv: Record<string, string> = {},
  options: { shared?: ReturnType<typeof machine>; sessionId?: string; listed?: string[]; toolList?: 'missing' | 'hangs' } = {},
) {
  const shared = options.shared ?? machine()
  const files = shared.files
  const sessionId = options.sessionId ?? SESSION
  const env = new Map<string, string>(Object.entries({ HOME: '/home/me', PLANNOTATOR_DATA_DIR: DATA, ...extraEnv }))
  const store = new Map<string, unknown>()
  const timers: { ms: number; fn: () => void; live: boolean }[] = []
  const world = {
    files,
    env,
    now: 1_000_000,
    tools: [] as string[],
    /** What `$.tool.list()` answers with (the session's tools, MCP ones included), and how often it was asked. */
    listed: [...(options.listed ?? [])],
    toolLists: 0,
    /** The MCP servers the context names (`$.session.usage`'s `mcpTools`), tools behind ToolSearch included. */
    servers: [] as string[],
    envSet: [] as string[],
    fetches: [] as { path: string; body: any }[],
    submits: [] as string[],
    /** Every `$.process.run` argv (a review's launch among them). */
    runs: [] as string[][],
    /** Ids the Inbox heard `delivered` for. */
    delivered: shared.delivered,
    /** The process exits: none of its timers fires again. */
    kill() {
      for (const timer of timers) timer.live = false
    },
    /** What `$.prompt.submit` resolves with; a `{ drop }` is the engine's refusal. */
    answer: undefined as unknown,
    /** Fire the Inbox tick `n` times, a second apart. */
    async ticks(n: number) {
      for (let i = 0; i < n; i++) {
        world.now += 1_000
        for (const timer of timers.filter((t) => t.live && t.ms === INBOX_TICK_MS)) timer.fn()
        await settle()
      }
    },
    $: {
      env: {
        get: async (name: string) => env.get(name),
        set: async (name: string, value: string) => {
          world.envSet.push(name)
          env.set(name, value)
        },
      },
      fs: {
        exists: async (path: string) => files.has(path),
        read: async (path: string) => {
          const text = files.get(path)
          if (text === undefined) throw new Error(`ENOENT: ${path}`)
          return text
        },
        write: async (path: string, text: string) => void files.set(path, text),
        stat: async (path: string) => (files.has(path) ? { kind: 'file', size: files.get(path)!.length } : null),
      },
      session: {
        id: async () => sessionId,
        cwd: async () => '/w',
        root: async () => '/w',
        messages: async () => [],
        version: async () => ({ version: '2.1.322', base: '2.1.322' }),
        usage: async () => ({ context: { window: 200_000, breakdown: { mcpTools: world.servers.map((serverName) => ({ name: `mcp__${serverName}__x`, serverName, tokens: 1, isLoaded: false })) } } }),
      },
      clock: {
        now: async () => world.now,
        // A few real milliseconds: a bound raced against a `$` call (`within`) loses to one that answers.
        sleep: (_ms: number, opts?: { signal?: AbortSignal }) =>
          new Promise<void>((resolve, reject) => {
            const timer = setTimeout(resolve, 5)
            opts?.signal?.addEventListener('abort', () => (clearTimeout(timer), reject(new Error('aborted'))), { once: true })
          }),
        every: (ms: number, fn: () => void) => {
          const timer = { ms, fn, live: true }
          timers.push(timer)
          return { cancel: () => void (timer.live = false) }
        },
      },
      store: { get: async (key: string) => store.get(key), set: async (key: string, value: unknown) => void store.set(key, value) },
      process: {
        run: async (argv: string[]) => {
          world.runs.push(argv)
          // A review's CLI comes up at once (as in apps/hook/tests/register.test.ts).
          if (argv[3] === 'plannotator-launch') files.set(`${argv[4]}/ready`, `${JSON.stringify({ url: 'http://localhost:4321', isRemote: false, port: 4321 })}\n`)
          return { exitCode: 0, stdout: '', stderr: '' }
        },
      },
      http: {
        fetch: async (url: string, init?: { body?: string }) => {
          const path = url.replace(`http://127.0.0.1:${PORT}`, '')
          const body = init?.body ? JSON.parse(init.body) : undefined
          world.fetches.push({ path, body })
          const answer = (value: unknown) => ({ status: 200, ok: true, headers: {}, text: JSON.stringify(value) })
          if (path === INBOX_BRIDGE_POLL_PATH) return answer({ commands: shared.replyWaiting && !world.delivered.includes(REPLY.id) ? [REPLY] : [] })
          if (path === '/api/inbox/health') return answer({ serverSession: 'srv' })
          if (path === '/mcp' && body?.method === 'tools/call') return answer({ jsonrpc: '2.0', id: body.id, result: { content: [{ type: 'text', text: 'Sent.' }] } })
          if (path === INBOX_BRIDGE_EVENT_PATH) {
            if (body?.type === 'delivered') world.delivered.push(body.id)
            return answer({ ok: true })
          }
          return { status: 404, ok: false, headers: {}, text: '' }
        },
      },
      tool: {
        ...(options.toolList === 'missing'
          ? {}
          : {
              list: async () => {
                world.toolLists += 1
                if (options.toolList === 'hangs') return new Promise(() => undefined)
                return world.listed.map((name) => ({ name, description: '', mcp: name.startsWith('mcp__') }))
              },
            }),
        register: async (spec: { name: string }) => {
          world.tools.push(spec.name)
          return { tool: `mcp__plugin_plannotator__${spec.name}` }
        },
      },
      command: { list: async () => [], register: async () => undefined },
      ui: { log: () => undefined, status: () => undefined, toast: () => undefined },
      prompt: {
        submit: async ({ text }: { text: string }) => {
          world.submits.push(text)
          return world.answer
        },
        suggest: async () => undefined,
        read: async () => ({ text: '', cursor: 0 }),
      },
      turn: { abort: async () => undefined },
    },
  }
  return world
}

const pass = (e: unknown) => e

async function started(name: string, env: Record<string, string>, options: Parameters<typeof engine>[1] = {}, start: typeof SDK_START | typeof TERMINAL_START = SDK_START) {
  const hook = await freshHooks(name)
  const world = engine(env, options)
  await hook('session.start')(world.$, start, async () => ({ cwd: '/w' }))
  await settle()
  return { hook, world }
}

const polls = (world: ReturnType<typeof engine>) => world.fetches.filter((f) => f.path === INBOX_BRIDGE_POLL_PATH)

/** One `plannotator_inbox` send through the registered hook: the arguments and `_meta` the Inbox's `/mcp` got. */
async function inboxCall(hook: Awaited<ReturnType<typeof freshHooks>>, world: ReturnType<typeof engine>) {
  const answer = (await hook('tool.call')(world.$, { tool: 'mcp__plugin_plannotator__plannotator_inbox', tool_use_id: 'toolu_inbox', action: 'send_message', subject: 'Hello', body: 'Ready.' }, pass)) as { result?: unknown; deny?: unknown }
  const call = world.fetches.find((f) => f.path === '/mcp' && f.body?.method === 'tools/call')
  expect([answer, call?.body?.params?.name]).toEqual([{ result: expect.any(String) }, 'send_message'])
  return { args: call!.body.params.arguments as Record<string, unknown>, meta: call!.body.params._meta as Record<string, unknown> | undefined }
}

describe('a panel host: the VS Code extension, Orca (not interactive)', () => {
  test.each(PANEL_HOSTS)('the mod runs: both tools registered, the session tagged, the Inbox polled as this session, and a reply goes in once as a turn (%j)', async (env) => {
    const { world } = await started(`panel-wake-${env.CLAUDE_CODE_ENTRYPOINT}`, env)

    expect(world.tools).toEqual(['plannotator_inbox', 'plannotator'])
    expect(world.env.get('PLANNOTATOR_SESSION_TAG')).toBe(`claude-code:${SESSION}`)

    await world.ticks(6)
    expect(polls(world).length).toBeGreaterThan(0)
    expect(polls(world).every((f) => f.body.session === SESSION && f.body.host === 'claude-code')).toBe(true)
    expect(world.submits).toHaveLength(1)
    expect(world.submits[0]).toContain(`Plannotator Inbox: ${REPLY.subject} (${REPLY.id})`)
    expect(world.submits[0]).toContain(REPLY.body)
    expect(world.delivered).toEqual([REPLY.id])

    await world.ticks(10)
    expect(world.submits).toHaveLength(1)
    // Its own session from the start: the tool list is never asked.
    expect(world.toolLists).toBe(0)
  })

  // The refusals the docs list for `$.prompt.submit` in an Agent SDK session, each resolved as `{ drop }`.
  for (const reason of [
    'the host has ended its input',
    'the run reached its --max-turns limit',
    'the session was stopped and nobody has sent input since',
  ]) {
    test.each([PANEL, ORCA])(`a wake the host refuses ("${reason}") is not lost and not tried again until the person sends input; then it goes in once (%j)`, async (env) => {
      const { hook, world } = await started(`panel-drop-${reason.length}-${env.CLAUDE_CODE_ENTRYPOINT}`, env)
      world.answer = { drop: reason }

      await world.ticks(6)
      expect(world.submits).toHaveLength(1)
      expect(world.delivered).toEqual([])
      // Still owed: the next poll says the session holds it until input (the window's existing "Stopped" line).
      await world.ticks(30)
      expect(world.submits).toHaveLength(1)
      expect(polls(world).at(-1)?.body.held).toBe(true)

      // The person types into the panel: the SDK host's own turn.
      world.answer = undefined
      await hook('prompt.submit')(world.$, { text: 'carry on', origin: { kind: 'sdk' } }, async () => ({ text: 'carry on' }))
      await hook('turn.start')(world.$, { turnId: 'turn-1', text: 'carry on' }, pass)
      await hook('turn.complete')(world.$, { turnId: 'turn-1', answer: 'Done.' }, pass)
      await world.ticks(6)

      expect(world.submits).toHaveLength(2)
      expect(world.submits[1]).toContain(REPLY.body)
      expect(world.delivered).toEqual([REPLY.id])
    })
  }
})

const launched = (world: ReturnType<typeof engine>, cli: string) => world.runs.some((argv) => argv.includes('plannotator-launch') && argv.includes(cli))

describe('ExitPlanMode in a panel host', () => {
  test.each([PANEL])("the mod's plan review opens (%j)", async (env) => {
    const { hook, world } = await started(`panel-plan-${env.CLAUDE_CODE_ENTRYPOINT}`, env)
    const below = (e: unknown) => ({ passed: e })
    const answer = await hook('tool.call')(world.$, { tool: 'ExitPlanMode', tool_use_id: 'toolu_plan', plan: '# Plan\n' }, below)
    expect(answer).not.toMatchObject({ passed: expect.anything() })
    expect(launched(world, 'claude-mod-plan')).toBe(true)
  })

  // Orca draws its own "Review proposed plan" card: a Plannotator review beside it was left open after the card approved.
  test("Orca: the mod opens no plan review and passes ExitPlanMode and its permission request on to Orca's card", async () => {
    const { hook, world } = await started('orca-plan', ORCA)
    const below = (e: unknown) => ({ passed: e })
    expect(await hook('tool.call')(world.$, { tool: 'ExitPlanMode', tool_use_id: 'toolu_plan', plan: '# Plan\n' }, below)).toMatchObject({ passed: { tool: 'ExitPlanMode' } })
    expect(await hook('classic.PermissionRequest')(world.$, { tool_name: 'ExitPlanMode', tool_use_id: 'toolu_plan', tool_input: { plan: '# Plan\n' } }, below)).toMatchObject({ passed: { tool_name: 'ExitPlanMode' } })
    expect(launched(world, 'claude-mod-plan')).toBe(false)
  })

  // When the mod passes ExitPlanMode on, Claude Code runs the plugin's classic command hook: the session's
  // environment, which that hook process inherits, is what turns it off (the process test below runs the real hook).
  const OWN_MARK = `claude-code:${SESSION}`
  test.each<[string, Record<string, string>, string | undefined, string | undefined, { listed?: string[] }, boolean]>([
    ['Orca', ORCA, '0', OWN_MARK, {}, false],
    // Sorted headless (an inherited tag, a nested run), still under Orca's card.
    ['Orca started from a Claude Code shell (another session\'s tag)', { ...ORCA, PLANNOTATOR_SESSION_TAG: 'claude-code:other' }, '0', OWN_MARK, {}, false],
    ['claude -p from Claude\'s Bash in an Orca session', { ...ORCA, CLAUDECODE: '1', CLAUDE_CODE_CHILD_SESSION: '1' }, '0', OWN_MARK, {}, false],
    ['the VS Code panel', PANEL, undefined, undefined, {}, false],
    ['claude -p', { CLAUDE_CODE_ENTRYPOINT: 'sdk-cli' }, undefined, undefined, {}, false],
    ['no entrypoint', {}, undefined, undefined, {}, false],
    ['the terminal', {}, undefined, undefined, {}, true],
  ])("%s: the session's hooks get PLANNOTATOR_PLAN_REVIEW=%p, marked %p", async (name, env, value, mark, options, interactive) => {
    const { world } = await started(`plan-env-${name.replace(/[^a-z0-9]+/gi, '-')}`, env, options, interactive ? TERMINAL_START : SDK_START)
    expect([world.env.get('PLANNOTATOR_PLAN_REVIEW'), world.env.get('PLANNOTATOR_PLAN_REVIEW_SET_BY')]).toEqual([value, mark])
  })

  // An Orca session's `0` reaches whatever it starts (a review server, the Inbox, an "Open in" terminal, a tmux
  // server); a terminal Claude Code started from one of those must still review plans.
  test.each<[string, Record<string, string>, typeof SDK_START | typeof TERMINAL_START]>([
    ['the terminal', {}, TERMINAL_START],
    ['the VS Code panel', PANEL, SDK_START],
  ])("%s inheriting another session's marked 0: plan review on, and both variables cleared", async (name, env, start) => {
    const inherited = { ...env, PLANNOTATOR_PLAN_REVIEW: '0', PLANNOTATOR_PLAN_REVIEW_SET_BY: 'claude-code:the-orca-session' }
    const { hook, world } = await started(`plan-inherited-${name.replace(/[^a-z0-9]+/gi, '-')}`, inherited, {}, start)
    expect([world.env.get('PLANNOTATOR_PLAN_REVIEW'), world.env.get('PLANNOTATOR_PLAN_REVIEW_SET_BY')]).toEqual(['', ''])
    const below = (e: unknown) => ({ passed: e })
    expect(await hook('tool.call')(world.$, { tool: 'ExitPlanMode', tool_use_id: 'toolu_plan', plan: '# Plan\n' }, below)).not.toMatchObject({ passed: expect.anything() })
    expect(launched(world, 'claude-mod-plan')).toBe(true)
  })

  test("the terminal with the person's own PLANNOTATOR_PLAN_REVIEW=0 (no marker): respected, nothing cleared", async () => {
    const { hook, world } = await started('plan-own-off', { PLANNOTATOR_PLAN_REVIEW: '0' }, {}, TERMINAL_START)
    expect([world.env.get('PLANNOTATOR_PLAN_REVIEW'), world.env.get('PLANNOTATOR_PLAN_REVIEW_SET_BY')]).toEqual(['0', undefined])
    const below = (e: unknown) => ({ passed: e })
    expect(await hook('tool.call')(world.$, { tool: 'ExitPlanMode', tool_use_id: 'toolu_plan', plan: '# Plan\n' }, below)).toMatchObject({ passed: { tool: 'ExitPlanMode' } })
  })

  test.each<[string, string, string | undefined]>([
    ['an explicit PLANNOTATOR_PLAN_REVIEW=1', '1', undefined],
    ['the person\'s own PLANNOTATOR_PLAN_REVIEW=off (no marker)', 'off', undefined],
  ])("Orca with %s: the person's value stays, unmarked", async (_name, value, mark) => {
    const { world } = await started(`orca-own-${value}`, { ...ORCA, PLANNOTATOR_PLAN_REVIEW: value })
    expect([world.env.get('PLANNOTATOR_PLAN_REVIEW'), world.env.get('PLANNOTATOR_PLAN_REVIEW_SET_BY')]).toEqual([value, mark])
  })

  test("Orca: the non-blocking code review stays the mod's (the command and Claude's Bash `plannotator review`)", async () => {
    const { hook, world } = await started('orca-review', ORCA)
    const below = (e: unknown) => ({ passed: e })
    expect(await hook('command.run')(world.$, { command: 'plannotator-review', args: '' }, below)).not.toMatchObject({ passed: expect.anything() })
    expect(await hook('tool.call')(world.$, { tool: 'Bash', tool_use_id: 'toolu_review', command: 'plannotator review' }, below)).not.toMatchObject({ passed: expect.anything() })
  })
})

describe("the person's prompt in the panel (origin sdk, the extension sends what they typed)", () => {
  const LEASE = `${inboxSessionDirOf(DATA, SESSION)}/watcher.json`
  const owner = (world: ReturnType<typeof engine>) => (JSON.parse(world.files.get(LEASE) ?? 'null') as { owner: string | null } | null)?.owner

  /** Another Claude Code process on this session (a `claude --continue` in a terminal) holds the Inbox lease, touched after this one started. */
  async function otherHolds(world: ReturnType<typeof engine>) {
    world.files.set(LEASE, JSON.stringify({ owner: 'other-process', at: world.now, touchedAt: world.now + 500 }))
    world.now += 1_000
  }

  test('reads as the person at the prompt: it pulls the Inbox lease to this process, as Enter in the terminal does', async () => {
    const { hook, world } = await started('panel-person', PANEL)
    await otherHolds(world)
    await hook('prompt.submit')(world.$, { text: 'carry on', origin: { kind: 'sdk' } }, async () => ({ text: 'carry on' }))
    await settle()
    expect(owner(world)).not.toBe('other-process')
    expect(owner(world)).toBeTruthy()
  })

  test("a background task's notification is not the person: the lease stays with the other process", async () => {
    const { hook, world } = await started('panel-notification', PANEL)
    await otherHolds(world)
    await hook('prompt.submit')(world.$, { text: 'Task done.', origin: { kind: 'task-notification' } }, async () => ({ text: 'Task done.' }))
    await settle()
    expect(owner(world)).toBe('other-process')
  })
})

/** What every Claude Code session that is not interactive and is neither the panel nor Orca is. */
const HEADLESS: [string, Record<string, string>][] = [
  ['an Agent SDK app (sdk-ts)', { CLAUDE_CODE_ENTRYPOINT: 'sdk-ts' }],
  ['an Agent SDK app (sdk-py)', { CLAUDE_CODE_ENTRYPOINT: 'sdk-py' }],
  ['claude -p (sdk-cli)', { CLAUDE_CODE_ENTRYPOINT: 'sdk-cli' }],
  ['claude -p naming itself cli', { CLAUDE_CODE_ENTRYPOINT: 'cli' }],
  ['Claude Desktop (claude-desktop)', { CLAUDE_CODE_ENTRYPOINT: 'claude-desktop' }],
  ['no entrypoint', {}],
  ['a child of an Orca panel', { ...ORCA, CLAUDE_CODE_CHILD_SESSION: '1' }],
  ['a different Orca session inherits a tag', { ...ORCA, PLANNOTATOR_SESSION_TAG: 'claude-code:other' }],
  ['an entrypoint only near the panel one', { CLAUDE_CODE_ENTRYPOINT: 'claude-vscode-insiders' }],
  // A `claude -p` started from inside a panel session inherits its entrypoint.
  ['claude -p from Claude\'s Bash in a panel session (CLAUDECODE, CLAUDE_CODE_CHILD_SESSION)', { ...PANEL, CLAUDECODE: '1', CLAUDE_CODE_CHILD_SESSION: '1' }],
  ['a nested run with CLAUDE_CODE_CHILD_SESSION only', { ...PANEL, CLAUDE_CODE_CHILD_SESSION: '1' }],
  ['a nested run with CLAUDECODE only', { ...PANEL, CLAUDECODE: '1' }],
  ['an agent job of a Plannotator CLI the panel\'s mod started (its session tag names that session)', { ...PANEL, PLANNOTATOR_SESSION_TAG: 'claude-code:the-panel-session' }],
]

describe('every other session that is not interactive (headless): the Inbox tool, no wake, the classic reviews', () => {
  for (const [name, env] of HEADLESS) {
    test(`${name}: plannotator_inbox as this session, the Inbox never polled, nothing submitted`, async () => {
      const { world } = await started(`headless-${name.replace(/[^a-z0-9]+/gi, '-')}`, env)
      await world.ticks(6)
      expect(world.tools).toEqual(['plannotator_inbox'])
      expect(world.env.get('PLANNOTATOR_SESSION_TAG')).toBe(`claude-code:${SESSION}`)
      expect(polls(world)).toEqual([])
      expect(world.submits).toEqual([])
      expect(world.toolLists).toBe(0)
    })
  }

  test('a send says nothing wakes the session (a one-shot run may end with its turn), and files as this session', async () => {
    const { hook, world } = await started('headless-send', { CLAUDE_CODE_ENTRYPOINT: 'sdk-cli' })
    const calls = await inboxCall(hook, world)
    expect(calls.args).toMatchObject({ agent_session: SESSION, agent_host: 'claude-code', agent_name: 'Claude Code' })
    expect(calls.meta?.['ai.plannotator/inbox-wakes']).toBeUndefined()
  })

  test("ExitPlanMode, the commands and Claude's Bash `plannotator review` keep the classic flows: the mod passes each on", async () => {
    const { hook, world } = await started('headless-classic', { CLAUDE_CODE_ENTRYPOINT: 'sdk-cli' })
    const below = (e: unknown) => ({ passed: e })
    expect(await hook('tool.call')(world.$, { tool: 'ExitPlanMode', tool_use_id: 'toolu_1', plan: '# Plan\n' }, below)).toMatchObject({ passed: { tool: 'ExitPlanMode' } })
    expect(await hook('tool.call')(world.$, { tool: 'Bash', tool_use_id: 'toolu_2', command: 'plannotator review' }, below)).toMatchObject({ passed: { tool: 'Bash' } })
    expect(await hook('command.run')(world.$, { command: 'plannotator-review', args: '' }, below)).toMatchObject({ passed: { command: 'plannotator-review' } })
  })
})

describe('where the mod stands down', () => {
  const cases: [string, Record<string, string>][] = [
    // Plannotator's own agent must never get Plannotator's tools or reach the person's Inbox (recursion).
    ['Plannotator\'s Ask AI child in the panel (PLANNOTATOR_ASK_AI_CHILD=1)', { ...PANEL, PLANNOTATOR_ASK_AI_CHILD: '1' }],
    ['Plannotator\'s Ask AI child as claude -p', { CLAUDE_CODE_ENTRYPOINT: 'sdk-cli', PLANNOTATOR_ASK_AI_CHILD: '1' }],
    ['the panel with the mod turned off (PLANNOTATOR_CLAUDE_MOD=0)', { ...PANEL, PLANNOTATOR_CLAUDE_MOD: '0' }],
    ['claude -p with the mod turned off', { CLAUDE_CODE_ENTRYPOINT: 'sdk-cli', PLANNOTATOR_CLAUDE_MOD: '0' }],
  ]
  for (const [name, env] of cases) {
    test(`${name}: no tool, nothing set, the Inbox never asked`, async () => {
      const { world } = await started(`inert-${name.replace(/[^a-z0-9]+/gi, '-')}`, env)
      await world.ticks(6)
      expect(world.tools).toEqual([])
      expect(world.envSet).toEqual([])
      expect(world.fetches).toEqual([])
      expect(world.submits).toEqual([])
    })
  }

  test("a module reload in the panel's own session (its tag already names it) runs the mod again", async () => {
    const { world } = await started('panel-reload', { ...PANEL, PLANNOTATOR_SESSION_TAG: `claude-code:${SESSION}` })
    expect(world.tools).toEqual(['plannotator_inbox', 'plannotator'])
  })

  test('the Inbox tool turned off in a headless session: nothing registered', async () => {
    const { world } = await started('headless-no-inbox', { CLAUDE_CODE_ENTRYPOINT: 'sdk-cli', PLANNOTATOR_INBOX_TOOL: '0' })
    await world.ticks(6)
    expect(world.tools).toEqual([])
    expect(polls(world)).toEqual([])
  })
})

/**
 * The plugin's classic plan hook (hooks.json: PermissionRequest on ExitPlanMode runs `plannotator`), run as Claude Code
 * runs it: a process with the session's environment, which holds what the mod set. Claude Code runs it in an Orca
 * session once the mod passes ExitPlanMode on (a real Orca run opened a Plannotator review beside Orca's card). Temp
 * HOME and data dir; no browser; no Inbox.
 */
describe("the plugin's classic plan hook, in the environment the mod leaves the session", () => {
  const entry = resolve(import.meta.dir, '../../server/index.ts')
  const roots: string[] = []
  let stubs: string[] = []
  beforeAll(() => {
    stubs = stubHookDistHtml()
  })
  afterAll(() => {
    removeStubbedHtml(stubs)
    for (const root of roots) rmSync(root, { recursive: true, force: true })
  })

  async function classicPlanHook(sessionEnv: Map<string, string>, timeoutMs: number, sessionId = SESSION) {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'plannotator-host-plan-card-')))
    roots.push(root)
    const dataDir = join(root, 'data')
    mkdirSync(dataDir, { recursive: true })
    const env: Record<string, string | undefined> = {}
    // Nothing from the shell running the tests speaks for the session (a Claude Code session's own CLAUDE* and PLANNOTATOR_*).
    for (const [name, value] of Object.entries(process.env)) if (!/^(CLAUDE|PLANNOTATOR_)/.test(name)) env[name] = value
    Object.assign(env, Object.fromEntries(sessionEnv), {
      HOME: join(root, 'home'),
      PLANNOTATOR_DATA_DIR: dataDir,
      PLANNOTATOR_PORT: '0',
      PLANNOTATOR_REMOTE: '0',
      PLANNOTATOR_SKIP_BROWSER_OPEN: '1',
      NO_BROWSER,
      BROWSER: NO_BROWSER,
      PLANNOTATOR_BROWSER: NO_BROWSER,
      PLANNOTATOR_INBOX_CONNECT: '0',
      PLANNOTATOR_AI: 'disabled',
      PLANNOTATOR_SHARE: 'disabled',
    })
    const payload = { session_id: sessionId, transcript_path: '/nowhere/transcript.jsonl', cwd: '/w', permission_mode: 'plan', hook_event_name: 'PermissionRequest', tool_name: 'ExitPlanMode', tool_input: { plan: '# Ship it\n\n1. Do the thing.\n' } }
    const proc = Bun.spawn([process.execPath, 'run', entry], { cwd: root, stdin: new TextEncoder().encode(JSON.stringify(payload)), stdout: 'pipe', stderr: 'pipe', env })
    const timer = setTimeout(() => proc.kill(), timeoutMs)
    const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
    clearTimeout(timer)
    const sessions = join(dataDir, 'sessions')
    return { stdout, stderr, code, sessions: existsSync(sessions) ? readdirSync(sessions) : [] }
  }

  test("Orca: it opens nothing and exits 0 with no decision, so Orca's own plan card decides", async () => {
    const { world } = await started('classic-plan-orca', ORCA)
    const run = await classicPlanHook(world.env, 20_000)
    expect(run.code).toBe(0)
    expect(run.stdout).toBe('')
    expect(run.stderr).not.toContain('http://')
    expect(run.sessions).toEqual([])
  }, 30_000)

  // A Claude Code with no mod to clear it (the mod off, an older Claude Code) started from something the Orca session
  // started: its own hook, with the Orca session's marked 0 in its environment, still opens the review.
  test("the Orca session's marked 0 in another session's hook: the review opens", async () => {
    const { world } = await started('classic-plan-orca-elsewhere', ORCA)
    const run = await classicPlanHook(world.env, 6_000, 'a-terminal-session')
    expect(run.stdout).toBe('')
    expect(run.stderr).toContain('http://')
  }, 30_000)

  // The control: where the mod reviews plans itself the classic hook still opens one when it is reached (it never is:
  // the mod's ExitPlanMode answer comes first), so the cases above are not vacuous.
  test('the VS Code panel: the same hook opens a review', async () => {
    const { world } = await started('classic-plan-vscode', PANEL)
    const run = await classicPlanHook(world.env, 6_000)
    expect(run.stdout).toBe('')
    expect(run.stderr).toContain('http://')
  }, 30_000)
})
