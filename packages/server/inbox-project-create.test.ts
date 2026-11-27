/**
 * 工坊需求卡的项目选择（POST /api/inbox/projects): a folder becomes the Inbox project the card keeps,
 * and a new folder can be made in the same step. The folder browser reads through the launch routes;
 * this write is the card's own. What can regress: a second pick making a second project for the same
 * folder, a new folder not being made, a page that is not this window writing, a missing folder being
 * taken, and a project that the requirements card cannot later resolve by id.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startInboxServer, type InboxServer } from "./inbox";

const roots: string[] = [];
const servers: InboxServer[] = [];

afterEach(() => {
  for (const server of servers.splice(0)) server.stop();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

async function setup() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "plannotator-project-create-")));
  roots.push(root);
  const folder = join(root, "notes");
  mkdirSync(folder);
  const server = await startInboxServer({ dataDir: join(root, "data"), phones: false });
  servers.push(server);
  const base = `http://127.0.0.1:${server.port}`;
  const post = (body: Record<string, unknown>, headers: Record<string, string> = {}) =>
    fetch(`${base}/api/inbox/projects`, {
      method: "POST",
      headers: { "content-type": "application/json", "sec-fetch-site": "same-origin", ...headers },
      body: JSON.stringify({ serverSession: server.serverSession, ...body }),
    });
  return { root, folder, server, base, post };
}

describe("POST /api/inbox/projects", () => {
  test("a folder becomes one project; picking it again answers the same id", async () => {
    const { folder, base, post } = await setup();
    const first = await post({ path: folder });
    expect(first.status).toBe(200);
    const made = (await first.json()) as { project: { id: string; name: string; root: string } };
    expect(made.project.root).toBe(folder);
    expect(made.project.id).toStartWith("prj_");

    const again = await post({ path: folder });
    expect(again.status).toBe(200);
    expect(((await again.json()) as { project: { id: string } }).project.id).toBe(made.project.id);

    const listed = (await (await fetch(`${base}/api/inbox/projects`)).json()) as { projects: { id: string; root: string }[] };
    expect(listed.projects.find((project) => project.id === made.project.id)?.root).toBe(folder);
  });

  test("create makes the new folder before making its project", async () => {
    const { root, post } = await setup();
    const folder = join(root, "new-notes");
    const response = await post({ path: folder, create: true });
    expect(response.status).toBe(200);
    expect(statSync(folder).isDirectory()).toBe(true);
    const made = (await response.json()) as { project: { root: string } };
    expect(made.project.root).toBe(folder);
  });

  test("another site, a stale page, a missing folder and a hidden new folder are refused", async () => {
    const { root, base, post } = await setup();
    expect((await post({ path: root }, { "sec-fetch-site": "cross-site" })).status).toBe(403);
    const stale = await fetch(`${base}/api/inbox/projects`, {
      method: "POST",
      headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" },
      body: JSON.stringify({ serverSession: "old", path: root }),
    });
    expect(stale.status).toBe(409);
    expect((await post({ path: join(root, "missing") })).status).toBe(400);
    const hidden = join(root, ".hidden");
    expect((await post({ path: hidden, create: true })).status).toBe(422);
    expect(() => statSync(hidden)).toThrow();
  });
});
