# WooCommerce merchant identity review and recommendation admission

## Research and authorization

The user explicitly approved reviewing all 200 existing Woo merchants: verified direct brands enter the official and trusted registries; qualified retailers enter the trusted registry; insufficient evidence leaves search access unchanged. This continues the authorized commit, push, production deployment and installed-plugin delivery workflow. Baseline: clean `4ddbf444e5b210712d9bff4118fea687bb6f59ba`, v0.18.0. Applicable design: sections 5, 7, 10 and 13.

FACT: the production official registry has 111 records and merchant trust has 211. A normalized exact-host comparison against all 200 Woo origins and aliases found zero overlaps. The independent access table is not trust evidence. `wooProductFacts` resolves trust by actual source host; `assessCatalogProduct`, `assessRanking` and `choosePrimaryRecommendation` already admit independently trusted Woo offers under the common identity, requirements and price gates. High product ratings alone cannot grant primary eligibility.

FACT: `OfficialStorefrontRecordSchema` supports Shopify, generic JSON-LD and Sony only. Its consumers include database publication/loading, the source HTTP registry, MCP registry refresh, known-product URL admission and official search dispatch. A newly added enum would cause old strict clients to reject the whole registry. The Woo catalog already performs one or at most two bounded Backend passes; adding a second native official fetcher would duplicate traffic and lose Woo source provenance.

FACT: Registry Builder supports explicit reviewed approvals, candidate import/probes, transactional approval and immutable publication. Existing published records must be retained. No migration or dependency is required. Current build commands are `pnpm build:mcp` and `pnpm build:awin-feed`; both consume shared contracts.

UNKNOWN: each merchant's current brand ownership/business identity and substantive support evidence. Three independent research batches cover indices 1–67, 68–134 and 135–200. Each review records identity and policy/support pages, concrete findings, retrieval time/status, limitations and a decision. Current API/product evidence is supporting evidence only. Failed reads remain recorded. No admission quota is imposed.

## Alternatives

| Dimension | A: native Woo registry routing | B: generic official page adapters |
| --- | --- | --- |
| Official search | Add Woo platform; use existing Backend Woo pass with reviewed host priority | Register individually verified JSON-LD sites and use the generic official adapter |
| Provenance and variants | Retain Woo IDs, child price evidence, image proxy and source budgets | Independent HTML reads and extra deduplication; JSON-LD coverage differs by merchant |
| Compatibility | Negotiate the extended official registry; legacy clients retain supported entries | Existing registry platform remains compatible |
| Cost | Small shared contract/HTTP/client/routing changes and regression tests | More per-store HTML configuration and duplicate search traffic |
| Rollback | Previous bundle and immutable registry release; access list unchanged | Previous registry release |

Choose A within the approved implementation scope. Old clients receive the legacy platform subset; updated clients explicitly request schema 2. Both responses have separate ETags and Vary metadata. The common trust/ranking algorithms are retained. Explicit other-brand Woo product evidence must not be overwritten by the merchant's own brand.

## Frozen plan

| Step / dependency | Minimum behavior | Immediate build and assertions | Exit condition |
| --- | --- | --- | --- |
| 1 / research | Extend official platform contract, negotiated source representation and MCP refresh header | Both consumer builds; HTTP old/new registry, ETag separation/304, refresh tests | Legacy registry remains parseable; updated client loads Woo records |
| 2 / 1 | Route reviewed Woo brand/PDP through existing catalog pass; prioritize only existing access hosts; preserve selected Woo URL attributes and explicit product-brand conflicts | Both builds; real search orchestration tests for Woo official/retailer/unknown, URL variant/canonical handling, no Shopify official reads, six-store/two-pass budget | Correct source/identity and display/primary gates without duplicate official network paths |
| 3 / independent | Complete all 200 evidence decisions and explicit approval payloads | Validate 200 unique decisions, evidence completeness, schema/host/brand-alias uniqueness against live baseline; independent review of uncertain cases | Every store has a justified disposition; unverified stores retain search only |
| 4 / 1–3 | Update design/docs and patch release; final regression and review | Typecheck, lint, both builds, full unit suite, bundled stdio, diff checks; prospective-registry SDK smoke | Mandatory gates pass on final artifacts |
| 5 / 4 | Commit/push and verify CI; deploy compatible source; import/probe/approve reviewed batch and publish immutable registries; update installed cache | Live old/new representations and exact additions, ETags, health, trusted/official Woo recommendation SDK checks; installed parity and stdio | Source, registry and installed bundle agree; native host acceptance separately reported |

No new cart, checkout, affiliate authorization, delivery-price claim, network permission or recurring crawl. Known-stock and unknown-stock semantics remain distinct. Source access count stays 200, with at most six stores per pass and two passes. Evidence and probe failures must not be relabeled as successes. Publication guards the baseline and preserves unrelated records and old immutable snapshots.

## Execution and verification

Research and plan were frozen before runtime changes. Raw review observations remain under ignored `artifacts/woo-trust-200/`. Portable [200-store decisions](2026-09-08-woocommerce-trust-200-evidence.json) and [explicit approvals](../../../config/registries/reviewed-woocommerce-trust-2026-09-08.json) are versioned.

- Step 1: negotiated official-platform tests first failed 3/6, then both consumer builds and 30 scoped assertions passed. Legacy and schema-2 representations have separate ETags and correct conditional 304/Vary behavior.
- Step 2: initial routing/identity regression failed 5/14; explicit other-brand grouping and direct official-PDP grouping each received a failing regression before repair. Independent review reproduced canonical-brand/alias exclusion. Twelve real-sample alias cases now pass, including both query spellings and explicit conflicting brands. Combined scoped routing/alias/compatibility tests passed 36/36. Real registered MCP snapshot tests cover OFFICIAL, ESTABLISHED_RETAILER and high-rated UNKNOWN; only independently trusted eligible offers receive a primary selection.
- Step 3: A 67 = 52 official / 12 retailer / 3 search-only; B 67 = 46 / 18 / 3; C 66 = 39 / 15 / 12. Total 200 = **137 / 45 / 18**, with 319 explicit approval records. Successful technical probes were 197/200; the three failed results remain FAIL. Known mixed independent-brand catalogs are retailer-only. Normalized punctuation/accent duplicate aliases were removed after the initial schema rejection, without adding any unreviewed alias. Data gates passed 6/6 and preserve the full search-only denominator.
- Step 4: final local checks at 2026-09-08 20:58 UTC passed: both builds, typecheck, full lint, **162 files / 2,589 assertions** including bundled stdio **4/4**, and diff checks. The initial versioned full run had 5/2,587 failures, all old `0.18.0` expectations in transport/UI/plugin tests; synchronized `0.18.1` expectations plus two added alias cases produced the final pass. This does not establish native host acceptance.
- Production database read-only audit returned `VALIDATED_NOT_APPLIED`: baseline `registry-2026-09-07-medicube` and all 322 previously approved records unchanged; 319 proposed additions schema-valid. Proposed representations are 71,014 official bytes and 55,712 trust bytes, below existing 512 KiB client caps. The audit returns before mutation and is not called a complete publication rehearsal.
- Independent operator review found no unresolved P1/P2. Actual collect/publish uses existing repository helpers in one guarded transaction, locks registry tables, compares baseline/approved content, verifies complete publication before commit and retains the old immutable release. Credentials stay in the source service environment; only public review data and sanitized receipts cross SSH stdin.
- Prospective-registry SDK replay passed **47/47**, with zero network attempts and clocks frozen to the saved source observations. It checks all 200 domain dispositions; real saved Root Science, General Pencil, PINE and Seven Cups primary selections; every search-only merchant's original sample and an explicitly labeled high-rating/in-stock counterexample; and stock, price, parent-range and brand conflicts. The initial 46/47 result used an invalid `condition` request property in the harness; correcting it to the real `conditionPreference` contract produced 47/47. No runtime change was needed and the original failure log was retained. This is saved-source replay, not current merchant or native-host verification.

Runtime package: `0.18.1+codex.20260908204926`. MCP SHA-256 `b3c809de4b5bf6973e8a384bd6de0a9b01b58876d0764c033333d07d1978f41d`; source SHA-256 `d98795de79eb54f1e91e46a930b3c4ae8753fca8b38f6be42d4a9ba1395fb343`.

Step 5 completed at 21:07 UTC: runtime commit `f4fc7ec` pushed and both CI workflows passed; compatibility and refresh production deployments reached SUCCESS with matching source hash. Publication committed all 319 approvals, yielding 248 official and 393 trusted records with prior content retained. Live registry checks 6/6, source checks 8/8, installed-cache stdio 4/4 and installed live SDK 6/6 passed. Installed package enabled with 13/13 source parity. The occupied old cache backup failed without preventing new-cache registration; no locked directory was deleted. Exact receipts, deployment IDs, limitations and CI links are in the [release](../../releases/v0.18.1.md) and [delivery JSON](2026-09-08-woocommerce-trust-200-delivery.json). Native host acceptance remains unexecuted.
