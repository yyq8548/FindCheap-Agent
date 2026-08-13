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
- The worker is a private service boundary with no authentication of its own. Never publish
  port 8080; only the trusted ingestion caller may join `crawler-internal`. Treat any exposure
  outside that network as a deployment failure.
- The root filesystem is read-only; `/tmp` is the only worker tmpfs; all Linux capabilities
  are dropped; `no-new-privileges` and the versioned seccomp allowlist are required. Validate
  the profile against the exact image and target kernel before enabling a merchant.

Run the profile with `docker compose --profile dynamic-crawl up --build`. The request
deadline is 15 seconds. The API accepts only merchant ID, relative resource path, and a
server-defined extraction profile. No URL, credentials, headers, proxy, JavaScript, browser
arguments, selectors, schemas, XPath, LLM prompt, session, cookie, screenshot, or download
configuration can cross the API boundary.

`POST /extract` is capped at 2,048 actual body bytes by a pure ASGI boundary before JSON
parsing. Content-Length, when present, must be a single canonical nonnegative decimal and is
only an early rejection hint; streamed chunks are always counted. `resourcePath` uses a closed
ASCII grammar and canonical decoding, so whitespace, non-ASCII, delimiters outside the grammar,
encoded aliases, ambiguous query forms, and duplicate query keys are rejected.

## TLS, robots, and browser lifecycle

- The pinned Crawl4AI 0.9.2 source adds Chromium certificate-bypass arguments. Image build
  runs a deterministic patch against the audited upstream SHA-256 and fails if the source or
  expected flag count drifts. Browser configuration also fixes `ignore_https_errors=False`
  and supplies no extra browser arguments.
- Crawl4AI's own robots fetch is disabled. Before every page crawl, the worker fetches
  `/robots.txt` through the enforced proxy with normal certificate validation, no cookies or
  authentication, at most three same-audited-host redirects, a 5-second deadline, and a
  256 KiB limit. DNS, TLS, HTTP, redirect, UTF-8, parse, or policy uncertainty denies access.
- One warm Chromium process is retained to avoid charging browser startup to the 15-second
  request budget. Crawl4AI 0.9.2 shares mutable manager state, so `arun` and shutdown are
  serialized. A fresh browser context is forced and recycled after every page; no Crawl4AI
  cache, session ID, cookies, storage state, downloads, or filesystem URLs are enabled.
- Image, media, font, and stylesheet requests are aborted. A document declaring more than
  2 MiB is closed at response headers; evidence is independently rejected before sanitization
  when its UTF-8 size exceeds 2,000,000 bytes. Sanitization, empty-result rejection, hashing,
  timestamps, and response-model construction all remain inside the same 15-second deadline.
- The seccomp profile returns ENOSYS for `clone3` and permits `clone` only when its namespace
  flag mask is zero. `unshare`, `setns`, user namespaces, and network namespaces remain denied.

## Reproducibility and runtime verification

The Python and Squid bases are digest-pinned. Direct dependencies remain pinned in
`requirements.txt`, and the Linux CPython 3.12 transitive graph is hash-locked in
`requirements.lock`; the image installs it with `--require-hashes`.

Run the disabled-by-default final-image smoke test with
`RUN_CRAWL4AI_RUNTIME_SMOKE=1 python scripts/test-crawl4ai-runtime.py`. It builds both images,
uses synthetic local TLS origins and a test-only exact-host allowlist, applies the production
non-root/read-only/tmpfs/capability/seccomp/resource/network restrictions, and verifies health,
disabled OpenAPI, proxy deny-all, exact allow, robots allow/deny/redirect handling, invalid
certificate rejection in real Chromium, private-IP denial, and direct-outbound failure. The
script removes every task-owned container, network, image, and temporary certificate on exit.
The production proxy image always retains the invalid deny-all sentinel.
The runtime workflow runs for relevant pull requests and pushes with cancellation concurrency.
Making that workflow a required merge check is a repository branch-protection setting and must
be enabled by an administrator; the workflow file cannot enforce that external policy itself.

`rawEvidence` is untrusted merchant-controlled text even after script/secret stripping. Every
downstream consumer must treat it as data only: never execute it, render it as trusted HTML,
interpolate it into SQL/shell/templates, or use it as an instruction or LLM system message.

## Known residual

Crawl4AI 0.9.2 exposes the final redirect URL but not a complete browser redirect chain in
all result paths. The worker validates every redirect/final URL the library exposes and
pre-resolves every exposed merchant hostname. The outbound proxy remains the authoritative
control for redirects and DNS rebinding because it re-applies exact-domain, port, and
destination-IP ACLs on network requests.
