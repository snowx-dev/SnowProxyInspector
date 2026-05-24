/** Minimum milliseconds between uncached lookups for the same IP. */
export const RATE_LIMIT_MS = 60_000;

/** Bump when cached payload shape changes (invalidates prior KV entries). */
export const CACHE_KEY_VERSION = 4;

export function cacheKey(ip: string): string {
  return `answer:v${CACHE_KEY_VERSION}:${ip}`;
}

export function rateLimitKey(ip: string): string {
  return `rl:${ip}`;
}

/** True when a new lookup must be rejected (no cache, last lookup within window). */
export function shouldRateLimit(
  lastLookupMs: number | null,
  nowMs: number,
  hasCachedAnswer: boolean,
): boolean {
  if (hasCachedAnswer) return false;
  if (lastLookupMs == null) return false;
  return nowMs - lastLookupMs < RATE_LIMIT_MS;
}
