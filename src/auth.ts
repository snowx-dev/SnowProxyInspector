import type { Env } from "./types";

export function isProtectionEnabled(env: Env): boolean {
  return (env.PROTECTION_MODE ?? "off").toLowerCase() === "strict";
}

export function isAuthorized(request: Request, env: Env): boolean {
  if (!isProtectionEnabled(env)) return true;

  const token = env.API_TOKEN;
  if (!token) return false;

  const auth = request.headers.get("Authorization");
  if (auth === `Bearer ${token}`) return true;

  const apiKey = request.headers.get("X-Api-Key");
  return apiKey === token;
}
