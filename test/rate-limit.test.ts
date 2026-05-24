import { describe, expect, it } from "vitest";
import { cacheKey, RATE_LIMIT_MS, shouldRateLimit } from "../src/rate-limit";

describe("shouldRateLimit", () => {
  const now = 1_000_000;

  it("never limits when a cached answer exists", () => {
    expect(shouldRateLimit(now - 1000, now, true)).toBe(false);
  });

  it("allows first lookup", () => {
    expect(shouldRateLimit(null, now, false)).toBe(false);
  });

  it("blocks second lookup within one minute", () => {
    expect(shouldRateLimit(now - 30_000, now, false)).toBe(true);
  });

  it("allows lookup after one minute", () => {
    expect(shouldRateLimit(now - RATE_LIMIT_MS, now, false)).toBe(false);
  });
});

describe("cacheKey", () => {
  it("includes version prefix to invalidate stale KV entries", () => {
    expect(cacheKey("203.0.113.1")).toBe("answer:v4:203.0.113.1");
  });
});
