# Visual-search acceptance v2: frozen cohort and honest outcomes

This supplements the original approved plan. `visual-search-evaluation.md` and its
default manifest/cohort examples now use v2. It does not lower the acceptance gates or
authorize commit, publication, deployment, or installed-cache replacement.

## Development is not held-out acceptance

The six user-PDF images in `artifacts/pdf-six-trial/` and all crops, recolors, near
duplicates, or other images of their product/style families are development regressions.
The evaluator rejects the six original image SHA256 values in HELD_OUT even if renamed.
Hashes cannot recognize all derived images: the human cohort reviewer must group the
same style family together and attest prior exposure. Do not relabel a previously seen
family as UNSEEN or invent a new family ID for a different photograph of the same style.

The six-image results remain 12 development runs, not a population accuracy estimate.
Do not convert their `DEVELOPMENT_LIVE_CODEX_MCP_CAPTURE` files to acceptance captures
by adding invented missing fields. An independently frozen acceptance corpus still
requires at least 40 supported/retrievable, human-confirmed real images, each with and
without an explicit brand, for baseline and candidate. At least 10 supported held-out
images remain required; 20 development / 20 held-out is recommended. Split by style
family, not just filename or image hash, before tuning.

## Freeze before recording

1. Human reviewers label targets, support/retrievability and style-family membership
   before running either release. Unsupported and negative cases remain in the inventory.
2. Create an immutable private cohort JSON, compute its SHA256, and record that digest
   in the owner-reviewed evaluation record before capture. Freeze the label file hashes
   as well as image hashes, splits, eligibility, and prior exposure.
3. Every actual capture records that same `cohortSha256` at start, plus actual `startedAt`.
   All baseline/candidate captures must start after the cohort freeze time.
4. The final manifest references the cohort artifact. Missing cases, changed labels or
   splits, retrospective eligibility changes, reused captures, and mismatched digests
   make the report INCOMPLETE; failed runs must not be moved out of the denominator.

Minimal cohort shape (placeholders are not usable acceptance evidence):

```json
{
  "kind": "FROZEN_VISUAL_EVALUATION_COHORT",
  "frozenAt": "2026-09-06T12:00:00Z",
  "reviewerId": "human-reviewer",
  "cases": [{
    "id": "case-id",
    "imageSha256": "<64 lowercase hex>",
    "labelSha256": "<64 lowercase hex>",
    "styleFamilyId": "reviewed-style-family-id",
    "split": "HELD_OUT",
    "priorExposure": "UNSEEN",
    "eligibility": "SUPPORTED_RETRIEVABLE"
  }]
}
```

`priorExposure` is UNSEEN or DEVELOPMENT. Eligibility remains SUPPORTED_RETRIEVABLE,
UNAVAILABLE, OUT_OF_SCOPE or EXPECTED_NO_MATCH. Do not mark an upstream outage occurring
during a test as a preexisting exclusion. Record it as a failed or incomplete run under
the frozen eligibility. A materially changed source set requires a newly approved cohort
and a new baseline/candidate run pair, not edits to the old evidence.

Manifest changes: `schemaVersion: 2` and required
`cohort: { "path": "cohort.json", "sha256": "<frozen digest>" }`; other manifest fields
remain as documented for v1. Every LIVE_CODEX_MCP_CAPTURE now also requires `startedAt`
and `cohortSha256`. Human target labels must be reviewed before cohort freeze; run
reviews must be dated after their actual capture start.

Cryptographic hashes prove internal file consistency, not real-world authorship or
honest timestamps. Keep original Codex messages/tool results and the independently
recorded pre-run cohort digest for human audit. Do not manufacture captures or backdate
metadata. The CLI does not itself prove a model looked at an image.

## Blind inputs and actual model verdicts

- First freeze reference-image extraction without reading target answers. Keep expected
  names, URLs and hashes outside the acting search/review context; reveal only a supplied
  brand in WITH_BRAND mode. Human reviewers attest `answerIsolationReviewed: true`.
- Each HUMAN_RUN_REVIEW now also requires
  `verdictOriginReviewed: "ACTIVE_MODEL_IMAGE_REVIEW"`. The reviewer must check that
  submitted verdicts came from actual inspection of the returned candidate images by
  the active model, not a fixture, expected-output generator, or metadata-only shortcut.
- The evaluator rejects `sourcePageUrl`, `productUrl` and `suspectedProductName` hints
  in visual-acceptance input. Known-URL detail retrieval is a separate diagnostic and
  never image-search recall. Free-text answer leakage and fraudulent provenance still
  require human auditing; typed schemas alone cannot establish blindness.
- Retain actual initial and finalize calls, candidate images and their hashes, session
  IDs, final cards and selection references. Never synthesize absent baseline stages.
- A genuine terminal no-candidate result is a miss for a supported target, not missing
  evidence. Initial image-display-only capture still cannot masquerade as terminal by
  appending an empty final list. Timeouts/errors remain visible, never silently excluded.

## Fixed gates and denominators

The original gates remain: candidate-pool recall >=95%, top-three target recall >=90%,
human-reviewed displayed visual precision >=95%, correct primary ordering 100%, zero
identity/reference/EXACT/policy/false-absence violations, and no baseline regression.
Apply them separately to WITH_BRAND, WITHOUT_BRAND and their held-out subsets. A small
development rerun cannot satisfy these release gates. Empty denominators never pass.

The report now includes `cohortSha256`, `denominators`, `heldOutDenominators`:

- `plannedCases`: every frozen case, including negatives and unsupported cases.
- `supportedCases`: the pre-frozen supported/retrievable target denominator.
- `targetCases`: supported plus unavailable target cases; excludes explicit out-of-scope
  and expected-no-match cases from target-hit math, while retaining them in inventory,
  precision and safety checks.
- Recall uses frozen supportedCases, not only successful captures.
- `allSampleTop3Coverage`: target hits across supported and unavailable targets /
  frozen targetCases. This exposes coverage gaps beyond the supported-only gate.
- `runCompletion`: completed, valid case records / plannedCases. Missing artifacts stay
  in planned denominators and block acceptance; precision still describes only observed
  cards, so incomplete evidence must not be reported as a passed precision gate.

Pool telemetry currently means the bounded backend review pool, not every raw provider
product. Do not label it complete raw-source recall. Keep stage-level provider/filtered/
pool/review/final identities distinct if expanding telemetry.

Score the requested style and colorway as a target. Other-brand similar silhouettes and
other colorways are not target hits merely because they look similar. Judge visual
precision according to the displayed claim: a different-brand simple silhouette must
not be labeled the same product without evidence. Correct target discovery, validated
selected-variant availability, and an eligible buying recommendation are separate results.
FAYE's official XXS out-of-stock result demonstrates why RESEARCH_ONLY is not automatically
a retrieval failure or merchant-trust failure. Do not generalize one size to all sizes.

## Recommendation reasons added with this fix

Primary eligibility and research reasons use the same ranking assessment. New typed
reason codes are VARIANT_OUT_OF_STOCK, UNVERIFIED_MERCHANT, UNFULFILLED_REQUIREMENTS,
SIMILAR_ONLY and MISSING_PRICE. Missing/invalid item prices cannot establish a buying
primary; a verified zero price remains valid. READY reasons stay separate from blockers.
The aggregate summary lists at most three applicable limitations across results, not
an assertion that each card has all those limitations. Stock wording stays scoped to
the selected variant, and never downgrades an OFFICIAL merchant due to missing stock.

## Local validation and evidence limits

```sh
pnpm exec vitest run apps/mcp-server/test/product-recommendation.test.ts apps/mcp-server/test/recommendation-message.test.ts apps/mcp-server/test/ranking-assessment.test.ts scripts/evaluate-visual-search.test.ts
pnpm eval:visual path/to/private-manifest.json
```

Evaluator unit tests deliberately use synthetic fixtures to exercise validation logic;
their green results are not real-image acceptance. The scoring CLI only reads artifacts,
does not call providers, generate verdicts, or publish original images. Retain local
images and unredacted raw captures privately; never commit them or private source URLs.
