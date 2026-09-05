# Approved visual-search improvement plan

Approved by the user on 2026-09-04. Baseline: v0.17.12, commit
`9a6fc1c39fd1dda5f486c87e8a737e164ecb8049`.

## Scope and authority

Improve image retrieval, visual review, identity preservation, primary recommendation,
bounded recovery, and evaluation using the existing Backend and MCP tools. Implementation
and local validation are approved. Commit, push, deployment, installed-cache replacement,
and publication require separate authorization. The owner subsequently deferred the
40-image real-world acceptance run; complete code and deterministic regression first.
Do not change Awin Feed ingestion,
purchase/checkout permissions, approved merchant trust, or unrelated user files.

The owner/acceptance reviewer is Chris. Candidate search reads public sources; snapshots
remain local and immutable. Do not publish user images or private source URLs. No hosted
vision model, vector database, arbitrary website crawler, or unattended model review.

## Work packages

### 1. Identity and execution boundaries

- [x] Freeze baseline and add regression tests before implementation.
- [x] Use merchant-scoped product/variant identities for joins, rendering and references.
- [x] Keep image-URL deduplication separate from product identity.
- [x] Separate explicit user constraints, observable evidence and inferred retrieval hints.
- [x] Preserve immutable render IDs, selection IDs and source-owned merchant/price facts.

Acceptance: equal handles at different merchants cannot overwrite each other; missing,
foreign and cross-snapshot references still fail closed. Observed brands never silently
become user-required brands.

### 2. Visual evidence and primary recommendation

- [x] One admissibility rule checks visibility and confidence/inference for final matches/conflicts.
- [x] New review evidence cannot override known uncertainty through duplicate attributes.
- [x] Family-appropriate structural evidence is required for visual similarity.
- [x] Final server-validated visual group/evidence participates in primary ranking before price.
- [x] Model visual evidence cannot create EXACT, merchant trust, prices or discount eligibility.

Acceptance: low-confidence evidence neither excludes nor promotes; product family plus
color is insufficient for apparel HIGHLY_SIMILAR; equal-trust weaker visual matches do not
win merely on price. Ordinary text ranking remains unchanged.

### 3. Shared retrieval and safe official links

- [x] Share reliable family/color/length/one-or-two structural anchors across source queries.
- [x] Normalize explicit brand requirements independently of observed brand hints.
- [x] Start verified official retrieval without waiting for all global fallback passes.
- [x] Preserve every successful official stage when a later stage fails; report partial coverage.
- [x] Read exact product links only through supported, verified official-store adapters.
- [x] Reuse bounded same-search public sitemap/detail reads; retain all existing network policy.

Acceptance: unknown-brand searches use reliable visual anchors; field placement cannot
accidentally disable official hints; later timeouts cannot erase successful products;
untrusted hosts, credentials, private IPs and unapproved redirects remain rejected.

### 4. Candidate pool and two review rounds

- [x] Track loading, skipped output, failed, reviewed and accepted candidates separately.
- [x] Initial zero-image and zero-match recovery both inspect the remaining original pool first.
- [x] Keep first-round accepted results when a second review is needed or fails.
- [x] Stop on sufficient possible-same-item evidence; optionally continue only-similar results
      when eligible unreviewed candidates and budget remain.
- [x] Allocate review slots by relevance with bounded source/style diversity, independent of
      presentation tiers. Never pad empty presentation tiers.

Acceptance: targets at positions 7/9/10, nine initial image failures, partial success and
second-round failure are covered. No third round, no foreign IDs and no replacement of
accepted source facts. Preserve at most six first-round and three second-round images.

### 5. Image processing, budgets and honest errors

- [x] Prefer approved CDN resizing and bounded local processing where necessary.
- [x] Bound input bytes, decoded pixels, processing time and output; preserve key visual detail.
- [x] Keep the shared 12-image-request, 16-catalog-read and 30-second active-I/O limits,
      with second-round capacity reserved and cancellation propagated to transport.
- [x] Keep each returned image batch within 400,000 Base64 characters.
- [x] Distinguish network, output capacity/processing, evidence, visible conflict and budget failures.

Acceptance: downloaded images skipped for capacity do not become network errors; a failed
optional second pass never wipes accepted results; no arbitrary CDN redirect relaxation.

### 6. Evaluation, telemetry and release gate

- [x] Review existing sanitized conversation regressions for inclusion; do not silently change them.
- [x] Record stage counts, reasons, budget, timing and versions without secrets/raw image URLs.
- [x] Build a reproducible recorded-real-image evaluation runner and freezeable manifest format.
- [ ] Supply and freeze the real acceptance set (owner deferred).
- [ ] Collect at least 40 human-confirmed images, each with and without an explicit brand,
      plus negative/adversarial cases. Split development and held-out cases before tuning.
- [ ] Run actual reference-image extraction, retrieval, candidate-image review and final cards;
      synthetic verdicts and supplied target names are not image-search success.
- [ ] Compare against the baseline; report unavailable sources/targets explicitly.

Proposed and approved gates on the fixed supported/retrievable target set:

- Candidate-pool target recall >=95%.
- Final top-three target recall >=90%.
- Human-reviewed displayed visual precision >=95%.
- Zero visual-grade/primary ordering conflicts among otherwise comparable reviewed products.
- Zero cross-merchant facts, unsafe references, unsupported EXACT claims or false absence claims.
- Both explicit-brand and no-explicit-brand segments must not regress against baseline.
- All known deterministic regression cases pass; text search, coupons and comparison do not regress.

Do not claim these real-image gates passed without the image corpus, blind human labels,
baseline measurements and actual model traces. Missing evaluation inputs block release,
not independent implementation work. Keep original images local; source control contains
only consented/sanitized fixtures, public product identifiers and necessary hashes.

## Delivery order and rollback

Baseline/regressions, then package 1, package 2, packages 3/5 in parallel, package 4 integration,
and package 6 final validation. Evaluation scaffolding starts alongside the baseline.
Each package reports changes, tests and remaining limitations. Final validation includes
typecheck, lint, MCP/Awin builds, full tests, bundled stdio tests and actual Codex image turns.

After separate release authorization, verify remote commit, explicit Railway production
deployment/health/readiness/search, installed-plugin state, bundle hashes and stdio startup.
Railway serves the backend; local MCP runs the visual workflow. Retain the last validated
commit/bundle for rollback. Identity/price contamination or material relevance regression
stops promotion and triggers rollback; a broken case is never hidden by aggregate averages.
