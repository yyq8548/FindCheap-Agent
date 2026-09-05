# Text-search reliability fixes

Date: 2026-09-05. Baseline: v0.17.17. Release target: v0.17.18.

## Scope

Improve text retrieval, selected-variant evidence, and final response consistency.
The image-review workflow, merchant registry, and production configuration are
unchanged. The release updates the local plugin. Do not equate candidate retrieval
with purchase eligibility.

## Confirmed defects and changes

- The selected-product inspector reused a parser that accepted only `ProductGroup`.
  Margaux publishes `Product` with variant-specific `offers[]`. Its US 7 variant
  survived inspection, but its USD price disappeared. Both JSON-LD forms now use
  the same exact-domain, product-path, single-variant-ID, and currency validation.
  Aggregate prices and another variant's price are not substitutes.
- Text constraints were not forwarded as `requiredColor` to official retrieval.
  Standalone color requirements now select the official variant before ranking;
  compound and Chinese colors are checked against the selected variant rather than
  a description advertising multiple colors. Explicit size evidence remains required.
- Named official-product queries fell back to the first three words plus a broad
  category. Text fallback now retains the full product name and only removes explicit
  feature terms from the retrieval query; final constraints remain enforced.
- Explicit brands start reviewed official-store retrieval alongside other sources.
  A qualifying exact target stops redundant official query stages. Request budgets,
  source timeouts, and the maximum two general search passes are unchanged.
- Missing prices cannot satisfy an explicit budget. Unpriced and unverified-merchant
  candidates no longer satisfy text replenishment targets. They may remain clearly
  limited research leads; merchant trust is not relaxed to fill recommendation slots.
- Final text results no longer reuse intermediate Catalog clarification questions.
  Missing user fields are clarified before searching; official recovery no longer
  carries the obsolete instruction to provide an exact model.

## Verification

`apps/mcp-server/test/text-search-reliability.test.ts` contains 18 deterministic cases.
An additional configuration-with-budget case extends `search-products.test.ts`.
The initial 15-case suite reproduced 9 failures before the fixes. Tests cover:

- Product offers and `@graph` parsing; per-variant USD prices.
- Foreign domains, different products, missing/duplicate variant parameters,
  non-USD and aggregate offers fail closed.
- Budget equality, over-budget prices, and missing/foreign-currency prices.
- Research-only replenishment, selected colors, official query identity retention,
  and removal of stale questions in both Chinese and English.

Run:

```sh
pnpm exec vitest run apps/mcp-server/test/text-search-reliability.test.ts
pnpm typecheck
pnpm lint
pnpm build:mcp
pnpm test
git diff --check
```

Final checks: typecheck, lint, MCP bundle/notices generation, and whitespace check
passed. The complete suite passed 960 tests across 73 files, including stdio and
existing visual workflow regressions. Pre-release development bundle SHA-256:
`74ca1f0ec65e9fd0200856f9567e07aa7cf7cd81c1dbd0d042a8d77380806e8a`.

## Read-only live probes and limits

Six hand-normalized text requests used the repository's public plugin environment,
live Awin/Shopify adapters, reviewed registries, and the modified local source code.
They did not invoke an image model, cart, Watch, production deployment, or installation.
The initial shell-only probe lacked the plugin's Shopify environment; it is excluded
from this comparison. These probes are not an end-to-end model-language benchmark.

| Request | Observation |
| --- | --- |
| wig | Results from the active sources, with trusted candidates available. |
| shampoo | Results from the active sources, with trusted candidates available. |
| SKIMS Soft Lounge Long Slip Dress | Official candidates retrieved. |
| Same dress, Heather Grey required | Still no accepted target; official queries returned other products. This is not evidence of absence. |
| ballet flats, US 7, USD 500 ceiling | Margaux The Demi's three width variants retained explicit US 7, stock, and their own USD 325 prices. Merchant trust remains unverified in this result, so no purchase primary. |
| long straight wig, USD 30 ceiling | Matching-price/attribute candidates remain research leads where independent merchant evidence is missing. |

The Margaux result fixes a confirmed parsing defect, not all text recall. Brand/color
coverage gaps and missing merchant evidence remain separate limitations. Do not claim
that all text queries succeed, that the gray dress is absent, or that a reviewed
merchant registry automatically covers every domain. No new trusted merchants were added.

Rollback: reinstall v0.17.17 or revert this scoped source/test/bundle change. No data
migration, production state change, or new persistent product index is involved.
