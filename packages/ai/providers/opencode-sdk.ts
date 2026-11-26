/**
 * OpenCode provider — bridges Plannotator's AI layer with OpenCode's agent server.
 *
 * Uses @opencode-ai/sdk to spawn a dedicated `opencode serve` on an
 * OS-assigned port. One server is shared across all sessions of this process,
 * closed on dispose and on process exit. This provider deliberately never
 * attaches to a server it did not spawn: an attached server cannot be cleaned
 * up by us, and opencode's per-directory instances accumulate in it without
 * eviction, so a shared long-lived server grows without bound. The user must
 * have the `opencode` CLI installed and authenticated.
 */

import { randomBytes } from "node:crypto";
import type { OpencodeClient } from "@opencode-ai/sdk";
import { BaseSession } from "../base-session.ts";
import { buildSystemPrompt } from "../context.ts";
import { withAskAiChildEnv } from "./ask-ai-env.ts";
import type {
	AIMessage,
	AIProvider,
	AIProviderCapabilities,
	AIQueryOptions,
	AISession,
	CreateSessionOptions,
	OpenCodeConfig,
} from "../types.ts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PROVIDER_NAME = "opencode-sdk";

// ---------------------------------------------------------------------------
// SDK import cache — resolve once, reuse across all sessions
// ---------------------------------------------------------------------------

// biome-ignore lint/suspicious/noExplicitAny: SDK types not available at compile time
let sdk: any = null;

/** Whether a spawned server exposes OpenCode 2.3's `/api` root (with Basic auth). */
async function serverExposesApi(url: string, password: string): Promise<boolean> {
	try {
		const response = await fetch(`${url}/api/info`, {
			headers: { authorization: `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}` },
			signal: AbortSignal.timeout(2_000),
		});
		return response.ok;
	} catch {
		return false;
	}
}

async function getSDK() {
	if (!sdk) {
		sdk = await import("@opencode-ai/sdk");
	}
	return sdk;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export class OpenCodeProvider implements AIProvider {
	readonly name = PROVIDER_NAME;
	readonly capabilities: AIProviderCapabilities = {
		fork: true,
		resume: true,
		streaming: true,
		tools: true,
	};
	models?: Array<{ id: string; label: string; default?: boolean }>;

	private config: OpenCodeConfig;
	// biome-ignore lint/suspicious/noExplicitAny: SDK types not available at compile time
	private server: { url: string; close: () => void } | null = null;
	private client: OpencodeClient | null = null;
	/** OpenCode 2.3's API lives under `/api` and speaks HTTP Basic (`opencode:<server password>`). */
	private apiBase: string | null = null;
	private authHeader: string | null = null;
	private startPromise: Promise<void> | null = null;
	private exitHandler: (() => void) | null = null;
	/**
	 * Bumped by dispose() to invalidate an in-flight doStart: a spawn that
	 * completes after its epoch has passed reaps its own server instead of
	 * resurrecting a provider the runtime already considers disposed.
	 */
	private startEpoch = 0;

	constructor(config: OpenCodeConfig) {
		this.config = config;
	}

	/** Spawn this process's OpenCode server if it is not already running. */
	async ensureServer(): Promise<void> {
		if (this.client) return;
		this.startPromise ??= this.doStart().catch((err) => {
			this.startPromise = null;
			throw err;
		});
		return this.startPromise;
	}

	private async doStart(): Promise<void> {
		const epoch = this.startEpoch;
		const { createOpencodeServer, createOpencodeClient } = await getSDK();
		// port 0 asks opencode for an OS-assigned free port (the SDK reads the
		// real URL back from the child's "listening" line), so every Plannotator
		// process gets its own server instead of piling onto a shared default
		// port. An explicitly configured port is still honored verbatim.
		let server: { url: string; close: () => void };
		let serverPasswordRef = "";
		try {
			// Plannotator's integration off in this `opencode serve`
			// (ask-ai-env.ts): the Plannotator OpenCode plugin it loads reads
			// process.env and stands down. The SDK takes no env, so the switches
			// are set on process.env only for the synchronous part of the call,
			// where the SDK copies it into the spawn.
			// OpenCode 2.3 serves its real API under `/api` behind HTTP Basic auth
			// (`opencode:<server password>`). The password is generated per
			// `opencode serve`; pinning it through OPENCODE_SERVER_PASSWORD (copied
			// into the spawn) lets this provider authenticate without parsing the
			// child's stdout. Older hosts ignore the variable; their servers accept
			// unauthenticated calls, and the `/api` probe below falls back.
			const serverPassword = randomBytes(24).toString("base64url");
			const previousPassword = process.env.OPENCODE_SERVER_PASSWORD;
			process.env.OPENCODE_SERVER_PASSWORD = serverPassword;
			try {
				server = await withAskAiChildEnv(() =>
					createOpencodeServer({
						hostname: this.config.hostname ?? "127.0.0.1",
						port: this.config.port ?? 0,
						timeout: 15_000,
					}),
				);
			} finally {
				if (previousPassword === undefined) delete process.env.OPENCODE_SERVER_PASSWORD;
				else process.env.OPENCODE_SERVER_PASSWORD = previousPassword;
			}
			serverPasswordRef = serverPassword;
		} catch (err: unknown) {
			// A missing CLI is a spawn error with code ENOENT in every runtime
			// (Node: "spawn opencode ENOENT"; Bun: "Executable not found in
			// $PATH"; cross-spawn re-emits the Windows cmd.exe miss the same
			// way). Match the code only: the SDK's other failures embed the
			// child's stderr in the message, which can say "not found" for
			// reasons that have nothing to do with the binary.
			if ((err as NodeJS.ErrnoException | null)?.code === "ENOENT") {
				throw new Error(
					"OpenCode CLI (`opencode`) was not found on PATH. Install it (https://opencode.ai) or choose a different AI provider.",
					{ cause: err },
				);
			}
			throw err;
		}
		// A SIGINT/SIGTERM death is routed through process.exit() by the CLI, so
		// an "exit" handler is what keeps Ctrl-C from orphaning the spawned
		// `opencode serve` child (server.close() kills it synchronously). The
		// closure captures ITS server — never `this.server`, which a failed
		// retry could have replaced, leaving the first child unreachable by any
		// cleanup. No SIGHUP listener: that would override the ignored
		// disposition `nohup` depends on.
		const exitHandler = () => {
			try {
				server.close();
			} catch {
				// Best effort — the process is exiting either way.
			}
		};
		process.once("exit", exitHandler);

		const reap = () => {
			process.removeListener("exit", exitHandler);
			try {
				server.close();
			} catch {
				// Best effort — the child may already be gone.
			}
		};

		if (epoch !== this.startEpoch) {
			// dispose() ran while the spawn was in flight: the runtime no longer
			// wants this provider, so reap the just-spawned server instead of
			// resurrecting a disposed provider with a live child.
			reap();
			throw new Error("OpenCode provider was disposed during startup.");
		}

		try {
			// OpenCode 2.3: the API root is `/api` and every call carries Basic
			// auth. A server that does not expose `/api` falls back to the bare
			// root (older hosts), unauthenticated.
			const exposesApi = await serverExposesApi(server.url, serverPasswordRef);
			if (exposesApi) {
				this.apiBase = `${server.url}/api`;
				this.authHeader = `Basic ${Buffer.from(`opencode:${serverPasswordRef}`).toString("base64")}`;
			}
			this.client = createOpencodeClient({
				baseUrl: exposesApi ? `${server.url}/api` : server.url,
				...(exposesApi && this.authHeader ? { headers: { authorization: this.authHeader } } : {}),
				directory: this.config.cwd ?? process.cwd(),
			});
		} catch (err) {
			// A post-spawn failure must not leak the child: close it and drop the
			// handler so a retry starts from a clean slate.
			reap();
			throw err;
		}
		this.server = server;
		this.exitHandler = exitHandler;
	}

	/** The 2.3 API root + auth, or undefined on a legacy server (legacy prompt shape). */
	private api(): { baseUrl: string; auth: string } | undefined {
		if (!this.apiBase || !this.authHeader) return undefined;
		return { baseUrl: this.apiBase, auth: this.authHeader };
	}

	private getClient(): OpencodeClient {
		if (!this.client) {
			throw new Error("OpenCode client is not initialized.");
		}
		return this.client;
	}

	async createSession(options: CreateSessionOptions): Promise<AISession> {
		await this.ensureServer();
		const client = this.getClient();

		const result = await client.session.create({
			query: { directory: options.cwd ?? this.config.cwd ?? process.cwd() },
		});
		const sessionData = result.data;
		if (!sessionData) {
			throw new Error("OpenCode did not return session data.");
		}

		const session = new OpenCodeSession({
			sessionId: sessionData.id,
			systemPrompt: options.oneShot?.systemPrompt ?? buildSystemPrompt(options.context),
			client,
			model: options.model,
			parentSessionId: null,
			firstEventTimeoutMs: this.config.firstEventTimeoutMs,
			noTools: !!options.oneShot,
			api: this.api(),
		});
		return session;
	}

	async forkSession(options: CreateSessionOptions): Promise<AISession> {
		await this.ensureServer();
		const client = this.getClient();

		const parentId = options.context.parent?.sessionId;
		if (!parentId) {
			throw new Error("Fork requires a parent session ID.");
		}

		const result = await client.session.fork({
			path: { id: parentId },
		});
		const sessionData = result.data;
		if (!sessionData) {
			throw new Error("OpenCode did not return forked session data.");
		}

		return new OpenCodeSession({
			sessionId: sessionData.id,
			systemPrompt: buildSystemPrompt(options.context),
			client,
			model: options.model,
			parentSessionId: parentId,
			firstEventTimeoutMs: this.config.firstEventTimeoutMs,
			api: this.api(),
		});
	}

	async resumeSession(sessionId: string, systemPrompt?: string): Promise<AISession> {
		await this.ensureServer();
		const client = this.getClient();

		// Verify session exists — and really verify it: the SDK answers a miss in `error` instead of throwing
		// (as createSession reads its own answer), so an id whose session is gone must be refused HERE. A
		// handle resumed past a dead id looks fine and then refuses every prompt ("Invalid session ID"), and
		// the caller that would have started a fresh session never learns it should.
		const existing = await client.session.get({ path: { id: sessionId } });
		if (!existing.data) {
			throw new Error(`OpenCode session ${sessionId} does not exist${existing.error ? `: ${JSON.stringify(existing.error)}` : "."}`);
		}

		return new OpenCodeSession({
			sessionId,
			systemPrompt: systemPrompt ?? null,
			client,
			model: undefined,
			parentSessionId: null,
			firstEventTimeoutMs: this.config.firstEventTimeoutMs,
			api: this.api(),
		});
	}

	dispose(): void {
		// Invalidate any in-flight doStart so a spawn completing after this
		// point reaps itself instead of resurrecting the provider.
		this.startEpoch++;
		if (this.exitHandler) {
			process.removeListener("exit", this.exitHandler);
			this.exitHandler = null;
		}
		if (this.server) {
			this.server.close();
			this.server = null;
		}
		this.client = null;
		this.startPromise = null;
	}

	/** Fetch available models from OpenCode. Call before registering the provider. */
	async fetchModels(): Promise<void> {
		try {
			await this.ensureServer();
			const client = this.getClient();

			const result = await client.provider.list({
				query: { directory: this.config.cwd ?? process.cwd() },
			});
			const data = result.data;
			if (!data) {
				return;
			}
			const connected = new Set(data.connected ?? []);
			const allProviders = data.all ?? [];

			const models: Array<{ id: string; label: string; default?: boolean }> = [];
			for (const provider of allProviders) {
				if (!connected.has(provider.id)) continue;
				for (const model of Object.values(provider.models)) {
					models.push({
						id: `${provider.id}/${model.id}`,
						// include the provider name: different providers can expose
						// models with the same name (e.g. deepseek-v4-pro via
						// DeepSeek and via OpenRouter), which would otherwise be
						// indistinguishable in the dropdown
						label: `${model.name ?? model.id} (${provider.name})`,
					});
				}
			}

			if (models.length > 0) {
				// Mark first model as default
				models[0].default = true;
				this.models = models;
			}
		} catch {
			// OpenCode not configured or no models available
		}
	}
}

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

interface SessionConfig {
	sessionId: string;
	systemPrompt: string | null;
	// biome-ignore lint/suspicious/noExplicitAny: SDK types not available at compile time
	client: any;
	/** Model in "providerID/modelID" format. */
	model?: string;
	parentSessionId: string | null;
	/** How long to wait for the event stream's first frame before prompting. */
	firstEventTimeoutMs?: number;
	/** A single judgment (`CreateSessionOptions.oneShot`): every tool off for this prompt. */
	noTools?: boolean;
	/**
	 * OpenCode 2.3's API root (`…/api`) and its Basic auth header. Present: turns
	 * go in through `POST {apiBase}/session/{id}/prompt` (`{ text }`) instead of
	 * the SDK's legacy `/session/{id}/message` path. Absent: the legacy shape.
	 */
	api?: { baseUrl: string; auth: string };
}

class OpenCodeSession extends BaseSession {
	private config: SessionConfig;
	/** The persona/system prompt went out with the first turn (2.3 has no system field). */
	private _systemSent = false;

	constructor(config: SessionConfig) {
		super({
			parentSessionId: config.parentSessionId,
			initialId: config.sessionId,
		});
		this.config = config;
		this._resolvedId = config.sessionId;
	}

	/** OpenCode 2.3 has no per-turn `system` field: the persona rides the first turn. */
	private withSystemLine(prompt: string): string {
		if (this._systemSent || !this.config.systemPrompt) return prompt;
		this._systemSent = true;
		return `${this.config.systemPrompt}\n\n---\n\n${prompt}`;
	}

	async *query(prompt: string, options?: AIQueryOptions): AsyncIterable<AIMessage> {
		const started = this.startQuery();
		if (!started) {
			yield BaseSession.BUSY_ERROR;
			return;
		}
		const { gen, signal } = started;

		try {
			// Build model param if specified
			let modelParam: { providerID: string; modelID: string } | undefined;
			if (this.config.model) {
				const [providerID, ...rest] = this.config.model.split("/");
				const modelID = rest.join("/");
				if (providerID && modelID) {
					modelParam = { providerID, modelID };
				}
			}

			// Open the SSE stream and wait for the first frame *before* prompting.
			// OpenCode 1.18+ can finish a short turn before a late subscriber
			// connects; Ask AI then hangs until the browser reports Failed to fetch.
			// The subscription has its own controller (aborted with the query) so a
			// first frame that never comes can end it too: the SDK's stream retries
			// a failed connection forever, and an async generator's return() waits
			// behind a pending next().
			const subscription = new AbortController();
			const abortSubscription = () => subscription.abort();
			signal.addEventListener("abort", abortSubscription, { once: true });
			if (signal.aborted) subscription.abort();
			let iterator: AsyncIterator<{ type?: string; properties?: Record<string, unknown> }> | null = null;

			try {
				// The v1 client takes one options object; a signal in a second
				// argument is ignored and the connection is never closed.
				const { stream } = await this.config.client.event.subscribe({
					signal: subscription.signal,
				});
				const events: AsyncIterator<{ type?: string; properties?: Record<string, unknown> }> =
					stream[Symbol.asyncIterator]();
				iterator = events;
				// First frame only proves the subscriber is live. Do not treat it as
				// this turn — it can be server.connected or leftover idle from a
				// previous query on the same session.
				const first = await nextEventWithin(
					events,
					this.config.firstEventTimeoutMs ?? OPENCODE_FIRST_EVENT_TIMEOUT_MS,
					signal,
				);
				if (first === "aborted") {
					yield { type: "error", error: "OpenCode query aborted.", code: "provider_error" };
					return;
				}
				if (first === "timeout") {
					yield {
						type: "error",
						error: "OpenCode's event stream did not connect, so the question was not sent.",
						code: "provider_error",
					};
					return;
				}
				if (first.done) {
					yield {
						type: "error",
						error: "OpenCode event stream closed before the prompt was sent.",
						code: "provider_error",
					};
					return;
				}

				try {
					if (this.config.api) {
						// OpenCode 2.3: one text turn through the real endpoint.
						const response = await fetch(
							`${this.config.api.baseUrl}/session/${encodeURIComponent(this.config.sessionId)}/prompt`,
							{
								method: "POST",
								headers: {
									"content-type": "application/json",
									authorization: this.config.api.auth,
								},
								body: JSON.stringify({
									text: this.withSystemLine(prompt),
									...(modelParam ? { model: modelParam } : {}),
								}),
								signal,
							},
						);
						if (!response.ok) {
							const detail = await response.text().catch(() => "");
							throw new Error(`OpenCode prompt refused (${response.status})${detail ? `: ${detail.slice(0, 200)}` : ""}`);
						}
					} else {
						await this.config.client.session.promptAsync({
							path: { id: this.config.sessionId },
							body: {
								...(!this._firstQuerySent &&
									this.config.systemPrompt && {
										system: this.config.systemPrompt,
									}),
								...(modelParam && { model: modelParam }),
								// `variant`: the low effort of a model that has one; anything else ignores it.
								...(this.config.noTools && { tools: { "*": false }, variant: "low" }),
								parts: [
									{ type: "text", text: prompt },
									// 主人发来的文件（管家）：原生 file parts，data URL 直达——图片模型
									// 当场看得见；其余文件也在提示词里有落盘路径，会话可用工具再读。
									...(options?.files ?? []).map((file) => ({
										type: "file",
										mime: file.mime,
										filename: file.name,
										url: file.dataUrl,
									})),
								],
							},
						});
					}
				} catch (err) {
					yield {
						type: "error",
						error: `OpenCode rejected prompt: ${err instanceof Error ? err.message : String(err)}`,
						code: "opencode_prompt_rejected",
					};
					return;
				}
				this._firstQuerySent = true;

				const state = createOpenCodeQueryState();
				while (!signal.aborted) {
					// Stop ends this wait at once; the stream itself can take up to
					// its retry delay to notice the abort.
					const next = await nextEventWithin(events, null, signal);
					if (next === "aborted" || next === "timeout" || next.done) break;
					const { messages, done } = consumeOpenCodeEvent(
						next.value,
						this.config.sessionId,
						state,
					);
					for (const msg of messages) yield msg;
					if (done) return;
				}

				yield {
					type: "error",
					error: signal.aborted
						? "OpenCode query aborted."
						: "OpenCode event stream ended without a result.",
					code: "provider_error",
				};
			} finally {
				// Abort first: it ends a pending next(), which return() waits behind.
				signal.removeEventListener("abort", abortSubscription);
				subscription.abort();
				void Promise.resolve(iterator?.return?.()).catch(() => {});
			}
		} catch (err) {
			yield {
				type: "error",
				error: err instanceof Error ? err.message : String(err),
				code: "provider_error",
			};
		} finally {
			this.endQuery(gen);
		}
	}

	abort(): void {
		this.config.client.session
			.abort({ path: { id: this.config.sessionId } })
			.catch(() => {});
		super.abort();
	}

	respondToPermission(
		requestId: string,
		allow: boolean,
		_message?: string,
	): void {
		this.config.client
			.postSessionIdPermissionsPermissionId({
				path: { id: this.config.sessionId, permissionID: requestId },
				body: { response: allow ? "once" : "reject" },
			})
			.catch(() => {});
	}
}

// ---------------------------------------------------------------------------
// Event mapping
// ---------------------------------------------------------------------------

/** Returns true for events that should terminate the query when mapped to an error. */
function isTerminalEvent(eventType: string): boolean {
	return eventType === "session.error" || eventType === "session.status";
}

/** How long Ask AI waits for OpenCode's event stream to send its first frame. */
export const OPENCODE_FIRST_EVENT_TIMEOUT_MS = 10_000;

/**
 * The iterator's next result, or "timeout" / "aborted" when neither comes
 * first (`timeoutMs` null: no time limit). The caller ends the pending next()
 * itself (by aborting its stream).
 */
export async function nextEventWithin<T>(
	iterator: AsyncIterator<T>,
	timeoutMs: number | null,
	signal: AbortSignal,
): Promise<IteratorResult<T> | "timeout" | "aborted"> {
	if (signal.aborted) return "aborted";
	let timer: ReturnType<typeof setTimeout> | undefined;
	let onAbort: (() => void) | undefined;
	const stop = new Promise<"timeout" | "aborted">((resolve) => {
		if (timeoutMs !== null) timer = setTimeout(() => resolve("timeout"), timeoutMs);
		onAbort = () => resolve("aborted");
		signal.addEventListener("abort", onAbort, { once: true });
	});
	try {
		return await Promise.race([iterator.next(), stop]);
	} finally {
		clearTimeout(timer);
		if (onAbort) signal.removeEventListener("abort", onAbort);
	}
}

export function openCodeEventSessionId(
	props: Record<string, unknown>,
): string | undefined {
	return (
		(props.sessionID as string | undefined) ??
		((props.info as Record<string, unknown> | undefined)?.sessionID as
			| string
			| undefined) ??
		((props.part as Record<string, unknown> | undefined)?.sessionID as
			| string
			| undefined)
	);
}

/**
 * OpenCode 1.18 still emits `message.part.delta` for streaming text, but some
 * turns only land a final `message.part.updated` snapshot (or a late
 * subscriber misses the deltas). Capture assistant text parts so Ask AI can
 * still render an answer. User-prompt snapshots have no `time` stamp.
 */
export function assistantTextFromPartUpdate(
	part: Record<string, unknown> | undefined,
): string | undefined {
	if (!part || part.type !== "text") return undefined;
	if (part.time == null) return undefined;
	const text = part.text;
	return typeof text === "string" && text.length > 0 ? text : undefined;
}

export interface OpenCodeQueryState {
	sawTextDelta: boolean;
	lastAssistantText: string;
	/** Tool names by `session.tool.input.started`'s id: `session.tool.called` names the input, not the tool. */
	toolNames?: Map<string, string>;
}

export function createOpenCodeQueryState(): OpenCodeQueryState {
	return { sawTextDelta: false, lastAssistantText: "", toolNames: new Map() };
}

/**
 * If this turn never streamed `message.part.delta` text, emit the last
 * assistant snapshot so Ask AI still has something to render (#514 / #907).
 */
export function fallbackAssistantText(state: OpenCodeQueryState): AIMessage[] {
	if (state.sawTextDelta || !state.lastAssistantText) return [];
	return [{ type: "text_delta", delta: state.lastAssistantText }];
}

/**
 * Consume one OpenCode SSE event after promptAsync. Returns mapped Ask AI
 * messages and whether the query should stop. Pre-prompt leftover idle is
 * ignored by only calling this after the prompt is sent.
 */
export function consumeOpenCodeEvent(
	event: { type?: string; properties?: Record<string, unknown>; data?: Record<string, unknown> },
	sessionId: string,
	state: OpenCodeQueryState,
): { messages: AIMessage[]; done: boolean } {
	const eventType = event.type as string;
	// OpenCode 2.3 wraps the payload in `data` (older hosts: `properties`).
	const props = event.properties ?? event.data;
	if (props == null) return { messages: [], done: false };

	// OpenCode 2.3's event family (`session.text.delta`, `session.execution.*`).
	// Its names differ from the 1.18 shape the legacy map below handles.
	if (/^session\.(text|reasoning|step|tool|execution|usage|inbox|instructions|renamed)\.?/.test(eventType)) {
		const eventSessionId = typeof props.sessionID === "string" ? props.sessionID : null;
		if (eventSessionId && eventSessionId !== sessionId) return { messages: [], done: false };
		return mapOpenCodeV2Event(eventType, props, sessionId, state);
	}

	const eventSessionId = openCodeEventSessionId(props);
	if (eventSessionId && eventSessionId !== sessionId) {
		return { messages: [], done: false };
	}

	if (eventType === "message.part.updated") {
		const snapshot = assistantTextFromPartUpdate(
			props.part as Record<string, unknown> | undefined,
		);
		if (snapshot) state.lastAssistantText = snapshot;
	}

	const mapped = mapOpenCodeEvent(eventType, props, sessionId);
	const messages: AIMessage[] = [];
	let done = false;
	for (const msg of mapped) {
		if (msg.type === "text_delta") state.sawTextDelta = true;
		if (msg.type === "result") {
			messages.push(...fallbackAssistantText(state));
			done = true;
		}
		messages.push(msg);
		if (msg.type === "error" && isTerminalEvent(eventType)) done = true;
	}
	return { messages, done };
}

/**
 * Map an OpenCode SSE event to AIMessage[].
 *
 * Key events:
 *   message.part.delta  → text_delta (streaming text)
 *   message.part.updated → tool_use / tool_result (tool lifecycle)
 *   permission.updated   → permission_request
 *   session.status        → result (when idle)
 *   message.updated       → error (when message has error)
 */
/**
 * OpenCode 2.3's streaming events → Ask AI messages:
 *   session.text.delta          → text_delta
 *   session.execution.succeeded → result (the turn ended) / failed, interrupted likewise
 *   everything else (reasoning, steps, usage) is ignored.
 */
export function mapOpenCodeV2Event(
	eventType: string,
	props: Record<string, unknown>,
	sessionId: string,
	state?: OpenCodeQueryState,
): { messages: AIMessage[]; done: boolean } {
	switch (eventType) {
		case "session.text.delta": {
			const delta = props.delta;
			return typeof delta === "string" && delta
				? { messages: [{ type: "text_delta", delta }], done: false }
				: { messages: [], done: false };
		}
		// 模型在说话前想的事（管家页显示成可折叠的「思考」）。
		case "session.reasoning.delta": {
			const delta = props.delta;
			return typeof delta === "string" && delta
				? { messages: [{ type: "reasoning_delta", delta }], done: false }
				: { messages: [], done: false };
		}
		// 工具生命周期：input.started 只记名字（called 的 data 里没有工具名），
		// called 给输入，success/failed 给结果。
		case "session.tool.input.started": {
			const id = typeof props.id === "string" ? props.id : null;
			const name = typeof props.name === "string" ? props.name : null;
			if (id && name) state?.toolNames?.set(id, name);
			return { messages: [], done: false };
		}
		case "session.tool.called": {
			const id = typeof props.id === "string" ? props.id : null;
			if (!id) return { messages: [], done: false };
			const input = props.input && typeof props.input === "object" && !Array.isArray(props.input)
				? (props.input as Record<string, unknown>)
				: {};
			return { messages: [{ type: "tool_use", toolName: state?.toolNames?.get(id) ?? "tool", toolInput: input, toolUseId: id }], done: false };
		}
		case "session.tool.success": {
			const id = typeof props.id === "string" ? props.id : null;
			const content = Array.isArray(props.content) ? props.content : [];
			const text = content
				.map((part) => (part && typeof part === "object" && (part as { type?: unknown }).type === "text" ? String((part as { text?: unknown }).text ?? "") : ""))
				.join("\n")
				.trim();
			return { messages: [{ type: "tool_result", ...(id ? { toolUseId: id } : {}), result: text }], done: false };
		}
		case "session.tool.failed": {
			const id = typeof props.id === "string" ? props.id : null;
			const error = props.error && typeof props.error === "object" ? (props.error as { message?: unknown }).message : null;
			return { messages: [{ type: "tool_result", ...(id ? { toolUseId: id } : {}), result: typeof error === "string" && error ? error : "工具调用失败。" }], done: false };
		}
		case "session.execution.succeeded":
			return { messages: [{ type: "result", sessionId, success: true }], done: true };
		case "session.execution.failed":
		case "session.execution.interrupted":
			return {
				messages: [{ type: "error", error: "OpenCode's turn ended before an answer (interrupted or failed).", code: "provider_error" }],
				done: true,
			};
		default:
			return { messages: [], done: false };
	}
}

export function mapOpenCodeEvent(
	eventType: string,
	props: Record<string, unknown>,
	sessionId: string,
): AIMessage[] {
	switch (eventType) {
		case "message.part.delta": {
			const field = props.field as string;
			const delta = props.delta as string;
			// Reasoning/thinking deltas share this event; Ask AI only renders
			// assistant answer text.
			if (field === "text" && delta) {
				return [{ type: "text_delta", delta }];
			}
			return [];
		}

		case "message.part.updated": {
			const part = props.part as Record<string, unknown>;
			if (!part) return [];

			const partType = part.type as string;

			if (partType === "tool") {
				const state = part.state as Record<string, unknown>;
				if (!state) return [];

				const status = state.status as string;
				const callID = (part.callID as string) ?? (part.id as string);
				const toolName = part.tool as string;

				switch (status) {
					case "running":
						return [
							{
								type: "tool_use",
								toolName: toolName ?? "unknown",
								toolInput: (state.input as Record<string, unknown>) ?? {},
								toolUseId: callID,
							},
						];

					case "completed": {
						const output = (state.output as string) ?? "";
						return [
							{
								type: "tool_result",
								toolUseId: callID,
								result: output,
							},
						];
					}

					case "error": {
						const error = (state.error as string) ?? "Tool execution failed";
						return [
							{
								type: "tool_result",
								toolUseId: callID,
								result: `[Error] ${error}`,
							},
						];
					}

					default:
						return [];
				}
			}

			return [];
		}

		case "permission.updated": {
			const id = props.id as string;
			const permType = props.type as string;
			const title = props.title as string;
			const callID = props.callID as string;
			const metadata = (props.metadata as Record<string, unknown>) ?? {};

			return [
				{
					type: "permission_request",
					requestId: id,
					toolName: permType ?? "unknown",
					toolInput: metadata,
					title: title ?? permType,
					toolUseId: callID ?? id,
				},
			];
		}

		case "session.status": {
			const status = props.status as Record<string, unknown>;
			if (status?.type === "idle") {
				return [
					{
						type: "result",
						sessionId,
						success: true,
					},
				];
			}
			return [];
		}

		case "session.error": {
			const error = props.error as Record<string, unknown>;
			const message =
				(error?.message as string) ?? (props.message as string) ?? "Session error";
			return [
				{
					type: "error",
					error: message,
					code: "opencode_session_error",
				},
			];
		}

		case "message.updated": {
			const info = props.info as Record<string, unknown>;
			if (!info) return [];

			const msgError = info.error as Record<string, unknown>;
			if (msgError) {
				const errorData = msgError.data as Record<string, unknown>;
				const message =
					(errorData?.message as string) ??
					(msgError.name as string) ??
					"Message error";
				return [
					{
						type: "error",
						error: message,
						code: "opencode_message_error",
					},
				];
			}
			return [];
		}

		default:
			return [];
	}
}

// ---------------------------------------------------------------------------
// Factory registration
// ---------------------------------------------------------------------------

import { registerProviderFactory } from "../provider.ts";

registerProviderFactory(
	PROVIDER_NAME,
	async (config) => new OpenCodeProvider(config as OpenCodeConfig),
);
