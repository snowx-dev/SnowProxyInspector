import {
  DNSBL_ZONE_BARRACUDA,
  DNSBL_ZONE_SPAMHAUS,
  queryDnsblZone,
  type FetchFn,
} from "./dnsbl";
import type {
  Env,
  RepCheck,
  ReputationInfo,
  ReputationResponse,
  ReputationSource,
} from "./types";

const API_TIMEOUT_MS = 6_000;
const RETRY_BACKOFF_MS = 200;

const REPUTATION_SOURCES: ReputationSource[] = [
  "spamhaus",
  "barracuda",
  "abuseipdb",
  "greynoise",
];

const TRANSIENT_RESULTS = new Set(["timeout", "unreachable"]);

function pickSecret(env: Env, ...keys: string[]): string | undefined {
  const e = env as unknown as Record<string, string | undefined>;
  for (const k of keys) {
    const v = e[k];
    if (v != null && v !== "") return v;
  }
  return undefined;
}

function abuseListedMin(env: Env): number {
  const n = Number(env.ABUSEIPDB_LISTED_MIN ?? "25");
  return Number.isFinite(n) ? n : 25;
}

function ipv4Only(ip: string): boolean {
  return ip.includes(".") && !ip.includes(":");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientFailure(check: RepCheck): boolean {
  return (
    !check.checked &&
    typeof check.result === "string" &&
    TRANSIENT_RESULTS.has(check.result)
  );
}

async function withRetry(
  run: () => Promise<RepCheck>,
  retries = 1,
): Promise<RepCheck> {
  let result = await run();
  for (let attempt = 0; attempt < retries && isTransientFailure(result); attempt++) {
    await sleep(RETRY_BACKOFF_MS);
    result = await run();
  }
  return result;
}

async function checkDnsblSource(
  ip: string,
  zone: string,
  fetchFn: FetchFn,
): Promise<RepCheck> {
  if (!ipv4Only(ip)) return { checked: false, result: "ipv4_only" };

  const { listed, answered } = await queryDnsblZone(ip, zone, fetchFn);
  if (!answered) return { checked: false, result: "unreachable" };
  return { checked: true, listed, result: listed ? "listed" : "clean" };
}

async function checkAbuseIPDB(
  ip: string,
  apiKey: string | undefined,
  listedMin: number,
  fetchFn: FetchFn,
): Promise<RepCheck> {
  if (!apiKey) return { checked: false, result: "no_key" };

  const url = new URL("https://api.abuseipdb.com/api/v2/check");
  url.searchParams.set("ipAddress", ip);
  url.searchParams.set("maxAgeInDays", "90");

  try {
    const res = await fetchFn(url.toString(), {
      headers: { Key: apiKey, Accept: "application/json" },
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });
    if (res.status === 401) return { checked: false, result: "auth" };
    if (res.status === 429) return { checked: false, result: "rate_limit" };
    if (!res.ok) return { checked: false, result: `http_${res.status}` };

    const body = (await res.json()) as {
      data?: { abuseConfidenceScore?: number };
    };
    const score = body.data?.abuseConfidenceScore;
    if (typeof score !== "number") return { checked: false, result: "bad_response" };

    const listed = score >= listedMin;
    return { checked: true, listed, result: score };
  } catch {
    return { checked: false, result: "timeout" };
  }
}

async function checkGreyNoise(
  ip: string,
  apiKey: string | undefined,
  fetchFn: FetchFn,
): Promise<RepCheck> {
  if (!apiKey) return { checked: false, result: "no_key" };

  const url = `https://api.greynoise.io/v3/ip/${encodeURIComponent(ip)}?quick=true`;

  try {
    const res = await fetchFn(url, {
      headers: { key: apiKey, Accept: "application/json" },
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });
    if (res.status === 401) return { checked: false, result: "auth" };
    if (res.status === 429) return { checked: false, result: "rate_limit" };
    if (res.status === 404) {
      return { checked: true, listed: false, result: "not_in_database" };
    }
    if (res.status !== 200 && res.status !== 206) {
      return { checked: false, result: `http_${res.status}` };
    }

    const body = (await res.json()) as GreyNoiseIpBody;
    return parseGreyNoiseIpBody(body);
  } catch {
    return { checked: false, result: "timeout" };
  }
}

type GreyNoiseIpBody = {
  business_service_intelligence?: { found?: boolean };
  internet_scanner_intelligence?: {
    found?: boolean;
    classification?: string;
  };
  /** Legacy community 404 body (kept for safety during API transitions). */
  noise?: boolean;
  riot?: boolean;
  classification?: string;
};

/** Map GreyNoise /v3/ip JSON to a reputation check result. */
export function parseGreyNoiseIpBody(body: GreyNoiseIpBody): RepCheck {
  const riot = body.business_service_intelligence?.found === true || body.riot === true;
  const noise =
    body.internet_scanner_intelligence?.found === true || body.noise === true;
  const classification =
    body.internet_scanner_intelligence?.classification ??
    body.classification ??
    "unknown";

  if (!riot && !noise) {
    return { checked: true, listed: false, result: "not_in_database" };
  }

  const listed =
    classification === "malicious" ||
    (noise && !riot && classification === "unknown");

  return {
    checked: true,
    listed,
    result: riot ? "riot" : classification,
  };
}

function aggregateListed(...checks: RepCheck[]): boolean {
  return checks.some((c) => c.checked && c.listed === true);
}

export function requiredReputationSources(ip: string, env: Env): ReputationSource[] {
  const abuseKey = pickSecret(env, "AbuseIPDBKey", "ABUSEIPDB_KEY", "ABUSEIPDB_API_KEY");
  const greyKey = pickSecret(env, "GreynoiseKey", "GREYNOISE_KEY", "GREYNOISE_API_KEY");

  const required: ReputationSource[] = [];
  if (ipv4Only(ip)) {
    required.push("spamhaus", "barracuda");
  }
  if (abuseKey) required.push("abuseipdb");
  if (greyKey) required.push("greynoise");
  return required;
}

export function isReputationComplete(
  rep: Pick<ReputationInfo, ReputationSource>,
  ip: string,
  env: Env,
): boolean {
  for (const source of requiredReputationSources(ip, env)) {
    if (!rep[source].checked) return false;
  }
  return true;
}

export function toReputationResponse(rep: ReputationInfo): ReputationResponse {
  const out: ReputationResponse = {
    listed: rep.listed,
    complete: rep.complete,
  };

  for (const source of REPUTATION_SOURCES) {
    const check = rep[source];
    if (check.checked && check.listed != null && check.result != null) {
      out[source] = { listed: check.listed, result: check.result };
    }
  }

  return out;
}

export async function buildReputation(
  ip: string,
  env: Env,
  fetchFn: FetchFn = fetch,
): Promise<ReputationInfo> {
  const abuseKey = pickSecret(env, "AbuseIPDBKey", "ABUSEIPDB_KEY", "ABUSEIPDB_API_KEY");
  const greyKey = pickSecret(env, "GreynoiseKey", "GREYNOISE_KEY", "GREYNOISE_API_KEY");

  const [spamhaus, barracuda, abuseipdb, greynoise] = await Promise.all([
    withRetry(() => checkDnsblSource(ip, DNSBL_ZONE_SPAMHAUS, fetchFn)),
    withRetry(() => checkDnsblSource(ip, DNSBL_ZONE_BARRACUDA, fetchFn)),
    withRetry(() => checkAbuseIPDB(ip, abuseKey, abuseListedMin(env), fetchFn)),
    withRetry(() => checkGreyNoise(ip, greyKey, fetchFn)),
  ]);

  const info: ReputationInfo = {
    listed: aggregateListed(spamhaus, barracuda, abuseipdb, greynoise),
    complete: false,
    spamhaus,
    barracuda,
    abuseipdb,
    greynoise,
  };
  info.complete = isReputationComplete(info, ip, env);
  return info;
}
