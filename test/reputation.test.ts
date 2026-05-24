import { describe, expect, it, vi } from "vitest";
import {
  buildReputation,
  parseGreyNoiseIpBody,
  toReputationResponse,
} from "../src/reputation";
import type { Env } from "../src/types";

const envWithKeys: Env = {
  CACHE: {} as KVNamespace,
  AbuseIPDBKey: "abuse-test",
  GreynoiseKey: "grey-test",
};

function routeFetch(
  routes: Array<{ match: RegExp; response: Response | (() => Response) }>,
): typeof fetch {
  return vi.fn((input: string | URL) => {
    const url = String(input);
    const route = routes.find((r) => r.match.test(url));
    if (!route) return Promise.resolve(new Response("not found", { status: 404 }));
    const res =
      typeof route.response === "function" ? route.response() : route.response.clone();
    return Promise.resolve(res);
  }) as typeof fetch;
}

const cleanDoh = {
  match: /zen\.spamhaus\.org|b\.barracuda|dns-query|dns\.google/,
  response: () => new Response(JSON.stringify({ Status: 3 }), { status: 200 }),
};

describe("toReputationResponse", () => {
  it("omits sources that did not answer", () => {
    const resp = toReputationResponse({
      listed: false,
      complete: false,
      spamhaus: { checked: true, listed: false, result: "clean" },
      barracuda: { checked: false, result: "unreachable" },
      abuseipdb: { checked: false, result: "no_key" },
      greynoise: { checked: false, result: "no_key" },
    });
    expect(resp).toEqual({
      listed: false,
      complete: false,
      spamhaus: { listed: false, result: "clean" },
    });
  });
});

describe("parseGreyNoiseIpBody", () => {
  it("returns not_in_database when neither dataset matches", () => {
    expect(
      parseGreyNoiseIpBody({
        business_service_intelligence: { found: false },
        internet_scanner_intelligence: { found: false },
      }),
    ).toEqual({ checked: true, listed: false, result: "not_in_database" });
  });

  it("maps riot from business service intelligence", () => {
    expect(
      parseGreyNoiseIpBody({
        business_service_intelligence: { found: true },
        internet_scanner_intelligence: { found: false },
      }),
    ).toEqual({ checked: true, listed: false, result: "riot" });
  });

  it("maps scanner classification when not riot", () => {
    expect(
      parseGreyNoiseIpBody({
        business_service_intelligence: { found: false },
        internet_scanner_intelligence: { found: true, classification: "unknown" },
      }),
    ).toEqual({ checked: true, listed: true, result: "unknown" });
  });
});

describe("buildReputation", () => {
  it("aggregates listed from abuseipdb score", async () => {
    const fetchFn = routeFetch([
      cleanDoh,
      {
        match: /abuseipdb\.com/,
        response: new Response(
          JSON.stringify({ data: { abuseConfidenceScore: 100 } }),
        ),
      },
      {
        match: /greynoise\.io\/v3\/ip/,
        response: () =>
          new Response(
            JSON.stringify({
              ip: "8.8.8.8",
              business_service_intelligence: { found: true, trust_level: "1" },
              internet_scanner_intelligence: { found: false },
            }),
            { status: 200 },
          ),
      },
    ]);

    const rep = await buildReputation("8.8.8.8", envWithKeys, fetchFn);
    expect(rep.listed).toBe(true);
    expect(rep.complete).toBe(true);
    expect(rep.abuseipdb).toEqual({ checked: true, listed: true, result: 100 });
    expect(rep.greynoise).toEqual({ checked: true, listed: false, result: "riot" });
    expect(rep.spamhaus.checked).toBe(true);
  });

  it("is complete when optional API keys are missing", async () => {
    const fetchFn = routeFetch([cleanDoh]);
    const rep = await buildReputation("8.8.8.8", { CACHE: {} as KVNamespace }, fetchFn);
    expect(rep.abuseipdb).toEqual({ checked: false, result: "no_key" });
    expect(rep.greynoise).toEqual({ checked: false, result: "no_key" });
    expect(rep.complete).toBe(true);
    expect(toReputationResponse(rep)).not.toHaveProperty("abuseipdb");
  });

  it("marks greynoise malicious as listed", async () => {
    const fetchFn = routeFetch([
      cleanDoh,
      {
        match: /abuseipdb/,
        response: new Response(
          JSON.stringify({ data: { abuseConfidenceScore: 0 } }),
        ),
      },
      {
        match: /greynoise\.io\/v3\/ip/,
        response: () =>
          new Response(
            JSON.stringify({
              ip: "1.2.3.4",
              business_service_intelligence: { found: false },
              internet_scanner_intelligence: {
                found: true,
                classification: "malicious",
              },
            }),
            { status: 200 },
          ),
      },
    ]);

    const rep = await buildReputation("1.2.3.4", envWithKeys, fetchFn);
    expect(rep.greynoise.listed).toBe(true);
    expect(rep.listed).toBe(true);
    expect(rep.complete).toBe(true);
  });

  it("returns not_in_database on GreyNoise 404", async () => {
    const fetchFn = routeFetch([
      cleanDoh,
      {
        match: /abuseipdb/,
        response: () =>
          new Response(
            JSON.stringify({ data: { abuseConfidenceScore: 0 } }),
            { status: 200 },
          ),
      },
      {
        match: /greynoise\.io\/v3\/ip/,
        response: () =>
          new Response(
            JSON.stringify({
              ip: "203.0.113.118",
              noise: false,
              riot: false,
              message: "IP not observed scanning the internet or contained in RIOT data set.",
            }),
            { status: 404 },
          ),
      },
    ]);

    const rep = await buildReputation("203.0.113.118", envWithKeys, fetchFn);
    expect(rep.greynoise).toEqual({
      checked: true,
      listed: false,
      result: "not_in_database",
    });
    expect(String(fetchFn.mock.calls.find((c) => String(c[0]).includes("greynoise"))?.[0])).toContain(
      "/v3/ip/",
    );
  });

  it("requires API checks for ipv6 when keys are set", async () => {
    const fetchFn = routeFetch([
      {
        match: /abuseipdb/,
        response: () =>
          new Response(
            JSON.stringify({ data: { abuseConfidenceScore: 0 } }),
            { status: 200 },
          ),
      },
      {
        match: /greynoise\.io\/v3\/ip/,
        response: () =>
          new Response(
            JSON.stringify({
              ip: "2001:db8::1",
              business_service_intelligence: { found: true, trust_level: "1" },
              internet_scanner_intelligence: { found: false },
            }),
            { status: 200 },
          ),
      },
    ]);

    const rep = await buildReputation("2001:db8::1", envWithKeys, fetchFn);
    expect(rep.spamhaus).toEqual({ checked: false, result: "ipv4_only" });
    expect(rep.barracuda).toEqual({ checked: false, result: "ipv4_only" });
    expect(rep.abuseipdb.checked).toBe(true);
    expect(rep.greynoise.checked).toBe(true);
    expect(rep.complete).toBe(true);
    expect(fetchFn).toHaveBeenCalled();
  });
});
