/**
 * 工坊会话详情的「在终端打开」命令（owner 2026-11-25，工坊对话流回复报错线程）：
 * 按宿主给出可直接粘贴的命令——Claude Code 用 `claude --resume <完整id>`（transcript
 * 全局，任意目录可用）；opencode 的会话按目录归属，必须 `cd <会话目录>` 再
 * `opencode -s <id>`。已启动（launch）的会话沿用运行线的 attachOf 命令。
 */
import { InboxError } from "@plannotator/shared/inbox/schema";
import type { InboxStore } from "@plannotator/shared/inbox/store";
import { shellQuote } from "./inbox-launch-claude";
import { openCodeAttachCommand } from "./inbox-launch-opencode";
import { openCodeSessionDirectory } from "./inbox-stream";

export interface SessionAttachInput {
	session: string;
	host: string | null;
	/** 会话自己的工作目录（opencode 的 v2 库/线程项目根），null 表示未知。 */
	folder: string | null;
	platform?: NodeJS.Platform;
	/** 已启动会话的运行线命令优先（launch.attachOf 的产物）。 */
	launchedCommand?: string | null;
}

export function sessionAttachCommand(input: SessionAttachInput): { command: string; dir: string | null } | null {
	if (input.launchedCommand) return { command: input.launchedCommand, dir: null };
	switch (input.host) {
		case "claude-code":
			// transcript 全局：任意目录 `claude --resume <uuid>` 都能续。
			return { command: `claude --resume ${shellQuote(input.session)}`, dir: null };
		case "opencode":
			if (!input.folder) return null;
			return {
				command: `cd ${shellQuote(input.folder)} && opencode -s ${shellQuote(input.session)}`,
				dir: input.folder,
			};
		default:
			return null;
	}
}

/** 会话详情工具栏「复制在终端打开」的路由（工坊，owner 2026-11-25）：`GET /api/inbox/threads/:id/terminal`。 */
export const INBOX_SESSION_TERMINAL_PATH = /^\/api\/inbox\/threads\/([A-Za-z0-9_]+)\/terminal$/;

/** 线程的「在终端打开」命令，或为何没有：thread＝线程/归属会话都不在；host＝宿主给不出命令；folder＝opencode 的目录不明。 */
export type SessionTerminal = { command: string; dir: string | null } | { none: "thread" | "host" | "folder" };

/** 线程的「在终端打开」命令（按会话现在的归属者，不是启动时的宿主；mod 的 `claude-code:` 前缀id 剥成裸 id）。 */
export function sessionTerminalOf(
	threadId: string,
	store: InboxStore,
	attachOf: (threadId: string) => string | null,
): SessionTerminal {
	const thread = store.thread(threadId);
	const owner = thread ? store.threadOwner(threadId) : null;
	if (!thread || !owner) return { none: "thread" };
	// 已启动会话的运行线命令优先（带它启动时的环境与绑定，工坊的手动会话没有它）。
	const launchedCommand = attachOf(threadId);
	if (launchedCommand) return sessionAttachCommand({ session: owner.session, host: owner.host, folder: thread.project.root, launchedCommand }) ?? { command: launchedCommand, dir: null };
	const session = owner.session.replace(/^claude-code:/, "");
	if (owner.host === "opencode") {
		// 目录：v2 库里会话自己的（可能搬过家），缺了落回线程的项目根。
		const folder = openCodeSessionDirectory(session) ?? (thread.project.root.trim() !== "" ? thread.project.root : null);
		return sessionAttachCommand({ session, host: owner.host, folder }) ?? { none: "folder" };
	}
	return sessionAttachCommand({ session, host: owner.host, folder: thread.project.root }) ?? { none: "host" };
}

export function createInboxSessionTerminalRoute(options: {
	store: InboxStore;
	attachOf: (threadId: string) => string | null;
	json: (body: unknown, status?: number) => Response;
}): { route: (req: Request, url: URL) => Promise<Response | null> } {
	// 同流路由的门：只答收件箱自己的窗口（sec-fetch-site 由浏览器盖，curl 没有它）。
	const fromWindow = (req: Request): boolean => req.headers.get("sec-fetch-site")?.trim().toLowerCase() === "same-origin";
	return {
		route: async (req, url) => {
			const match = INBOX_SESSION_TERMINAL_PATH.exec(url.pathname);
			if (!match) return null;
			if (req.method !== "GET") return options.json({ error: "Use GET.", code: "method" }, 405);
			if (!fromWindow(req)) throw new InboxError("window_only", "The terminal command answers only the Inbox window.");
			const resolved = sessionTerminalOf(match[1]!, options.store, options.attachOf);
			if ("none" in resolved) {
				const noSession = resolved.none === "thread" || resolved.none === "host";
				return options.json(
					{
						error: noSession ? "This thread has no session that opens in a terminal here." : "This opencode session's folder is unknown, so there is no command to open it.",
						code: noSession ? "no_session" : "no_folder",
					},
					404,
				);
			}
			return options.json({ command: resolved.command, dir: resolved.dir });
		},
	};
}
