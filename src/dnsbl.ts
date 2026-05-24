const QUERY_TIMEOUT_MS = 6_000;

/** RFC 5782-style 127.0.0.0/8 return codes used by many DNSBLs. */
const DNSBL_LISTED_PREFIX = "127.0.0.";

const DOH_RESOLVERS = [
  {
    buildUrl: (name: string) => {
      const url = new URL("https://cloudflare-dns.com/dns-query");
      url.searchParams.set("name", name);
      url.searchParams.set("type", "A");
      return url.toString();
    },
    headers: { Accept: "application/dns-json" },
  },
  {
    buildUrl: (name: string) => {
      const url = new URL("https://dns.google/resolve");
      url.searchParams.set("name", name);
      url.searchParams.set("type", "A");
      return url.toString();
    },
    headers: {} as Record<string, string>,
  },
] as const;

export const DNSBL_ZONE_SPAMHAUS = "zen.spamhaus.org";
export const DNSBL_ZONE_BARRACUDA = "b.barracudacentral.org";

export type FetchFn = typeof fetch;

export function ipv4ToReverse(ip: string): string | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  for (const part of parts) {
    const n = Number(part);
    if (!Number.isInteger(n) || n < 0 || n > 255) return null;
  }
  return parts.reverse().join(".");
}

export function isListedInDohAnswer(
  status: number,
  answers: Array<{ type?: number; data?: string }> | undefined,
): boolean {
  if (status === 3) return false;
  if (status !== 0 || !answers?.length) return false;
  return answers.some(
    (a) =>
      a.type === 1 &&
      typeof a.data === "string" &&
      a.data.startsWith(DNSBL_LISTED_PREFIX),
  );
}

type DohJson = {
  Status?: number;
  Answer?: Array<{ type?: number; data?: string }>;
};

async function queryOneResolver(
  name: string,
  resolver: (typeof DOH_RESOLVERS)[number],
  fetchFn: FetchFn,
): Promise<DohJson> {
  const res = await fetchFn(resolver.buildUrl(name), {
    headers: resolver.headers,
    signal: AbortSignal.timeout(QUERY_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`doh_http_${res.status}`);
  return (await res.json()) as DohJson;
}

/** Query DoH resolvers in parallel; first successful response wins. */
async function fetchDoh(
  name: string,
  fetchFn: FetchFn,
): Promise<DohJson | null> {
  try {
    return await Promise.any(
      DOH_RESOLVERS.map((resolver) => queryOneResolver(name, resolver, fetchFn)),
    );
  } catch {
    return null;
  }
}

export async function queryDnsblZone(
  ip: string,
  zone: string,
  fetchFn: FetchFn = fetch,
): Promise<{ listed: boolean; answered: boolean }> {
  const reverse = ipv4ToReverse(ip);
  if (!reverse) return { listed: false, answered: false };

  const body = await fetchDoh(`${reverse}.${zone}`, fetchFn);
  if (!body) return { listed: false, answered: false };

  return {
    listed: isListedInDohAnswer(body.Status ?? -1, body.Answer),
    answered: true,
  };
}
