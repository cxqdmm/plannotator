/**
 * 管家（approval "butler" 一期）：the Inbox's digital butler — a persistent chat
 * persona living in its own folder (`~/plannotator-butler/`). Phase 1:
 * conversation only. The brain = an **opencode provider session** (this
 * machine's opencode install; claude.cmd spawn is broken here — measured), cwd
 * = the butler folder, persona = 管家 (AIContext mode "butler"). Phase 2
 * (future): requirement tools + dispatch in the butler's tool surface.
 *
 *   POST /api/inbox/butler/chat   `{ message, files? }` → SSE 增量 + done（window only）；
 *     过程帧：`{ reasoning }` 思考增量、`{ tool }` 工具开始、`{ tool_result }` 工具结果
 *   GET  /api/inbox/butler/history → `{ history: [{ at, role, text, files? }] }`
 *
 * The folder: `history.jsonl` (append per turn) + `state.json` (the opencode
 * session id, so the conversation continues across daemon restarts) + `files/`
 * (主人发来的附件按字节落盘，会话用工具可再读)。Nothing here writes anywhere
 * else; the folder is the butler's own.
 */
import { mkdirSync, existsSync, readdirSync, readFileSync, writeFileSync, appendFileSync, cpSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { requirementCardGuide, requirementCardTemplate } from "@plannotator/core/requirement-card";
import { createProvider, buildButlerPrompt } from "@plannotator/ai";
import type { AIQueryOptions } from "@plannotator/ai";
import { BUTLER_FILE_INLINE_BYTES, BUTLER_FILE_MAX_BYTES, BUTLER_FILE_MAX_COUNT } from "@plannotator/core/inbox-types";
import { butlerTraceOf, traceBrief } from "./inbox-butler-trace";

/** 主人 opencode.json 里的默认模型（`glm/glm-5.3-flash` 之类），读不到给 null。 */
function readOpencodeDefaultModel(): string | null {
  try {
    const config = JSON.parse(readFileSync(join(homedir(), ".config", "opencode", "opencode.json"), "utf8")) as { model?: unknown };
    return typeof config.model === "string" && config.model ? config.model : null;
  } catch {
    return null;
  }
}

/** 管家给主人复制的命令的引号：Windows（cmd/PowerShell）用双引号，其余平台用 POSIX
 *  单引号（内含单引号走 `'\''`）。 */
export function butlerShellQuote(platform: NodeJS.Platform): (value: string) => string {
  if (platform === "win32") return (value) => `"${value}"`;
  return (value) => `'${value.replace(/'/g, "'\\''")}'`;
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
/** 卡片协议的围栏标记：模型写三反引号 + html card；源码里用常量拼，避免出现三反引号。 */
const CARD_FENCE = "```html card";

/** `butler-card` 技能正文：协议、工具类词表、铁律（多选必须先选后确认）、阿里 C 端卡片风格与模板。 */


/** 管家项目的 opencode 配置（技能白名单）：环境里的技能（主人自己的 `~/.claude/skills`、
 *  全局目录等）一概 deny，只放行 `butler-*`——被拒的技能连模型的可见清单都不进
 *  （owner 2026-11-25「管家要有技能白名单」；实测 scratch 目录：deny 后只报 butler-*）。
 *  与 AGENTS.md 同款幂等覆写：每次守护进程启动重写，手改会被重置。 */
function butlerProjectConfig(): string {
  const rules = [{ action: "skill", resource: "*", effect: "deny" }, { action: "skill", resource: "butler-*", effect: "allow" }];
  // 管家的提问写在回复里（页面能看见、主人能直接回），不用 opencode 的交互式提问工具：
  // 那个工具在本页面没有作答入口，会把整轮挂住（现场 2026-11-27「Asked 1 question」）。
  const policies = [{ action: "tool.use", resource: "question", effect: "deny" }];
  return `${JSON.stringify({ $schema: "https://opencode.ai/config.json", permissions: rules, policies }, null, 2)}\n`;
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
    // 技能部署（owner 2026-11-27「skill 就该写一个真正的 skill」）：仓库里的
    // butler-skills/<id>/SKILL.md 原样拷贝到管家文件夹——技能是可独立编辑的
    // markdown 文件，不是代码拼装（此前正文硬编码在 TS 数组里，改一次踩一次转义坑）。
    const skillsSrc = join(import.meta.dir, "butler-skills");
    for (const id of readdirSync(skillsSrc)) {
      const skillDir = join(skillsSrc, id);
      if (!existsSync(join(skillDir, "SKILL.md"))) continue;
      cpSync(skillDir, join(dir, ".opencode", "skills", id), { recursive: true, force: true });
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

/** 流式过程中的非正文事件：模型的思考增量、工具调用的开始与结果（管家页分别画成
 *  「思考」与工具行；历史只存正文，这些是过程不是内容）。 */
export type ButlerStreamEvent =
  | { type: "reasoning"; delta: string }
  | { type: "tool"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; id: string | null; text: string };

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

/** What the butler needs from a brain provider: resuming its one session. The test injects a fake;
 *  the real one is created from `@plannotator/ai` (the opencode-sdk provider). */
export interface ButlerBrainProvider {
  resumeSession(id: string, systemPrompt: string): Promise<import("@plannotator/ai").AISession>;
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
  /** The event plane's pending digest (doc 管家-事件机制设计 §8.1): what happened since the
   *  butler last looked, put at the front of the next prompt. Absent in tests without events. */
  private readonly digests: (() => string) | null;
  /** A wake digest that could not be spoken now (no session yet, or a turn running): said on the next chat. */
  private readonly deferred: string[] = [];
  /** Queries running now: a wake never speaks over the owner's own turn. */
  private running = 0;
  /** 连续由事件唤起、中间没有主人说话的次数：防「动作→事件→唤醒→动作」自我循环。 */
  private wakeStreak = 0;
  /** Tests inject the brain provider instead of mocking `@plannotator/ai` process-wide (the mock
   *  leaked into every other test file in the same run). Absent: the real opencode-sdk provider. */
  private readonly provider: ButlerBrainProvider | null;

  constructor(options: { bootstrapBin?: string; model?: string; digests?: () => string; provider?: ButlerBrainProvider | null } = {}) {
    this.model = options.model ?? readOpencodeDefaultModel();
    this.bootstrapBin = options.bootstrapBin ?? (Bun.which("opencode") ?? "opencode");
    this.digests = options.digests ?? null;
    this.provider = options.provider ?? null;
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

  /**
   * 管家会话的终端入口：会话 id 与在终端打开它的命令（首次会先起好会话）。
   *
   * opencode 自己收目录（positional `directory`），所以不用 `cd … &&`：一条命令在
   * cmd、PowerShell、Git Bash、zsh 里原样可粘。引号按平台挑——cmd/PowerShell 不认
   * POSIX 单引号（现场事故 2026-11-26：`cd 'C:\…'` 在 Windows 报「文件名、目录名或
   * 卷标语法不正确」），Windows 一律双引号，其余平台保持单引号。
   */
  async session(): Promise<{ sessionId: string; dir: string; command: string }> {
    const brain = await this.brain();
    this.persistSessionId(brain.id);
    const quote = butlerShellQuote(process.platform);
    return {
      sessionId: brain.id,
      dir: this.dir,
      command: `opencode -s ${quote(brain.id)} ${quote(this.dir)}`,
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

  /**
   * 主人打断（owner 2026-11-27「没法打断管家的说话」）：中止当前正在流式的回合。
   * session.abort() 打到 opencode 服务端，正在生成的回复立刻停下；已流出的部分
   * 由 chatRoute 的 catch 保留进历史。没有在说话时调用是安全的空操作。
   */
  stopStreaming(): { ok: boolean; error?: string } {
    const session = this.brainSession;
    if (!session || !session.isActive) {
      butlerTraceOf(this.dir).append({ at: new Date().toISOString(), type: "action", summary: "主人打断：没有正在进行的回复", outcome: "no-op" });
      return { ok: false, error: "管家没有正在进行的回复。" };
    }
    session.abort();
    butlerTraceOf(this.dir).append({ at: new Date().toISOString(), type: "action", summary: "主人打断：中止当前回合", outcome: "ok" });
    return { ok: true };
  }

  /** 一条对话：先落 you 侧历史，opencode 回复后落 butler 侧并返回全文。 */
  async chat(message: string, files: ButlerStoredFile[] = []): Promise<string> {
    this.wakeStreak = 0;
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
    // 唤醒可能先于主人打开管家页（审批结果直接叫醒）：文件夹和人设先就绪，spawn 的 cwd 才在。
    ensureButlerDir();
    if (this.brainSession) return this.brainSession;
    // A test's provider stands in for the real one; otherwise the provider factory is registered
    // by the module import's side effect (ai-runtime 同款): import first, then create.
    const provider: ButlerBrainProvider = this.provider ?? (await (async () => {
      await import("@plannotator/ai/providers/opencode-sdk");
      return await createProvider({
        type: "opencode-sdk",
        cwd: this.dir,
        ...(this.bootstrapBin ? { opencodeExecutablePath: this.bootstrapBin } : {}),
      } as never);
    })());
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
    return await this.askButlerStream(message, () => {}, files);
  }

  /**
   * opencode 说这个会话 id 不存在（存储清理、重装、别的机器留下的 state.json）：
   * 是「会话没了」，不是「这轮答不了」——丢掉记录的 id 重建一次即可，别让它把管家焊死。
   * 现场事故 2026-11-26：Windows 上 state.json 留着一个 Mac/旧装留下的 id，每句话都 400。
   */
  private static staleSession(error: unknown): boolean {
    const text = error instanceof Error ? error.message : String(error);
    return /Invalid session ID|session .*does not exist|session not found|NotFoundError/i.test(text);
  }

  /** 忘掉记录的会话 id（下次 brain() 走 bootstrap 起新会话）。 */
  private forgetSession(): void {
    this.brainSession = null;
    try {
      writeFileSync(this.statePath, "{}\n", { mode: 0o600 });
    } catch {
      // 写不掉也没关系：进程内的 brainSession 已清空，这一次仍会重建。
    }
  }

  /**
   * The event plane's pending digest, once: what happened since the butler last looked is put
   * at the front of the next prompt (doc 管家-事件机制设计 §8.1). A wake that could not be
   * spoken (no session yet, a turn running) waits here too. Empty when there is nothing new.
   */
  private takeDigest(): string {
    const parts = this.deferred.splice(0);
    if (this.digests) {
      try {
        const fresh = this.digests();
        if (fresh) parts.push(fresh);
      } catch {
        // A projector failure never blocks a chat; the ledger still has the facts.
      }
    }
    return parts.join("\n");
  }

  /**
   * 事件唤醒：something needs the person, so the butler speaks first (the page shows it as
   * the butler's own line; there is no fake "you" bubble). A turn already running is never
   * spoken over.
   *
   * 没有会话时（守护进程刚重启、主人还没开口）：普通动态留到下一句对话再说；但**审批结果**
   * （butler.action.*）不同——主人刚刚在管家页点过按钮，正看着结果，这一步的后续动作
   * （比如提议开执行会话）就该由管家接着做。现场 2026-11-27：批准建卡后没有任何后续，
   * 因为重启后 brainSession 为空，唤醒被静静压后了。
   */
  async wake(digest: string, events: readonly { kind: string; id?: string }[] = []): Promise<void> {
    const text = digest.trim();
    if (!text) return;
    const trace = butlerTraceOf(this.dir);
    const cause = events.find((event) => typeof event.id === "string" && event.id)?.id;
    const ownerJustActed = events.some((event) => typeof event.kind === "string" && event.kind.startsWith("butler.action."));
    // 连续第三次由事件唤起（中间没人说话）就停下来：否则管家自己的动作产生事件、事件又唤醒它，
    // 能自己转一晚上（现场 2026-11-27 的 127 次工具调用就是这么起来的）。留到下一句对话。
    const runLooping = this.wakeStreak >= 3;
    if ((!this.brainSession && !ownerJustActed) || this.running > 0 || this.brainSession?.isActive || runLooping) {
      // 行为 trace（owner 2026-11-28「接收了某个事件后，后面触发了什么」）：延迟与静默
      // 正是要监控的决策瞬间——不说也得有据可查。
      const deferredBy = runLooping
        ? "连醒熔断：连续第三次由事件唤起，静默留到下一句对话"
        : this.running > 0 || this.brainSession?.isActive
          ? "上一轮还在说话，延迟到它说完"
          : "还没有会话，留到下一句对话";
      trace.append({ at: new Date().toISOString(), type: "wake", summary: traceBrief(text), cause, outcome: runLooping ? "suppressed" : "deferred", detail: deferredBy });
      this.deferred.push(text);
      return;
    }
    // 压队里的旧动态（主人已批但管家忙没说出的）随这次唤醒一并补上——不再等主人开口。
    const pendingText = this.deferred.splice(0).join('\n');
    const full = [pendingText, text].filter(Boolean).join('\n');
    this.running += 1;
    this.wakeStreak += 1;
    try {
      const reply = await this.askButlerStream(full, () => {}, [], false, cause);
      this.appendHistory({ at: new Date().toISOString(), role: "butler", text: reply });
      trace.append({ at: new Date().toISOString(), type: "wake", summary: traceBrief(text), cause, outcome: "spoken", ...(pendingText ? { detail: "随本次唤醒补上了此前延迟的动态" } : {}) });
    } catch (error) {
      // Could not speak now (the session went away, the model refused): say it with the next chat.
      this.deferred.push(text);
      trace.append({ at: new Date().toISOString(), type: "wake", summary: traceBrief(text), cause, outcome: "error", detail: error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200) });
    } finally {
      this.running -= 1;
    }
  }

  /** 流式一问：增量经 onDelta 出去，返回全文（历史照记）。`cause`：由哪笔事件引发（行为 trace 用）。 */
  private async askButlerStream(message: string, onDelta: (delta: string) => void, files: ButlerStoredFile[] = [], withDigest = true, cause?: string, onEvent?: (event: ButlerStreamEvent) => void): Promise<string> {
    // The digest is the event plane's "since you last looked", never the owner's own words.
    const digest = withDigest ? this.takeDigest() : "";
    const prompt = `${digest ? `${digest}\n\n` : ""}${message}${filesNoteOf(files)}`;
    this.running += 1;
    try {
      const reply = await this.askButlerRun(prompt, onDelta, files, onEvent);
      // 行为 trace：开口只记一句摘要（正文在 history.jsonl，这里是索引，不存两份）。
      butlerTraceOf(this.dir).append({ at: new Date().toISOString(), type: "turn", summary: traceBrief(reply || message), cause, outcome: "spoken" });
      return reply;
    } catch (error) {
      // The turn never happened: the digest goes back to the queue, so the next one still sees it
      // (a failed turn must not quietly eat a delivery the owner was waiting to hear about).
      if (digest) this.deferred.push(digest);
      throw error;
    } finally {
      this.running -= 1;
    }
  }

  private async askButlerRun(prompt: string, onDelta: (delta: string) => void, files: ButlerStoredFile[], onEvent?: (event: ButlerStreamEvent) => void): Promise<string> {
    const run = async (): Promise<string> => {
      const session = await this.brain();
      let reply = "";
      // 循环保险（现场 2026-11-27：模型退化，连发 127 次 `shell: echo .` 不停）。
      // 连续同一个工具+同一份输入 4 次，或一轮超过 60 次工具调用，就中止这一轮并说明。
      let lastSig = "";
      let sameCount = 0;
      let calls = 0;
      for await (const msg of session.query(prompt, butlerQueryFiles(files))) {
        if (msg.type === "text") {
          reply += msg.text;
          onDelta(msg.text);
        } else if (msg.type === "text_delta") {
          reply += msg.delta;
          onDelta(msg.delta);
        } else if (msg.type === "reasoning_delta") {
          // 思考不是回答：不进 reply，只作为过程事件给页面。
          onEvent?.({ type: "reasoning", delta: msg.delta });
        } else if (msg.type === "tool_use") {
          calls += 1;
          const signature = `${msg.toolName}:${JSON.stringify(msg.toolInput ?? {})}`;
          sameCount = signature === lastSig ? sameCount + 1 : 1;
          lastSig = signature;
          if (sameCount >= 4 || calls > 60) {
            try {
              session.abort();
            } catch {
              // 中止失败也要抛出：这一轮不能再跑下去。
            }
            butlerTraceOf(this.dir).append({ at: new Date().toISOString(), type: "fuse", summary: "工具循环熔断，本轮中止", detail: `同一工具连发 ${sameCount} 次 / 本轮共 ${calls} 次调用`, outcome: "error" });
            throw new Error("管家连续重复调用同一个工具，已中止这一轮。可以换个说法再试。");
          }
          onEvent?.({ type: "tool", id: msg.toolUseId, name: msg.toolName, input: msg.toolInput ?? {} });
        } else if (msg.type === "tool_result") {
          onEvent?.({ type: "tool_result", id: msg.toolUseId ?? null, text: msg.result });
        } else if (msg.type === "error") {
          throw new Error(msg.error ?? "管家这会儿没法回答。");
        }
      }
      const trimmed = reply.trim();
      if (!trimmed) throw new Error("the butler gave no answer");
      return trimmed;
    };
    try {
      return await run();
    } catch (error) {
      // 续接通过了、prompt 才被拒（会话在 resumed 之后被删）：自愈一次，不把错误抛给主人。
      if (!Butler.staleSession(error)) throw error;
      butlerTraceOf(this.dir).append({ at: new Date().toISOString(), type: "fuse", summary: "会话 id 失效，自愈重建", outcome: "ok" });
      this.forgetSession();
      return await run();
    }
  }

  /** 窗口专属（same-origin 才答）：管家路由。 */
  async route(req: Request, url: URL): Promise<Response | null> {
    const sameOrigin = req.headers.get("sec-fetch-site")?.trim().toLowerCase() === "same-origin";
    if (!sameOrigin) return null;
    if (url.pathname === "/api/inbox/butler/chat" && req.method === "POST") {
      return await this.chatRoute(req);
    }
    // 行为 trace（owner 2026-11-28「对管家本身的监控」）：事件入账、唤醒处置、开口、
    // 动作与结果、熔断自愈——一条因果可查的时间线。读时裁剪（14 天 / 2000 条）。
    if (url.pathname === "/api/inbox/butler/trace" && req.method === "GET") {
      return Response.json({ entries: butlerTraceOf(this.dir).read() });
    }
    if (url.pathname === "/api/inbox/butler/history" && req.method === "GET") {
      return Response.json({ history: this.history() });
    }
    // 打断（owner 2026-11-27「类似 interrupt 功能」）：中止正在流式的回复。
    if (url.pathname === "/api/inbox/butler/stop" && req.method === "POST") {
      return Response.json(this.stopStreaming());
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
    let received = "";
    const stream = new ReadableStream<Uint8Array>({
      start: async (controller) => {
        const send = (payload: Record<string, unknown>) =>
          controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(payload)}\n\n`));
        this.wakeStreak = 0;
        try {
          this.appendHistory({ at: new Date().toISOString(), role: "you", text: message, ...(files.length ? { files: files.map((file) => file.name) } : {}) });
          reply = await this.askButlerStream(
            message || `（主人发来了 ${files.length} 个附件）`,
            (delta) => {
              received += delta;
              send({ delta });
            },
            files,
            true,
            undefined,
            (event) => {
              if (event.type === "reasoning") send({ reasoning: event.delta });
              else if (event.type === "tool") send({ tool: { id: event.id, name: event.name, input: event.input } });
              else send({ tool_result: { id: event.id, text: event.text } });
            },
          );
          this.appendHistory({ at: new Date().toISOString(), role: "butler", text: reply });
          send({ done: true, reply });
        } catch (error) {
          const why = error instanceof Error ? error.message : String(error);
          // 主人主动打断（abort/interrupted）：已流出的部分算数——落历史、发 done 帧。
          if (/abort|interrupt/i.test(why)) {
            if (received.trim()) {
              this.appendHistory({ at: new Date().toISOString(), role: "butler", text: received.trim() });
              send({ done: true, reply: received.trim(), stopped: true });
            } else {
              send({ done: true, reply: "", stopped: true });
            }
          } else {
            send({ error: why });
          }
        }
        controller.close();
      },
    });
    return new Response(stream, {
      headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
    });
  }
}

