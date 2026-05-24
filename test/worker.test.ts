import {
  env,
  createExecutionContext,
  waitOnExecutionContext,
} from "cloudflare:test";
import { describe, expect, it, beforeEach } from "vitest";
import worker from "../src/index";

describe("proxy-api-checker worker", () => {
  beforeEach(async () => {
    const list = await env.CACHE.list();
    await Promise.all(list.keys.map((k) => env.CACHE.delete(k.name)));
  });

  it("returns IP check JSON and caches per IP", async () => {
    const ctx = createExecutionContext();
    const req = new Request("https://xy.snowx.dev/?t=1000", {
      headers: { "CF-Connecting-IP": "203.0.113.50" },
    });

    const res1 = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res1.status).toBe(200);
    expect(res1.headers.get("X-Cache")).toBe("MISS");

    const body1 = (await res1.json()) as {
      ip: string;
      cached: boolean;
      timing?: { client_ms: number };
    };
    expect(body1.ip).toBe("203.0.113.50");
    expect(body1.cached).toBe(false);
    expect(body1.timing?.client_ms).toBe(1000);

    const ctx2 = createExecutionContext();
    const res2 = await worker.fetch(req, env, ctx2);
    await waitOnExecutionContext(ctx2);
    expect(res2.headers.get("X-Cache")).toBe("HIT");
    const body2 = (await res2.json()) as { cached: boolean; timing?: unknown };
    expect(body2.cached).toBe(true);
    expect(body2.timing?.client_ms).toBe(1000);
  });

  it("omits timing when client timestamp is absent", async () => {
    const ctx = createExecutionContext();
    const req = new Request("https://xy.snowx.dev/", {
      headers: { "CF-Connecting-IP": "203.0.113.51" },
    });

    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);

    const body = (await res.json()) as { timing?: unknown };
    expect(body).not.toHaveProperty("timing");
  });

  it("rate limits uncached IP within one minute", async () => {
    const ip = "203.0.113.99";
    await env.CACHE.put(`rl:${ip}`, String(Date.now()), { expirationTtl: 120 });

    const ctx = createExecutionContext();
    const req = new Request("https://xy.snowx.dev/", {
      headers: { "CF-Connecting-IP": ip },
    });
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(429);
  });
});
