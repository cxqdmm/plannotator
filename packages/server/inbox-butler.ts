/**
 * 管家（approval "butler" 一期）：the Inbox's digital butler — a persistent chat
 * persona living in its own folder (`~/plannotator-butler/`). Phase 1:
 * conversation only. The brain = an **opencode provider session** (this
 * machine's opencode install; claude.cmd spawn is broken here — measured), cwd
 * = the butler folder, persona = 管家 (AIContext mode "butler"). Phase 2
 * (future): requirement tools + dispatch in the butler's tool surface.
 *
 *   POST /api/inbox/butler/chat   `{ message }` → `{ reply }` (window only)
 *   GET  /api/inbox/butler/history → `{ history: [{ at, role, text }] }`
 *
 * The folder: `history.jsonl` (append per turn) + `state.json` (the opencode
 * session id, so the conversation continues across daemon restarts). Nothing
 * here writes anywhere else; the folder is the butler's own.
 */
import { mkdirSync, existsSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createProvider } from "@plannotator/ai";

/** 管家的家：`~/plannotator-butler/`。 */
export function butlerDir(): string {
  return join(homedir(), "plannotator-butler");
}

/** 守护进程初始化时调用：管家文件夹不存在则创建（幂等）。 */
export function ensureButlerDir(): string {
  const dir = butlerDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o755 });
  return dir;
}

interface ButlerTurn {
  at: string;
  role: "you" | "butler";
  text: string;
}

export class Butler {
  private brainSession: import("@plannotator/ai").AISession | null = null;
  private readonly dir = butlerDir();
  private readonly historyPath = join(this.dir, "history.jsonl");

  /** 初始化（守护进程启动时调用）：管家文件夹就绪。 */
  init(): void {
    ensureButlerDir();
  }

  /** 历史（窗口管家界面的初始渲染，最旧在前）。 */
  history(): ButlerTurn[] {
    if (!existsSync(this.historyPath)) return [];
    try {
      return readFileSync(this.historyPath, "utf8")
        .split("\n")
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line) as ButlerTurn);
    } catch {
      return [];
    }
  }

  /** 一条对话：先落 you 侧历史，opencode 回复后落 butler 侧并返回全文。 */
  async chat(message: string): Promise<string> {
    const at = new Date().toISOString();
    this.appendHistory({ at, role: "you", text: message });
    const reply = await this.askButler(message);
    this.appendHistory({ at: new Date().toISOString(), role: "butler", text: reply });
    return reply;
  }

  private appendHistory(turn: ButlerTurn): void {
    try {
      appendFileSync(this.historyPath, `${JSON.stringify(turn)}\n`, { mode: 0o600 });
    } catch {
      // 历史写失败不阻断对话（管家照常回）。
    }
  }

  /** 管家的大脑：opencode 提供者的一个会话（cwd = 总管文件夹；本进程持有，进程内延续）。 */
  private async brain(): Promise<import("@plannotator/ai").AISession> {
    if (this.brainSession) return this.brainSession;
    // 提供者工厂靠模块导入的副作用注册（ai-runtime 同款）：先导入再建。
    await import("@plannotator/ai/providers/opencode-sdk");
    const opencodePath = Bun.which("opencode");
    const provider = await createProvider({
      type: "opencode-sdk",
      cwd: this.dir,
      ...(opencodePath ? { opencodeExecutablePath: opencodePath } : {}),
    } as never);
    this.brainSession = await provider.createSession({ context: { mode: "butler" } });
    return this.brainSession;
  }

  private async askButler(message: string): Promise<string> {
    const session = await this.brain();
    let reply = "";
    for await (const msg of session.query(message)) {
      if (msg.type === "text") reply += msg.text;
      else if (msg.type === "text_delta") reply += msg.delta;
      else if (msg.type === "error") throw new Error(msg.error ?? "管家这会儿没法回答。");
    }
    const trimmed = reply.trim();
    if (!trimmed) throw new Error("the butler gave no answer");
    return trimmed;
  }

  /** 窗口专属（same-origin 才答）：管家路由。 */
  async route(req: Request, url: URL): Promise<Response | null> {
    const sameOrigin = req.headers.get("sec-fetch-site")?.trim().toLowerCase() === "same-origin";
    if (!sameOrigin) return null;
    if (url.pathname === "/api/inbox/butler/chat" && req.method === "POST") {
      return await this.chatRoute(req);
    }
    if (url.pathname === "/api/inbox/butler/history" && req.method === "GET") {
      return Response.json({ history: this.history() });
    }
    return null;
  }

  private async chatRoute(req: Request): Promise<Response> {
    let message = "";
    try {
      const body = (await req.json()) as { message?: unknown };
      message = typeof body.message === "string" ? body.message.trim() : "";
    } catch {
      message = "";
    }
    if (!message) return Response.json({ error: "message: 要对管家说的话不能为空。" }, { status: 422 });
    let reply: string;
    try {
      reply = await this.chat(message);
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 502 });
    }
    return Response.json({ reply });
  }
}
