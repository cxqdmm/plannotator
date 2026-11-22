/**
 * The workshop's `requirement` MCP tool after the owner收权 (req_01M81N2V88RZK9TX0T1VW0HHJW):
 * the agent sees (mine/get), delivers and reports progress — it never creates a
 * requirement and never ties one to a thread. `create` and `link` are gone from
 * the schema: an older client calling them gets the op-enum error and reqs.jsonl
 * gains nothing; a stray `notes` (the deleted create field) is refused by the
 * strict schema. The person's own door (`POST /api/requirements`, the workshop
 * UI) still creates, and through it the kept ops run end to end. Real server,
 * MCP SDK client, loopback.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { startInboxServer, type InboxServer } from "./inbox";

const roots: string[] = [];
const servers: InboxServer[] = [];
const clients: Client[] = [];

afterEach(async () => {
  for (const client of clients.splice(0)) await client.close().catch(() => {});
  for (const server of servers.splice(0)) server.stop();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

type Result = { isError?: boolean; content: { text: string }[] };

async function world() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "plannotator-req-mcp-")));
  roots.push(root);
  const server = await startInboxServer({ dataDir: join(root, "data") });
  servers.push(server);
  const client = new Client({ name: "inbox-requirements-test", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${server.port}/mcp`)));
  clients.push(client);
  const agent = { agent_session: "ses_r", agent_host: "claude-code", agent_name: "Claude Code" };
  const call = async (args: Record<string, unknown>) => (await client.callTool({ name: "requirement", arguments: { ...agent, ...args } })) as Result;
  const text = (r: Result) => r.content.map((part) => part.text ?? "").join("\n");
  // The person's own door: the workshop UI creates and patches through these routes.
  const person = async (method: string, path: string, body?: Record<string, unknown>) =>
    fetch(`http://127.0.0.1:${server.port}${path}`, {
      method,
      headers: { "content-type": "application/json", Authorization: `Bearer ${server.token}` },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  const personCreate = async (title: string) => {
    const made = (await (await person("POST", "/api/requirements", { title })).json()) as { requirement: { id: string; stage: string } };
    return made.requirement;
  };
  return { root, server, call, text, person, personCreate };
}

describe("the requirement tool without create and link", () => {
  test("op create is refused by name: the schema names the kept ops, and nothing is written", async () => {
    const { call, text, person } = await world();
    const refused = await call({ op: "create", title: "Agent-made requirement" });
    expect(refused.isError).toBe(true);
    // The strict schema refuses it before any code runs, naming the kept ops.
    expect(text(refused)).toContain('expected one of "mine"|"get"|"deliver"|"progress"');
    // The person's list stays empty: a refused create wrote nothing.
    const list = (await (await person("GET", "/api/requirements")).json()) as { requirements: unknown[] };
    expect(list.requirements).toEqual([]);
  });

  test("op link is refused the same way", async () => {
    const { call, text, personCreate } = await world();
    const made = await personCreate("登录页改版");
    const refused = await call({ op: "link", requirement: made.id, thread_id: "pn_some_thread" });
    expect(refused.isError).toBe(true);
    expect(text(refused)).toContain('expected one of "mine"|"get"|"deliver"|"progress"');
    // The requirement carries no thread: the refused link tied nothing.
    const got = await call({ op: "get", requirement: made.id });
    expect(text(got)).not.toContain("threads ");
  });

  test("a stray notes field (the deleted create field) is refused by the strict schema", async () => {
    const { call, text } = await world();
    const refused = await call({ op: "mine", notes: "markdown from an older client" });
    expect(refused.isError).toBe(true);
    expect(text(refused)).toMatch(/notes/i);
  });

  test("the person creates in the workshop; the agent sees it, delivers to it, and reports progress", async () => {
    const { call, text, personCreate } = await world();
    const made = await personCreate("登录页改版");
    expect(made.stage).toBe("design");
    // mine by thread stays meaningful only for card-started sessions; plain mine lists it.
    const mine = await call({ op: "mine" });
    expect(text(mine)).toContain(made.id);
    const delivered = await call({ op: "deliver", requirement: made.id, kind: "design-doc", ref: "docs/plan.md", title: "改版设计" });
    expect(text(delivered)).toContain("改版设计");
    const progressed = await call({ op: "progress", requirement: made.id, note: "设计说明已交付，等审阅。", stage: "design-review" });
    expect(text(progressed)).toContain("需求设计 → 设计评审");
    const got = await call({ op: "get", requirement: made.id });
    expect(text(got)).toContain("改版设计");
    expect(text(got)).toContain("设计文档");
  });

  test("the served tool description says the person creates, and lists only the kept ops", async () => {
    const { server } = await world();
    const client = new Client({ name: "inbox-requirements-list", version: "1.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${server.port}/mcp`)));
    const list = await client.listTools();
    const requirement = list.tools.find((tool) => tool.name === "requirement")!;
    expect(requirement.description).toContain("never by you");
    expect(requirement.description).not.toContain("create (");
    expect(requirement.description).not.toContain("link (tie");
    const schema = requirement.inputSchema as { properties?: Record<string, { description?: string; anyOf?: { enum?: string[] }[] }> };
    expect(Object.keys(schema.properties ?? {})).not.toContain("notes");
    const op = schema.properties?.op as { enum?: string[] };
    expect(op.enum).toEqual(["mine", "get", "deliver", "progress"]);
    await client.close().catch(() => {});
  });
});
