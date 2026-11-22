/**
 * 打断（会话级，v2）：`POST /api/inbox/threads/:id/interrupt` records one pending interrupt
 * for the thread's session, the session's next bridge poll carries it (`INBOX_INTERRUPT_FIELD`),
 * and the poll's receipt (`INBOX_INTERRUPTED_FIELD`) clears it. A session that is not polling is
 * refused, an unknown thread is 404. Handout is by session, so a session started by hand is
 * reached exactly like one the Inbox started. Temp data dir, loopback only.
 */
import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { INBOX_INTERRUPT_CAPABLE_POLL_FIELD, INBOX_INTERRUPTED_FIELD, INBOX_INTERRUPT_FIELD } from "@plannotator/shared/inbox/connection";
import { startInboxServer, type InboxServer } from "./inbox";

const roots: string[] = [];
const servers: InboxServer[] = [];

afterEach(() => {
  for (const server of servers.splice(0)) server.stop();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const person = { kind: "person" as const };

async function setup() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "plannotator-inbox-interrupt-")));
  roots.push(root);
  const server = await startInboxServer({ dataDir: join(root, "data"), binaryPath: null, htmlContent: "<!doctype html><title>Inbox</title>" });
  servers.push(server);
  const project = server.store.ensureProject({ name: "web", root: join(root, "web") });
  const thread = server.store.startPersonThread({ project_id: project.id, body: "Begin.", to: { host: "claude-code", session: "sess_i" }, idempotency_key: "k-interrupt" }).message;
  return { server, thread };
}

const base = (server: InboxServer) => `http://127.0.0.1:${server.port}`;
const auth = (server: InboxServer) => ({ "Content-Type": "application/json", Authorization: `Bearer ${server.token}` });
const poll = (server: InboxServer, body: Record<string, unknown>) =>
  fetch(`${base(server)}/api/inbox/bridge/poll`, { method: "POST", headers: auth(server), body: JSON.stringify(body) });
const interrupt = (server: InboxServer, threadId: string) =>
  fetch(`${base(server)}/api/inbox/threads/${threadId}/interrupt`, { method: "POST", headers: auth(server), body: JSON.stringify({}) });

test("an interrupt rides the session's next poll, and its receipt clears it", async () => {
  const { server, thread } = await setup();
  // The session polls (that is the whole reach of an interrupt: by session, not by launch) and says it can take one.
  await poll(server, { session: "sess_i", host: "claude-code", waitMs: 0, [INBOX_INTERRUPT_CAPABLE_POLL_FIELD]: true });
  expect((await interrupt(server, thread.id)).status).toBe(200);
  // The next poll carries the pending interrupt's id.
  const handed = (await (await poll(server, { session: "sess_i", host: "claude-code", waitMs: 0 })).json()) as Record<string, unknown>;
  expect(typeof handed[INBOX_INTERRUPT_FIELD]).toBe("string");
  // The receipt (what the mod did) clears it: the poll after carries none.
  const receipt = await poll(server, { session: "sess_i", host: "claude-code", waitMs: 0, [INBOX_INTERRUPTED_FIELD]: { id: handed[INBOX_INTERRUPT_FIELD], ok: true } });
  expect(receipt.status).toBe(200);
  const after = (await (await poll(server, { session: "sess_i", host: "claude-code", waitMs: 0 })).json()) as Record<string, unknown>;
  expect(after[INBOX_INTERRUPT_FIELD]).toBeUndefined();
});

test("a session that is not polling is refused, not silently parked", async () => {
  const { server, thread } = await setup();
  const answer = (await (await interrupt(server, thread.id)).json()) as { code?: string };
  expect(answer.code).toBe("session_not_connected");
});

test("a session that polls but predates the feature (no can_interrupt) is named as the cause", async () => {
  const { server, thread } = await setup();
  await poll(server, { session: "sess_i", host: "claude-code", waitMs: 0 });
  const answer = (await (await interrupt(server, thread.id)).json()) as { code?: string };
  expect(answer.code).toBe("session_too_old");
});

test("an unknown thread is 404", async () => {
  const { server } = await setup();
  expect((await interrupt(server, "msg_none")).status).toBe(404);
});

test("a fresh interrupt wakes a held poll at once (ask.onWaits, for interrupts)", async () => {
  const { server, thread } = await setup();
  // Settle the thread's own message, so nothing waits on the session and a poll with a waitMs really holds.
  server.store.recordDelivery(thread.id, { host: "claude-code", session: "sess_i" });
  // The connection names itself interrupt-capable on every poll (the mod's own cadence), then sits in a held
  // poll; the interrupt lands and the hold answers at once, not at its timer — 等下一次 poll 回来平均要 ~10 s。
  await poll(server, { session: "sess_i", host: "claude-code", waitMs: 0, [INBOX_INTERRUPT_CAPABLE_POLL_FIELD]: true });
  const held = poll(server, { session: "sess_i", host: "claude-code", waitMs: 8_000, [INBOX_INTERRUPT_CAPABLE_POLL_FIELD]: true });
  await new Promise((resolve) => setTimeout(resolve, 150));
  expect((await interrupt(server, thread.id)).status).toBe(200);
  const answer = await Promise.race([
    held.then((r) => r.json() as Promise<Record<string, unknown>>),
    new Promise<never>((_, fail) => setTimeout(() => fail(new Error("the held poll did not wake at once")), 2_000)),
  ]);
  expect(typeof answer[INBOX_INTERRUPT_FIELD]).toBe("string");
});

test("a busy session decorates its thread row with busy (a hand-started session interrupts like a launched one)", async () => {
  const { server, thread } = await setup();
  // The connection's poll says a turn runs (busy); the hold keeps it live while the list is read.
  const held = poll(server, { session: "sess_i", host: "claude-code", waitMs: 5_000, busy: true });
  await new Promise((resolve) => setTimeout(resolve, 150));
  const list = (await (await fetch(`${base(server)}/api/inbox/threads`, { headers: auth(server) })).json()) as {
    sections: { threads: { thread_id: string; busy?: boolean }[] }[];
  };
  const row = list.sections.flatMap((section) => section.threads).find((r) => r.thread_id === thread.id);
  expect(row?.busy).toBe(true);
  await held;
});
