/**
 * `plannotator requirement …`: the workshop panel's call from a shell, for an
 * agent or a script that logs from the shell. A thin client over the Inbox's
 * `requirement` MCP tool (packages/server/inbox-mcp-requirements.ts), built
 * on the card command's shape (card-command.ts): one `tools/call` to the
 * running Inbox's `/mcp`, started detached when it is stopped, exactly as
 * `plannotator inbox mcp` reaches it. The rules live once, in the server.
 *
 * Its own `--help` answers without config or an Inbox.
 *
 * Inside an agent host session (a Claude Code session's
 * `PLANNOTATOR_SESSION_TAG`, a Pi bash call's `PI_SESSION_ID`) the call signs
 * as that session's agent, as its `plannotator_inbox` tool would.
 *
 * stdout: the tool's text. A refusal goes to stderr as `<code>: <message>`
 * and exits 1; bad usage exits 2.
 */

import { mcpAnswerOf } from "@plannotator/shared/inbox/connection";
import { inboxEnsureFailedWords, type InboxRegistryEntry } from "@plannotator/shared/inbox/registry";
import { REQUIREMENT_COMMAND_USAGE } from "./cli";
import { writeWholeToStdout } from "./write-whole-stdout";
import { inboxHostSessionFromEnv } from "./inbox-mcp-shim";

export { REQUIREMENT_COMMAND_USAGE };

type Op = "mine" | "get" | "link" | "deliver" | "say";

/** A parsed command: the tool's arguments (without the filled ones), or why it is not one. */
export type ParsedRequirementCommand = { ok: true; op: Op; args: Record<string, unknown>; json: boolean } | { ok: false; error: string };

const VALUE_FLAGS: Record<string, string> = {
  "--requirement": "requirement",
  "--thread": "thread_id",
  "--kind": "kind",
  "--ref": "ref",
  "--title": "title",
  "--note": "note",
  "--stage": "stage",
  "--why": "why",
};

/** The positional arguments each command takes, by the tool field they fill. */
const POSITIONAL: Record<Op, { names: readonly string[]; required: number }> = {
  mine: { names: ["thread_id"], required: 0 },
  get: { names: ["requirement"], required: 1 },
  link: { names: ["requirement", "thread_id"], required: 2 },
  deliver: { names: ["requirement", "kind", "ref"], required: 3 },
  say: { names: ["requirement", "note"], required: 2 },
};

export function parseRequirementCommand(argv: readonly string[]): ParsedRequirementCommand {
  const op = argv[0] as Op | undefined;
  if (!op || !Object.hasOwn(POSITIONAL, op)) return { ok: false, error: op ? `Unknown requirement command: ${op}` : "A requirement command: mine, get, link, deliver or say." };
  const args: Record<string, unknown> = { op };
  const positional: string[] = [];
  let json = false;
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--json") json = true;
    else if (Object.hasOwn(VALUE_FLAGS, arg)) {
      const value = argv[i + 1];
      if (value === undefined) return { ok: false, error: `${arg} takes a value.` };
      i++;
      const field = VALUE_FLAGS[arg]!;
      if (field in args) return { ok: false, error: `${arg} given twice.` };
      args[field] = value;
    } else if (arg.startsWith("--")) return { ok: false, error: `Unknown requirement option: ${arg}` };
    else positional.push(arg);
  }
  const { names, required } = POSITIONAL[op];
  if (positional.length > names.length) return { ok: false, error: `requirement ${op} takes at most: ${names.join(", ")} (quote a line with spaces).` };
  if (positional.length < required) return { ok: false, error: `requirement ${op} needs: ${names.slice(0, required).join(", ")}.` };
  for (const [index, value] of positional.entries()) {
    const field = names[index]!;
    if (field in args) return { ok: false, error: `${field} given twice.` };
    args[field] = value;
  }
  return { ok: true, op, args, json };
}

export interface RequirementCommandDeps {
  cwd: string;
  env: Record<string, string | undefined>;
  ensureRunning: () => Promise<InboxRegistryEntry>;
  out?: (text: string) => void | Promise<void>;
  err?: (text: string) => void;
}

/** Run `plannotator requirement …`; resolves to the exit code. */
export async function runRequirementCommand(argv: readonly string[], deps: RequirementCommandDeps): Promise<number> {
  const out = deps.out ?? writeWholeToStdout;
  const err = deps.err ?? ((text: string) => void process.stderr.write(text));
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    await (argv.length === 0 ? err : out)(`${REQUIREMENT_COMMAND_USAGE}\n`);
    return argv.length === 0 ? 2 : 0;
  }
  const parsed = parseRequirementCommand(argv);
  if (!parsed.ok) {
    err(`${parsed.error}\n${REQUIREMENT_COMMAND_USAGE}\n`);
    return 2;
  }
  // Inside an agent host session the call signs as that session's agent, as its plannotator_inbox tool would.
  const host = inboxHostSessionFromEnv(deps.env);
  const args: Record<string, unknown> = { ...parsed.args };
  if (host) {
    args.agent_session = host.session;
    args.agent_host = host.host;
    args.agent_name = host.name;
  }
  let entry: InboxRegistryEntry;
  try {
    entry = await deps.ensureRunning();
  } catch (error) {
    err(`${inboxEnsureFailedWords(error)}\n`);
    return 1;
  }
  let text: string;
  try {
    const response = await fetch(`http://127.0.0.1:${entry.port}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "requirement", arguments: args } }),
    });
    text = await response.text();
  } catch (error) {
    err(`Plannotator Inbox did not answer: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
  const answer = mcpAnswerOf(text);
  const noTool = (line: string) => /tool requirement not found|unknown tool/i.test(line);
  if (!answer || answer.error) {
    const message = answer?.error?.message ?? "Plannotator Inbox gave no answer.";
    err(noTool(message) ? "This Plannotator Inbox does not offer requirements yet.\n" : `${message}\n`);
    return 1;
  }
  const result = answer.result as { content?: { type?: string; text?: string }[]; structuredContent?: unknown; isError?: boolean } | undefined;
  const body = (result?.content ?? []).map((part) => part.text ?? "").join("\n");
  if (result?.isError) {
    err(`${body || "The requirement call was refused."}\n`);
    return 1;
  }
  await out(parsed.json ? `${JSON.stringify(result?.structuredContent ?? null, null, 2)}\n` : `${body}\n`);
  return 0;
}
