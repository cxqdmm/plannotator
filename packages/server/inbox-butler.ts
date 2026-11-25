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

/** 管家的家：`~/plannotator-butler/`。测试与开发用 `PLANNOTATOR_BUTLER_DIR` 沙箱
 *  （与 PLANNOTATOR_DATA_DIR 同款模式），避免测试写进真实的管家文件夹。 */
export function butlerDir(): string {
  const override = process.env.PLANNOTATOR_BUTLER_DIR?.trim();
  if (override) return override;
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
  private readonly statePath = join(this.dir, "state.json");

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

  /** 上次管家的 opencode 会话 id（跨守护进程重启延续对话）。 */
  private priorSessionId(): string | null {
    try {
      const state = JSON.parse(readFileSync(this.statePath, "utf8")) as { sessionId?: unknown };
      return typeof state.sessionId === "string" && state.sessionId ? state.sessionId : null;
    } catch {
      return null;
    }
  }

  private persistSessionId(sessionId: string): void {
    try {
      writeFileSync(this.statePath, `${JSON.stringify({ sessionId })}\n`, { mode: 0o600 });
    } catch {
      // 状态写失败不阻断对话（管家照常回，只是重启后开新会话）。
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

  /** 管家的大脑：opencode 提供者的一个会话（cwd = 总管文件夹）。跨守护进程重启：
   *  state.json 里存着上次的 opencode 会话 id，优先 resumeSession 续接同一份对话。 */
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
    const priorId = this.priorSessionId();
    if (priorId) {
      try {
        this.brainSession = await provider.resumeSession(priorId);
        return this.brainSession;
      } catch {
        // 会话没了（存储清理等）：开新会话。
      }
    }
    const session = await provider.createSession({ context: { mode: "butler" } });
    this.persistSessionId(session.id);
    this.brainSession = session;
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

  /** 流式一问：增量经 onDelta 出去，返回全文（历史照记）。 */
  private async askButlerStream(message: string, onDelta: (delta: string) => void): Promise<string> {
    const session = await this.brain();
    let reply = "";
    for await (const msg of session.query(message)) {
      if (msg.type === "text") {
        reply += msg.text;
        onDelta(msg.text);
      } else if (msg.type === "text_delta") {
        reply += msg.delta;
        onDelta(msg.delta);
      } else if (msg.type === "error") {
        throw new Error(msg.error ?? "管家这会儿没法回答。");
      }
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
      const body = (await req.json()) as { message?: unknown; stream?: unknown };
      message = typeof body.message === "string" ? body.message.trim() : "";
    } catch {
      message = "";
    }
    if (!message) return Response.json({ error: "message: 要对管家说的话不能为空。" }, { status: 422 });
    // 流式（v3，owner 2026-11-25「像 web 版一样」）：SSE 增量 + 终帧；流中断历史照记。
    let reply = "";
    const stream = new ReadableStream<Uint8Array>({
      start: async (controller) => {
        const send = (payload: Record<string, unknown>) =>
          controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(payload)}\n\n`));
        try {
          this.appendHistory({ at: new Date().toISOString(), role: "you", text: message });
          reply = await this.askButlerStream(message, (delta) => send({ delta }));
          this.appendHistory({ at: new Date().toISOString(), role: "butler", text: reply });
          send({ done: true, reply });
        } catch (error) {
          send({ error: error instanceof Error ? error.message : String(error) });
        }
        controller.close();
      },
    });
    return new Response(stream, {
      headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
    });
  }
}
