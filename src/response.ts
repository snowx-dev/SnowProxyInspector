import type { IncomingRequestCfProperties } from "@cloudflare/workers-types";
import type {
  CachedCheckPayload,
  CfIpData,
  CheckResponse,
  ReputationResponse,
  TimingInfo,
} from "./types";

const COUNTRY_NAMES: Record<string, string> = {
  US: "United States",
  FR: "France",
  DE: "Germany",
  GB: "United Kingdom",
  CA: "Canada",
  NL: "Netherlands",
  // Fallback: return ISO code as name when unknown
};

export function countryName(iso: string | undefined): string | null {
  if (!iso) return null;
  return COUNTRY_NAMES[iso] ?? iso;
}

export function buildCfIpData(
  cf: IncomingRequestCfProperties | undefined,
): CfIpData {
  const country = cf?.country ?? null;

  return {
    country,
    country_name: countryName(country ?? undefined),
    edge_location: cf?.colo ?? null,
    asn: cf?.asn ?? null,
    as_organization: cf?.asOrganization ?? null,
  };
}

export function buildCachedPayload(params: {
  ip: string;
  cf: IncomingRequestCfProperties | undefined;
  rep: ReputationResponse;
}): CachedCheckPayload {
  const { ip, cf, rep } = params;

  return {
    ip,
    cf_ip_data: buildCfIpData(cf),
    rep,
  };
}

export function buildCheckResponse(params: {
  payload: CachedCheckPayload;
  timing: TimingInfo | null;
  cached: boolean;
}): CheckResponse {
  const { payload, timing, cached } = params;

  const body: CheckResponse = {
    ...payload,
    cached,
  };

  if (timing != null) {
    body.timing = timing;
  }

  return body;
}

export function buildFreshCheckResponse(params: {
  ip: string;
  cf: IncomingRequestCfProperties | undefined;
  rep: ReputationResponse;
  timing: TimingInfo | null;
  cached: boolean;
}): CheckResponse {
  return buildCheckResponse({
    payload: buildCachedPayload(params),
    timing: params.timing,
    cached: params.cached,
  });
}
