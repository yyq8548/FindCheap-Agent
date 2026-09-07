# QA recovery repair — 2026-09-07

Status: Research / Propose complete; plan frozen before code changes; scoped code/build/default-test gates PASS. Original business acceptance remains PARTIAL / NO-GO, with the unmet gates listed below.
Baseline: `7509cac5217790345a2852eb810c11520bb03cc4`, v0.17.28.
Authority: repair the proposal in task `01a07c45-2e71-7a30-ae59-1be9f10aff86` under `AGENTS.md`, the five-stage development protocol, and `docs/architecture/agent-design.md`. This turn does not authorize publication or installed-cache replacement.

## Research: observed facts and boundaries

Applicable [agent design](../../architecture/agent-design.md): §3 responsibility boundaries, §4 identity and visual review, §5 independent merchant trust, §7 recovery/budgets, §8 task identity/lifecycle, §10 execution safety and §13 evidence/acceptance. No approved business or authorization rule is changed.

The observations below describe the baseline unless explicitly called current. FACT means observed source/run evidence; UNKNOWN does not become an implementation assumption.

- The supplied QA archive has 23 business checks: 13 PASS, 5 FAIL, 4 BLOCKED, 1 NOT_RUN; 1,828 default and 4 database assertions passed. These are historical observations, not current acceptance.
- `safeFetchWithProvenance` wraps transport exceptions as `request blocked`; `resolveAndValidate` wraps DNS exceptions as `DNS blocked`. `classifySourceFailure` treats those wrapper messages as non-retryable security failures before inspecting their causes.
- A current, injected no-network probe through the actual `safeFetch` and `classifySourceFailure` reproduces EAI_AGAIN and ECONNRESET as SECURITY_REJECTED. This confirms the classification defect, not the historical Sony connection's exact cause.
- `createVisualCandidateImagePort` reduces most fetch errors to REQUEST_FAILED. `loadVisualCandidates` records code/host/count but not transport phase. SearchRun already owns cancellation, wall-clock/read budgets, caching and a 12-image-read cap; independent loader retries would hide attempts from that ledger.
- The frozen R10 input is medicube Zero Pore Pad, 70 pads, 155 g, SAME_PRODUCT, compareMerchants=true. Nine historical native candidates were excluded for brand. No local medicube official registry entry exists. R11 is Sony WH-1000XM5, SAME_PRODUCT, compareMerchants=true. R12 is the original medicube descriptor with the visible 70 pads / 155 g label. Do not change their requirements to make tests pass.
- `stdio.ts` supplies no trusted host conversation identity/lifecycle bridge; shopping goals and render snapshots are process-local. Agent design §8 explicitly gates persistent goal implementation on verified same-task restart identity, cross-task isolation and archive/delete events. A shell environment variable or MCP task ID is not that evidence.
- Current tool metadata exposes 17 FindCheap tools, and an actual read-only list_watches call succeeds. This resolves tool presence only for this current session; it does not establish native UI/form/lifecycle acceptance for the historical tester.
- Real quote approval, scheduled notification delivery, held-out truth and end-to-end P95 require evidence that the supplied archive does not contain. No automatic consent, synthetic accuracy claim, global product catalog or cross-task state store is permitted.

### Active call graph, contracts and consumers

| FACT: entry and symbols | Contract / affected consumers | Boundaries and dependency evidence |
|---|---|---|
| [stdio.ts](../../../apps/mcp-server/src/stdio.ts) → createShoppingServer → searchProducts → official/shopify/source adapters → [safeFetchWithProvenance](../../../packages/network-safety/src/safe-fetch.ts) | Transport failure affects native source status and recovery; network safety also feeds Awin service reads | Existing Node 24 / pnpm 10.34.5 / TypeScript / Zod / MCP SDK workspace; no dependency or lockfile change. Both `build:mcp` and `build:awin-feed` exercise shared transport consumers |
| [server.ts](../../../apps/mcp-server/src/server.ts) loadVisualCandidates → [SearchRun.read](../../../apps/mcp-server/src/search-run.ts) → [createVisualCandidateImagePort](../../../apps/mcp-server/src/visual-candidate-images.ts) | Per-flow IMAGE count, in-flight sharing, cancellation, byte/output limits; code/host/phase reach bounded diagnostics | Retry opts in only here; source, quote and Watch operations do not acquire a retry. The existing 12-image cap includes retries |
| [officialStoreSeed](../../../apps/mcp-server/src/search-products.ts) → [createOfficialShopifySearchPort](../../../apps/mcp-server/src/shopify-official-store-search.ts) → [createSonyOfficialSearchPort](../../../apps/mcp-server/src/sony-official-store-search.ts) or Shopify product JSON | Selected SKU/model, URL, price, stock and hard requirements remain source-owned; managed trust remains authoritative | Only a reviewed exact medicube host is added; reads stay on demand. No catalog ingestion, generic domain inference or arbitrary CDN redirect expansion |
| createShoppingServer renderSnapshots / resolveSearchParent → [toolError](../../../apps/mcp-server/src/execution/tool-outcome.ts) | Omitted reference, unavailable state and known expiry produce distinct correction instructions | `stdio.ts` state directory currently supports Watch state, not a trusted host task/lifecycle bridge. This patch does not persist shopping goals or revive expired prices/permissions |

ASSUMPTION: a source transport failure is transient only for the enumerated system codes. UNKNOWN: the precise historical Sony/CDN network error, because its original nested cause was not retained; actual host lifecycle/form/notification behavior; independent image accuracy; sustained performance. These are not inferred from a successful current fetch.

## Propose: alternatives

| Option | Benefit | Risk / cost |
|---|---|---|
| A. Inspect nested error messages separately in every source/image adapter | Small initial patch, no transport API addition | Duplicated security precedence; runtime/private text can drift; image retries can escape the execution ledger |
| B. Typed, sanitized transport failures at the existing network boundary; reuse them in source/image diagnostics; execution-owned retry | One classification contract, explicit DNS/request/body phase, preserves fail-closed validation and request accounting | Requires network, image and executor contract tests; small additive types/method, no backend rewrite |

Choose B. Validation denials stay terminal. Only enumerated transient transport codes permit one bounded image retry. No arbitrary redirect/TLS bypass or message-based inference of retry permission. Source recovery continues to require its existing real host authorization. No hidden transport retry for quotes, Watch or affiliate feeds.

## Plan: ordered atomic steps and gates

1. Add red regression tests for actual DNS/request/body failure classification, private-address/redirect/TLS denial, unknown failures, sanitized diagnostics and cancellation. Implement transport classification and source mapping. Run local tests and both MCP/Awin builds.
2. Add image phase/reason diagnostics, execution-owned maximum-one transient retry with original image/read/time/cancellation caps and shared in-flight requests. Assert success-after-reset, exhausted retry, no security/429/decode retry, duplicate/cancel/budget behavior. Run image/SearchRun/server tests and MCP build.
3. Verify medicube ownership and current source shape before any reviewed registry addition. If verified, use the existing on-demand official adapter; retain brand and 70 pads / 155 g gates. Add original-query regression, incompatible brand/package negatives, and inspect live original R10/R11/R12 outcomes. A single official offer is not completed cross-merchant comparison. Image loading is not image match accuracy.
4. Improve reference diagnostics only where the current executor can distinguish omitted input, missing process-local state and known expiry. Do not invent a cross-task mismatch verdict or persist goals before the §8 host prerequisites. Assert no retry loop or NEW_PRODUCT bypass. Run affected context tests and MCP build.
5. Add a reproducible read-only QA/preflight and an evidence ledger for the frozen failures. Preflight distinguishes bundle stdio from actual host tools, UI, forms and lifecycle. Run typecheck, lint, full default tests, stdio smoke and diff checks; document actual passes, failures and external gates. No live Watch/quote mutation is manufactured to satisfy a test.

Dependency: 1 → 2 → 3; 4 independently depends on the reference contract investigation; 5 follows all implemented steps. Record any evidence-driven deviation before changing scope.

## Acceptance / rollback

- Red before green, then replay the original symptom through the real affected boundary.
- Unsafe targets, unexpected redirects, certificates, cancellation and budgets never become successful empty results or retry permission.
- Diagnostics contain enum codes/phase, approved host and counts only; never URLs, credentials, raw exceptions or response bodies.
- Ordinary comparison stays nine rows. Immutable goal/render/selection IDs, source facts, trust/quality separation, quote authorization and Watch side-effect boundaries are unchanged.
- Whole-agent NO-GO remains until actual host lifecycle/quote/notification and independent accuracy/performance gates pass. Report blocked evidence separately from implemented code.
- Rollback is removal of this isolated patch; no state migration, production mutation, registry publication or stored authorization changes are involved.

## Test and outcome ledger

### Evidence-driven refinement before step 3

Live bundle replay with the new embedded medicube seed and the older production managed trust registry exposed a rollout-order mismatch: the seed exists, but the authoritative trust registry does not yet approve its host. Do not override managed trust with the embedded seed. Gate official seed use on the current independent OFFICIAL trust verdict, leaving normal authorized recovery available instead of calling an ineligible adapter and generating UNKNOWN. Test both current and older registry states. No production registry was changed.

A second live Sony response includes an unrelated camera accessory in the search results. Its unsupported URL rejects the entire requested headphone result before model filtering. Move the existing source-code model filter before URL parsing (no read or trust is granted to discarded results); matching-model URLs still fail closed. Add positive unrelated-result and negative unsafe-matching-result cases.

The live Sony WH-1000XM5 source now reaches HTTP successfully but fails its schema: two nonselected, explicitly out-of-stock legacy sibling options omit `variants` (suffixes `-ples`, `-sbb`). Their incomplete color metadata rejects the entire valid selected SKU. Options considered: make all option evidence optional (unsafe for selected prices/colors), or narrowly omit only bounded, same-model, explicitly unavailable and hidden nonselected siblings before selected-SKU validation. Choose the latter; add a real-shape regression plus selected/in-stock/foreign-model negatives before editing the adapter. Selected identity/color/price/stock equality remains mandatory.

The current medicube public product JSON says `100ml / 70pads`; numeric shipping weight is 318, not proof of 155 g net content. A reviewed official source addition cannot convert this into verified 155 g. Keep that hard requirement unresolved unless source-owned net-content evidence is actually found.

Step 1: 7 red classification cases → 8 green contract cases; 123 network/retrieval assertions pass. Both MCP and Awin builds pass. Step 2 initial loop: 2 red → 8 green image-recovery assertions; 44 image/SearchRun assertions pass, MCP build passes. These are not full-suite or live visual acceptance results.

### Implementation evidence and final automated checks

Tests were added at the transport, executor, adapter and MCP seams, without mocking the matching or safety decision under test. Subsequent integration assertions prove that real injected DNS/request/body errors reach `searchProducts` recovery decisions, and that `search_visual_candidates` actually uses the counted retry and exposes safe phase diagnostics.

| Rule / change | Automated evidence | Result |
|---|---|---|
| DNS/reset/timeout are not automatically security denials; TLS/private targets stay terminal; unknown errors remain closed | `network-failure-contract.test.ts`, `retrieval-plan.test.ts`, existing safe-fetch tests | PASS. Transport → source → recovery covered; raw messages/URLs excluded |
| At most one image retry, within the original flow ledger | `image-transport-recovery.test.ts`, `workflow-replay.test.ts`, existing SearchRun/image tests | PASS. Shared concurrent read, failed receipt, 12-read limit, late failure, cancellation and no TLS/redirect/429/5xx/decode retry covered |
| Valid Sony selected SKU survives unrelated search results and narrowly incomplete inactive siblings | `sony-official-store-search.test.ts` plus existing storefront tests | PASS. New positive cases first failed on the baseline; matching unsafe URL, selected/in-stock/visible/foreign incomplete options stay rejected |
| New official seed cannot outrank current managed trust or manufacture package facts | `medicube-official-regression.test.ts` | PASS for registry consistency, lookalike rejection, old-authoritative-registry gate and no READY recommendation from observed 100ml/70pads evidence. This is NOT a positive 155g exact-match acceptance |
| Correct but unavailable reference is not an omitted input retry loop | `shopping-goal.test.ts`, `model-context-replay.test.ts` | PASS for omitted/unavailable/expired distinctions and existing goal/selection isolation. Persistence itself is NOT implemented |

Final run: 2026-09-07, approximately 11:22–11:23 America/New_York, baseline commit plus this uncommitted patch. Plugin version remains 0.17.28; distinguish the patched bundle by SHA-256 `96abcd37afdad7d936c36f9089888e13a896cab59f7fbd3e0cd1b5a16f3a7300`.

| Command | Exit / observed result |
|---|---|
| `pnpm build:mcp` | 0; source-checkout MCP bundle, image worker and matching notices regenerated |
| `pnpm build:awin-feed` | 0; `apps/awin-feed-service/dist/main.cjs` built |
| `pnpm typecheck` | 0 |
| `pnpm lint` | 0 |
| `pnpm test` | 0; **128 files / 1,865 assertions PASS**, including 37 new cases relative to the archive's 1,828 baseline |
| `pnpm test:mcp-stdio` | 0; 4 PASS against the source-checkout bundle; these four are already included in the 1,865 total, not additional tests |
| `git diff --check` | 0; no whitespace errors; only existing Windows line-ending conversion warnings |
| Local Markdown link / record structure check | 0; all 11 local links resolve; Research, Propose, Plan, implementation, test and remaining-gate sections present |

Earlier full-suite run had 1,856 PASS / 1 FAIL: a source-service assertion still expected the previous official registry date. The reviewed registry version changed, so the two relevant version expectations were updated, not removed. An earlier lint run reported eight undefined Node globals in the new `.mjs` harness; explicit Node imports fixed them. Final reruns above passed. No production database was used; `pnpm test:integration` was not run (no DB schema/repository change), and its four historical passes are not claimed as current.

Timeout detail: explicit typed transport exceptions carry DNS / REQUEST / BODY. Existing total-deadline/cancellation exceptions may have no transport phase; this patch does not invent a phase for them or automatically retry every timeout.

### Original-case replay, not a replacement success prompt

Reproduce with [qa-frozen-cases.mjs](../../../apps/mcp-server/scripts/qa-frozen-cases.mjs):

```powershell
node apps/mcp-server/scripts/qa-frozen-cases.mjs
node apps/mcp-server/scripts/qa-frozen-cases.mjs --live
```

The script uses the newly built local bundle, original frozen tool inputs and default registries. It isolates local state, performs only read-only operations, reports a safe summary, and never copies user Watch data or grants browser/quote consent. Exit 0 means the harness ran; it does **not** mean every business case passed. Even without `--live`, it obtains a clarification receipt and checks actual process-restart behavior. It cannot verify the desktop's UI or lifecycle API.

Final live replay, 2026-09-07 approximately 11:22 America/New_York:

| Case | Observed | Acceptance |
|---|---|---|
| Preflight | MCP 0.17.28, matching patched bundle hash, 23 stdio tools / 2 resources | PASS for local protocol/load only. Current Codex session separately exposed 17 model-visible tools and accepted a real read-only list_watches call; this does not certify the historical tester's host setup |
| R10 original medicube + 70 pads + 155g + cross-merchant comparison | 1 research-only card, 0 recommendable, 0 comparable merchants; REQUEST_WEB_SEARCH / COMPARISON_INCOMPLETE; official NOT_USED under the older production managed registry | PARTIAL / still not accepted. The new reviewed registry is local and unpublished. No 155g claim, no completed cross-store result; authorized web recovery was not run |
| R11 original Sony WH-1000XM5 | 3 cards, 1 recommendable; official COMPLETE / 1 product accepted; only 1 comparable merchant and REQUEST_WEB_SEARCH / COMPARISON_INCOMPLETE | Native retrieval repaired in this observation. Full same-product cross-merchant comparison still not accepted; authorized web recovery was not run |
| R12 original medicube visual descriptor | 6 candidates, 6 images loaded, 0 image failures; REVIEW_REQUIRED; 6 image reads / 0 retries | PASS for this image-loading stage only. No reference-image/model review or finalize; no same-item or accuracy claim. This run does not prove which network fault caused the historical 12 failures |
| R13 real restart, same isolated state directory and original parentRenderId | restored=false; REFERENCE_STATE_UNAVAILABLE; ASK_USER_TO_RESTATE / maxAttempts=0 | Error guidance repaired. **Cross-restart continuation still FAIL / blocked on the §8 host prerequisite** |

Individual native-stage durations were approximately 2.4 s / 1.6 s / 1.1 s for R10 / R11 / R12. These are single observations, not total model/browser latency or P95 acceptance.

### Reviewed medicube ownership evidence

Only `medicube.us` was added. The [official-domain warning](https://medicube.us/pages/notice), [US operator privacy policy](https://medicube.us/policies/privacy-policy) and [APR parent-company history](https://www.apr-in.com/en/apr_about.html) were checked on 2026-09-07. The public product JSON for Zero Pore Pads currently exposes 100ml / 70pads; shipping weight is not evidence of net contents. No other similarly named domain was granted trust. Firecrawl was unavailable in this environment, so read-only web/source checks were used; no plugin was installed.

### Remaining gates and handoff

- **Not implemented:** trusted task-bound cross-restart goal/selection memory and archive/delete lifecycle handling. Agent design §8 prohibits shipping persistence before trusted host identity, cross-task isolation and real lifecycle events are verified. A global JSON store would violate the design. This needs the actual supported host bridge, not another model-supplied ID.
- **Not accepted:** R10 exact package / cross-store comparison and R11 full cross-store comparison; local official-registry publication and actual authorized recovery have not occurred. Generic query/identity coverage is not proven by this pilot.
- **Not executed:** reference-image review/finalize and held-out ≥40-image acceptance, real quote approval/cancel UI, scheduled notification exactly-once/stop observation, lifecycle end-to-end checks and sustained P95 measurement. No automated model/host consent or artificial Watch operation was used to manufacture a pass.
- **Preserved:** exact identity and hard requirements, trust/quality separation, immutable IDs, nine comparison rows, quote/Watch authorization, 90/180-second search contracts, bounded network validation and read-only scope. No total-design rule was relaxed; this document records partial implementation, not an upgrade of the overall acceptance status.
- **Publication:** no commit, push, version bump, Railway deployment, registry publication or installed Codex cache replacement. Generated artifacts belong to the local source checkout only.
