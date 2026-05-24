import { describe, expect, it } from "vitest";
import { computeTiming, parseClientTimestamp } from "../src/timestamp";

describe("parseClientTimestamp", () => {
  it("reads seconds from query param", () => {
    const url = new URL("https://xy.snowx.dev/?t=1715951999");
    expect(parseClientTimestamp(url, new Headers())).toBe(1715951999000);
  });

  it("reads milliseconds from header", () => {
    const url = new URL("https://xy.snowx.dev/");
    const headers = new Headers({ "X-Client-Timestamp": "1715951999123" });
    expect(parseClientTimestamp(url, headers)).toBe(1715951999123);
  });

  it("returns null when absent", () => {
    const url = new URL("https://xy.snowx.dev/");
    expect(parseClientTimestamp(url, new Headers())).toBeNull();
  });
});

describe("computeTiming", () => {
  it("computes latency when client clock is sane", () => {
    expect(computeTiming(1000, 400)).toEqual({
      client_ms: 400,
      client_latency_ms: 600,
      note: null,
    });
  });

  it("flags clock skew when client is ahead", () => {
    expect(computeTiming(1000, 5000)).toEqual({
      client_ms: 5000,
      client_latency_ms: null,
      note: "clock_skew",
    });
  });
});
