/**
 * 局域网门（方案 B）：把一个跑在本机回环上的评审会话，通过一个带随机令牌
 * 的二次监听暴露给内网同事——他们浏览器直接打开 `http://<内网IP>:<端口>/t/<令牌>`
 * 即可看到同一个会话页面；批注在各自浏览器里做，只读（写接口一律 403），
 * 拍板（批准/否决/发反馈）留在主人手里。
 *
 * 为什么是第二个监听而不是改绑定：会话服务启动时绑了回环，进程内再起一个
 * Bun.serve 绑 0.0.0.0 即可，主人自己的会话路径一字不动；门用 Cookie 验令牌，
 * 页面的相对路径 API（/api/plan 等）经门原样转发，无需改写。
 */

import { networkInterfaces } from "node:os";

export interface LanDoorState {
  on: boolean;
  /** 同事打开的完整入口（含令牌路径）。 */
  url: string | null;
}

const COOKIE = "plannotator-lan";

/** 内网 IPv4（第一个非内部地址）；没有就退回主机名。 */
function lanAddress(): string {
  for (const list of Object.values(networkInterfaces())) {
    for (const net of list ?? []) {
      if (net.family === "IPv4" && !net.internal) return net.address;
    }
  }
  return "127.0.0.1";
}

export function createLanDoor(options: { forward: (req: Request) => Promise<Response> | Response }) {
  const doorRequests = new WeakSet<Request>();
  let server: ReturnType<typeof Bun.serve> | null = null;
  let token: string | null = null;

  const state = (): LanDoorState => (server && token ? { on: true, url: `http://${lanAddress()}:${server.port}/t/${token}` } : { on: false, url: null });

  const stop = () => {
    server?.stop(true);
    server = null;
    token = null;
  };

  const start = (): LanDoorState => {
    if (server) return state();
    token = crypto.randomUUID().replace(/-/g, "");
    server = Bun.serve({
      port: 0,
      hostname: "0.0.0.0",
      async fetch(req): Promise<Response> {
        const url = new URL(req.url);
        const path = url.pathname;
        // 入口：验令牌、种 Cookie、回页面。
        if (path === `/t/${token}` && req.method === "GET") {
          const page = await options.forward(new Request("http://lan/", { headers: req.headers }));
          const headers = new Headers(page.headers);
          headers.append("Set-Cookie", `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`);
          headers.set("Cache-Control", "no-store");
          return new Response(page.body, { status: page.status, headers });
        }
        const cookie = req.headers.get("cookie") ?? "";
        if (!cookie.includes(`${COOKIE}=${token}`)) {
          return new Response("这个评审链接需要从完整入口打开（含 /t/ 令牌路径）。", { status: 403, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
        }
        doorRequests.add(req);
        // 同事只读：写接口不进主处理器（由调用方的 guard 拒绝也行，这里先挡在门口）。
        if (path.startsWith("/api/") && req.method !== "GET" && req.method !== "HEAD") {
          return Response.json({ error: "同事视图是只读的：可以看和批注（批注在你的浏览器里），决定与反馈由评审主人做出。", code: "lan_readonly" }, { status: 403, headers: { "Cache-Control": "no-store" } });
        }
        return options.forward(req);
      },
    });
    return state();
  };

  return {
    start,
    stop,
    state,
    /** 这条请求是不是从门进来的（主处理器可据此收紧）。 */
    isDoorRequest: (req: Request) => doorRequests.has(req),
    get port(): number | null {
      return server?.port ?? null;
    },
  };
}
