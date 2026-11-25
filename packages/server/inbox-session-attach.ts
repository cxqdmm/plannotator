/**
 * 工坊会话详情的「在终端打开」命令（owner 2026-11-25，工坊对话流回复报错线程）：
 * 按宿主给出可直接粘贴的命令——Claude Code 用 `claude --resume <完整id>`（transcript
 * 全局，任意目录可用）；opencode 的会话按目录归属，必须 `cd <会话目录>` 再
 * `opencode -s <id>`。已启动（launch）的会话沿用运行线的 attachOf 命令。
 */
import { shellQuote } from "./inbox-launch-claude";
import { openCodeAttachCommand } from "./inbox-launch-opencode";

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
