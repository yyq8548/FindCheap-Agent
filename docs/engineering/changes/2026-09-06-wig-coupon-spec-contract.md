# Wig discovery, Coupon and specification contracts

## Outcome, authority and baseline

Chris authorized fixing the findings from task `01a07746-cc84-7c01-820b-6b0b10a4ac5c` and publishing on 2026-09-06. Baseline: `61dbaf9cdda1d8f9c6a66e865168b65bea3cec59`, runtime 0.17.27, clean main. Scope follows Agent design sections 4–6 and 13. Preserve read-only shopping, source trust, variant identity, price evidence, snapshot selection, budgets and real quote consent. Publication is an R2 production action with explicit user approval; no new provider, runtime dependency, local catalog, credential, scheduler or persistent format.

## Research

FACT: Recorded black/$100 refinement, same-snapshot selection and selected-product Coupon lookup succeeded. Read-only replay of the recorded comparison rendered nine rows in both UIs but empty specification cells. The 29 merchant offers were reported as 87 associations across three cards. WS30 was correctly assessed WHOLESALE_ONLY, while the raw card label still selected it. UI independently hid that label. No Cart was requested. These recorded examples are development evidence, not held-out or current checkout verification.

| Chain and contract | Facts / consumers |
| --- | --- |
| Awin Promotions service `offers.normalizePromotion` / DealPort / `deal-assessment` | Nonempty `NO` becomes an eligibility entry; the nonempty-entry gate precedes sitewide candidate handling. Preserve the raw terms. Unknown terms can never prove product eligibility. Assessment also feeds ranking, price estimates, cards and selected deal research. |
| `server.withVerifiedCoupons` / snapshot / both UIs and model text | Summary uses an eligible preferred offer; card label uses the first ranked entry instead. `unifiedResult` counts per-card copies. UI already follows the summary. |
| `awinCardProduct` / `rememberSnapshot` / `product-comparison` | Awin card mapping always supplies empty variantDimensions; feed titles and variant-bound merchant URLs survive. Numeric sizes without units must stay uninterpreted. |
| `selectPresentationCandidates` / flat snapshot products / product-card UI | Merchant-diverse mode then fills remaining slots by unique variant ID. Same source/merchant canonical product URLs identify display families, not same-offer price comparability. Each variant needs its original price and selection ID. |

Node 24, pnpm 10.34.5, pinned MCP SDK 1.30.0, Zod 3.25.76 and esbuild 0.28.2 remain unchanged. Build entrypoints: `pnpm build:mcp`, `pnpm build:awin-feed`; default Vitest excludes database integration tests. Existing Coupon tests use empty eligibility arrays rather than observed placeholder text. Prior recorded reproduction: selection/target/no-Cart assertions pass; label and unique-count assertions fail. No CONTEXT.md or applicable ADR was found in the active repository. Archived commercial-platform code is outside scope.

UNKNOWN: NO/N/A are not proof of no restrictions; actual checkout applicability, host permission popup behavior and full source catalog coverage remain unverified. The design below requires explicit sitewide language for a conditional merchant candidate and never upgrades such an offer to PRODUCT_CONFIRMED.

## Propose

| Approach | Benefit | Risk / cost / rollback |
| --- | --- | --- |
| Domain assessment and existing card/snapshot contracts (selected) | Works with current and cached source responses; keeps all consumers on shared eligibility; preserves raw source facts | Small deterministic helpers and contract tests; source/installed bundle rollback, no data migration |
| Source adapter enrichment plus versioned promotion/variant DTOs | Richer explicit source metadata before MCP | Changes both service and plugin contracts, requires cache/backward-compatibility migration and still must handle old records; higher cost for this bounded incident |

Choose the first approach. Titles only yield bounded, visibly merchant-reported variant text when a numeric variant URL is bound to that feed item. No broad description parsing or invented dimensions. Display grouping uses source/merchant/canonical product path, not title similarity. It never changes same-item identity or selection authority.

## Frozen Plan v1

Each step adds a failing public behavior assertion first, then implements and immediately runs `pnpm build:mcp` plus the named tests. A failure holds its step. Release follows only when the final gates pass.

| Step / dependencies | Atomic behavior | Assertions |
| --- | --- | --- |
| C1 / none | Recognize exact NO/N/A placeholders without erasing raw terms; explicit sitewide merchant offers become conditional candidates only after conflict, scope, customer and minimum-spend checks | deal-assessment and deal-concierge: placeholder, mixed real restrictions, wholesale, mismatched product ID, no product confirmation or estimated discount |
| C2 / C1 | Align raw card label with eligible summary; deduplicate offer IDs within merchant; selected-deal text leads with chosen candidate and includes scope/assessment instead of unbounded raw offer prose | MCP search/compare/deal contract with source substitutes: three products/29 unique offers, rejected wholesale label, both locales, same selection and zero Cart |
| S1 / none | Extract bounded merchant-reported variant suffix only from a source-bound numeric product variant URL; copy into Awin card and comparison, preserve unknown units | helper plus MCP contracts: Finger Wave/Natura Black, Brazilian Hair, ambiguous/no suffix, other variant URL, no new quality/price/trust claims |
| G1 / S1 | Prefer distinct source-owned styles when filling ordinary category-discovery slots; expose an optional display-family key only for that intent | ranking and MCP contracts: duplicate variants, different merchants/styles, exact and explicit cross-merchant requests unchanged |
| G2 / G1 | Fold same-family cards behind a real variants disclosure; preserve order, original IDs, prices and selection controls | DOM tests: hidden variants still selectable in same snapshot, primary/selected variant visible, legacy snapshots and nine comparison rows unchanged |
| V1 / C2,S1,G2 | Synchronize design and concise release metadata, build both artifacts, run types/lint/full tests/stdio/diff; replay original recorded case and bounded live reads | Current artifact evidence, explicit pass/fail counts; no claim of held-out or actual checkout acceptance |
| R1 / V1 | Commit/push, check GitHub CI; explicitly deploy existing Railway production and check deployment/health/ready/read-only search/artifact hash; upgrade only FindCheap marketplace/cache and verify enabled version, file equality and installed stdio | Each destination verified separately; locked old cache is preserved, no force push or forced replacement |

Railway target: project `9bf7a976-a5ca-4524-bb9b-457d1a4750b5`, environment `c115fe92-33b0-45e2-b7f4-6af738c0f1b0`, service `2a177106-d0e0-4de9-a9fd-de6a4c258f2b`. Preserve current volume and previous successful deployment/package. On identity, consent, price or source-safety regression, stop publication and repair or revert only this change. No production Feed refresh or Cart mutation is used as a diagnostic.

## Implementation and verification

Completed C1–G2. Each module change was immediately bundled and checked. No source/permission expansion or data migration. Original task replay remains local; sanitized fixtures contain no private task logs or images.

| Step | First failing assertion / correction | Passing evidence |
| --- | --- | --- |
| C1 | Four NO/N/A cases incorrectly UNKNOWN; preserved raw terms and bypassed only the placeholder-entry gate for merchant-wide conditional candidates | Assessment/client/concierge: 3 files, 46 tests; no price calculation or product-confirmation relaxation |
| C2 | Three MCP failures: 87 vs 29 and wholesale raw label; aligned label, deduplicated count and bounded selected summary | Card/selected-deal and server: 79 tests; locale: 6 tests. Two old server assertions promoted unverified selected-style offers; replaced with explicit no-recommendation plus retained raw evidence assertions |
| S1 | Awin MCP comparison received empty specifications; new helper initially absent | Helper and Awin contract: 15 tests; original suffix spelling and unknown units preserved |
| G1 | Duplicate style displaced distinct style; no display-family output | Ranking/Awin/search: 112 tests. Only ordinary category trusted-slot fill opts in; lowest-price, explicit cross-store and visual behavior retain their boundaries |
| G2 | Variant disclosure absent in both locales; merchant-label translation missing | Both UIs: 77 tests, including actual bridge messages from folded selections and nine-row contracts. Subsequent variants fold at original ordinal positions rather than being moved beside the first family member |
| V1 | Two skill byte budgets exceeded by 2/3 bytes, plus obsolete summary field assertion | Compressed wording without increasing caps; asserted actual dealSummary field. Final default suite: 125 files / 1,828 tests; typecheck, lint, MCP/Awin builds, separate 4-test bundle stdio and diff checks all pass |

Typecheck also caught the eBay branch lacking merchantId and an overly broad MCP result type in the new test; fixed locally before release. Lint caught a control-character regex; replaced with explicit character-code bounds. The standalone replay harness first lacked a complete source diagnostics DTO, then incorrectly supplied already-assessed output as raw DealPort input; both harness contracts were corrected, not production validation weakened.

Recorded Awin-only source replay of initial search → black/$100 refinement → UI selection sync → comparison → selected Coupon: PASS. Three original products retained; 29 unique offers; IS18 conditional candidate, WS30 not promoted; all three source-reported specification suffixes preserved; same-snapshot IDs and original selected product maintained; zero Cart calls. Selected summary is 342 characters. Shopify's research-only candidates and final model wording were not replayed. This is a known development case, not held-out accuracy.

Bounded live production reads succeeded for product search and Ishow offers (29). Source still reports IS18 with eligibility NO and explicit sitewide title, and WS30 as wholesale; no checkout applicability was tested. Direct legacy Feed query results are raw source observations, not final plugin recommendations. No source refresh or private Feed download was requested.

Final artifact SHA256: MCP `1ce1f87c1d3b10a202b254aa4cedd84f1ba86dcda7189a9e3a3681dc092d443b`; Railway Awin `8ee8b5643682402eb108a3f9af67ec75e130f40002e9f9ad9e8fb145203cf12d`.

Default tests exclude database integration tests. Real desktop folding/wording and actual checkout Coupon applicability require user acceptance; host authorization, lifecycle, Watch and independent-image gaps remain. R1 publication is authorized but destination completion is verified after commit, not inferred here.
