/**
 * 打断会话（approval "workshop-interrupt"）在共享 wake 上的收发：poll 带 can_interrupt，
 * 应答里的 interrupt 领走即调 host 的原语（一次；重复应答不重跑），回执随下一次 poll
 * 上行（ok 与 message 如实）。桩 bridge 即可——唤醒的收发逻辑不依赖任何宿主。
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InboxAgentConnection, InboxWake, type InboxWakeTarget } from "./agent-link";

const dataDir = mkdtempSync(join(tmpdir(), "agent-link-interrupt-"));

const interruptCalls: string[] = [];
let interruptError: string | null = null;
const bodies: Record<string, unknown>[] = [];
/** The poll answer's extra fields (the test plants `interrupt` here to hand one down). */
let answerExtra: Record<string, unknown> = {};

const connection = {
  dataDir,
  host: "opencode",
  agentName: "OpenCode",
  tools: [],
  command: "definitely-not-on-path-plannotator",
  bridge: async (_path: string, _sessionId: string, body: Record<string, unknown>) => {
    bodies.push(body);
    return { status: 200, text: JSON.stringify({ commands: [], ...answerExtra }) };
  },
} as unknown as InboxAgentConnection;

const target: InboxWakeTarget = {
  isBusy: () => false,
  deliver: async () => {},
  notify: () => undefined,
  interrupt: () => {
    interruptCalls.push("called");
    if (interruptError) throw new Error(interruptError);
  },
};

const until = async (check: () => boolean, ms = 3_000): Promise<void> => {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("timed out");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
};

const wake = new InboxWake(connection as InboxAgentConnection, "ses_interrupt", target, 60);
wake.start();

const pollBodies = () => bodies.filter((body) => body.waitMs !== undefined || body.can_interrupt !== undefined);

describe("the wake's interrupt round trip", () => {
  test("the poll declares can_interrupt (the host's target has interrupt)", async () => {
    await until(() => pollBodies().some((body) => body.can_interrupt === true));
  });

  test("an interrupt in the answer runs the host's primitive once; the receipt rides the next poll", async () => {
    answerExtra = { interrupt: "int_1" };
    await until(() => interruptCalls.length === 1);
    // The answer repeats the interrupt until the receipt lands: the seen-set must not run it twice.
    await until(() => bodies.some((body) => (body as { interrupted?: { id?: string } }).interrupted?.id === "int_1"));
    const receiptPoll = bodies.find((body) => (body as { interrupted?: { id?: string } }).interrupted?.id === "int_1") as { interrupted?: { ok?: boolean } };
    expect(receiptPoll.interrupted?.ok).toBe(true);
    await until(() => interruptCalls.length >= 1 && bodies.filter((body) => (body as { interrupted?: { id?: string } }).interrupted?.id === "int_1").length >= 1);
    // Give a repeat-answer a moment: the seen-set means no second run.
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(interruptCalls.length).toBe(1);
  });

  test("a failing primitive reports the reason in the receipt", async () => {
    interruptError = "opencode refused";
    answerExtra = { interrupt: "int_2" };
    await until(() => bodies.some((body) => (body as { interrupted?: { id?: string } }).interrupted?.id === "int_2"));
    const receiptPoll = bodies.find((body) => (body as { interrupted?: { id?: string } }).interrupted?.id === "int_2") as { interrupted?: { ok?: boolean; message?: string } };
    expect(receiptPoll.interrupted?.ok).toBe(false);
    expect(receiptPoll.interrupted?.message).toContain("opencode refused");
  });
});

afterAll(() => {
  wake.dispose();
  rmSync(dataDir, { recursive: true, force: true });
});
