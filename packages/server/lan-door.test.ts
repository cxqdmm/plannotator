import { describe, expect, test } from "bun:test";
import { createLanDoor, forwardToSession } from "./lan-door";

/** 起一个假主服务（回环），门转发到它。 */
async function withMain(serve: (req: Request, path: string) => Response | Promise<Response>, run: (mainPort: number) => Promise<void>) {
  const main = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: (req) => serve(req, new URL(req.url).pathname) });
  try {
    await run(main.port);
  } finally {
    main.stop(true);
  }
}

describe("lan-door", () => {
  test("入口种 Cookie 并回页面；带 Cookie 的 GET 放行；写接口 403；无令牌 403", async () => {
    await withMain(
      (req, path) => (path === "/api/plan" ? Response.json({ plan: "# hi" }) : new Response("<html>page</html>", { headers: { "Content-Type": "text/html" } })),
      async (mainPort) => {
        const door = createLanDoor({ forward: (r) => fetch(new Request(`http://127.0.0.1:${mainPort}${new URL(r.url).pathname}`, r)) });
        const state = door.start();
        expect(state.on).toBe(true);
        expect(state.url).toMatch(new RegExp(`^http://.+:\\d+/t/[0-9a-f]{32}$`));

        // 1) 入口：带 Set-Cookie，回的是主服务的页面
        const entry = await fetch(state.url!, { redirect: "manual" });
        expect(entry.status).toBe(200);
        expect(await entry.text()).toContain("page");
        const cookie = entry.headers.get("set-cookie")?.split(";")[0] ?? "";
        expect(cookie).toContain("plannotator-lan=");

        // 2) 带 Cookie 的 GET API 放行
        const read = await fetch(`http://127.0.0.1:${door.port}/api/plan`, { headers: { cookie } });
        expect(read.status).toBe(200);
        expect(await read.json()).toEqual({ plan: "# hi" });

        // 3) 写接口在门口挡下（同事只读）
        const write = await fetch(`http://127.0.0.1:${door.port}/api/approve`, { method: "POST", headers: { cookie, "Content-Type": "application/json" }, body: "{}" });
        expect(write.status).toBe(403);
        expect(((await write.json()) as { code?: string }).code).toBe("lan_readonly");

        // 4) 没有令牌 Cookie 一律 403
        const noCookie = await fetch(`http://127.0.0.1:${door.port}/api/plan`);
        expect(noCookie.status).toBe(403);

        // 5) 门自答 lan-view 标记：页面探路用，带不带 Cookie 都答（只说明"这是门"，不漏数据）
        const view = await fetch(`http://127.0.0.1:${door.port}/api/lan-view`);
        expect(view.status).toBe(200);
        expect(await view.json()).toEqual({ lan: true });
        const viewNoCookie = await fetch(`http://127.0.0.1:${door.port}/api/lan-view`);
        expect(viewNoCookie.status).toBe(200);

        // 6) 关门后端口不再服务
        door.stop();
        expect(door.state()).toEqual({ on: false, url: null });
        await expect(fetch(`http://127.0.0.1:${door.port}/api/plan`, { headers: { cookie } })).rejects.toThrow();
      },
    );
  });

  test("转发以主服务自己的回环主机名发：上游看到 Host 127.0.0.1:<port>，同事原主机名在 X-Forwarded-Host", async () => {
    await withMain(
      (req) => Response.json({ host: req.headers.get("host"), xfh: req.headers.get("x-forwarded-host") }),
      async (mainPort) => {
        // 同事浏览器带进来的 Host 是内网 IP + 门端口——原样转发会被主服务的主机名准入 403。
        const seen = await forwardToSession(new Request("http://192.168.1.11:59999/assets/index-abc.js", { headers: { host: "192.168.1.11:59999" } }), mainPort);
        expect(seen.status).toBe(200);
        const echoed = (await seen.json()) as { host: string | null; xfh: string | null };
        expect(echoed.host).toBe(`127.0.0.1:${mainPort}`);
        expect(echoed.xfh).toBe("192.168.1.11:59999");
      },
    );
  });
});
