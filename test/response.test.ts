import { describe, expect, it } from "vitest";
import { buildCheckResponse, buildCfIpData, buildFreshCheckResponse } from "../src/response";

describe("buildCfIpData", () => {
  it("maps Cloudflare metadata to cf_ip_data", () => {
    expect(
      buildCfIpData({
        country: "US",
        colo: "SFO",
        asn: 13335,
        asOrganization: "Cloudflare, Inc.",
      } as import("@cloudflare/workers-types").IncomingRequestCfProperties),
    ).toEqual({
      country: "US",
      country_name: "United States",
      edge_location: "SFO",
      asn: 13335,
      as_organization: "Cloudflare, Inc.",
    });
  });
});

describe("buildCheckResponse", () => {
  it("omits timing when not provided", () => {
    const body = buildFreshCheckResponse({
      ip: "1.2.3.4",
      cf: undefined,
      rep: { listed: false, complete: true },
      timing: null,
      cached: false,
    });
    expect(body).not.toHaveProperty("timing");
    expect(body.cf_ip_data.edge_location).toBeNull();
  });

  it("includes timing when provided", () => {
    const body = buildCheckResponse({
      payload: {
        ip: "1.2.3.4",
        cf_ip_data: {
          country: null,
          country_name: null,
          edge_location: null,
          asn: null,
          as_organization: null,
        },
        rep: { listed: false, complete: true },
      },
      timing: {
        server_ms: 1000,
        client_ms: 500,
        client_latency_ms: 500,
        note: null,
      },
      cached: true,
    });
    expect(body.timing?.client_latency_ms).toBe(500);
    expect(body.cached).toBe(true);
  });
});
