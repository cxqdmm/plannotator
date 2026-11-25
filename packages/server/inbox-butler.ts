/**
 * 管家（approval "butler" 一期）：the Inbox's digital butler — a persistent chat
 * persona living in its own folder (`~/plannotator-butler/`). Phase 1:
 * conversation only. The brain = an **opencode provider session** (this
 * machine's opencode install; claude.cmd spawn is broken here — measured), cwd
 * = the butler folder, persona = 管家 (AIContext mode "butler"). Phase 2
 * (future): requirement tools + dispatch in the butler's tool surface.
 *
 *   POST /api/inbox/butler/chat   `{ message, files? }` → SSE 增量 + done（window only）
 *   GET  /api/inbox/butler/history → `{ history: [{ at, role, text, files? }] }`
 *
 * The folder: `history.jsonl` (append per turn) + `state.json` (the opencode
 * session id, so the conversation continues across daemon restarts) + `files/`
 * (主人发来的附件按字节落盘，会话用工具可再读)。Nothing here writes anywhere
 * else; the folder is the butler's own.
 */
import { mkdirSync, existsSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createProvider, buildButlerPrompt } from "@plannotator/ai";
import type { AIQueryOptions } from "@plannotator/ai";
import { BUTLER_FILE_INLINE_BYTES, BUTLER_FILE_MAX_BYTES, BUTLER_FILE_MAX_COUNT } from "@plannotator/core/inbox-types";

/** 主人 opencode.json 里的默认模型（`glm/glm-5.3-flash` 之类），读不到给 null。 */
function readOpencodeDefaultModel(): string | null {
  try {
    const config = JSON.parse(readFileSync(join(homedir(), ".config", "opencode", "opencode.json"), "utf8")) as { model?: unknown };
    return typeof config.model === "string" && config.model ? config.model : null;
  } catch {
    return null;
  }
}

/** 管家的家：`~/plannotator-butler/`。测试与开发用 `PLANNOTATOR_BUTLER_DIR` 沙箱
 *  （与 PLANNOTATOR_DATA_DIR 同款模式），避免测试写进真实的管家文件夹。 */
export function butlerDir(): string {
  const override = process.env.PLANNOTATOR_BUTLER_DIR?.trim();
  if (override) return override;
  return join(homedir(), "plannotator-butler");
}

/** 管家的独有技能（技能 ID 一律 `butler-*`）：写到管家文件夹的 `.opencode/skills/` 下，
 *  opencode 会话（cwd = 这里）只认这些。加新技能时同步加到这份表——白名单按 ID 放行。 */
const BUTLER_SKILLS: ReadonlyMap<string, { name: string; description: string; body: string }> = new Map([
  [
    "butler-intake",
    {
      name: "需求受理",
      description: "把主人说想做的事整理成一句话需求（工坊需求卡片），并说明从卡片启动执行会话",
      body: [
        "## 工作流",
        "",
        "1. 听主人讲想做什么，缺要点就追问一句补齐。",
        "2. 整理成一句话标题（说清要做什么），列出补充要点。",
        "3. 告知真正动手的入口：工坊里该需求卡片上的「开启新会话」；管家统筹，不亲自执行任务。",
      ].join("\n"),
    },
  ],
  [
    "butler-inbox-guide",
    {
      name: "收件箱向导",
      description: "介绍 Plannotator 收件箱的用法：工坊、计划评审、代码评审、文件标注、会话与回复规则",
      body: [
        "## 要点",
        "",
        "- 工坊：需求卡片挂会话与产物；卡片上「开启新会话」派活，「历史」看事件流。",
        "- 计划评审：执行会话交出设计文档后，卡片或历史页「去审阅」，批注意见回给会话。",
        "- 代码评审：会话行 ⋯ 菜单发起，结论送达本会话并记入需求历史。",
        "- 会话在等你回复时会停下（「等你回复」）；打断在会话行的 ⋯ 菜单里。",
        "- 管家只统筹不执行；管家会话的终端命令在管家面板右上角复制。",
      ].join("\n"),
    },
  ],
]);

/** 管家项目的 opencode 配置（技能白名单）：环境里的技能（主人自己的 `~/.claude/skills`、
 *  全局目录等）一概 deny，只放行 `butler-*`——被拒的技能连模型的可见清单都不进
 *  （owner 2026-11-25「管家要有技能白名单」；实测 scratch 目录：deny 后只报 butler-*）。
 *  与 AGENTS.md 同款幂等覆写：每次守护进程启动重写，手改会被重置。 */
function butlerProjectConfig(): string {
  const rules = [{ action: "skill", resource: "*", effect: "deny" }, { action: "skill", resource: "butler-*", effect: "allow" }];
  return `${JSON.stringify({ $schema: "https://opencode.ai/config.json", permissions: rules }, null, 2)}\n`;
}

/** 守护进程初始化时调用：管家文件夹不存在则创建，写好人设（AGENTS.md）、技能白名单
 *  （opencode.json）与独有技能（.opencode/skills/butler-*，幂等）。
 *  人设写进 AGENTS.md——opencode 会话（cwd = 这里）自动读取，CLI 引导的会话与
 *  页面续接的会话因此一致地以管家身份说话。 */
export function ensureButlerDir(): string {
  const dir = butlerDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o755 });
  try {
    writeFileSync(join(dir, "AGENTS.md"), `${buildButlerPrompt()}
`, { mode: 0o600 });
  } catch {
    // 人设写失败不阻断：会话照常能开，只是少了口吻设定。
  }
  try {
    writeFileSync(join(dir, "opencode.json"), butlerProjectConfig(), { mode: 0o600 });
    for (const [id, skill] of BUTLER_SKILLS) {
      const folder = join(dir, ".opencode", "skills", id);
      if (!existsSync(folder)) mkdirSync(folder, { recursive: true, mode: 0o755 });
      const frontmatter = `---\nname: ${skill.name}\ndescription: ${skill.description}\n---\n\n${skill.body}\n`;
      writeFileSync(join(folder, "SKILL.md"), frontmatter, { mode: 0o600 });
    }
  } catch {
    // 白名单写失败不阻断：会话照常能开，只是技能面退回环境默认（下轮启动再试）。
  }
  return dir;
}

interface ButlerTurn {
  at: string;
  role: "you" | "butler";
  text: string;
  /** 这条消息带的附件名（落盘在 files/ 下）；无附件省略。 */
  files?: string[];
}

/** 主人发来的一个附件（base64，wire 上与工坊上传同款）。 */
export interface ButlerFile {
  name: string;
  mime: string;
  data: string;
}

/** 一条已验收的附件：落盘路径 + 内联用的 dataUrl（图片且够小才有）。 */
interface ButlerStoredFile {
  name: string;
  mime: string;
  path: string;
  dataUrl: string | null;
}

/** 附件验收：数量/大小/形态，过了直接回 413/422 的错。 */
function storeButlerFiles(files: ButlerFile[]): { stored: ButlerStoredFile[] } | { error: string; status: number } {
  if (files.length > BUTLER_FILE_MAX_COUNT) return { error: `附件最多 ${BUTLER_FILE_MAX_COUNT} 个。`, status: 413 };
  const dir = join(butlerDir(), "files");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o755 });
  const stamp = Date.now().toString(36);
  const stored: ButlerStoredFile[] = [];
  for (const [index, file] of files.entries()) {
    const name = typeof file.name === "string" && file.name.trim() ? file.name.trim().replace(/[/\\]/g, "_").slice(0, 120) : `file-${index + 1}`;
    const mime = typeof file.mime === "string" && file.mime.trim() ? file.mime.trim() : "application/octet-stream";
    const data = typeof file.data === "string" ? file.data.replace(/^data:[^;]*;base64,/, "") : "";
    if (!/^[A-Za-z0-9+/=\s]+$/.test(data)) return { error: `附件 ${name} 不是 base64 数据。`, status: 422 };
    let bytes: Buffer;
    try {
      bytes = Buffer.from(data, "base64");
    } catch {
      return { error: `附件 ${name} 解不开。`, status: 422 };
    }
    if (bytes.length > BUTLER_FILE_MAX_BYTES) return { error: `附件 ${name} 超过 ${Math.round(BUTLER_FILE_MAX_BYTES / 1024 / 1024)} MB。`, status: 413 };
    const path = join(dir, `${stamp}-${index}-${name}`);
    try {
      writeFileSync(path, bytes, { mode: 0o600 });
    } catch {
      return { error: `附件 ${name} 没能存下。`, status: 500 };
    }
    stored.push({
      name,
      mime,
      path,
      dataUrl: bytes.length <= BUTLER_FILE_INLINE_BYTES && mime.startsWith("image/") ? `data:${mime};base64,${data.replace(/\s/g, "")}` : null,
    });
  }
  return { stored };
}

/** 附件进提示词的说明行：模型靠它在会话里知道有什么、在哪，工具可再读。 */
function filesNoteOf(files: readonly ButlerStoredFile[]): string {
  if (files.length === 0) return "";
  const lines = files.map((file) => `- ${file.name}（${file.mime}）已存到 ${file.path}`);
  return `\n\n[主人随这条消息发来了 ${files.length} 个附件：\n${lines.join("\n")}\n]`;
}

/** 内联文件（够小的图片）作为 opencode 原生 file parts；其余只走提示词里的路径。 */
function butlerQueryFiles(files: readonly ButlerStoredFile[]): AIQueryOptions {
  const inline = files.filter((file) => file.dataUrl !== null).map((file) => ({ name: file.name, mime: file.mime, dataUrl: file.dataUrl! }));
  return inline.length ? { files: inline } : {};
}

export class Butler {
  private brainSession: import("@plannotator/ai").AISession | null = null;
  private readonly dir = butlerDir();
  private readonly historyPath = join(this.dir, "history.jsonl");
  private readonly statePath = join(this.dir, "state.json");
  /** 测试注入：bootstrap 用的 CLI 路径（默认 PATH 上的 opencode）。 */
  private readonly bootstrapBin: string;
  /** bootstrap 回合用的模型（主人的 opencode.json 默认模型）；测试可注入。 */
  private readonly model: string | null;

  constructor(options: { bootstrapBin?: string; model?: string } = {}) {
    this.model = options.model ?? readOpencodeDefaultModel();
    this.bootstrapBin = options.bootstrapBin ?? (Bun.which("opencode") ?? "opencode");
  }

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

  /** 管家会话的终端入口：会话 id 与在终端打开它的命令（首次会先起好会话）。 */
  async session(): Promise<{ sessionId: string; dir: string; command: string }> {
    const brain = await this.brain();
    this.persistSessionId(brain.id);
    const quote = (value: string) => `'${value.replace(/'/g, "'\\''")}'`;
    return {
      sessionId: brain.id,
      dir: this.dir,
      command: `cd ${quote(this.dir)} && opencode -s ${quote(brain.id)}`,
    };
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
  async chat(message: string, files: ButlerStoredFile[] = []): Promise<string> {
    const at = new Date().toISOString();
    this.appendHistory({ at, role: "you", text: message, ...(files.length ? { files: files.map((file) => file.name) } : {}) });
    const reply = await this.askButler(message, files);
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

  /** 管家的大脑：一个**固定 id 的真 opencode 会话**（终端 `opencode -s <id>` 可打开同一
   *  份对话；cwd = 总管文件夹）。跨守护进程重启：state.json 存着会话 id，优先续接；
   *  会话不存在（首次/被清理）时用 CLI bootstrap 一次（CLI 能建会话，serve 不能）。 */
  private async brain(): Promise<import("@plannotator/ai").AISession> {
    if (this.brainSession) return this.brainSession;
    // 提供者工厂靠模块导入的副作用注册（ai-runtime 同款）：先导入再建。
    await import("@plannotator/ai/providers/opencode-sdk");
    const provider = await createProvider({
      type: "opencode-sdk",
      cwd: this.dir,
      ...(this.bootstrapBin ? { opencodeExecutablePath: this.bootstrapBin } : {}),
    } as never);
    let priorId = this.priorSessionId();
    if (priorId) {
      try {
        this.brainSession = await provider.resumeSession(priorId, buildButlerPrompt());
        return this.brainSession;
      } catch {
        // 会话没了（存储清理等）：重新 bootstrap。
      }
    }
    // Bootstrap：CLI 起一次管家会话（CLI 能建会话，serve 不能）——固定 id，一次性回合。
    priorId = `ses_butler${Math.random().toString(36).slice(2, 10)}`;
    // 模型显式带上主人的默认配置：CLI run 不带 --model 会落到 opencode 的免费默认
    // 模型，额度耗尽时退出 1（现场事故 2026-11-24：Free usage limit reached）。
    const bootstrap = spawn(
      this.bootstrapBin,
      [
        "run", "--standalone", "--session", priorId,
        ...(this.model ? ["--model", this.model] : []),
        "（管家就位，等待主人吩咐。）",
      ],
      { cwd: this.dir, env: { ...process.env }, timeout: 120_000, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
    );
    await new Promise<void>((resolve, reject) => {
      let stderrTail = "";
      bootstrap.stderr?.on("data", (chunk: Buffer) => { stderrTail = (stderrTail + String(chunk)).slice(-400); });
      bootstrap.on("error", reject);
      bootstrap.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`管家会话初始化失败（退出码 ${code}）${stderrTail ? `：${stderrTail}` : ""}`));
      });
    });
    this.persistSessionId(priorId);
    this.brainSession = await provider.resumeSession(priorId, buildButlerPrompt());
    return this.brainSession;
  }

  private async askButler(message: string, files: ButlerStoredFile[] = []): Promise<string> {
    const session = await this.brain();
    let reply = "";
    for await (const msg of session.query(`${message}${filesNoteOf(files)}`, butlerQueryFiles(files))) {
      if (msg.type === "text") reply += msg.text;
      else if (msg.type === "text_delta") reply += msg.delta;
      else if (msg.type === "error") throw new Error(msg.error ?? "管家这会儿没法回答。");
    }
    const trimmed = reply.trim();
    if (!trimmed) throw new Error("the butler gave no answer");
    return trimmed;
  }

  /** 流式一问：增量经 onDelta 出去，返回全文（历史照记）。 */
  private async askButlerStream(message: string, onDelta: (delta: string) => void, files: ButlerStoredFile[] = []): Promise<string> {
    const session = await this.brain();
    let reply = "";
    for await (const msg of session.query(`${message}${filesNoteOf(files)}`, butlerQueryFiles(files))) {
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
    // 管家会话的终端入口（窗口右上角按钮）：会话 id + 可直接粘贴的命令。
    if (url.pathname === "/api/inbox/butler/session" && req.method === "GET") {
      try {
        return Response.json(await this.session());
      } catch (error) {
        return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 502 });
      }
    }
    return null;
  }

  private async chatRoute(req: Request): Promise<Response> {
    let message = "";
    let files: ButlerStoredFile[] = [];
    try {
      const body = (await req.json()) as { message?: unknown; files?: unknown };
      message = typeof body.message === "string" ? body.message.trim() : "";
      // 附件（图片文件等，owner 2026-11-25「关键的输入框的基础功能…图片文件等等」）：
      // 先验收落盘，验收失败直接 4xx，不进历史不进会话。
      const raw = Array.isArray(body.files) ? (body.files as ButlerFile[]) : [];
      if (raw.length > 0 || body.files !== undefined) {
        const outcome = storeButlerFiles(raw);
        if ("error" in outcome) return Response.json({ error: outcome.error }, { status: outcome.status });
        files = outcome.stored;
      }
    } catch {
      message = "";
    }
    if (!message && files.length === 0) return Response.json({ error: "message: 要对管家说的话（或附件）不能为空。" }, { status: 422 });
    // 流式（v3，owner 2026-11-25「像 web 版一样」）：SSE 增量 + 终帧；流中断历史照记。
    let reply = "";
    const stream = new ReadableStream<Uint8Array>({
      start: async (controller) => {
        const send = (payload: Record<string, unknown>) =>
          controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(payload)}\n\n`));
        try {
          this.appendHistory({ at: new Date().toISOString(), role: "you", text: message, ...(files.length ? { files: files.map((file) => file.name) } : {}) });
          reply = await this.askButlerStream(message || `（主人发来了 ${files.length} 个附件）`, (delta) => send({ delta }), files);
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
