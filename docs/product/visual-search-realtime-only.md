# Visual search without a local product directory

This document records the implementation checkpoint before publication. The user
subsequently approved release as v0.17.16; see `docs/releases/v0.17.16.md`.

## Outcome and scope

User decision, 2026-09-05: remove the local official-product directory. Products
are retrieved from current official, Awin, Shopify and configured eBay providers.
Keep reviewed source/trust registries and the prior real-time visual fixes.
No version bump, commit, push, deployment, cache replacement or user-data deletion.

## Removed

- `official-catalog.ts` persistence/search adapter and independent sitemap crawler.
- Operator import, refresh and discovery command and pilot host manifest.
- Runtime initialization, Backend injection, unified-search merge and catalog
  diagnostics. This also removes the older keyword-cache integration, not just
  the new independent-discovery experiment.
- Local metadata ranking and catalog-specific tests. Integration tests now cover
  real-time official retrieval and rejection of legacy catalog injection.

Old local catalog JSON and development artifacts remain untouched but are no
longer read. There is no migration or auto-cleanup. Tracked removed code can be
recovered from Git history; experiment evidence remains in ignored local files.

## Preserved architecture and controls

- Existing adapters and parallel source execution, official/trusted registries,
  remote Awin feed service and Shopify provider are unchanged in purpose.
- SearchRun owns ephemeral request deduplication, attempted official-query hashes,
  and reviewed-product hashes. A new search makes new provider requests.
- If first-round images fail, continue untried official queries. Retain two slots
  for the same-run tail and reserve one for fresh results when appropriate; return
  unused capacity to the tail. No third review round or extra total budget.
- Keep compact palette/pattern and separate structural queries, with the original
  effective Shopify first query retained. Required brand, product-family and
  identity constraints still apply before display. Swimwear, bodysuits and
  jumpsuits/rompers cannot silently become a dress or standalone top.
- Keep canonical/variant verification and actual HTTP/read-byte accounting.
  Sources never gain trust from metadata, and text matching cannot establish
  visual identity. Network destination/body limits remain enforced.
- Keep bounded same-search memory reuse, immutable selection snapshots and
  user-authorized Watch state. Removing a product directory does not remove
  comparison context or break existing Watch persistence.

## Acceptance gates

- Typecheck, lint, MCP build, Awin service build, full automated suite, stdio smoke
  and `git diff --check`.
- Bundle input graph and payload contain no local official-catalog module/path.
- Legacy JavaScript catalog injection is ignored for both text and visual search;
  a separate search re-queries the current provider.
- Real-time MCP integration retains out-of-stock / research-only semantics.
- Replay six frozen development images using the current bundle, original image
  observations and stated brands. Product names/expected URLs remain scorer-only.
  Reuse previous judgments only for identical reference AND candidate image bytes.
- Do not claim full six-image acceptance or held-out accuracy from unit tests.

## Verification

Typecheck, lint, MCP and Awin builds, and whitespace checks passed. All 906 tests
across 71 files passed, including three bundled stdio smoke tests and the bundle
exclusion checks. The previous 923-test count included the removed catalog tests;
those were retired with the feature, and live-provider regression coverage added.

Current development MCP bundle SHA256:
`5b45a92e4c897426122986641bed82b5a8c39c71586b97e08f7983ec68860bcd`.

A fresh real-time-only run retained 5/6 known targets: Julia, Faye, Zeno, Oren and
Belden. Faye remained out of stock / research only. Zeno and Oren stayed highly
similar, not exact-identity claims. Nataly returned no accepted product; it is
still a retrieval miss, not proof of absence. No run exhausted its shared budget.
The isolated state directory stayed empty and no trace contained a local-catalog
source or diagnostic. Expected product names/URLs were checked only afterward by
the scorer; the original image observations and brands were unchanged.

Local ignored evidence:
`artifacts/visual-pilot/realtime-only-unit-results.json`,
`artifacts/visual-pilot/realtime-only-verification.json`, and
`artifacts/pdf-six-trial/runs/realtime-only-verified-01` through `-06`.

This establishes removal and non-regression for these known examples, not general
visual-search accuracy. No commit, push, version bump, Railway deployment or
installed Codex cache replacement was performed.
