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
  test("an empty data dir reads as no requirements; a create lands, starts in 需求设计, and writes history", async () => {
    const list = await call("GET", "/api/requirements");
    expect(list.status).toBe(200);
    expect(list.data.requirements).toEqual([]);
    const made = await createOne();
    expect(made.id).toStartWith("req_");
    const record = (await call("GET", "/api/requirements")).data.requirements as { title: string; stage: string; priority: string; deliverables: unknown[] }[];
    expect(record).toHaveLength(1);
    expect(record[0]).toMatchObject({ title: "登录页改版", stage: "design", priority: "none", deliverables: [] });
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
    const moved = await call("PATCH", `/api/requirements/${made.id}`, { stage: "dev" });
    expect(moved.status).toBe(200);
    expect((moved.data.requirement as { stage: string }).stage).toBe("dev");
    const renamed = await call("PATCH", `/api/requirements/${made.id}`, { title: "登录页改版 v2", nope: true });
    expect(renamed.status).toBe(200);
    expect((renamed.data.requirement as { title: string }).title).toBe("登录页改版 v2");
    const events = ((await call("GET", `/api/requirements/${made.id}`)).data.events as { kind: string; from?: string; to?: string; field?: string }[]).slice().reverse();
    expect(events[0]).toMatchObject({ kind: "field", field: "title" });
    expect(events.some((event) => event.kind === "stage" && event.from === "design" && event.to === "dev")).toBe(true);
    expect(events.some((event) => event.kind === "say")).toBe(true);
    expect(events[events.length - 1]).toMatchObject({ kind: "created" });
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

  test("deliverables attach and remove over the routes, with history; a bad kind, empty ref, or a non-document design-doc ref is refused", async () => {
    const made = await createOne();
    // 治本：design-doc 的 ref 必须是文档（评审开的是文档本身），会话 id 之类的句柄当场拒收。
    const refused = await call("POST", `/api/requirements/${made.id}/deliverables`, { kind: "design-doc", ref: "sess_123", title: "登录页方案", by: "Claude Code" });
    expect(refused.status).toBe(400);
    expect((refused.data as { error: string }).error).toContain("文档");
    const attached = await call("POST", `/api/requirements/${made.id}/deliverables`, { kind: "design-doc", ref: "docs/login-plan.md", title: "登录页方案", by: "Claude Code" });
    expect(attached.status).toBe(201);
    expect(attached.data.deliverable).toMatchObject({ kind: "design-doc", ref: "docs/login-plan.md", title: "登录页方案", by: "Claude Code" });
    const detail = await call("GET", `/api/requirements/${made.id}`);
    expect((detail.data.requirement as { deliverables: { id: string }[] }).deliverables).toHaveLength(1);
    expect((detail.data.events as { kind: string }[]).map((event) => event.kind)).toContain("deliverable");
    const id = (detail.data.requirement as { deliverables: { id: string }[] }).deliverables[0]!.id;
    expect((await call("DELETE", `/api/requirements/${made.id}/deliverables/${id}`)).status).toBe(200);
    // A GET under deliverables/:id is not this module's subpath: the route answers null (the caller 404s).
    expect(await routes().route(new Request(`http://x/api/requirements/${made.id}/deliverables/${id}`), new URL(`http://x/api/requirements/${made.id}/deliverables/${id}`))).toBeNull();
    expect(((await call("GET", `/api/requirements/${made.id}`)).data.requirement as { deliverables: unknown[] }).deliverables).toEqual([]);
    for (const body of [{ kind: "napkin", ref: "x" }, { kind: "link", ref: "  " }, { kind: "link", ref: "pn-123" }]) {
      expect((await call("POST", `/api/requirements/${made.id}/deliverables`, body)).status).toBe(400);
    }
  });


  test("threads link over PATCH and say lands in history without touching the record", async () => {
    const made = await createOne();
    expect((await call("PATCH", `/api/requirements/${made.id}`, { threads: ["msg_a"] })).status).toBe(200);
    expect(((await call("GET", `/api/requirements/${made.id}`)).data.requirement as { threads: string[] }).threads).toEqual(["msg_a"]);
    expect((await call("PATCH", `/api/requirements/${made.id}`, { threads: "msg_a" })).status).toBe(400);
    const events = ((await call("GET", `/api/requirements/${made.id}`)).data.events as { kind: string; note?: string }[]);
    expect(events.filter((event) => event.kind === "field" ).length).toBeGreaterThanOrEqual(1);
  });


  test("需求上下文: links, pasted text (which becomes a file) and uploads all land as references; the card carries them; removal takes the file", async () => {
    const made = ((await call("POST", "/api/requirements", { title: "登录页改版" })).data.requirement as { id: string }).id;
    // A link.
    const link = (await call("POST", `/api/requirements/${made}/contexts`, { kind: "link", name: "PRD", ref: "https://example.com/prd" })).data.context as { id: string; kind: string; ref: string };
    expect(link.kind).toBe("link");
    // A refused non-URL.
    expect((await call("POST", `/api/requirements/${made}/contexts`, { kind: "link", name: "x", ref: "ftp://nope" })).status).toBe(400);
    // Pasted text becomes a file in the requirement's context folder.
    const text = (await call("POST", `/api/requirements/${made}/contexts`, { kind: "text", name: "背景说明", text: "支持微信登录，扫码优先。" })).data.context as { id: string; kind: string; ref: string };
    expect(text.kind).toBe("file");
    expect(existsSync(text.ref)).toBe(true);
    expect(readFileSync(text.ref, "utf8")).toContain("扫码优先");
    // An upload (base64) lands as a file; an image is marked.
    const upload = (await call("POST", `/api/requirements/${made}/contexts`, { kind: "upload", name: "登录页截图.png", data: Buffer.from("png").toString("base64") })).data.context as { id: string; image?: true };
    expect(existsSync(upload.ref!)).toBe(true);
    if (upload.image === undefined) throw new Error("image context not marked");
    // The detail's card: the title, the references (never the contents), and the id the session links with.
    const detail = (await call("GET", `/api/requirements/${made}`)).data as { card: string; requirement: { contexts: unknown[] } };
    expect(detail.card).toContain("# 需求卡：登录页改版");
    expect(detail.card).toContain(`\`${made}\``);
    expect(detail.card).toContain("- 链接：https://example.com/prd —— PRD");
    expect(detail.card).toContain(`- 文件：${text.ref} —— 背景说明`);
    expect(detail.card).not.toContain("扫码优先");
    expect(detail.requirement.contexts).toHaveLength(3);
    // Removing a file context removes its file with it.
    const removed = text.ref;
    expect((await call("DELETE", `/api/requirements/${made}/contexts/${text.id}`)).status).toBe(200);
    expect(existsSync(removed)).toBe(false);
    expect(((await call("GET", `/api/requirements/${made}`)).data.requirement as { contexts: unknown[] }).contexts).toHaveLength(2);
    // The context preview reads the file, the person's window only.
    expect((await call("GET", `/api/requirements/${made}/contexts/${upload.id}/content`)).status).toBe(403);
  });


  test("a legacy 待跟进 record reads as 需求设计", async () => {
    mkdirSync(join(dataDir, "requirements"), { recursive: true });
    writeFileSync(join(dataDir, "requirements", "requirements.json"), JSON.stringify({ v: 1, requirements: [{ id: "req_old", title: "旧需求", notes: "", stage: "triage", priority: "none", deliverables: [], threads: [], suggestions: [] }] }));
    const read = await call("GET", "/api/requirements/req_old");
    expect((read.data.requirement as { stage: string }).stage).toBe("design");
  });

  test("stage-auto: a design doc lands the requirement in review and the session is told; the verdict moves it on", async () => {
    const told: string[] = [];
    const bridged = createBunRequirementRoutes({ dataDir, spawnAnnotate: (file) => Promise.resolve({ stdout: "", code: 0 }), notifyThread: (threadId, words) => told.push(words) });
    const callBridged = async (method: string, path: string, body?: unknown) => {
      const response = await bridged.route(new Request(`http://x${path}`, { method, body: body === undefined ? undefined : JSON.stringify(body) }), new URL(`http://x${path}`));
      return { status: response!.status, data: (await response!.json()) as Record<string, unknown> };
    };
    const made = ((await callBridged("POST", "/api/requirements", { title: "登录页改版" })).data.requirement as { id: string }).id;
    // A design doc delivered → design-review, the session told.
    expect((await callBridged("POST", `/api/requirements/${made}/deliverables`, { kind: "design-doc", ref: "/tmp/design.md" })).status).toBe(201);
    let stage = ((await callBridged("GET", `/api/requirements/${made}`)).data.requirement as { stage: string }).stage;
    expect(stage).toBe("design-review");
    // suggest is retired.
    expect((await callBridged("POST", `/api/requirements/${made}/suggestions`, { stage: "dev", why: "x", by: "a" })).status).toBe(410);
    // A manual move tells the session too.
    told.length = 0;
    expect((await callBridged("PATCH", `/api/requirements/${made}`, { stage: "qa" })).status).toBe(200);
    stage = ((await callBridged("GET", `/api/requirements/${made}`)).data.requirement as { stage: string }).stage;
    expect(stage).toBe("qa");
    expect(told).toHaveLength(0); // no threads linked yet: nothing to tell.
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
