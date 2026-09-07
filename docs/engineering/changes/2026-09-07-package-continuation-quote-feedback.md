# Package requirements, edition continuation and quote feedback

## Research (completed before implementation)

Baseline: v0.17.30, clean main at `6fe7254edb377b9a125938e2a20ec61deef8757e`.
Authority: Chris requested code changes and synchronization before manual retest.
Design: agent-design §§4, 6, 7, 10, 11, 13. No identity/trust/permission expansion, memory change, local catalog or new dependency.

FACT: task 01a07cd8 submitted `requiredSize: "70 pads, 155g"`. SearchProductsInputSchema accepts this. search_products -> search-products -> normalizedSizeRequirement -> evaluateProductRequirements treats the composite as a variant size, while explicit `requiredFeatures: ["70 pads", "155 g"]` correctly verifies the Mild description and leaves regular 155g unknown. The same request is saved in snapshot/goal receipts and consumed by inspection and continuation.

FACT: search_products -> mergeSearchRequirements -> continuedIdentityQuery rejects both recorded Mild follow-ups with PRODUCT_CONTEXT_CONFLICT. Server catches this as generic INVALID_ARGUMENTS. Controlled refinements cover colors/sizes, not cosmetic editions or the bound candidate's longer title. Raw schema is a ZodObject consumed through `.omit` by visual input: do not replace it with a transformed schema.

FACT: standalone product-comparison-ui and embedded product-card-ui both wait only 8 seconds for quote RPC and flatten denied/missing-reference/timeout into a retry suggestion. Server authorizeQuote allows 20 seconds for host consent; quotes then run in parallel with a maximum 5-second provider deadline. UI timeout does not prove server cancellation. Quote errors already contain safe codes but UI ignores them.

FACT: selected inspection uses exact same-host product JSON/page, bound variant and schema checks. Recorded failure is generic English. Exact-page read-only replay currently succeeds, so its historical cause is UNKNOWN. The screenshot's actual quote RPC error is also UNKNOWN; simulated denied/reference/timeout paths reproduce the misleading copy, not the original host outcome.

Validation baseline: original diagnostic replay reproduced package/continuation/UI defects; existing medicube, identity consumers, comparison UI and quote authorization tests passed 52/52, demonstrating a trajectory coverage gap. Existing live QA ran independent searches, not confirmation on the same goal.

Dependencies: Node 24, pnpm 10.34.5, existing Zod/MCP SDK/Vitest; active MCP build consumes these modules, Railway feed does not. Default Vitest excludes database integration tests. No DB change or production test writes.

## Propose

| Dimension | A: individual entrance patches | B: small shared contracts (selected) |
| --- | --- | --- |
| Structure | Normalize only tool handler, special-case edition there; copy feedback in two views | Pure package normalizer shared by search/merge, bounded refinement in existing domain module; shared quote feedback injected into both views |
| Benefit | Fewer touched files, quick localized repair | Direct consumers and both UI surfaces use the same rules; full same-goal replay locks behavior |
| Risk | Direct search/inspection or one UI can drift; model-only field guidance insufficient | Shared helper changes need consumer tests; no free-form identity substitution |
| Cost | Low initially, repeated contract tests per caller | Moderate bounded changes, no migration/dependency/backend rewrite |
| Rollback | Revert patch/build/cache | Revert versioned commit/build/cache, no data migration |

Select B. Preserve hard identity anchors and reject conflicting editions/models. Candidate title expansion requires an original snapshot candidate and retained original identity, not arbitrary added words. Neither route claims a stable same-item ID from a title or user confirmation alone.

## Frozen Plan v1

Each step: first reproduce red at its public seam, implement minimally, immediately run `pnpm build:mcp` plus its named Vitest file(s), then proceed. Failure stays in that step.

| Step / dependency | Contract and change | Assertions / command |
| --- | --- | --- |
| S1 / none | search-products + requirement-context: recognize whole package count/net-weight expressions; retain original hard meaning as features before receipts/execution. Leave shoe/display/unrecognized sizes intact; never truncate constraints. Tool description clarifies fields. | `pnpm exec vitest run apps/mcp-server/test/medicube-official-regression.test.ts apps/mcp-server/test/search-requirements-context.test.ts`; composite package matches Mild evidence, regular net mass stays unknown, true sizes unchanged |
| S2 / S1 | requirement-context + server: narrow to explicitly requested cosmetic edition; exact previous candidate title may provide longer spelling only with old anchors/category retained. Safe context conflict receipt, no automatic NEW/CORRECT bypass. | Same files plus goal-context tests; original full/short Mild continuation succeeds on same goal, unrelated constraints retained; second model/character and conflicting edition rejected |
| S3 / S2 | selected-product inspector/server: typed safe source/identity/format failure codes and localized terminal failure; preserve exact-target safety, no replacement search | selected-product + identity-consumer tests; safe reason visible, raw URL/body hidden, no alternative search or stale quote upgrade |
| S4 / S3 | shared quote feedback and both comparison UIs: wait beyond consent + parallel provider budget, classify authorization/reference/capability/unknown outcomes, preserve table/selection, no blind retry; late responses cannot replace a newer view | both UI files + quote-authorization-server tests; actual script callback replay for denied/cancel/missing/expired/unknown/success-after-8s, duplicate click and stale response; zero unauthorized quote writes |
| S5 / S4 | integrated trajectory and final release | same-session first search -> inspect -> Mild confirmation -> comparison, full `pnpm typecheck`, `pnpm lint`, `pnpm build:mcp`, `pnpm build:awin-feed`, `pnpm test`, `git diff --check`, installed stdio/read-only live check; commit/push/CI, explicit Railway production health/hash, marketplace/cache verification separately |

Unknown host prompt behavior and true original-photo identity remain manual acceptance items. No live anonymous carts, orders, payment, login or Watch mutations in verification. A timed-out UI operation is an unknown outcome, never proof no Cart was created. Retain existing bounded authorization and provider cancellation; UI does not invent host cancellation support.

## Implement / Test

S1: 3 red assertions, then MCP build and 36 assertions passed. The first synthetic regular description included unrelated shipping mass and was filtered; corrected the fixture to the observed net-content text, without changing production matching or accepting shipping mass as net content.

S2: original full/short confirmation red at continuation after fixture correction; then MCP build and 51 assertions passed (medicube, requirement context, goal and context boundaries). Original snapshot retained; no identity replacement permitted.

S3: 3 diagnostic assertions red, then MCP build and 40 assertions passed. Historical inspection failure remains unreproduced; added typed reason/host with no raw exception leakage.

S4 plan clarification before further code: actual script timer tests exposed that directly hydrating an embedded comparison leaves `hasResult=false`, allowing the old 5-second card-loading timer to erase a valid comparison. Option A marks comparison arrival as a result (selected, one existing state assignment); option B adds a separate comparison-ready state (extra duplicated lifecycle). Add A to S4, covered by the existing 9s/36s tests. This does not change source, permission or UI scope.

S4: initial UI callback replay failed 25/26 cases; build and 128 assertions passed after fixes, then extended wrong-selection coverage. Complete same-goal replay now includes comparison. No live Cart writes.

Final validation initially found a strict optional-property type mismatch, the intentional package-field contract change in an old expectation, and excess distributed-skill bytes. Fixed representations and compressed guidance without weakening thresholds.

Live observation 17:51 UTC: pre-version original-trajectory check passed 8/8; later versioned run passed three independent cases but inspection failed. Safe exact-URL probes found HTTP 429 on both medicube product JSON and page, no Retry-After. Stop further live reads during cooldown. This is not a proven cause of the historical screenshot.

S3 plan refinement before code: classify direct HTTP 429/5xx as source response failures and do not request the HTML fallback on those transient rejection responses. A: keep page fallback and only classify final status; B: classify and stop at JSON transient failure (selected, reduces requests under rate limits). Preserve existing fallback for unsupported JSON, identity safety, and no automatic retry. Add deterministic 429/503 tests and rerun build/consumers. Final release remains pending verification.

Refinement: both HTTP tests first failed and then passed after implementation (38 inspector assertions plus 4 consumers). The 6,400-byte skill contract and literal safety guidance were preserved; package field guidance is in the tool schema, not an added prompt paragraph. Versioned resource URIs changed to v37/v7 with bundled stdio 4/4.

Final local gate: v0.17.31 builds and typecheck passed; full default suite 133 files / 1,961 assertions passed, diff clean. First-run failures above are retained. No DB integration test (unchanged contracts), actual Cart, Watch or production DB mutation. Release evidence remains separate in v0.17.31 notes.

At 17:56 UTC final-bundle cooldown recheck: 7/8 live assertions passed; exact inspection safely returned RATE_LIMITED. No more merchant reads. Final lint passed. Product/host acceptance is explicitly incomplete. LIMITED GO only for the user's requested sync-then-manual-test delivery; do not label all validation or the full Test phase complete. Installed live inspection is blocked by the same upstream condition, not counted as passed; mandatory installed stdio/source-hash checks still run. This release disposition preserves the failed assertion and scope rather than weakening the test.
