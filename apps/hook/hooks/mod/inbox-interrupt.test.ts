/**
 * 打断（会话级，v2）：the poll answer hands this session one interrupt (`INBOX_INTERRUPT_FIELD`),
 * the mod aborts the running turn here with the Ask bridge's guards (a turn another plugin's
 * prompt started is never stopped; no turn at all is a quiet success), and the receipt
 * (`INBOX_INTERRUPTED_FIELD`) rides a later poll once. A handed-out id is acted on once even
 * when the answer repeats it. A memory host, no Inbox.
 */
import { describe, expect, test } from 'bun:test'
import { INBOX_INTERRUPT_CAPABLE_POLL_FIELD as INBOX_INTERRUPT_CAPABLE_SHARED, INBOX_INTERRUPTED_FIELD as INBOX_INTERRUPTED_SHARED, INBOX_INTERRUPT_FIELD as INBOX_INTERRUPT_SHARED } from '@plannotator/shared/inbox/connection'
import { InboxLink, inboxRegistryPathOf } from './inbox'
import { INBOX_BRIDGE_POLL_PATH, INBOX_INTERRUPT_CAPABLE_POLL_FIELD, INBOX_INTERRUPTED_FIELD, INBOX_INTERRUPT_FIELD } from './inbox-contract'
import { TurnTracker } from './turns'
import { fakeHost } from './testing/fake-host'

const DATA = '/data'
const REGISTRY = JSON.stringify({ v: 1, pid: 1, port: 4100, token: 't'.repeat(40), serverSession: 'srv', url: 'http://127.0.0.1:4100' })

async function ticks(host: ReturnType<typeof fakeHost>, n: number) {
  for (let i = 0; i < n; i += 1) {
    host.clock += 1_000
    await host.tick()
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

/** A link whose every poll answer hands out `interrupt: id` (the Inbox repeats it until the receipt). */
function world(turns: TurnTracker, id: string) {
  const host = fakeHost()
  host.files.set(inboxRegistryPathOf(DATA), REGISTRY)
  const polls: Record<string, unknown>[] = []
  host.onFetch = (url, body) => {
    if (url.endsWith(INBOX_BRIDGE_POLL_PATH)) {
      polls.push(body as Record<string, unknown>)
      return { status: 200, ok: true, text: JSON.stringify({ commands: [], [INBOX_INTERRUPT_FIELD]: id }) }
    }
    return { status: 200, ok: true, text: '{}' }
  }
  const link = new InboxLink({ host, dataDir: DATA, sessionId: 'sess-1', tools: [], isBusy: () => false, instanceId: 'me', turns })
  return { host, link, polls }
}

const receiptOf = (polls: Record<string, unknown>[]) => polls.map((poll) => poll[INBOX_INTERRUPTED_FIELD]).filter(Boolean)

describe('an interrupt handed to the session', () => {
  test('the mod mirrors the Inbox\'s poll fields (it cannot import them): the copies have not drifted', () => {
    expect(INBOX_INTERRUPT_FIELD).toBe(INBOX_INTERRUPT_SHARED)
    expect(INBOX_INTERRUPTED_FIELD).toBe(INBOX_INTERRUPTED_SHARED)
    expect(INBOX_INTERRUPT_CAPABLE_POLL_FIELD).toBe(INBOX_INTERRUPT_CAPABLE_SHARED)
  })

  test('aborts the running turn once, and the receipt rides the next poll exactly once', async () => {
    const turns = new TurnTracker()
    turns.runningTurnId = 'turn_main'
    const { host, link, polls } = world(turns, 'int_1')
    link.start()
    await ticks(host, 4)
    expect(host.aborted).toEqual(['turn_main'])
    // Every poll declares the engine can take an interrupt (the window refuses one for a connection that cannot).
    for (const poll of polls) expect(poll[INBOX_INTERRUPT_CAPABLE_POLL_FIELD]).toBe(true)
    const receipts = receiptOf(polls)
    expect(receipts).toEqual([{ id: 'int_1', ok: true }])
    link.dispose()
  })

  test('a turn another plugin started is never stopped; the receipt says so', async () => {
    const turns = new TurnTracker()
    turns.onPromptEntered({ text: 'another plugin asks', fromUs: false, turnId: 'turn_plugin', originKind: 'plugin' })
    turns.runningTurnId = 'turn_plugin'
    const { host, link, polls } = world(turns, 'int_2')
    link.start()
    await ticks(host, 4)
    expect(host.aborted).toEqual([])
    expect(receiptOf(polls)[0]).toMatchObject({ id: 'int_2', ok: false })
    link.dispose()
  })

  test('no turn running: a quiet success, no abort', async () => {
    const turns = new TurnTracker()
    const { host, link, polls } = world(turns, 'int_3')
    link.start()
    await ticks(host, 4)
    expect(host.aborted).toEqual([])
    expect(receiptOf(polls)).toEqual([{ id: 'int_3', ok: true }])
    link.dispose()
  })

  test('a receipt a non-200 answer never took is sent again (only a read answer settles it)', async () => {
    const turns = new TurnTracker()
    const { host, link, polls } = world(turns, 'int_4')
    let n = 0
    // Poll 1 hands the interrupt out (200); poll 2 fails with 503 — the receipt rode it and rides again; poll 3
    // reads it (200), and the poll after carries none.
    host.onFetch = (url, body) => {
      if (url.endsWith(INBOX_BRIDGE_POLL_PATH)) {
        n += 1
        polls.push(body as Record<string, unknown>)
        if (n === 2) return { status: 503, ok: false, text: 'no' }
        return { status: 200, ok: true, text: JSON.stringify({ commands: [], [INBOX_INTERRUPT_FIELD]: 'int_4' }) }
      }
      return { status: 200, ok: true, text: '{}' }
    }
    link.start()
    await ticks(host, 12)
    const receiptAt = polls.map((poll, i) => (poll[INBOX_INTERRUPTED_FIELD] !== undefined ? i : -1)).filter((i) => i >= 0)
    expect(receiptAt).toEqual([1, 2])
    link.dispose()
  })

  test('a refused interrupt toasts the reason in the engine, besides the receipt', async () => {
    const turns = new TurnTracker()
    turns.onPromptEntered({ text: 'another plugin asks', fromUs: false, turnId: 'turn_plugin', originKind: 'plugin' })
    turns.runningTurnId = 'turn_plugin'
    const { host, link, polls } = world(turns, 'int_5')
    link.start()
    await ticks(host, 4)
    expect(host.toasts).toEqual(['打断没有执行：这个回合由另一个插件发起，Plannotator 不停它。'])
    expect(receiptOf(polls)[0]).toMatchObject({ id: 'int_5', ok: false })
    link.dispose()
  })
})
