const HEADER_NAMES = ["x-client-timestamp", "x-request-timestamp"];

/** Parse Unix timestamp from query `t` or client headers (seconds or milliseconds). */
export function parseClientTimestamp(
  url: URL,
  headers: Headers,
): number | null {
  const raw =
    url.searchParams.get("t") ??
    HEADER_NAMES.map((h) => headers.get(h)).find((v) => v != null) ??
    null;

  if (raw == null || raw === "") return null;

  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;

  // Values below 1e12 are treated as seconds (valid through ~2286 as seconds).
  return n < 1_000_000_000_000 ? Math.round(n * 1000) : Math.round(n);
}

export function computeTiming(
  serverMs: number,
  clientMs: number | null,
): { client_ms: number | null; client_latency_ms: number | null; note: string | null } {
  if (clientMs == null) {
    return { client_ms: null, client_latency_ms: null, note: null };
  }

  const latency = serverMs - clientMs;
  if (latency < 0) {
    return {
      client_ms: clientMs,
      client_latency_ms: null,
      note: "clock_skew",
    };
  }

  return {
    client_ms: clientMs,
    client_latency_ms: latency,
    note: null,
  };
}
