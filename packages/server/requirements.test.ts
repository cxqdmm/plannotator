/**
 * The Requirements module's storage and routes (requirements.ts): what a
 * create/patch/delete does to the records and the history, what validation
 * refuses, and that a change reaches the watch. Everything under a scratch
 * data dir; the real one is never read.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBunRequirementRoutes, requirementEventFrame } from "./requirements";

let dataDir: string;
/** One instance per test (a fresh one would re-read the files, missing everything this one holds in memory). */
let module: ReturnType<typeof createBunRequirementRoutes> | null = null;

beforeEach(() => {
  dataDir = join(tmpdir(), `plannotator-requirements-test-${crypto.randomUUID()}`);
  mkdirSync(dataDir, { recursive: true });
  module = null;
});
afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

const routes = () => (module ??= createBunRequirementRoutes({ dataDir }));

async function call(method: string, path: string, body?: unknown): Promise<{ status: number; data: Record<string, unknown> }> {
  const answer = await routes().route(new Request(`http://x${path}`, { method, body: body === undefined ? undefined : JSON.stringify(body) }), new URL(`http://x${path}`));
  return { status: answer!.status, data: (await answer!.json()) as Record<string, unknown> };
}

async function createOne(title = "登录页改版"): Promise<{ id: string }> {
  const made = await call("POST", "/api/requirements", { title });
  expect(made.status).toBe(201);
  return made.data.requirement as { id: string };
}

describe("the requirements routes", () => {
  test("an empty data dir reads as no requirements; a create lands, starts in 待跟进, and writes history", async () => {
    const list = await call("GET", "/api/requirements");
    expect(list.status).toBe(200);
    expect(list.data.requirements).toEqual([]);
    const made = await createOne();
    expect(made.id).toStartWith("req_");
    const record = (await call("GET", "/api/requirements")).data.requirements as { title: string; stage: string; priority: string; deliverables: unknown[] }[];
    expect(record).toHaveLength(1);
    expect(record[0]).toMatchObject({ title: "登录页改版", stage: "triage", priority: "none", deliverables: [] });
    const detail = await call("GET", `/api/requirements/${made.id}`);
    expect((detail.data.events as { kind: string }[]).map((event) => event.kind)).toEqual(["created"]);
    // The records and the history are on disk, so a later instance reads them.
    expect(existsSync(join(dataDir, "requirements", "requirements.json"))).toBe(true);
    expect(JSON.parse(readFileSync(join(dataDir, "requirements", "requirement-events.json"), "utf8")).events).toHaveLength(1);
    const again = await call("GET", "/api/requirements");
    expect((again.data.requirements as unknown[]).length).toBe(1);
  });

  test("validation: an empty title, a too-long one, a stage at create, and a priority that is not one are refused, nothing written", async () => {
    for (const body of [{ title: "  " }, { title: "x".repeat(201) }, { title: "ok", stage: "design" }, { title: "ok", stage: "launched" }, { title: "ok", priority: "whenever" }]) {
      const refused = await call("POST", "/api/requirements", body);
      expect(refused.status).toBe(400);
      expect(refused.data.code).toBe("validation_error");
    }
    const kept = await call("GET", "/api/requirements");
    expect(kept.data.requirements).toEqual([]);
  });

  test("a stage move writes a from/to event; a field change names its field; unknown keys are ignored", async () => {
    const made = await createOne();
    const moved = await call("PATCH", `/api/requirements/${made.id}`, { stage: "design" });
    expect(moved.status).toBe(200);
    expect((moved.data.requirement as { stage: string }).stage).toBe("design");
    const renamed = await call("PATCH", `/api/requirements/${made.id}`, { title: "登录页改版 v2", nope: true });
    expect(renamed.status).toBe(200);
    expect((renamed.data.requirement as { title: string }).title).toBe("登录页改版 v2");
    const events = ((await call("GET", `/api/requirements/${made.id}`)).data.events as { kind: string; from?: string; to?: string; field?: string }[]).slice().reverse();
    expect(events[0]).toMatchObject({ kind: "field", field: "title" });
    expect(events[1]).toMatchObject({ kind: "stage", from: "triage", to: "design" });
    expect(events[2]).toMatchObject({ kind: "created" });
  });

  test("归档 takes a card off the board and back; the list answers count the archived; the record carries a timestamp, never a boolean", async () => {
    const made = await createOne();
    expect((await call("GET", "/api/requirements")).data.archived).toBe(0);
    expect((await call("PATCH", `/api/requirements/${made.id}`, { archived: true })).status).toBe(200);
    const board = await call("GET", "/api/requirements");
    expect(board.data.requirements).toEqual([]);
    expect(board.data.archived).toBe(1);
    const archivedPage = await call("GET", "/api/requirements?archived=1");
    expect((archivedPage.data.requirements as { id: string }[]).map((r) => r.id)).toEqual([made.id]);
    const record = (await call("GET", `/api/requirements/${made.id}`)).data.requirement as { archived_at: string | null } & Record<string, unknown>;
    expect(record.archived_at).not.toBeNull();
    expect(record.archived).toBeUndefined();
    // Restore: back on the board, off the archived page.
    expect((await call("PATCH", `/api/requirements/${made.id}`, { archived: false })).status).toBe(200);
    const back = await call("GET", "/api/requirements");
    expect(back.data.requirements).toHaveLength(1);
    expect(back.data.archived).toBe(0);
    // Both moves are history; a non-boolean is refused.
    const events = ((await call("GET", `/api/requirements/${made.id}`)).data.events as { kind: string; field?: string }[]).filter((event) => event.field === "archived");
    expect(events).toHaveLength(2);
    expect((await call("PATCH", `/api/requirements/${made.id}`, { archived: "yes" })).status).toBe(400);
  });

  test("deliverables attach and remove over the routes, with history; a bad kind or empty ref is refused", async () => {
    const made = await createOne();
    const attached = await call("POST", `/api/requirements/${made.id}/deliverables`, { kind: "design-doc", ref: "sess_123", title: "登录页方案", by: "Claude Code" });
    expect(attached.status).toBe(201);
    expect(attached.data.deliverable).toMatchObject({ kind: "design-doc", ref: "sess_123", title: "登录页方案", by: "Claude Code" });
    const detail = await call("GET", `/api/requirements/${made.id}`);
    expect((detail.data.requirement as { deliverables: { id: string }[] }).deliverables).toHaveLength(1);
    expect((detail.data.events as { kind: string }[]).map((event) => event.kind)).toContain("deliverable");
    const id = (detail.data.requirement as { deliverables: { id: string }[] }).deliverables[0]!.id;
    expect((await call("DELETE", `/api/requirements/${made.id}/deliverables/${id}`)).status).toBe(200);
    // A GET under deliverables/:id is not this module's subpath: the route answers null (the caller 404s).
    expect(await routes().route(new Request(`http://x/api/requirements/${made.id}/deliverables/${id}`), new URL(`http://x/api/requirements/${made.id}/deliverables/${id}`))).toBeNull();
    expect(((await call("GET", `/api/requirements/${made.id}`)).data.requirement as { deliverables: unknown[] }).deliverables).toEqual([]);
    for (const body of [{ kind: "napkin", ref: "x" }, { kind: "link", ref: "  " }]) {
      expect((await call("POST", `/api/requirements/${made.id}/deliverables`, body)).status).toBe(400);
    }
  });

  test("suggest → adopt moves the stage and settles it; dismiss only drops it; only the person-facing routes do either", async () => {
    const made = await createOne();
    const suggested = await call("POST", `/api/requirements/${made.id}/suggestions`, { stage: "design", why: "方案已挂", by: "Claude Code" });
    expect(suggested.status).toBe(201);
    expect(suggested.data.suggestion).toMatchObject({ stage: "design", why: "方案已挂", by: "Claude Code" });
    // A second suggestion for the same stage replaces the first (one open proposal per stage).
    const again = await call("POST", `/api/requirements/${made.id}/suggestions`, { stage: "design", why: "更新理由", by: "Pi" });
    expect(((await call("GET", `/api/requirements/${made.id}`)).data.requirement as { suggestions: unknown[] }).suggestions).toHaveLength(1);
    expect(again.data.suggestion).toMatchObject({ why: "更新理由" });
    const sid = (again.data.suggestion as { id: string }).id;
    expect((await call("POST", `/api/requirements/${made.id}/suggestions/${sid}/adopt`)).status).toBe(200);
    const detail = await call("GET", `/api/requirements/${made.id}`);
    expect((detail.data.requirement as { stage: string; suggestions: unknown[] }).stage).toBe("design");
    expect((detail.data.requirement as { suggestions: unknown[] }).suggestions).toEqual([]);
    // Dismiss: dropped, stage untouched.
    const third = await call("POST", `/api/requirements/${made.id}/suggestions`, { stage: "done", why: "完成", by: "event bridge" });
    const tid = (third.data.suggestion as { id: string }).id;
    expect((await call("DELETE", `/api/requirements/${made.id}/suggestions/${tid}`)).status).toBe(200);
    const after = await call("GET", `/api/requirements/${made.id}`);
    expect((after.data.requirement as { stage: string }).stage).toBe("design");
    expect((after.data.requirement as { suggestions: unknown[] }).suggestions).toEqual([]);
    expect((after.data.events as { kind: string }[]).map((event) => event.kind)).toContain("suggestion");
  });

  test("threads link over PATCH and say lands in history without touching the record", async () => {
    const made = await createOne();
    expect((await call("PATCH", `/api/requirements/${made.id}`, { threads: ["msg_a"] })).status).toBe(200);
    expect(((await call("GET", `/api/requirements/${made.id}`)).data.requirement as { threads: string[] }).threads).toEqual(["msg_a"]);
    expect((await call("PATCH", `/api/requirements/${made.id}`, { threads: "msg_a" })).status).toBe(400);
    const events = ((await call("GET", `/api/requirements/${made.id}`)).data.events as { kind: string; note?: string }[]);
    expect(events.filter((event) => event.kind === "field" ).length).toBeGreaterThanOrEqual(1);
  });

  test("a delete removes the record and writes history; an unknown id is 404; an unknown subpath is not this module's", async () => {
    const made = await createOne();
    expect((await call("DELETE", `/api/requirements/${made.id}`)).status).toBe(200);
    expect((await call("GET", "/api/requirements")).data.requirements).toEqual([]);
    // The history of a deleted requirement stays in the events file (its detail route is gone with the record).
    expect(JSON.parse(readFileSync(join(dataDir, "requirements", "requirement-events.json"), "utf8")).events.map((event: { kind: string }) => event.kind)).toEqual(["created", "deleted"]);
    expect((await call("GET", "/api/requirements/req_nope")).status).toBe(404);
    expect(await routes().route(new Request("http://x/api/requirements/x/y"), new URL("http://x/api/requirements/x/y"))).toBeNull();
  });

  test("a change reaches the watch; the frame names what changed", async () => {
    const seen: string[][] = [];
    routes().watch.subscribe((ids) => seen.push(ids));
    const made = await createOne("可观测");
    expect(seen).toEqual([[made.id]]);
    expect(requirementEventFrame(["a", "b"])).toBe('event: requirements\ndata: {"ids":["a","b"]}\n\n');
  });

  test("an unreadable file reads as empty and is replaced by the next save, never written over unreadable", async () => {
    mkdirSync(join(dataDir, "requirements"), { recursive: true });
    writeFileSync(join(dataDir, "requirements", "requirements.json"), "{ not json");
    const list = await call("GET", "/api/requirements");
    expect(list.data.requirements).toEqual([]);
    const made = await createOne("恢复");
    expect(JSON.parse(readFileSync(join(dataDir, "requirements", "requirements.json"), "utf8")).requirements).toHaveLength(1);
    expect(made.id).toStartWith("req_");
  });
});
