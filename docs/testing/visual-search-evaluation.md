# Recorded visual-search acceptance

Current format: **manifest v2**. Read [frozen-cohort acceptance v2](./visual-search-acceptance-v2.md)
before recording runs. The default examples below use v2. Historical v1 captures and
manifests remain useful audit records, but cannot pass the current acceptance gate by
inventing missing cohort, timing, or human-attestation fields.

## Status and authority

The evaluator and deterministic guard tests are implemented. The owner deferred collection and acceptance of the 40 real images. **There is no real-image accuracy result or production-readiness claim in this change.**

`pnpm eval:visual artifacts/visual-search/manifest.json` reads existing files only. It never calls a model, searches a provider, uploads an image, edits source, deploys, or rewrites missing evidence. Keep the private dataset under the git-ignored `artifacts/` directory, or a separate private directory. Do not commit user images or raw conversation captures.

Exit codes: `0` = `PASS_RECORDED_EVIDENCE`; `1` = complete evidence but quality gate failed; `2` = `INCOMPLETE` or invalid/missing input. `PASS_RECORDED_EVIDENCE` means the recorded evidence satisfies the configured checks. It is **not cryptographic proof** that a capture came from a live model or that a human label is correct. An accountable reviewer must verify those attestations.

## Required dataset

- At least 40 different, SHA-256-identified, real **supported, retrievable target** images; duplicate hashes are not independent samples. Out-of-scope images, provider outages and expected-no-match negatives are additional cases, never padding for the minimum 40.
- Each image has both `WITH_BRAND` and `WITHOUT_BRAND` runs, for the baseline and candidate: at least 160 recorded runs.
- Freeze held-out cases by product/style family before tuning. The six user-PDF development images and related style families are not unseen hold-out. The minimum guard is 10 supported held-out images; a 20-development/20-held-out split is recommended.
- Each case has an independently checked target label. A label can contain up to 10 equivalent target product hashes, only when a human verifies that the source/merchant identity aliases represent the same requested item and variant. Do not label different colors or sizes equivalent without explicit user intent.
- Every run has the reference-image extraction, raw MCP calls, backend evaluation metadata, and a separate human review bound to the exact capture hash.
- The manifest pins baseline and candidate version plus full commit. Baseline 0.17.12 needs the same **read-only capture instrumentation**, without retrieval/ranking/decision changes. An old capture without required stages is incomplete; never manufacture the missing stages from current behavior.
- Synthetic fixtures belong to unit tests only. `imageOrigin: SYNTHETIC`, synthetic capture origin, missing human review, missing baseline, missing brand segment, or missing terminal evidence cannot pass.

The [v2 manifest template](./visual-search-manifest.example.json) and [cohort template](./visual-search-cohort.example.json) deliberately contain placeholders and are not an acceptance dataset. Copy both into the private dataset directory, replace the placeholders, and freeze the cohort before recording baseline or candidate runs. Each capture must bind the pre-recorded cohort SHA256; changing a denominator after recording is not permitted.

## Files and format

All artifact paths are relative to the private manifest directory. Absolute paths, parent traversal, symlinks leaving that directory, files over the size bound, and SHA mismatches fail closed. The reader does not print artifact contents or exception stacks.

### Human target label

```json
{
  "kind": "HUMAN_TARGET_LABEL",
  "caseId": "cornella-black",
  "imageSha256": "<64 lowercase hex>",
  "reviewerId": "reviewer-id",
  "reviewedAt": "2026-09-04T12:00:00Z",
  "eligibility": "SUPPORTED_RETRIEVABLE",
  "expectedProductHashes": ["<64 lowercase hex>"]
}
```

Other eligibility values: `UNAVAILABLE`, `OUT_OF_SCOPE`, `EXPECTED_NO_MATCH`. They require `reason` and are listed separately in the report. They do not silently disappear from the sample inventory or contaminate target-recall denominators. Their returned products still contribute to precision and safety checks. Both evaluated brand segments and held-out segments must have eligible target runs.

### Live run capture

```json
{
  "kind": "LIVE_CODEX_MCP_CAPTURE",
  "origin": "LIVE",
  "caseId": "cornella-black",
  "threadId": "<actual task id>",
  "runId": "<actual backend traceId>",
  "imageSha256": "<reference image hash>",
  "brandMode": "WITH_BRAND",
  "startedAt": "2026-09-04T12:30:00Z",
  "cohortSha256": "<pre-run frozen cohort SHA256>",
  "version": "<version>",
  "commit": "<40 lowercase hex>",
  "referenceExtraction": {
    "modelId": "<actual model>",
    "messageId": "<actual extraction message id>",
    "visualInput": { "productType": "dress", "colors": ["black"] }
  },
  "calls": [
    {
      "toolName": "search_visual_candidates",
      "arguments": {},
      "result": {}
    },
    {
      "toolName": "finalize_visual_search",
      "arguments": {},
      "result": {}
    }
  ]
}
```

Replace `arguments` and `result` with actual recorded tool arguments/results; do not populate them from expected answers. First-call `visualInput` must match `referenceExtraction.visualInput`. `WITH_BRAND` requires an explicit required top-level brand; `WITHOUT_BRAND` must not contain that user-specified requirement. A vision-derived observed brand is not automatically a required brand.

The cohort freeze must precede `startedAt`. Known product URLs, `sourcePageUrl`,
`productUrl`, or `suspectedProductName` answers are not permitted in image-acceptance
input; known-URL diagnostics are scored separately. Preserve raw messages for human
checking of free-text answer leakage and actual candidate-image inspection.

Preserve each result's `_meta["findcheap/visualEvaluation"]`:

```json
{
  "version": 1,
  "traceId": "<actual backend traceId>",
  "retrievedProductHashes": ["<product hash>"],
  "reviewedCandidates": [
    { "candidateId": "<id>", "productHash": "<hash>", "imageSha256": "<actual candidate image hash>" }
  ],
  "finalProductHashes": ["<hash>"],
  "primaryProductHash": "<hash>"
}
```

`productHash` is SHA-256 of the backend's composite product-reference key. It is not a product title or model-authored identifier. Metadata contains no product URL or raw image bytes. `reviewedCandidates` describes images exposed for review; the evaluator counts actual review only when a successful `finalize_visual_search` submits valid verdicts covering the current session's unique candidate IDs. Old-round IDs, duplicate IDs, failed calls and incomplete verdict batches are rejected. `finalProductHashes` appears only for terminal results, including `[]` on genuine terminal failures. A capture ending at candidate display is incomplete, even if someone adds an empty final list to its metadata.

Preserve the actual image content blocks and `structuredContent` in the private raw result. The evaluator verifies candidate-image SHA against those bytes, recomputes final product hashes from returned card identity fields, and checks the primary selection against the returned recommendation. Metadata cannot substitute for missing images, final cards or terminal workflow state.

Retain model candidate verdicts and raw messages for human auditing. Do not use a candidate's metadata description as a substitute for the actual image comparison. The CLI verifies file hashes, lineage and typed trajectories; human reviewers remain responsible for checking the captured images, user request, identity and relevance.

### Human run review

```json
{
  "kind": "HUMAN_RUN_REVIEW",
  "caseId": "cornella-black",
  "captureSha256": "<hash of exact capture file>",
  "reviewerId": "reviewer-id",
  "reviewedAt": "2026-09-04T13:00:00Z",
  "referenceExtractionReviewed": true,
  "captureOriginReviewed": true,
  "verdictOriginReviewed": "ACTIVE_MODEL_IMAGE_REVIEW",
  "answerIsolationReviewed": true,
  "productLabels": [{ "productHash": "<hash>", "relevant": true }],
  "expectedPrimaryProductHash": "<hash or null>",
  "violations": []
}
```

Every final card must receive a human relevance label. Supported violation codes: `IDENTITY_OVERWRITE`, `CROSS_SNAPSHOT_REFERENCE`, `UNSUPPORTED_EXACT`, `FALSE_NONEXISTENCE`, `PRIMARY_ORDER_CONFLICT`, `POLICY_VIOLATION`. A capture can have zero cards without being incomplete, but it fails target-hit metrics when a supported target was expected.

## Metrics and gates

Report baseline/candidate separately for with-brand, without-brand, and their held-out subsets:

- Candidate recall: expected item enters the bounded backend candidate pool.
- Review recall: expected item receives an actual submitted visual verdict.
- Top-3 hit rate: expected item appears among terminal cards.
- Precision: human-relevant cards / all returned cards.
- Primary accuracy: backend-selected primary agrees with human review, including justified no-primary outcomes.
- Safety violations and every excluded/incomplete case.
- Frozen planned/supported/all-target denominators, all-target Top3 coverage, and run completion. Failed or missing runs do not shrink the frozen denominator.

Both brand segments and their held-out subsets require candidate recall >=95%, top-3 hit rate >=90%, precision >=95%, primary accuracy 100%, zero recorded safety violations, and no baseline regression in recall/review recall/top-3/precision. Empty denominators do not count as success. These thresholds validate a recorded dataset, not population-level statistical confidence; expand samples and report uncertainty before claiming broad accuracy.

## Resuming the deferred real acceptance

1. Obtain approved real images and target labels; freeze image/label hashes, style families, exposure, splits and eligibility in the cohort artifact and record its SHA256 before running.
2. Record baseline and candidate in equivalent provider conditions and capture settings. Preserve failures and upstream outages.
3. Have the reviewer check origin, extraction, candidate images, cards, links/variants and primary choice; bind each review to capture SHA.
4. Run the CLI; inspect every `INCOMPLETE`, exclusion and failure. Do not relax gates to make the report green.
5. Approval to implement or evaluate is not approval to commit, publish, deploy or replace an installed plugin.
