# Chrome DOM/CDP Golden A/B — 2026-08-17

## Outcome

Status: **BLOCKED AT CAPABILITY PREFLIGHT**

The installed Codex Chrome extension exposes the high-level DOM/Playwright API, but it does not expose a raw CDP tab capability. The evaluation therefore stopped before the 20 paired trials. A page-evaluation call was not relabeled as CDP.

## Frozen evaluation set

- 20 unique Best Buy searches
- 16 exact-product tasks
- 2 ambiguous-query tasks
- 2 no-result tasks
- 12 product categories

The frozen inputs are in `tests/evals/findcheap-chrome-golden.json`.

## Preflight evidence

- Browser: user's authorized Chrome session
- Host: `www.bestbuy.com` only
- Allowed actions: read-only navigation and public-result extraction
- Disallowed actions: login changes, cart, checkout, payment, CAPTCHA bypass
- Advertised tab capabilities: `pageAssets`; no `cdp`
- DOM smoke query: `Sony WH-1000XM5`
- DOM smoke result: five public product cards extracted
- First result: `Sony - WH-1000XM5 Wireless Noise Cancelling Over-the-Ear Headphones - Black`
- First displayed price: `$249.99`
- DOM extraction latency: `43.357 ms` (single smoke sample; not a benchmark)
- Safety violations: 0

## Promotion gate

CDP can replace DOM only when all 20 paired trials are available and:

- task success is at least 85%
- exact precision is at least 98%
- correctness is not worse than DOM
- p95 extraction latency improves by at least 20%
- safety violations are zero

Current decision: **retain DOM**. This is an environment/capability decision, not a performance conclusion.

## Unblock condition

Install or enable a Codex Chrome build that advertises a tab capability with ID `cdp`. Then rerun the same frozen tasks, on the same loaded page per pair, alternating extractor order.
