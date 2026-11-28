/**
 * Spawns this process's own `opencode serve` — the OpenCode SDK's
 * `createOpencodeServer` minus the visible console window on Windows.
 *
 * The SDK's factory launches `opencode` through cross-spawn with no
 * `windowsHide`, so a headless host (the Inbox daemon has no console) gets a
 * fresh console window for `bin\opencode.exe` on every server start — a
 * terminal pops up over the person's desktop each time the butler session
 * starts. This module spawns with `windowsHide: true` and otherwise mirrors
 * the SDK's behavior: OS-assigned port (port 0) read back from the child's
 * "listening" stdout line, a startup timeout, and a close() that kills the
 * whole process tree on Windows (`taskkill /T /F`, as the SDK's stop() does).
 *
 * Like the SDK factory, it copies `process.env` synchronously inside the call
 * (before the first await) — `withAskAiChildEnv` relies on that to hand the
 * child a live env with Plannotator's integration switched off.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { buildWindowsCommandScriptSpawnCommand, killWindowsProcessTree } from "./command-path.ts";

export interface OpencodeServerSpawnOptions {
	hostname?: string;
	port?: number;
	timeout?: number;
}

export interface OpencodeServerHandle {
	url: string;
	close: () => void;
}

/**
 * Where `opencode` lives. On Windows the runtimes' bare-name PATH search only
 * finds `.exe`s (#2372), so search PATH × PATHEXT here; a `.cmd`/`.bat` hit
 * goes through cmd.exe at the spawn (below). Not found: the bare name — the
 * runtime's own PATH search still covers the plain `.exe` install.
 */
function resolveOpencodeCommand(): string {
	const name = "opencode";
	if (process.platform !== "win32") return name;
	const extensions = (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean);
	for (const dir of (process.env.PATH ?? "").split(";")) {
		const clean = dir.trim();
		if (!clean) continue;
		for (const ext of extensions) {
			const candidate = join(clean, `${name}${ext.toLowerCase()}`);
			if (existsSync(candidate)) return candidate;
		}
	}
	return name;
}

export async function spawnOpencodeServer(options: OpencodeServerSpawnOptions = {}): Promise<OpencodeServerHandle> {
	const hostname = options.hostname ?? "127.0.0.1";
	const port = options.port ?? 4096;
	const timeout = options.timeout ?? 5000;
	const commandPath = resolveOpencodeCommand();
	const args = [`serve`, `--hostname=${hostname}`, `--port=${port}`];
	const command = buildWindowsCommandScriptSpawnCommand(commandPath, args) ?? [commandPath, ...args];

	let proc: ChildProcess;
	try {
		proc = spawn(command[0]!, command.slice(1), {
			// Sync env copy (withAskAiChildEnv's contract); an empty config overlay,
			// as the SDK factory passes.
			env: { ...process.env, OPENCODE_CONFIG_CONTENT: "{}" },
			stdio: ["ignore", "pipe", "pipe"],
			// The whole point of this module: no console window on Windows.
			windowsHide: true,
		});
	} catch (err) {
		// spawn() throws synchronously on bad arguments; a missing binary
		// arrives as an async "error" event below instead.
		throw err instanceof Error ? err : new Error(String(err));
	}

	const stop = () => {
		if (proc.exitCode !== null || proc.signalCode !== null) return;
		// taskkill /T /F on Windows (the SDK's stop() does the same), plain
		// kill elsewhere or when the tree kill is refused.
		if (!killWindowsProcessTree(proc.pid)) proc.kill();
	};

	const url = await new Promise<string>((resolve, reject) => {
		const timer = setTimeout(() => {
			stop();
			reject(new Error(`Timeout waiting for server to start after ${timeout}ms`));
		}, timeout);
		let output = "";
		let resolved = false;
		proc.stdout?.on("data", (chunk) => {
			if (resolved) return;
			output += chunk.toString();
			const lines = output.split("\n");
			for (const line of lines) {
				if (line.startsWith("opencode server listening") || line.startsWith("server listening")) {
					const match = line.match(/on\s+(https?:\/\/[^\s]+)/);
					if (!match) {
						stop();
						clearTimeout(timer);
						reject(new Error(`Failed to parse server url from output: ${line}`));
						return;
					}
					clearTimeout(timer);
					resolved = true;
					resolve(match[1]!);
					return;
				}
			}
		});
		proc.stderr?.on("data", (chunk) => {
			if (!resolved) output += chunk.toString();
		});
		// Attached for the child's whole life: after resolve() a late event only
		// settles an already-settled promise (no-op), and without these listeners
		// an unexpected "exit"/"error" would be an uncaughtException in the host.
		proc.on("exit", (code) => {
			clearTimeout(timer);
			if (resolved) return;
			let msg = `Server exited with code ${code}`;
			if (output.trim()) msg += `\nServer output: ${output}`;
			reject(new Error(msg));
		});
		proc.on("error", (error) => {
			clearTimeout(timer);
			reject(error);
		});
	});
	return {
		url,
		close: stop,
	};
}
