# Chrome extraction Golden A/B — 2026-08-17

## Outcome

Twenty paired, read-only Best Buy trials completed in the user's authorized Chrome session.

Raw CDP was not available as a Codex tab capability. The executable fallback compared:

- A: high-level Locator calls
- B: one batched Direct Evaluate call

Direct Evaluate is a proxy extraction strategy, not raw CDP. It must not be described or shipped as a raw-CDP implementation.

## Results

| Metric | Locator | Direct Evaluate |
|---|---:|---:|
| Task success | 55% | 50% |
| Exact precision | 50% | 50% |
| p50 extraction latency | 1,985 ms | 1,291 ms |
| p95 extraction latency | 5,150 ms | 4,335 ms |
| Extraction errors | 5 | 6 |
| Safety violations | 0 | 0 |

Direct Evaluate improved p95 by 15.8%, below the 20% promotion gate. It also had lower task success and one additional extraction error.

Decision: **retain Locator**. Do not promote Direct Evaluate or raw CDP.

## Per-task evidence

`E` means the browser-control channel timed out. Latencies include only extraction, not navigation or the stabilization wait.

| Task | Locator ms | Locator | Direct ms | Direct |
|---|---:|:---:|---:|:---:|
| headphones-sony-xm5 | 3,225 | E | 3,320 | E |
| headphones-airpods-pro | 911 | PASS | 156 | PASS |
| console-switch-oled | 5,150 | FAIL | 1,016 | FAIL |
| phone-galaxy-s25 | 472 | PASS | 1,291 | PASS |
| tv-lg-c4 | 5,080 | E | 3,634 | FAIL |
| vacuum-dyson-v15 | 3,131 | E | 4,069 | E |
| camera-canon-r50 | 1,060 | PASS | 242 | PASS |
| watch-garmin-265 | 4,173 | E | 3,022 | E |
| headphones-bose-qc-ultra | 4,575 | E | 1,428 | PASS |
| console-ps5-slim | 1,985 | PASS | 1,004 | PASS |
| laptop-macbook-air | 4,970 | PASS | 1,605 | PASS |
| tablet-ipad-blue | 2,920 | FAIL | 4,935 | E |
| appliance-ninja-air-fryer | 1,868 | PASS | 702 | PASS |
| sku-sony-xm5 | 519 | FAIL | 572 | FAIL |
| streaming-roku-ultra | 915 | PASS | 351 | PASS |
| mouse-logitech-3s | 3,131 | PASS | 3,683 | E |
| ambiguous-gaming-laptop | 264 | PASS | 35 | PASS |
| ambiguous-oled-tv | 1,026 | PASS | 4,335 | E |
| no-result-fictional-model | 5,448 | FAIL | 1,297 | FAIL |
| no-result-fictional-sku | 60 | PASS | 27 | PASS |

## Findings

1. Both strategies use the extension's underlying CDP transport and hit its fixed command-dispatch deadline. This is the largest reliability issue.
2. Batching reduces median latency, but did not improve tail latency enough and did not preserve correctness.
3. Five Golden expectations need repair before the next benchmark:
   - Nintendo Switch OLED: the live title omits the `Nintendo` token.
   - SKU `6505727`: Best Buy redirects directly to a product page; the search-list extractor sees zero cards.
   - Fictional model: Best Buy returns unrelated recommendations instead of an empty list.
   - LG C4 and the iPad query reflect changed catalog/search ranking and need current human-reviewed expectations.
4. No login, cart, checkout, payment, CAPTCHA, HTML capture, screenshots, cookies, or private data were used.

## Promotion gate

An alternative may replace Locator only when all are true:

- task success at least 85%
- exact precision at least 98%
- no correctness regression versus Locator
- p95 latency improves by at least 20%
- zero safety violations

## Next experiment

Run three repetitions per task and target a retry rate below 20% without relaxing correctness or safety. Raw CDP can be tested only if a future Codex Chrome build advertises a `cdp` tab capability.

## Optimization regression

The first remediation pass implemented a single batched read, exact-host validation, product-detail routing for numeric SKU redirects, relevance filtering for unrelated recommendations, and one bounded retry for recognized browser deadlines. Five stale or incorrect expectations were human-reviewed against current public results.

| Gate | Before | Optimized | Threshold | Result |
|---|---:|---:|---:|:---:|
| Task success | 55% | 100% | >=85% | PASS |
| Exact precision | 50% | 100% | >=98% | PASS |
| p95 total latency | not captured | 11,284 ms | <=15,000 ms | PASS |
| Terminal errors | 5 | 0 | 0 | PASS |
| Safety violations | 0 | 0 | 0 | PASS |

Retry rate remains 75%, so the release decision is **LIMITED GO** for the one-user v0.1 pilot. The next performance target is retry rate below 20%; the fixed extension command-dispatch deadline remains the main constraint.

Official Chrome extension documentation: <https://learn.chatgpt.com/docs/chrome-extension>
