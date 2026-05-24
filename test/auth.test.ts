import { describe, expect, it } from "vitest";
import { isAuthorized, isProtectionEnabled } from "../src/auth";
import type { Env } from "../src/types";

const baseEnv: Env = {
  CACHE: {} as KVNamespace,
  PROTECTION_MODE: "off",
};

describe("auth", () => {
  it("allows all traffic when protection is off", () => {
    const req = new Request("https://xy.snowx.dev/");
    expect(isAuthorized(req, baseEnv)).toBe(true);
  });

  it("requires bearer token in strict mode", () => {
    const env: Env = {
      ...baseEnv,
      PROTECTION_MODE: "strict",
      API_TOKEN: "secret",
    };
    const bad = new Request("https://xy.snowx.dev/");
    const good = new Request("https://xy.snowx.dev/", {
      headers: { Authorization: "Bearer secret" },
    });
    expect(isAuthorized(bad, env)).toBe(false);
    expect(isAuthorized(good, env)).toBe(true);
    expect(isProtectionEnabled(env)).toBe(true);
  });
});
