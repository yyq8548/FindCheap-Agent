# Coffee category search repair

## Research and authorization

The user reported failure in task `01a082ec-10df-7fd3-bf84-3e29c2986b6c` immediately after the authorized Woo trust release. This repair continues that implementation and delivery scope. Baseline: clean main `e2b47c7`, installed v0.18.1, production Woo access 200 and published trust review unchanged. Applicable design: 4.1 category clarification/identity, 5 merchant and recommendation gates, 13 separate business acceptance. No repository CONTEXT.md or applicable ADR was found.

FACT: the original three MCP receipts are retained under `artifacts/woo-coffee-bug/receipt/`. Initial coffee search returned three Woo cards including a grinder. The user's category refinement, budget and US delivery requirement then failed with PRODUCT_CONTEXT_CONFLICT before any search. A confirmed NEW_PRODUCT search returned zero cards with REPORT_INCOMPLETE/SOURCE_UNAVAILABLE; the original agent did not receive REQUEST_WEB_SEARCH. Do not blame that response on a skipped authorized fallback.

FACT: `pnpm exec tsx artifacts/woo-coffee-bug/repro.ts original` reproduces the exact final input through the installed bundle and production gateway: zero cards, two Woo passes, 12 merchant reads/24 bytes of empty arrays. Source completeness can vary by time; this later run returned REQUEST_WEB_SEARCH. The tool, schema and installed version are available. Root replay captured the compiled query `coffee beans whole bean coffee` on both passes (`buildSourceQuery`, `compileSourceQuery`). Delivery requirements are not included in the physical Woo request.

FACT: independent production 2x2 query/type checks returned zero products for coffee beans with or without whole-bean type; coffee returned eight. Six same-store reader observations preserve raw and normalized counts. Barrington's wider results are mostly honey/books/equipment, while Abednego includes actual Whole Bean titles. These controls establish retrieval loss, not eight valid coffee products. A frozen source replay also lets a coffee-themed sock survive category discovery: `candidateIdentity` skips its identity classifier for CATEGORY_DISCOVERY. The fallback must retain product/form validation.

FACT: `mergeSearchRequirements` permits a changed productType only through its reviewed headphone refinement predicate. The public two-call MCP sequence fails deterministically; changing only coffee to whole bean coffee reproduces it, whereas changing only query/budget/delivery does not. Four current exact-identity/category/form conflict guards pass. Existing source adapters, shared requirement evaluation, trust, immutable snapshots, private product anchors and two-pass budgets remain the boundaries. Build commands are pnpm build:mcp and pnpm build:awin-feed; no dependency or database migration is needed.

UNKNOWN: which live products will remain available at verification time. US market, USD or an official merchant do not establish delivery eligibility. Unknown delivery must remain visible as an unresolved requirement, not be removed to create a primary recommendation.

## Proposals

| Dimension | A: source-side category translation | B: shared MCP category interpretation |
| --- | --- | --- |
| Retrieval | Translate reviewed coffee categories at the Woo service; retain original request for filtering | Compile controlled coffee category queries to a useful Woo term within the existing pass |
| Refinement and precision | Separate client predicates for continuation and offer identity | One small reviewed coffee-category helper shared by continuation, retrieval and category assessment |
| Compatibility | Requires source and client rollout; standalone source callers benefit | Existing source HTTP contract unchanged; all identity/requirement receipts remain original |
| Risk and cost | Duplicated semantic rules across service and client need additional contracts | Localized helper and consumers; fail closed for unrelated categories, named models and conflicting selected forms |
| Rollback | Previous source and client bundle | Previous client bundle; trust and access tables unchanged |

Choose B. A valid broad retrieval query is not proof that every result is coffee or the requested form. Use a controlled vocabulary for generic coffee, whole bean, ground, pods and instant; do not accept arbitrary token overlap as a category refinement. Exact models, selected products, visual queries and unrelated categories retain existing paths.

## Frozen plan

| Step / dependency | Minimum change | Build and automatic assertions | Exit condition |
| --- | --- | --- | --- |
| 1 / research | Add a small coffee-category helper with strict category parsing, one-way generic-to-form refinement and product/form evidence assessment | MCP build; pure tests using saved coffee, socks, books, honey and selected-ground counterexamples | Explicit non-coffee/form conflicts rejected; missing form evidence remains unknown; no brand/merchant inference |
| 2 / 1 | Continue generic coffee into a stated form without abandoning the current goal or budget | MCP build; real two-call MCP regression plus exact identity/cross-form negatives | Reported continuation executes; forbidden identity changes remain rejected |
| 3 / 1–2 | Compile reviewed category-only Woo retrieval to coffee; prevent duplicated equivalent category words; enforce coffee category/form through candidate assessment and retain original shipping/price requirements | MCP build; frozen source replay/registered MCP cases, source request assertions, retained/selected identity negatives | Exact user request returns actual coffee beans; no coffee-themed merchandise or wrong selected form; US delivery remains unverified unless evidenced; <=2 Woo passes |
| 4 / 1–3 | Final v0.18.2 patch, design/runbook updates and business regression | Both builds, typecheck, lint, full suite, bundled stdio, original production-backed repro and full clarification sequence | Final artifacts pass; distinguish live limitations and native-host observations |
| 5 / 4 | Continue authorized commit/push/install delivery; deploy source only if its artifact changes | CI, exact remote SHA, installed/enabled cache parity, installed original-sequence test; separate production hash/state if redeployed | User can load the repair; old locked cache retained, no fabricated native UI acceptance |

No expanded merchant quota, trust promotion, policy inference, authentication, browser-approval bypass, extra search turns or new product index. No message is sent into the user's linked task. Raw failed runs stay in artifacts; temporary probes stay in that debug directory.

## Execution

Research and plan frozen before runtime edits. Diagnosis hypotheses were tested separately: type-only HTTP changes do not recover results; query broadening does; the first context guard independently blocks refinement. The original host termination followed REPORT_INCOMPLETE, so no fallback-skill change is planned.

Step 1 completed with controlled category parsing and selected-form assessment. The initial helper stub failed 79/113 assertions before implementation. Observed follow-ups retained their own red runs: the real `Guatemala Coffee – 2oz. – Ground` suffix, selected green coffee, and the generic-search phone cover/dripper observations. The final helper has 123 passing assertions. These cases do not infer form from descriptions, merchant identity or unselected parent options.

Step 2 changed only the existing productType refinement guard. The public MCP suite moved 11 permitted continuation failures to passing while retaining nine forbidden identity/form/translation changes. The step's 118 related assertions and MCP build passed.

Step 3 first replayed nine saved real Woo observations through registered MCP. Seven of the initial eight cases failed, including query compilation, continuation and five wrong-product/form examples. After the fix all eight pass; three explicitly synthetic selected-form cases additionally prove that unknown form cannot gain a primary or be overwritten by a Woo URL anchor. Retrieval boundary tests retain branded, named, model, visual and unrelated queries. No shipping requirement is forwarded as a product-query term or erased from the request ledger.

Business checks caught a further gap: the first live sequence returned three real whole-bean offers on continuation, but generic coffee still included a coffee-colored phone cover and Hario dripper. That early script only asserted the narrowed results. A strengthened generic-stage assertion reproduced FAIL on the same bundle; the saved title regressions and helper repair now exclude both. Do not report the weaker early PASS as whole-sequence acceptance. The updated v0.18.2 sequence returned three actual coffee cards, then Chambersburg, Cross Blend and King Street whole-bean 2 oz offers at USD 2.50 each. US delivery remained UNKNOWN and none received a primary under that requirement. A separate exact NEW_PRODUCT request returned the same three. These are live SDK observations, not a claim that all 200 stores or native host interactions were exercised.

Review extension within step 3: Shopify's selected-variant inspection recomputed identity outside the common candidate path. A source-owned URL or a title match must not promote unknown coffee form. Apply the same shared assessment to the derived snapshot, with real MCP negative and positive regressions: unknown stays unverified, confirmed Ground is excluded, and confirmed Whole Bean can advance. This closes the existing selected-product boundary; it adds no new source or permission.

The first full v0.18.2 run passed 2,743/2,744 assertions; the sole failure was an old escaped version regex in the plugin contract. Updating that literal made the contract suite pass. Final artifact gates and delivery receipts are recorded in the release record, separately from these development runs.

The inspection extension reproduced two failures in three registered-MCP/real-JSON-inspector cases, then passed all three after the minimal derived-snapshot fix. Related inspection and coffee checks passed 29/29. Final MCP/source builds, typecheck, lint and all 166 files / 2,747 assertions passed. The installed final artifact then passed the complete sequence and direct restarted request against the deployed production gateway. Runtime CI, successful production hash verification, unchanged registries and 13/13 installed parity are recorded in the [delivery receipt](2026-09-08-coffee-search-delivery.json). Native host interaction is still a separate user-visible check.
