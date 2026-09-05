# Qualified-result recovery

Approved September 5, 2026. Baseline: 3f32301 / 0.17.18. Implementation initially
local-only. Chris subsequently authorized v0.17.19 publication, Railway production
deployment and installed-cache replacement; see [release scope](../releases/v0.17.19.md).

Contract: preserve explicit snapshot-bound requirements, distinguish fulfilled
fit from merchant trust and research cards, perform bounded targeted retrieval,
then offer one authorized web-discovery session when complete API results contain
no qualified fit. Partial sources and exhausted budgets are not absence evidence.
No local product directory, new trust approval, checkout or provider rewrite.

Acceptance: replay shampoo then oily scalp/dandruff; aliases and negations;
distinct queries; research cards do not block recovery; unavailable sources do;
runtime consent, expiry and single-use limits; page-owned price/identity; new
snapshots and comparisons; old references remain valid. Run all existing tests,
typecheck, lint, builds, stdio smoke and bounded live probes before handoff.

Implementation boundary: the plugin can enforce consent and admission of one
web-recovery session, its deadline and at most five merchant-page reads. Codex
owns the external Chrome tool and its own navigation permissions. Do not claim
that a plugin token can police arbitrary unrelated browser-tool calls. Browser
discovery returns URLs only; merchant-page verification stays inside the plugin.

## Implementation

- `functional-requirements.ts`: bounded oily-scalp / anti-dandruff aliases and
  negation checks. A scalp mention or ingredient alone is not efficacy evidence.
  Compact retrieval retains every hard requirement for final evaluation.
- `search-products.ts` / `text-search-recovery.ts`: separate qualified fit,
  recommendability and research counts. Complete two-pass text searches with no
  qualified fit may request recovery even when research cards exist. Source
  failures and exhausted budgets remain incomplete, not absence.
- `begin_web_search`: host MCP form elicitation, never a model approval flag.
  Consent wait is capped at 25 seconds. One admission per immutable snapshot;
  expiry is 60 seconds after approval. Hosts without form elicitation fail closed.
- `complete_web_search`: URLs only, at most 5 distinct hosts, two concurrent
  reads, at most 1 MiB per page, and at most 25 seconds within the remaining lease
  (fits the existing 30-second host tool deadline). Single use, no redirect
  following, public-DNS checks and no credentials. The old snapshot is retained.
- Shared Product JSON-LD parsing, requirement/identity/trust/ranking gates and
  native comparisons; at most 3 cards. Canonical base PDPs may identify selected
  variants only when an exact-URL offer independently binds that variant price.
  Missing, conflicting, unsupported-currency or ambiguous offers fail closed.
  No cart quotes for these merchant-checkout-only cards; no inferred Coupons.
- Fixed pre-existing `isColorRequirement` empty-array `every()` bug: non-color
  requirements no longer become color selectors. Existing visual tests retained.

## Verification — September 5, 2026

- Full suite: **1,006 / 1,006 passing**, 75 files; baseline 960 tests.
- Typecheck, lint, MCP build, Awin service build, stdio smoke (3/3), diff check:
  passing at the implementation gate; rerun for versioned release 0.17.19.
- Regression includes consent refusal / unsupported hosts / concurrency / expiry /
  replay / forged facts / DNS-to-private-IP / redirect / oversized page / bounded
  stalled adapter / competing offers / original hard constraints / native
  comparison / preserved old IDs / rejected mixed snapshots.
- Live configured APIs: initial shampoo search returned 6 cards in 1.09 s;
  continuation with oily-scalp and anti-dandruff requirements returned 3 relevant
  anti-dandruff research leads in 1.72 s. None proved oily-scalp suitability, so
  qualified=0, recommendable=0, REQUEST_WEB_SEARCH, REQUIREMENTS_UNVERIFIED.
  Old render snapshot was unchanged. No product-absence conclusion was made.
- Three live candidate-page probes were not admitted: Harry's checkout host had
  no usable Product JSON-LD; Distacart hit network/policy failure; Go Vita did not
  provide an admissible price/offer. These are safe failures, **not** three
  successful web recoveries or proof of catalog absence.

Local evidence (ignored, not published): `artifacts/text-recovery/tests.json`,
`live-results.json`, `page-probe.json`, plus their read-only probe scripts.

## Not claimed

Codex's actual Chrome discovery plus host consent UI has not been exercised with
the new installed plugin. Protocol-level consent and URL-to-card-to-comparison
tests use synthetic fixtures; the live SDK client without elicitation correctly
returns PERMISSION_UNAVAILABLE. This does not establish whether Codex itself
supports elicitation. Real host acceptance remains a post-install check.

The web adapter requires bounded, page-owned Product JSON-LD and a uniquely bound
USD offer; it is not a general DOM scraper or full-site crawler. No local product
directory or trust-list expansion. Publication and installation are separately
authorized and verified under the v0.17.19 release scope.
