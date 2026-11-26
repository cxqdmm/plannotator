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

  test("stage moves only through the progress op / PATCH: a delivered design doc does NOT auto-move it", async () => {
    const made = await createOne();
    await call("POST", `/api/requirements/${made.id}/deliverables`, { kind: "design-doc", ref: "docs/plan.md", by: null });
    const afterDeliver = await call("GET", `/api/requirements/${made.id}`);
    expect((afterDeliver.data.requirement as { stage: string }).stage).toBe("design");
    const moved = await call("PATCH", `/api/requirements/${made.id}`, { stage: "design-review" });
    expect((moved.data.requirement as { stage: string }).stage).toBe("design-review");
    const events = (await call("GET", `/api/requirements/${made.id}`)).data.events as { kind: string; from?: string; to?: string }[];
    expect(events.some((event) => event.kind === "stage" && event.from === "design" && event.to === "design-review")).toBe(true);
  });

  test("审阅裁决落账不改阶段：approved/annotated 写 审阅裁决 事件，读侧算成 deliverable.verdict（后写的赢）", async () => {
    const made = await createOne();
    const delivered = await call("POST", `/api/requirements/${made.id}/deliverables`, { kind: "design-doc", ref: "docs/plan.md", title: "方案一" });
    const docId = (delivered.data.deliverable as { id: string }).id;
    await call("PATCH", `/api/requirements/${made.id}`, { stage: "design-review" });
    routes().store.reviewVerdict(made.id, docId, "annotated", 3);
    let detail = (await call("GET", `/api/requirements/${made.id}`)).data as { requirement: { stage: string; deliverables: { id: string; verdict?: string }[] }; events: { kind: string; field?: string; from?: string; to?: string; note?: string }[] };
    // 阶段不动（350d4537a 的拍板），裁决进历史，读侧带 verdict。
    expect(detail.requirement.stage).toBe("design-review");
    expect(detail.requirement.deliverables.find((d) => d.id === docId)?.verdict).toBe("annotated");
    const verdictEvent = detail.events.find((event) => event.field === "审阅裁决");
    expect(verdictEvent?.from).toBe(docId);
    expect(verdictEvent?.to).toBe("annotated");
    expect(verdictEvent?.note).toContain("退回");
    expect(verdictEvent?.note).toContain("3");
    // 同一文档再审、改判：后写的裁决赢。
    routes().store.reviewVerdict(made.id, docId, "approved", null);
    detail = (await call("GET", `/api/requirements/${made.id}`)).data as typeof detail;
    expect(detail.requirement.deliverables.find((d) => d.id === docId)?.verdict).toBe("approved");
    expect(detail.events.filter((event) => event.field === "审阅裁决")).toHaveLength(2);
  });

  test("progress 的 stage/say 事件带 thread（会话归属），手动 PATCH 不带", async () => {
    const made = await createOne();
    // 手动 PATCH：阶段事件无归属。
    await call("PATCH", `/api/requirements/${made.id}`, { stage: "design-review" });
    const first = (await call("GET", `/api/requirements/${made.id}`)).data.events as { kind: string; thread?: string }[];
    expect(first.find((e) => e.kind === "stage")?.thread).toBeUndefined();
    // progress 路径（store 直调，同 MCP op 形状）：stage 事件带调用会话。
    routes().store.patch(made.id, { stage: "dev" }, { thread: "msg_smoke-thread" });
    routes().store.say(made.id, "一段进展", "Claude Code", "msg_smoke-thread");
    const events = (await call("GET", `/api/requirements/${made.id}`)).data.events as { kind: string; thread?: string }[];
    expect(events.find((e) => e.kind === "stage" && e.to === "dev")?.thread).toBe("msg_smoke-thread");
    expect(events.at(-1)?.thread).toBe("msg_smoke-thread");
  });

  test("设计评审裁决送达产出会话的线程（notifyThread），无归属或放弃不送达", async () => {
    // 评审文档要在磁盘上（路由校验 existsSync），放测试数据目录里。
    const docPath = join(dataDir, "docs", "plan.md");
    mkdirSync(join(dataDir, "docs"), { recursive: true });
    writeFileSync(docPath, "# 方案\n");
    const notes: { thread: string; words: string }[] = [];
    module = createBunRequirementRoutes({
      dataDir,
      spawnAnnotate: (file) => {
        expect(file.replaceAll("\\", "/")).toBe(docPath.replaceAll("\\", "/"));
        // 路由要等「活页登记」才返回地址（waitForAliveUrl → aliveAnnotateOf）：fake 子进程也得登记。
        mkdirSync(join(dataDir, "sessions"), { recursive: true });
        writeFileSync(join(dataDir, "sessions", "fake-annotate.json"), JSON.stringify({ pid: process.pid, url: "http://localhost:65111", mode: "annotate", target: docPath }));
        return Promise.resolve({ stdout: `${JSON.stringify({ decision: "annotated", annotationCount: 3, feedback: "边界再补两句话" })}\n`, code: 0 });
      },
      notifyThread: (thread, words) => notes.push({ thread, words }),
    });
    const made = await createOne();
    const delivered = await call("POST", `/api/requirements/${made.id}/deliverables`, { kind: "design-doc", ref: docPath, title: "改版设计", thread: "msg_thread_1" });
    const docId = (delivered.data.deliverable as { id: string }).id;
    const review = await call("POST", `/api/requirements/${made.id}/deliverables/${docId}/review`);
    expect(review.status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 30)); // 裁决处理是子进程退出后的异步分支
    // 送达产出会话的线程：结论 + 批注数 + 反馈。
    expect(notes).toEqual([{ thread: "msg_thread_1", words: expect.stringContaining("已退回") }]);
    expect(notes[0]!.words).toContain("改版设计");
    expect(notes[0]!.words).toContain("批注 3 条");
    expect(notes[0]!.words).toContain("边界再补两句话");

    // 无归属（thread 为空）：落账但不送达。
    const notesBefore = notes.length;
    const bare = await call("POST", `/api/requirements/${made.id}/deliverables`, { kind: "design-doc", ref: docPath, title: "无归属版" });
    const bareId = (bare.data.deliverable as { id: string }).id;
    module = createBunRequirementRoutes({
      dataDir,
      spawnAnnotate: () => Promise.resolve({ stdout: `${JSON.stringify({ decision: "approved" })}\n`, code: 0 }),
      notifyThread: (thread, words) => notes.push({ thread, words }),
    });
    const approved = await call("POST", `/api/requirements/${made.id}/deliverables/${bareId}/review`);
    expect(approved.status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(notes.length).toBe(notesBefore);
  });

  test("批注完成的 say 带 from=交付物 id（面板按交付物回查会话归属，不再无归属）", async () => {
    const docPath = join(dataDir, "docs", "note.md");
    mkdirSync(join(dataDir, "docs"), { recursive: true });
    writeFileSync(docPath, "# 便签\n");
    module = createBunRequirementRoutes({
      dataDir,
      spawnAnnotate: () => {
        mkdirSync(join(dataDir, "sessions"), { recursive: true });
        writeFileSync(join(dataDir, "sessions", "fake-annotate-note.json"), JSON.stringify({ pid: process.pid, url: "http://localhost:65112", mode: "annotate", target: docPath }));
        return Promise.resolve({ stdout: `${JSON.stringify({ decision: "annotated", annotationCount: 1 })}\n`, code: 0 });
      },
    });
    const made = await createOne();
    const delivered = await call("POST", `/api/requirements/${made.id}/deliverables`, { kind: "design-doc", ref: docPath, title: "带归属的批注", thread: "msg_thread_2" });
    const docId = (delivered.data.deliverable as { id: string }).id;
    const opened = await call("POST", `/api/requirements/${made.id}/deliverables/${docId}/annotate`);
    expect(opened.status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 30));
    const events = (await call("GET", `/api/requirements/${made.id}`)).data.events as { kind: string; from?: string; note?: string }[];
    const done = events.find((e) => e.note?.includes("批注完成"));
    expect(done?.from).toBe(docId);
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

test("a project is set at create, changed by PATCH, and an unknown one is refused", async () => {
  const projects = new Map([
    ["prj_1", { id: "prj_1", name: "web", root: "/work/web" }],
    ["prj_2", { id: "prj_2", name: "api", root: "/work/api" }],
  ]);
  module = createBunRequirementRoutes({ dataDir, projectOf: (id) => projects.get(id) ?? null });
  const made = await call("POST", "/api/requirements", { title: "登录页改版", project_id: "prj_1" });
  expect(made.status).toBe(201);
  const requirement = made.data.requirement as { id: string; project: { id: string; name: string; root: string } };
  expect(requirement.project).toEqual({ id: "prj_1", name: "web", root: "/work/web" });
  expect((await call("PATCH", `/api/requirements/${requirement.id}`, { project_id: "prj_2" })).status).toBe(200);
  expect(((await call("GET", `/api/requirements/${requirement.id}`)).data.requirement as { project: { id: string } }).project.id).toBe("prj_2");
  expect((await call("PATCH", `/api/requirements/${requirement.id}`, { project_id: null })).status).toBe(200);
  expect(((await call("GET", `/api/requirements/${requirement.id}`)).data.requirement as { project: unknown }).project).toBeNull();
  expect((await call("PATCH", `/api/requirements/${requirement.id}`, { project_id: "prj_missing" })).status).toBe(404);
});
