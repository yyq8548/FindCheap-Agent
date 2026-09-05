# Shopping improvement implementation — 2026-09-05

Historical implementation record: the scope and candidate evidence below were
recorded before release authorization. Chris subsequently authorized the
[v0.17.21 delivery](../releases/v0.17.21.md); that release record defines the
publication scope without changing the original acceptance limitations.

## Outcome and approved scope

Chris approved the six-package architecture plan for local implementation and read-only verification. The baseline is v0.17.20, commit `ed0630fa3c3d1b0e010a7b7aa96ce1c628c03554`. Changes are uncommitted. This is not a release or a claim of general shopping accuracy.

The business outcome remains precise, useful comparison of relevant products from trusted merchants, with evidence-backed price and Coupon advantages. No new paid provider, external upload of reference images, merchant auto-approval, persistent product catalog, production deployment or installed-cache replacement is included.

## Architecture and controls

The existing single shopping agent, deterministic MCP executor, Backend adapters, parallel sources, safe network layer and immutable snapshots are retained. Small contracts add goal revisions, compiled source queries, scoped claim evidence, value evidence and typed outcomes. Security controls remain at execution/network boundaries rather than in prompt advice alone.

Goal revisions are server-issued and session-bound. An exact parent or goal/revision pair is required; ambiguous, unknown, expired or conflicting bindings fail closed. Submitted-field provenance is recorded as `REQUEST_FIELD`, not falsely represented as a verbatim user quote. The model still performs intent extraction, so this is not proof that every future paraphrase preserves user intent.

Old candidates are revalidated from bounded, in-memory snapshots. Original observations keep their timestamps. Old card identifiers remain bound to their original snapshot; selected tools do not accept a global latest-product substitute.

## Implementation milestones

1. **Execution and recovery:** source query preflight; bounded complementary queries; separate invalid-query, source-rejection, timeout, 429, upstream, schema and security failures; safe transient-source recovery eligibility; host authorization diagnostics.
2. **Requirements and context:** `goalId`/`goalRevision`, requirement ledger, five-turn continuation regression, old-candidate revalidation, correction without silent requirement withdrawal, EV compatibility clarification.
3. **Retrieval:** controlled bilingual identity anchors, category-first EV classification, ordinary discovery target distinct from display cap, official/API cooperation, no catalog construction. Explicit same-product output is capped at three cards without reducing its source coverage target. Descriptor-only visual web recovery is constrained by remaining image/review budgets and requires subsequent visual review, not metadata-only recommendation.
4. **Evidence:** scoped merchant claims for hydration, frizz and fine-hair suitability; negation, conditional statements, ingredients and other bundle components cannot establish the target product's efficacy. Controlled character/work/style anchors reject contradictory identities. Trust, rating and unknown quality remain separate.
5. **Value and UI:** third-tier savings evidence; unverified leads moved to research; quantity/variant-aware unit prices; no different-product raw-price savings claim; expired or undated Coupon evidence cannot retain a confirmed savings advantage; server primary highlighted in its original group and consistent with ordinal references. Legacy cards preserve original snapshot order through adjacent group segments.
6. **Evaluation:** unique candidate funnel separated from source observations and overlapping exclusion counts; frozen baseline/candidate evaluation manifests; independent held-out cohort and real-host gates; no fake samples or fabricated PASS artifacts.

## Failure and recovery design

Host consent is required before Chrome. Refusal, cancellation, unavailable capability, expiry and exhausted admission limits stop the action. An automatically returned decline does not establish that the user clicked a refusal. Source failure does not prove product absence. Unknown or security/schema failures are not relabeled transient to enable recovery.

Image recovery sends only necessary descriptors, never the original user image. Recovered product pages still go through the safe loader, immutable candidate IDs and actual visual verdicts. No third visual-review round or unbounded extra reads are authorized.

## Actual host evidence

The installed v0.17.20 instance was tested read-only with a Tesla charging-station search. `begin_web_search` returned `PERMISSION_DENIED`, `retryable: false`, attempt 1. No Chrome recovery was executed. Chris confirmed that **no authorization popup was visible**. This establishes a host-denied outcome, not a user refusal or a proven root cause in host policy.

Local elicitation mocks are useful protocol tests but are not evidence that the desktop popup works. The edited source has not replaced the installed plugin. Three independent accepted real-host recovery runs, plus the other real-host scenarios, remain outstanding.

## Evaluation and release gates

Run local checks from the repository:

```powershell
pnpm typecheck
pnpm lint
pnpm build:mcp
pnpm build:awin-feed
pnpm test
pnpm test:mcp-stdio
git diff --check
```

The new offline business scorer is:

```powershell
pnpm exec tsx scripts/evaluate-shopping-tasks.ts <local-manifest.json>
```

It requires hash-bound captures and accountable human labels. It does not cryptographically authenticate a real host. Exit codes are 0 (`PASS_RECORDED_EVIDENCE`), 1 (failed gates), and 2 (incomplete or invalid evidence). Image tasks also invoke the existing visual evaluator without lowering its gates.

For text captures, server hash sequences explicitly use `SOURCE_OBSERVATION_ORDER`, not a claimed global relevance ranking. Revalidated previous products are recorded separately for final-result provenance and do not inflate fresh-source recall. New image-web-recovery captures must record real tool start/end times, successful host consent, the same lease and immutable candidate/image evidence, followed by the remaining visual finalization. A source label alone cannot satisfy that trajectory.

Business acceptance requires at least 40 independent held-out tasks, 20 text and 20 image, at least four categories; Recall@20 >= 90%, Precision@3 >= 95% with recommendation coverage, and eligible task success >= 85%. Empty output has undefined precision, not perfect precision. The six previously used clothing examples remain development cases. Current test counts must not be presented as real-image accuracy.

## Outstanding acceptance and decisions

### Final local verification

After rebuilding the candidate MCP bundle on 2026-09-05:

Tested `plugins/findcheap-agent/dist/mcp-server.js` SHA-256:
`371193aef375a0456244e83e61892e20003826b3fb8f76bf6198a7cecb3b045e`.
The source version remains 0.17.20 until a separately authorized release.

| Check | Observed result |
| --- | --- |
| `pnpm typecheck` | PASS |
| `pnpm lint` | PASS |
| `pnpm build:mcp` | PASS; repository plugin bundle rebuilt |
| `pnpm build:awin-feed` | PASS |
| `pnpm test -- --silent` | 84 files, 1,182 tests passed, 0 failed |
| `pnpm test:mcp-stdio` | 3 passed; included in the full suite, not 3 additional tests |
| `git diff --check` | PASS |

These checks cover the edited repository source and local build. They do not replace the installed Codex cache or verify a Railway deployment. The MCP regression tests use synthetic providers with network forbidden; real candidate-image encoding/size tests do not establish semantic image recognition accuracy. New UI tests execute the card logic and assert ordering, selection and Coupon states; no live desktop visual acceptance is claimed.

### Still outstanding

- Real desktop authorization remains blocked; no accepted browser-to-native-card run has been demonstrated for this candidate source.
- No new independent 40-task corpus, live six-image rerun or matched-environment P95 benchmark has been completed.
- Requirement provenance currently proves submitted-field origin, not model-independent interpretation of user statements.
- Quality evidence is limited to scoped merchant claims and reported ratings/unknown. Cross-category certification, material, warranty and return-policy verification is not implemented; unknown quality is not a guarantee of quality.
- Tesla, Verb and Bounce Curl registry gaps are reviewed separately in `docs/testing/merchant-coverage-review-2026-09-05.md`. No unreviewed merchant has been approved.
- Existing bounded detail inspection remains; this change does not establish exhaustive catalogs or universal semantic matching.

## Rollout, observability and rollback

Release decision is **NO-GO for a claim of complete business acceptance** until the missing gates are satisfied. This does not invalidate specific passing local regressions. Runtime diagnostics contain typed failures, counts, hashes and IDs, not raw queries, private Feed URLs, API keys or source documents. Existing logging retention remains host-operated; no seven-day retention job has been silently installed.

If deployment is separately approved, pin the reviewed source/bundle, repeat the release checks, explicitly verify Railway success/health and the installed runtime hash, then run actual-host acceptance. Revert the affected release if identity, selection, trust, authorization, pricing or budget invariants fail. No production restart or publish was performed for this implementation.
