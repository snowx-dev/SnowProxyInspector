import { describe, expect, it, vi } from "vitest";
import {
  ipv4ToReverse,
  isListedInDohAnswer,
  queryDnsblZone,
} from "../src/dnsbl";

describe("ipv4ToReverse", () => {
  it("reverses octets", () => {
    expect(ipv4ToReverse("203.0.113.118")).toBe("118.113.0.203");
  });

  it("rejects non-ipv4", () => {
    expect(ipv4ToReverse("not-an-ip")).toBeNull();
    expect(ipv4ToReverse("2606:4700::")).toBeNull();
  });
});

describe("isListedInDohAnswer", () => {
  it("detects 127.0.0.x listing", () => {
    expect(
      isListedInDohAnswer(0, [{ type: 1, data: "127.0.0.2" }]),
    ).toBe(true);
  });

  it("treats NXDOMAIN as not listed", () => {
    expect(isListedInDohAnswer(3, undefined)).toBe(false);
  });
});

describe("queryDnsblZone", () => {
  it("queries reverse name via DoH", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          Status: 0,
          Answer: [{ type: 1, data: "127.0.0.4" }],
        }),
        { status: 200 },
      ),
    );

    const result = await queryDnsblZone("1.2.3.4", "zen.spamhaus.org", fetchFn);
    expect(result).toEqual({ listed: true, answered: true });
    expect(String(fetchFn.mock.calls[0][0])).toContain(
      "name=4.3.2.1.zen.spamhaus.org",
    );
  });

  it("returns answered false on fetch failure", async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error("timeout"));
    const result = await queryDnsblZone("1.2.3.4", "zen.spamhaus.org", fetchFn);
    expect(result.answered).toBe(false);
  });
});
