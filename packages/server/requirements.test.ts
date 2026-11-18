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
