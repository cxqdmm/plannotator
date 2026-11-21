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

/** 内网 IPv4：优先物理网卡（以太网/WLAN），跳过虚拟网卡（WSL 的 vEthernet、
 *  Default Switch 等）——不然广告出去的链接是个谁也到不了的虚拟地址。 */
function lanAddress(): string {
  const physical = /^(eth|en\d|wlan|wi-?fi|以太网|本地连接)/i;
  const virtual = /(vethernet|wsl|virtual|hyper-?v|docker|vbox|vmware|loopback|tailscale|utun|tailscale)/i;
  const found: { address: string; rank: number }[] = [];
  for (const [name, list] of Object.entries(networkInterfaces())) {
    for (const net of list ?? []) {
      if (net.family !== "IPv4" || net.internal) continue;
      const rank = physical.test(name) ? 2 : virtual.test(name) ? 0 : 1;
      found.push({ address: net.address, rank });
    }
  }
  found.sort((a, b) => b.rank - a.rank);
  return found[0]?.address ?? "127.0.0.1";
}

/**
 * 门 → 主服务的转发：以主服务自己的回环主机名发（Host: 127.0.0.1:<port>），同事的
 * 原始主机名保进 X-Forwarded-Host。会话有主机名准入（request-host.ts：只认回环和
 * PLANNOTATOR_ALLOWED_HOSTS），把同事浏览器带进来的 Host（192.168.x.x:门端口）原样
 * 转过去会被主服务 403 拒掉——页面壳能进（入口分支另造请求），子资源 /assets/* 全挂。
 * 三个服务面（index/annotate/review）共用这一个转发。
 */
export function forwardToSession(req: Request, port: number | undefined): Promise<Response> {
  // 主服务还没绑上端口（理论到不了：路由活着就意味着已绑定）——诚实回 503 而不是转发到废地址。
  if (port === undefined) return Promise.resolve(new Response("会话端口还没就绪，稍后再试。", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } }));
  const from = new URL(req.url);
  const headers = new Headers(req.headers);
  headers.set("x-forwarded-host", from.host);
  headers.set("host", `127.0.0.1:${port}`);
  return fetch(new Request(`http://127.0.0.1:${port}${from.pathname}${from.search}`, {
    method: req.method,
    headers,
    body: req.body,
    ...(req.body ? { duplex: "half" as const } : {}),
  }));
}

export function createLanDoor(options: { forward: (req: Request) => Promise<Response> | Response }) {
  const doorRequests = new WeakSet<Request>();
  let server: ReturnType<typeof Bun.serve> | null = null;
  let token: string | null = null;
  /**
   * 门内批注交回（随链接保存）：同事页把自己批注快照的压缩串（#hash，同评审件
   * 「导出意见」那套 buildSharePayload+compress）自动 POST 进来；主任在自己页面
   * 「导入评审」粘门链接，GET 拉走全部串（去重存，多份快照合并取并集，谁也不覆盖谁）。
   * 只存内存：门的生死跟会话一致，链接失效数据自然作废。
   */
  const feedbackHashes: string[] = [];
  const MAX_FEEDBACK = 50;
  const MAX_HASH_CHARS = 2_000_000;

  const state = (): LanDoorState => (server && token ? { on: true, url: `http://${lanAddress()}:${server.port}/t/${token}` } : { on: false, url: null });

  const stop = () => {
    server?.stop(true);
    server = null;
    token = null;
    feedbackHashes.length = 0;
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
        // 页面探路：门自己答（不转发）。同事视图的页面据此收起拍板按钮、亮只读徽标；
        // 主任自己的页面不走门 → 会话没有这个路径 → 404 → 页面知道自己不是门内视图。
        if (path === "/api/lan-view" && req.method === "GET") {
          return Response.json({ lan: true }, { headers: { "Cache-Control": "no-store" } });
        }
        // 主任「导入评审」拉批注：跨源（主任页面在 localhost 会话源上），带 token 免 Cookie，
        // CORS 放行读取。这是门上唯一免 Cookie 的读，串里只有批注内容、令牌本身就是凭据。
        if (path === "/api/lan-feedback" && req.method === "GET" && url.searchParams.get("token") === token) {
          return Response.json({ items: feedbackHashes }, { headers: { "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" } });
        }
        // 入口：验令牌、种 Cookie、回页面。主服务可能把 / 重定向到带会话令牌的
        // 路径（annotate 的 /s/<token>），重定向不能出本门——这里手动跟到最终页面。
        if (path === `/t/${token}` && req.method === "GET") {
          const cookie = `${COOKIE}=${token}`;
          const headers = { cookie: [req.headers.get("cookie"), cookie].filter(Boolean).join("; ") };
          let target = "/";
          for (let hop = 0; hop < 6; hop += 1) {
            const page = await options.forward(new Request(`http://lan${target}`, { headers }));
            const location = page.headers.get("location");
            if (page.status >= 300 && page.status < 400 && location) {
              const next = new URL(location, "http://lan");
              target = `${next.pathname}${next.search}`;
              continue;
            }
            const out = new Headers(page.headers);
            out.append("Set-Cookie", `${cookie}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`);
            out.set("Cache-Control", "no-store");
            return new Response(page.body, { status: page.status, headers: out });
          }
          return new Response("评审入口重定向过多。", { status: 502, headers: { "Content-Type": "text/plain; charset=utf-8" } });
        }
        const cookie = req.headers.get("cookie") ?? "";
        if (!cookie.includes(`${COOKIE}=${token}`)) {
          return new Response("这个评审链接需要从完整入口打开（含 /t/ 令牌路径）。", { status: 403, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
        }
        doorRequests.add(req);
        // 同事批注交回：门上唯一放行的写（验过 Cookie 的门内访客），存快照串、去重、限量。
        if (path === "/api/lan-feedback" && req.method === "POST") {
          const body = await req.json().catch(() => null) as { hash?: unknown } | null;
          const hash = typeof body?.hash === "string" ? body.hash : null;
          if (!hash || hash.length > MAX_HASH_CHARS) return Response.json({ error: "批注快照无效或过大。", code: "lan_feedback_invalid" }, { status: 400, headers: { "Cache-Control": "no-store" } });
          if (!feedbackHashes.includes(hash) && feedbackHashes.length < MAX_FEEDBACK) feedbackHashes.push(hash);
          return Response.json({ ok: true, count: feedbackHashes.length }, { headers: { "Cache-Control": "no-store" } });
        }
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
