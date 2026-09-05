# Merchant coverage and quality-evidence review

Scope: current working-tree code plus read-only production registry GETs. No merchant approvals, database writes, deployment, external brand-ownership research or catalog construction.

## Verified observations

At `2026-09-05T10:18:46.9706348Z`, the public `/v1/official-storefronts` endpoint returned `registry-2026-09-05-02-official`, 110 records. `/v1/merchant-trust` returned `registry-2026-09-05-02-trust`, 210 records. Both requests succeeded. Exact brand/domain-family checks for Tesla, Verb/verbproducts and Bounce Curl found no corresponding record.

| Requested brand | Embedded official/trust records | Published official/trust records | Consequence, not a judgment about the merchant |
| --- | --- | --- | --- |
| Tesla | Absent | Absent | No reviewed brand-specific storefront seed from the registry. An encountered seller still requires its own trust and EV compatibility evidence. |
| Verb | Absent | Absent | Ghost product claims can now satisfy the three haircare requirements, but this does not approve its seller or create an official-store entry. |
| Bounce Curl | Absent | Absent | Product fit evidence and merchant identity remain independent; a name or product rating cannot fill the registry gap. |

“Absent” is verified. The historical reason nobody approved these records is not recoverable from the public snapshots; no rejection or unsafe-merchant conclusion is justified. Public snapshots contain approved rows only. The private candidate/rejection history was not queried.

`merchant-trust.ts` resolves exact normalized hosts and reviewed aliases, not a substring of a merchant name. Managed official records can supply official trust. Once managed merchant records are loaded they are authoritative for that lookup. The clients retain valid registry snapshots with a 24-hour refresh window; a previously running process may therefore differ from the endpoint observed above. Awin merchant approval remains a separate, explicitly user-reviewed path; it does not prove that these three brands are joined advertisers or turn arbitrary third-party sellers into official brand stores.

## Quality wording and remaining boundary

Current `QualityEvidenceSchema` permits only `REPORTED_RATING` or `UNKNOWN`, and fixes `qualityGuaranteed` to `false`. UI cards and comparison explicitly say source-reported ratings are not a quality guarantee; unknown quality is distinguished from merchant trust. The value section also says lower cost is not a quality guarantee. No current UI assertion that those fields independently verify product quality was found.

This is honest evidence disclosure, not full quality assurance: material authenticity, warranty performance, certification authenticity, return-policy enforceability, review authenticity and real-world efficacy are not currently verified by `assessQualityEvidence`. `assessRanking` does not universally block a primary recommendation when quality evidence is `UNKNOWN`. Any category that requires safety/quality certification needs an explicit evidence gate before claiming the full approved quality objective is achieved. Do not relabel a merchant claim as independent evidence or compensate for this gap by inventing a quality score.

## Pending explicit review

For each brand, a reviewer must establish the operated domain/storefront relationship, relevant region, brand aliases, product paths, platform/search behavior and exact image CDN hosts, with primary identity evidence and a review date. A successful HTTP or Product JSON-LD probe is technical reachability only. Registry Builder must retain candidate -> probe -> explicit approval -> immutable publication. No new `APPROVED` record was added by this review.

External brand identity pages were not examined in this pass. Proposed brand domains must not be described as newly verified official websites on the basis of this report.

## Acceptance scorer boundary

`scripts/evaluate-shopping-tasks.ts` scores independently recorded artifacts; it neither runs the model nor generates acceptance evidence. Hash verification detects artifact changes, not forged human provenance. The explicit basis is `HASH_VERIFIED_CAPTURE_WITH_HUMAN_ATTESTATION`, not a cryptographic host signature. Source-recording/review integrity remains an operational prerequisite.

Development and held-out tasks are separated; duplicate inputs, held-out family duplication and cross-split families cannot pass. Missing captures remain in frozen task/recall denominators when labels are valid. No displayed cards gives `precisionAt3: null`, not 100%. Three host retries in one task do not satisfy three independent accepted tasks. Image acceptance calls the pre-existing visual scorer directly without lowering its stronger image cohort or provenance checks. Thus satisfying the new 40-task minimum alone does not satisfy the retained visual gate.

The new scorer has no real cohort or successful host evidence supplied in this implementation. Passing its synthetic unit fixtures is not product acceptance.

`recallAt20` uses the first 20 unique fresh source observations, not a globally ranked top-20 list. Optional `retrieval.revalidatedProductHashes` binds still-valid previous products to the current final result; it does not add them to fresh-source recall. Optional `truncated` records bounded trace truncation. Historical captures without these optional fields remain valid.

The visual scorer also recognizes authorized web-image recovery. New `begin_web_search`, `complete_web_search` and the following `finalize_visual_search` calls must include recorded `startedAt`/`finishedAt` timestamps. It checks the actual captured `READY`/`ACCEPT_TRUE` response, parent render and lease, unexpired completion, hashed candidate images, review IDs and the final remaining visual-review round. `WEB_PRODUCT_PAGE` alone is not authorization or visual evidence. Direct webpage cards, denied or forged consent, expired leases and third review rounds are rejected. These checks preserve the original image hashes, frozen labels, human review, independence and visual-accuracy gates; synthetic protocol tests are not evidence of actual host acceptance.

## Code pointers

- `apps/mcp-server/src/merchant-trust.ts`
- `apps/mcp-server/src/official-storefront-registry-client.ts`
- `apps/mcp-server/src/merchant-trust-registry-client.ts`
- `apps/awin-feed-service/src/registry-database.ts`
- `apps/mcp-server/src/product-value-evidence.ts`
- `apps/mcp-server/src/ranking-assessment.ts`
- `apps/mcp-server/src/product-card-ui.ts`
- `scripts/evaluate-shopping-tasks.ts`
- `docs/product/registry-builder.md`
