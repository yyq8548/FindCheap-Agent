# Identity, snapshot and consent consistency

## Research — facts and scope

Baseline: `65bb80b`, clean working tree, 2026-09-07. Chris approved repair after the diagnosis of tasks `01a07d38` and `01a07d36`. This authorizes local implementation and tests, not release, installation, merchant trust changes or host permission changes.

Applicable design: agent-design sections 4–7, 8.1 and 13. Preserve existing Backend adapters, immutable selection provenance, read-only recovery and server-owned budgets. Node 24, pnpm 10.34.5, SDK Client/InMemoryTransport and Vitest are existing dependencies; no new dependencies or migrations.

| Classification | Evidence and contract |
| --- | --- |
| FACT | `shopify-match.ts: classifyShopifyCandidate` matches edition words against the whole description. A regular product's FAQ recommending Mild therefore satisfies the query token. `assessRequestIdentity` subsequently marks it unresolved but does not remove it. |
| FACT | `server.ts: inspect_selected_shopify_product` assigns TRUSTED_MATCH from merchant verification alone and BEST_VALUE otherwise. It bypasses `product-candidate-ranking.ts` and `ranking-assessment.ts`, and copies one-product comparison counts into a multi-product derived snapshot. |
| FACT | Search, inspection, visual review and quote create snapshots through `rememberSnapshot`. It binds IDs and quote capability but does not currently enforce final presentation eligibility or recompute final summary. Inspection also omits the original SearchRun. |
| FACT | `WebRecoverySessions.begin` owns admission by renderId. CONTINUE preserves goalId but changes renderId, allowing another authorization after a terminal denial. Native logs record form capability, DECLINE and 0–2 ms; they do not prove that a dialog appeared or that the user clicked. |
| FACT | Prior diagnostic replay through the real current MCP server failed both negative assertions: no regular product after explicit Mild, and no unresolved identities in recommendation groups. Replacing only the FAQ Mild token fixes the first failure. No network reads occurred. Existing five suites (106 assertions) passed, demonstrating missing coverage. |
| UNKNOWN | The precise native Codex branch returning immediate decline. Capability advertisement and simulated approval cannot establish visible native consent. Do not change approval_policy or claim host repair based on unit tests. |
| ASSUMPTION | The same shopping goal must not automatically re-prompt after terminal denial/cancellation merely because a card was inspected or a budget was changed. This implements section 7's stop-the-path rule, not a new permission grant. |

Topology: executor/schema → server handlers → existing Backend ports → identity/requirements → candidate ranking → final cards → rememberSnapshot → UI/model context/comparison. Domain presentation stays in domain code; security and source adapters are not rewritten. Research covers these affected paths, not every dynamic provider branch.

## Propose

| Dimension | A: repair each entry independently | B: shared final snapshot guard plus existing identity gate |
| --- | --- | --- |
| Change | Fix inspection groups/counts and add equivalent checks at quote/visual paths | Enforce card eligibility and final summary at the common snapshot boundary; reuse existing ranking assessment |
| Benefit | Smaller immediate diff | All snapshot creators receive the same protection; stable IDs/order remain owned by server |
| Risk | Next derived entry can omit a check again | Common consumer regression risk; requires broad contract tests |
| Cost | Low now, repeated future maintenance | Moderate, no Backend rewrite, no dependency or storage migration |
| Rollback | Revert per-entry patches | Revert this bounded change and regenerated MCP bundle |

Selected B, following approved direction. Keep public identity compatibility: explicit conflicting editions are rejected through existing IRRELEVANT classification; missing edition evidence is not asserted as a proven conflict. Requested edition tokens must come from primary product fields, not FAQ/cross-sell copy.

## Plan v1 — frozen before implementation

| Step / dependency | Module and minimum increment | Build and automated assertions |
| --- | --- | --- |
| S1 / none | Shared identity classifier: edition tokens use primary fields; explicit opposing edition rejected; missing evidence cannot count as a requested edition | First red tests in request-identity and Medicube MCP continuation; `pnpm build:mcp`; targeted identity, Shopify match and Medicube suites |
| S2 / S1 | Shared final presentation/summary guard using existing recommendation assessment; inspection retains source context, SearchRun and immutable history | First red full MCP inspection assertions; `pnpm build:mcp`; snapshot, comparison, identity consumers, quote and visual suites. Unknown identity/trust/price never become trusted/value recommendations; counts match final cards; primary belongs to new snapshot |
| S3 / S2 | Goal-scoped consent admission, exact-render lease consumption, terminal state returned consistently on derived snapshots; no automatic reset after denial/cancel | First red unit and MCP derived-render denial tests; `pnpm build:mcp`; consent/recovery/budget tests. Concurrent admission, timeout retry limit, foreign render/token and zero unauthorized reads |
| S4 / S3 | Strengthen live QA negative assertions and inspected-parent continuation; synchronize guidance/design implementation notes; final integration | `pnpm build:mcp`, typecheck, lint, full default test suite, stdio smoke, `git diff --check`; deterministic original-problem replay |

Each step must first reproduce its defect, then immediately build and run local assertions before proceeding. Failures stay in that step. Further architectural expansion requires re-freezing affected steps.

Native dialog acceptance and real merchant coverage remain separate external acceptance. No cart writes, live Watch, production DB integration, whole-web reads or deployment are required for these deterministic code assertions. The live QA script will be strengthened but not presented as executed native UI acceptance.

## Implement / Test

S1: two classifier assertions and the MCP explicit-Mild exclusion failed before repair. An initial fixture omitted the singular product-name field and failed setup; corrected the fixture before using it as defect evidence. After repair: MCP build and 38 assertions passed (three files; the supplied shopify-match filename was not a test file).

S2: the new inspection assertion first failed because unresolved cards became recommendation groups. Shared projection, final summary and context preservation implemented. Seven suites / 93 assertions and typecheck passed. The replay explicitly supplies a healthy empty Awin source; the default unavailable source cannot establish the original recovery precondition.

S3: three new goal-scope assertions first failed (duplicate host invocation, independent derived-render admission and concurrent admission). After repair: build and five suites / 69 assertions passed. Existing completed-recovery tool rejection remains unchanged.

S4 integration checkpoint: the first full run exposed six failures. Two were genuine over-broad edition gating of garment 'mini' length; two were cancellation/budget status precedence regressions; fixed without relaxing their assertions. Two legacy tests exposed inconsistent source comparison evidence: one offer was labeled as two merchants. Plan v1.1 adds reconciliation of legacy summary text with final cards, within S2's existing common-consumer scope; preserve provider evidence only when status/counts agree. Add a genuine two-offer positive fixture and retain a negative inflated-count fixture. No permission changes or new provider work.

Additional negative assertions exposed stale text still inviting authorization after the structured recovery stopped, unavailable form capability not retaining goal-level state, and an old value-savings amount surviving a price change. Each failed before its correction; the current snapshot projection now recomputes or removes value evidence as well as the group. Source condition filtering is a domain responsibility, not a ShopifyPort input field: the Sony trajectory uses cheap USED and wrong-color offers to prove inherited NEW/black constraints by their exclusion. It does not assert a nonexistent port field. The projection return type was corrected after typecheck caught newly projected fields missing from its generic output type.

## Final Test — 2026-09-07, local unpublished tree

Runtime version remains 0.17.31; no version bump. Baseline commit remains `65bb80b63a5f9dcc79420450450898cf0108a204` with this uncommitted diff. Final MCP bundle SHA-256: `84274309a5a9e0d83cb1d74676d8863986226a7e564ac4666f1e18c20d7c9e71`.

| Gate / rule | Evidence | Result |
| --- | --- | --- |
| Local module builds | `pnpm build:mcp` after each implemented increment and final projection type correction | Exit 0 |
| Types and lint | `pnpm typecheck`; `pnpm lint` | Exit 0 |
| Full default assertions | `pnpm test -- --reporter=dot --silent`, final run 15:54 local | 134 files, 1,976 tests passed, exit 0 |
| Built stdio transport | `pnpm test:mcp-stdio -- --reporter=dot --silent` | 4 tests passed, exit 0 |
| QA script syntax / diff | `node --check apps/mcp-server/scripts/qa-identity-offer.mjs`; `git diff --check` | Exit 0; Git emits only line-ending conversion warnings |
| Explicit Mild excludes regular | `snapshot-identity-consent-regression.test.ts`, request-identity tests and original captured-provider replay through current MCP | Passed |
| Inspection groups/counts/history | Full MCP regression: 3 retained research cards, 2 actual merchants, no primary; original selections unchanged | Passed |
| Sony budget continuation | Same goal and black/NEW requirements; expensive new offer, cheap used and wrong-color offers cannot satisfy the new ceiling | Passed |
| Consent scope and safety | Derived denial/unavailable, concurrent admission, exact-render token, transient limit and cancellation/expiry tests; zero unauthorized page reads | Passed |
| Comparison / value text | Inflated source count rejected in both text and cards; savings recalculated after price change | Passed |

Original Medicube replay uses captured public provider fields, current MCP server, simulated inspector and simulated host decline. It now returns only the two Mild offers after confirmation, keeps unresolved inspected cards in RESEARCH_ONLY, preserves goalId, and issues one rather than two form requests. External network requests: 0. This is a real code-path replay, not a live merchant or native-dialog test; full private transcripts were not copied into the repository.

The live QA script now checks exclusions, inspection groups/counts and continuation from updatedSnapshot, not merely the presence of one correct card. It was syntax-checked, not run against live providers in this turn.

## Delivery / remaining acceptance

Research, two-option Propose, frozen Plan, implementation and mandatory local Test are complete for these code defects. Agent design and Chrome recovery guidance are synchronized. No Backend rewrite, merchant trust expansion, dependency addition, cart write, Watch operation or host-policy change occurred.

Native Codex immediate decline remains **unresolved / not accepted**. This turn neither changes native approval policy nor proves a visible form, accepted consent, authorized Chrome continuation or real delivered-price quote. A simulated host is not a native consent probe. Live merchant coverage, native UI and independent image acceptance remain separate. Default tests exclude database integration; no production database was used.

No commit, push, Railway deployment, release publication or installed Codex cache replacement was performed. Obtain separate authorization for release and then perform actual host acceptance; do not label this an overall Agent acceptance or a native authorization repair.

Subsequent release turn: Chris explicitly authorized commit, push, deployment and installed-cache replacement. The versioned plan, gates and separate delivery evidence are recorded in [v0.17.32](../../releases/v0.17.32.md). This does not change the unpublished implementation checkpoint or native-host acceptance status above.
