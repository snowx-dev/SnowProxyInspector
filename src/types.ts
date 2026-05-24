export interface TimingInfo {
  server_ms: number;
  client_ms: number;
  client_latency_ms: number | null;
  note: string | null;
}

/** Per-source lookup result (internal). */
export interface RepCheck {
  checked: boolean;
  listed?: boolean;
  /** AbuseIPDB score, GreyNoise class, or error code (timeout, no_key, …). */
  result?: string | number;
}

export type ReputationSource = "spamhaus" | "barracuda" | "abuseipdb" | "greynoise";

/** Per-source result exposed in API responses (checked sources only). */
export interface RepSourceResult {
  listed: boolean;
  result: string | number;
}

/** Full internal reputation aggregate before response filtering. */
export interface ReputationInfo {
  /** True if any source that responded marks the IP as listed. */
  listed: boolean;
  complete: boolean;
  spamhaus: RepCheck;
  barracuda: RepCheck;
  abuseipdb: RepCheck;
  greynoise: RepCheck;
}

/** Reputation block in JSON responses — omits sources that did not answer. */
export interface ReputationResponse {
  listed: boolean;
  complete: boolean;
  spamhaus?: RepSourceResult;
  barracuda?: RepSourceResult;
  abuseipdb?: RepSourceResult;
  greynoise?: RepSourceResult;
}

/** Geo/ASN metadata from Cloudflare `request.cf` on the incoming request. */
export interface CfIpData {
  country: string | null;
  country_name: string | null;
  /** Cloudflare edge PoP (3-letter airport-style code, e.g. SFO). */
  edge_location: string | null;
  asn: number | null;
  as_organization: string | null;
}

/** Payload stored in KV (no timing — computed per request). */
export interface CachedCheckPayload {
  ip: string;
  cf_ip_data: CfIpData;
  rep: ReputationResponse;
}

export interface CheckResponse {
  ip: string;
  cf_ip_data: CfIpData;
  rep: ReputationResponse;
  timing?: TimingInfo;
  cached: boolean;
}

export interface Env {
  CACHE: KVNamespace;
  PROTECTION_MODE?: string;
  API_TOKEN?: string;
  /** Comma-separated DNSBL zones (default: zen.spamhaus.org,b.barracudacentral.org). */
  DNSBL_ZONES?: string;
  /** AbuseIPDB marks listed when score >= this (default 25). */
  ABUSEIPDB_LISTED_MIN?: string;
  CACHE_TTL_SECONDS?: string;
  /** Worker secret (dashboard name). */
  AbuseIPDBKey?: string;
  GreynoiseKey?: string;
}
