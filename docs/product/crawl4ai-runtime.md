# Crawl4AI worker runtime boundary

The dynamic-page worker is asynchronous ingestion infrastructure, never a synchronous
shopping-query dependency. Its production profile is disabled until a merchant has a
documented audit approval and an immutable worker config is rebuilt into the image.

## Required production controls

- The worker joins only `crawler-internal`, an internal Docker network. It has no host
  mount, database/Redis credential, published port, or direct outbound interface.
- Chromium uses the fixed `crawl4ai-egress:3128` proxy. That proxy is the only service
  connected to `crawler-outbound`; it permits CONNECT on port 443 only for exact audited
  domains and rejects private, loopback, link-local, metadata, reserved, and multicast IPs.
- `infra/docker/crawl4ai-allowed-hosts.txt` intentionally contains only an invalid sentinel.
  A reviewed deployment artifact must replace it with the exact hosts from approved audit
  records. Never add a wildcard or a host based on request/model input.
- Application DNS checks are defense in depth. Chromium performs its own networking, so
  `CRAWLER_EGRESS_ENFORCED=true` is not security by itself; the isolated network and proxy
  must be present. The worker fails closed when the declaration or proxy setting is absent.
- The root filesystem is read-only; `/tmp` is the only worker tmpfs; all Linux capabilities
  are dropped; `no-new-privileges` and the versioned seccomp allowlist are required. Validate
  the profile against the exact image and target kernel before enabling a merchant.

Run the profile with `docker compose --profile dynamic-crawl up --build`. The request
deadline is 15 seconds. The API accepts only merchant ID, relative resource path, and a
server-defined extraction profile. No URL, credentials, headers, proxy, JavaScript, browser
arguments, selectors, schemas, XPath, LLM prompt, session, cookie, screenshot, or download
configuration can cross the API boundary.

## Known residual

Crawl4AI 0.9.2 exposes the final redirect URL but not a complete browser redirect chain in
all result paths. The worker validates every redirect/final URL the library exposes and
pre-resolves every exposed merchant hostname. The outbound proxy remains the authoritative
control for redirects and DNS rebinding because it re-applies exact-domain, port, and
destination-IP ACLs on network requests.
