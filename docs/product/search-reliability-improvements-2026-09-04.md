# Search reliability improvements — 2026-09-04

## Scope and delivery state

Incremental implementation of the approved follow-up to task
`01a06df9-d03b-7390-909d-6d8ef716adda`. Keep the shared executor, existing Backend
ports, provider concurrency, read-only shopping scope, immutable selections, and
transport safety. No backend rewrite or new hosted vision service.

The implementation was first validated locally. The owner subsequently authorized
commit, push, Railway production deployment and Codex installed-cache replacement.
Release candidate: `0.17.11+codex.20260904204837`; card UI `v34`, comparison UI `v4`.
Deployment and installation outcomes must be verified separately from the local tests.

## Implemented work packages

| Priority | Package | Behavior and acceptance evidence |
| --- | --- | --- |
| P0 | Execution contract | Safe field paths, bounded limits and correction actions for invalid arguments. Observation values allow 240 characters. SDK-published schema and actual executor agree. One pre-execution argument correction is instructed; no model-driven network retry or safety-policy relaxation. |
| P0 | Visual evidence | Normalize legacy fields and observations together. Explicit visibility/region and conservative occlusion handling. Brand/product family remain locked; one relaxed pass retains 1–2 visible distinguishing structures. Inferences cannot become identity proof. |
| P1 | Retrieval and review | Keep a bounded candidate pool separate from final cards. Fill failed image slots, prefer style diversity and requested colours, review at most 6 + 3 candidates. Different variant/image identities survive deduplication. Final cards use accepted candidates, not the last source response. |
| P1 | Decisions and coupons | Candidate ranking, primary recommendation and comparison share ranking assessment; display group is not purchase eligibility. Different-product comparisons include conditions and limitations. Coupon lookup completeness and product applicability are separate, with one preferred eligible offer and other offers folded. |
| P1 | Diagnostics | A per-search trace connects retrieval, visual finalization and selected-product follow-ups. Source failures, empty retrieval, image failure, evidence insufficiency, visible conflict and budget exhaustion are distinct. A successful match remains a successful match even with source degradation. |
| P1 | Regression gates | Sanitized multi-turn MCP replays, domain/contract/UI tests, execution-boundary tests and real bundled stdio tests. Human-rated live accuracy is a separate gate, not inferred from unit tests. |

## Runtime bounds

- One interactive `SearchRun` spans both visual rounds. Its cache is private to
  that run; identical catalog/registry/deal reads share their result. Image bytes
  are not retained in that cache between model turns.
- At most 16 catalog/official-search port calls, 12 candidate-image attempts,
  8 merchant-deal lookups and 2 registry reads per run.
- At most 30 seconds of active read waiting; a single read wait is at most
  10 seconds. User/model deliberation between rounds is excluded.
- These are orchestration limits, not counts of underlying HTTP calls. Existing
  provider clients still own transport abort, bounded retries and their own timeouts.
  `SearchRun` bounds waiting and additional dispatch; it does not independently
  cancel a provider's in-flight request.
- Candidate pool is capped at 18; image loading considers at most 12 candidates
  per stage within the shared attempt cap. At most 6 images are returned initially
  and 3 on the one relaxed pass. Each response has a 400,000 base64-character budget.
- Image diagnostics distinguish attempts, successful downloads, returned images
  (`loaded`, retained for compatibility), output-budget skips and safe failure
  codes/source domains. A downloaded-but-unreturned image was not reviewed.
- Visual coupons are fetched only after acceptance. Text search retains its
  single-tool fast path and bounded enrichment.

## Invariants preserved

- Selection IDs must belong to the original immutable `renderId`. Missing context
  is not expiry; no title fallback silently chooses a different product.
- A malformed/incomplete visual verdict does not consume its session. Valid
  complete finalization consumes it once. Cross-session IDs and replay are rejected.
- Known-product identity, merchant trust and visible category/structure conflicts
  remain fail-closed. Three non-structural matches cannot bypass a colour conflict.
- Approved Awin merchants retain the owner's independent-verification treatment.
  Affiliate compensation, coupon count and display position cannot establish
  relevance or merchant trust.
- A provider-verified coupon is not automatically product-applicable. Explicit
  scope, spend, customer or conflicting-term restrictions cannot be overridden by
  a product-ID assertion. Only a confirmed applicable discount can reduce ranking
  price; merchant-wide candidates remain conditional.
- Release review also covers `Orders $100+`, USD-prefixed thresholds and reversed
  monetary order conditions. Below-threshold offers are ineligible; unparsed but
  evident spend restrictions stay unconfirmed and cannot produce a coupon price.
- Do not compare item-only prices with delivered totals or silently subtract an
  uncertain coupon from a shipping/tax-inclusive quote.
- Telemetry uses whitelisted counts, state, public source domains and opaque IDs.
  No raw queries, user images, private feed URLs, API keys or provider exception
  bodies are added to the new trace logs.

## Local validation

Final local run: typecheck, ESLint and MCP bundle build passed; **58 test files /
643 tests passed**, including **3 bundled-stdio tests**. `git diff --check` passed.
These numbers refer to the repository bundle, not an installed-cache or production run.

Required commands, rerun against the final tree:

```text
pnpm typecheck
pnpm lint
pnpm build:mcp
pnpm test
git diff --check
```

`workflow-replay.test.ts` covers the original 101-character black-dress failure,
white-blouse two-round structural retention, image failure, selection → coupon
failure → comparison → new image → old selection reuse, complete review submission,
variant-aware deduplication and accepted products surviving later source responses.
No private photographs are committed; provider records and image bytes are synthetic.

`stdio-smoke.test.ts` launches the repository plugin bundle and checks its published
schema and safe over-limit error. This is not proof that the user's installed plugin
cache has been replaced.

## Remaining release / empirical gates

1. Human-label the proposed 50–60 visual/product cases, including black DÔEN dress,
   white DÔEN blouse, SKIMS colour variants and wrong-family negatives. Measure
   Recall@9 / Precision@3, false-match rate, latency and request counts against a
   fixed baseline with the same source snapshots. Do not claim a 95% result without
   those measurements. Synthetic replay is a functional gate only.
2. After release authorization: update the coordinated release version, rebuild,
   rerun gates, commit/push and deploy explicitly to Railway production.
3. Verify remote commit, deployment success, health/readiness, old-cache recovery,
   real read-only product/coupon responses, updated Codex cache, enabled plugin,
   installed stdio and source/install hashes. Then perform real card/compare UI
   interaction checks and screenshots. Keep rollback to the previous verified release.
