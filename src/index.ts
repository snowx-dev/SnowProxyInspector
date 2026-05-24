import { isAuthorized } from "./auth";
import { buildReputation, toReputationResponse } from "./reputation";
import { buildCachedPayload, buildCheckResponse, buildFreshCheckResponse } from "./response";
import {
  cacheKey,
  rateLimitKey,
  shouldRateLimit,
} from "./rate-limit";
import { computeTiming, parseClientTimestamp } from "./timestamp";
import type { IncomingRequestCfProperties } from "@cloudflare/workers-types";
import type { CachedCheckPayload, Env, TimingInfo } from "./types";

function cacheTtlSeconds(env: Env): number {
  const n = Number(env.CACHE_TTL_SECONDS ?? "604800");
  return Number.isFinite(n) && n > 0 ? n : 604800;
}

function json(
  body: unknown,
  init: ResponseInit & { cache?: "HIT" | "MISS" } = {},
): Response {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  if (init.cache) headers.set("X-Cache", init.cache);
  return new Response(JSON.stringify(body), { ...init, headers });
}

function buildTiming(nowMs: number, clientMs: number | null): TimingInfo | null {
  if (clientMs == null) return null;

  const partial = computeTiming(nowMs, clientMs);
  return {
    server_ms: nowMs,
    client_ms: partial.client_ms!,
    client_latency_ms: partial.client_latency_ms,
    note: partial.note,
  };
}

async function readCachedAnswer(
  env: Env,
  ip: string,
): Promise<CachedCheckPayload | null> {
  const raw = await env.CACHE.get(cacheKey(ip));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as CachedCheckPayload;
  } catch {
    return null;
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return json({ error: "method_not_allowed" }, { status: 405 });
    }

    if (!isAuthorized(request, env)) {
      return json({ error: "unauthorized" }, { status: 401 });
    }

    const ip = request.headers.get("CF-Connecting-IP");
    if (!ip) {
      return json({ error: "missing_client_ip" }, { status: 502 });
    }

    const url = new URL(request.url);
    const clientMs = parseClientTimestamp(url, request.headers);
    const nowMs = Date.now();
    const timing = buildTiming(nowMs, clientMs);

    const cached = await readCachedAnswer(env, ip);
    if (cached) {
      if (request.method === "HEAD") {
        return new Response(null, {
          status: 200,
          headers: {
            "X-Cache": "HIT",
            "Cache-Control": "no-store",
          },
        });
      }
      return json(
        buildCheckResponse({ payload: cached, timing, cached: true }),
        { cache: "HIT" },
      );
    }

    const lastLookupRaw = await env.CACHE.get(rateLimitKey(ip));
    const lastLookupMs =
      lastLookupRaw != null ? Number(lastLookupRaw) : null;

    if (
      shouldRateLimit(
        Number.isFinite(lastLookupMs) ? lastLookupMs : null,
        nowMs,
        false,
      )
    ) {
      return json(
        {
          error: "rate_limited",
          message: "At most one lookup per minute per IP. Retry later.",
          retry_after_seconds: 60,
        },
        {
          status: 429,
          headers: { "Retry-After": "60" },
        },
      );
    }

    const cf = request.cf as IncomingRequestCfProperties | undefined;
    const repInfo = await buildReputation(ip, env);
    const rep = toReputationResponse(repInfo);

    const body = buildFreshCheckResponse({
      ip,
      cf,
      rep,
      timing,
      cached: false,
    });

    if (repInfo.complete) {
      const ttl = cacheTtlSeconds(env);
      const payload = buildCachedPayload({ ip, cf, rep });
      await env.CACHE.put(cacheKey(ip), JSON.stringify(payload), {
        expirationTtl: ttl,
      });
    }

    await env.CACHE.put(rateLimitKey(ip), String(nowMs), {
      expirationTtl: 120,
    });

    if (request.method === "HEAD") {
      return new Response(null, {
        status: 200,
        headers: {
          "X-Cache": "MISS",
          "Cache-Control": "no-store",
        },
      });
    }

    return json(body, { cache: "MISS" });
  },
};
