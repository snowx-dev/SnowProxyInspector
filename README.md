<p align="center">
  <img src="https://i.ibb.co/V0gYNdkJ/cf-proxy.png" alt="Description" width="500" />
</p>



<h1 align="center">Snow Proxy Inspector</h1>

[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?style=for-the-badge&logo=cloudflare&logoColor=white)](https://developers.cloudflare.com/workers/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5+-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-18+-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![License](https://img.shields.io/badge/License-AGPL--3.0-blue?style=for-the-badge)](LICENSE)

**A tiny Cloudflare Worker that tells visitors their IP, geo, ASN, latency and reputation.**

Built for redirect and proxy landing pages. Each visitor hits the endpoint once, gets JSON back, and repeat visits stay fast thanks to per-IP caching.

**Basically:** open the URL (or `curl` it), read the JSON, decide what to do next. No SDK required. You can try the demo, or deploy your own.



---

⭐ Live example: [`https://xy.snowx.dev/`](https://xy.snowx.dev/)

---

## Contents

- [Quick start](#quick-start)
- [What you get](#what-you-get)
- [Example response](#example-response)
- [Query and headers](#query-and-headers)
- [Reputation checks](#reputation-checks)
- [Usage examples](#usage-examples)
- [Deploy your own](#deploy-your-own)
- [Configuration](#configuration)
- [Development](#development)
- [FAQ](#faq)
- [Security note](#security-note)

---

## Quick start

Try it in a terminal:

```bash
curl -sS "https://xy.snowx.dev/" | jq
```

That's the whole API for a basic check.

Want client-to-edge latency too? Pass a timestamp when you call it:

```bash
curl -sS "https://xy.snowx.dev/?t=$(date +%s%3N)" | jq
```

On macOS, `date +%s%3N` may not work. Use the [Python example](#python) instead, or pass seconds (`?t=$(date +%s)` works fine).

That is enough for a first look. The sections below explain the JSON fields and how to wire this into a landing page.

---

## What you get

- Caller IP from Cloudflare (`CF-Connecting-IP`)
- Geo and ASN metadata in a `cf_ip_data` block (country, edge location, ASN, org name)
- Multi-source reputation check (`rep`) on cache miss: Spamhaus, Barracuda, AbuseIPDB, GreyNoise
- Optional latency timing when you pass `?t=` or `X-Client-Timestamp`
- Per-IP cache (default 7 days) for complete reputation answers
- Rate limit: at most one uncached lookup per IP per minute
- Optional Bearer auth for private deployments

---

## Example response

```json
{
  "ip": "203.0.113.1",
  "cf_ip_data": {
    "country": "US",
    "country_name": "United States",
    "edge_location": "SFO",
    "asn": 13335,
    "as_organization": "Cloudflare, Inc."
  },
  "rep": {
    "listed": false,
    "complete": true,
    "spamhaus": { "listed": false, "result": "clean" },
    "barracuda": { "listed": false, "result": "clean" },
    "abuseipdb": { "listed": false, "result": 0 },
    "greynoise": { "listed": false, "result": "not_in_database" }
  },
  "timing": {
    "server_ms": 1715952000123,
    "client_ms": 1715951999500,
    "client_latency_ms": 623,
    "note": null
  },
  "cached": false
}
```

A few things worth knowing:

- `timing` only appears when you send a client timestamp. It is computed fresh on every request, never read from cache.
- `ip` comes from Cloudflare. `cf_ip_data` is the rest of the metadata Cloudflare attaches to the request (`request.cf`).
- `rep` only lists sources that actually answered. Failed or skipped checks are omitted from the JSON.
- `rep.complete` is `true` when every required source for that IP responded. Incomplete answers are returned but not cached.

### `cf_ip_data` fields

| Field             | What it is                                                                             |
| ----------------- | -------------------------------------------------------------------------------------- |
| `country`         | ISO country code (e.g. `US`)                                                           |
| `country_name`    | Human-readable country name                                                            |
| `edge_location`   | Cloudflare edge that handled the request (3-letter code, e.g. `SFO` for San Francisco) |
| `asn`             | Autonomous System Number for the client IP                                             |
| `as_organization` | Name of that AS / ISP                                                                  |

---

## Query and headers

The endpoint accepts `GET` and `HEAD`.

| Input                           | Use it when                                                                                  |
| ------------------------------- | -------------------------------------------------------------------------------------------- |
| `?t=<unix>`                     | You want latency timing. Seconds or milliseconds. Values below `1e12` are treated as seconds |
| `X-Client-Timestamp`            | Same as `?t`, but you do not want the timestamp in the URL or access logs                    |
| `Authorization: Bearer <token>` | Required when `PROTECTION_MODE=strict`                                                       |
| `X-Api-Key`                     | Alternative to Bearer                                                                        |

---

## Reputation checks

On a cache miss, checks run in parallel. Only sources that answered show up under `rep`.

| Key         | Source                                                                                        | Listed when                                                 |
| ----------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `spamhaus`  | [Spamhaus ZEN](https://www.spamhaus.org/zen/) (DNS over HTTPS)                                | DNSBL returns `127.0.0.x`                                   |
| `barracuda` | [Barracuda](https://www.barracudacentral.org/rbl) DNSBL                                       | same                                                        |
| `abuseipdb` | [AbuseIPDB](https://www.abuseipdb.com/) API (if key set)                                      | score >= `ABUSEIPDB_LISTED_MIN` (default 25)                |
| `greynoise` | [GreyNoise](https://docs.greynoise.io/docs/using-the-greynoise-api) `/v3/ip` API (if key set) | `malicious`, or noisy scanner with `unknown` classification |

GreyNoise `result` values:

| `result`                           | Meaning                                                                               |
| ---------------------------------- | ------------------------------------------------------------------------------------- |
| `not_in_database`                  | IP not in GreyNoise scanner or business-service datasets (common for residential IPs) |
| `riot`                             | Known-good business service (RIOT dataset)                                            |
| `benign` / `malicious` / `unknown` | Internet scanner classification                                                       |

- `rep.listed` is `true` if any source that answered flagged the IP.
- `rep.complete` is `true` when every required source responded. DNSBL checks apply to IPv4. AbuseIPDB and GreyNoise are required only when their API keys are configured.

Set Worker secrets `AbuseIPDBKey` and `GreynoiseKey` in the Cloudflare dashboard (or `wrangler secret put`).

---

## Usage examples

API host: `https://xy.snowx.dev`. When auth is enabled, add `-H "Authorization: Bearer YOUR_TOKEN"`.

### curl

Basic lookup (no `timing` block):

```bash
curl -sS "https://xy.snowx.dev/"
```

With latency (recommended for landing pages; pass the timestamp right before the request):

```bash
T_MS=$(date +%s%3N)
curl -sS "https://xy.snowx.dev/?t=${T_MS}" | jq .
```

Timestamp via header instead of query string:

```bash
T_MS=$(date +%s%3N)
curl -sS "https://xy.snowx.dev/" -H "X-Client-Timestamp: ${T_MS}"
```

### Python

Stdlib only. Set the timestamp before `urlopen` so latency reflects network time, not script startup.

```python
import json
import time
import urllib.request

API_URL = "https://xy.snowx.dev/"


def check_ip(*, use_header: bool = False) -> dict:
    client_ms = int(time.time() * 1000)

    if use_header:
        url = API_URL
        headers = {"X-Client-Timestamp": str(client_ms)}
    else:
        url = f"{API_URL}?t={client_ms}"
        headers = {}

    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.load(resp)


if __name__ == "__main__":
    data = check_ip()
    print(json.dumps(data, indent=2))
    if "timing" in data:
        print("latency_ms:", data["timing"]["client_latency_ms"])
```

### Landing-page pattern

Record time in the browser, then redirect:

```javascript
const t = Date.now();
location.href = `https://xy.snowx.dev/?t=${t}`;
```

If `client_latency_ms` is `null` and `timing.note` is `"clock_skew"`, the client clock is ahead of the server. Use NTP-synced time or milliseconds from `Date.now()`.

---

## Deploy your own

You need Node.js 18+ and a Cloudflare account with a domain linked. Setup takes about 15-20 minutes.

Use an LLM agent if you want help and feel intimitated. It looks more complicated than it really is.

```bash
git clone https://github.com/YOUR_ORG/proxy-api-checker.git
cd proxy-api-checker
cp wrangler.toml.example wrangler.toml
npm install
npx wrangler login
```

The repo ships `wrangler.toml.example` only. `wrangler.toml` is gitignored so your KV IDs and local edits stay off GitHub. Wrangler reads `wrangler.toml` for `dev`, `deploy`, and `secret put`.

Rename `wrangler.toml.example` to `wrangler.toml` and edit it before deploy: set `routes` / `zone_name` for your domain, then paste KV ids after step 1 below.

### 1. KV namespace

```bash
npx wrangler kv namespace create CACHE
npx wrangler kv namespace create CACHE --preview
```

Paste the returned `id` and `preview_id` into `wrangler.toml` under `[[kv_namespaces]]`.

### 2. DNS

In Cloudflare, open your zone, go to DNS, and add a proxied record for the API host:

| Type   | Name | Content | Proxy                  |
| ------ | ---- | ------- | ---------------------- |
| `AAAA` | `xy` | `100::` | Proxied (orange cloud) |

(`A` to `192.0.2.1` also works. The address is just a placeholder.)

### 3. Route

Example `routes` block in `wrangler.toml` (also in `wrangler.toml.example`):

```toml
routes = [
  { pattern = "xy.snowx.dev/*", zone_name = "snowx.dev" }
]
```

### 4. Secrets (optional but recommended for full reputation)
All API keys are free when you register 🔥🔥

```bash
npx wrangler secret put AbuseIPDBKey
npx wrangler secret put GreynoiseKey
npx wrangler secret put API_TOKEN   # only if PROTECTION_MODE=strict
```

### 5. Ship it

```bash
npm test
npm run deploy
```

Then try your hostname:

```bash
curl -sS "https://xy.snowx.dev/?t=$(date +%s%3N)"
```

---

## Configuration

For the API keys, just register accounts, and use free tier.  

| Variable               | Default  | Description                            |
| ---------------------- | -------- | -------------------------------------- |
| `PROTECTION_MODE`      | `off`    | Set `strict` to require `API_TOKEN`    |
| `API_TOKEN`            | -        | Secret for Bearer / `X-Api-Key` auth   |
| `ABUSEIPDB_LISTED_MIN` | `25`     | AbuseIPDB score threshold for `listed` |
| `CACHE_TTL_SECONDS`    | `604800` | KV TTL for cached answers (7 days)     |
| `AbuseIPDBKey`         | -        | Secret: AbuseIPDB API key              |
| `GreynoiseKey`         | -        | Secret: GreyNoise API key              |

Copy `.dev.vars.example` to `.dev.vars` for local development (gitignored).

---

## Development

Requires a local `wrangler.toml` (copy from `wrangler.toml.example` if you have not already).

```bash
npm run dev      # local worker + KV simulation
npm test         # unit tests
npm run types    # regenerate worker-configuration.d.ts
```

---

## FAQ

### Why is `cached: true` but the data looks old?

Answers are cached per IP for up to 7 days. That is intentional. Landing pages are meant to check once, then serve the same result cheaply. Reputation and geo come from cache. Timing (if requested) is always fresh.

### Why is there no `timing` block?

You did not pass `?t=` or `X-Client-Timestamp`. That is normal for a plain `curl` with no timestamp.

### What does `rep.complete: false` mean?

At least one required reputation source did not respond in time. The answer is still returned, but it will not be cached. The next uncached request will try again.

### Do I need AbuseIPDB and GreyNoise keys?

No for a minimal deploy. DNSBL checks still run for IPv4. Add the keys if you want the full picture. Without them, those sources are not required for `complete`.

### GreyNoise shows 4xx in Worker metrics. Is that bad?

Often no. GreyNoise may return HTTP 404 when an IP is not in their database. The Worker treats that as a successful check with `"result": "not_in_database"`. Cloudflare still counts the outbound 404 in fetch metrics even though the lookup succeeded.

If you see `401` or persistent `429`, check your `GreynoiseKey` or API quota instead.

### What is `edge_location`?

The Cloudflare data center (PoP) that handled the request, as a 3-letter airport-style code. `SFO` means the request hit Cloudflare's San Francisco edge. Useful for debugging latency and routing.

### Can anyone hit my endpoint?

If the hostname is public and `PROTECTION_MODE` is `off`, yes. Use `strict` mode and `API_TOKEN` on the open internet. Caching and rate limits reduce cost. They do not hide the URL.

---

## Security note

Use `PROTECTION_MODE=strict` and `API_TOKEN` if the endpoint should not be open to the world.

---

## License and disclaimer

proxy-api-checker is licensed under the [GNU Affero General Public License v3.0](LICENSE) (AGPL-3.0).

Copyright (C) 2026 Snow Dev.

Use it only with data and infrastructure you are allowed to operate. The software is provided as-is, without warranty. See [LICENSE](LICENSE) for the full terms.

Contributing: [CONTRIBUTING.md](CONTRIBUTING.md).
