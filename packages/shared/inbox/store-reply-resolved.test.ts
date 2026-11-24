/**
 * A resolved thread takes no further words from the person (owner 2026-11-23,
 * 工坊对话流报错线程: replies and new messages alike refuse with
 * 「已解决，重新打开再发」— server side: the `thread_resolved` code; the
 * window's error line maps it to the Chinese line). Before this, only a NEW
 * message refused — a reply to an agent's message still posted into the
 * resolved thread and kept the delivery loop going.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { InboxAuthor } from "@plannotator/core/inbox-types";
import { InboxStore } from "./store";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function open() {
  const dir = mkdtempSync(join(tmpdir(), "plannotator-inbox-reply-resolved-"));
  roots.push(dir);
  const store = InboxStore.open(dir);
  const project = store.ensureProject({ name: "ledger", root: "/work/ledger" });
  const author: InboxAuthor = { kind: "agent", host: "opencode", session: "ses_v2known", name: null };
  const asked = store.sendMessage({ project_id: project.id, author, body: "Anyone there?" }).message;
  return { store, project, asked };
}

describe("replies into a resolved thread refuse", () => {
  test("a person's reply to an agent message in a resolved thread throws thread_resolved", () => {
    const { store, project, asked } = open();
    store.resolveThread(asked.id, true, "person");
    let thrown: { code?: string } | null = null;
    try {
      store.sendReply(asked.id, { words: "你好啊", idempotency_key: "r-resolved-1" });
    } catch (error) {
      thrown = error as { code?: string };
    }
    expect(thrown?.code).toBe("thread_resolved");
  });

  test("before the resolve the same reply posts fine (no regression on open threads)", () => {
    const { store, project, asked } = open();
    const reply = store.sendReply(asked.id, { words: "你好啊", idempotency_key: "r-open-1" }).reply;
    expect(reply.body).toContain("你好啊");
    store.resolveThread(asked.id, true, "person");
  });

  test("a new message to the resolved thread refuses as before", () => {
    const { store, project, asked } = open();
    store.resolveThread(asked.id, true, "person");
    expect(() =>
      store.startPersonThread(asked.thread_id, { body: "再来一条", to: { host: "opencode", session: asked.author.kind === "agent" ? (asked.author.session ?? "") : "" }, idempotency_key: "nm-1" }),
    ).toThrow();
  });
});
