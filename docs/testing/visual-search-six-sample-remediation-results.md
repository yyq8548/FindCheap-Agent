# Six-sample remediation verification

Local worktree only. No commit, push, deployment, registry publication, or Codex
installed-cache replacement was performed. Original user photos/captures are
gitignored local artifacts; this report contains no photo or private source URL.

## Implemented controls

- Bounded source-to-review-to-result funnel with SHA256 fingerprints, counts,
  truncation flags and cumulative multi-round outcomes; no raw queries or private URLs.
- Pattern/palette/structure retention, local occlusion handling and fail-closed
  confidence/visibility checks. Generic cut/color does not establish possible identity.
- Same product/raw source-image deduplication across resize budgets. Different
  merchants and real alternate views remain separate; duplicate downloads cost budget.
- Reviewed official catalog adapter: independent category discovery, persisted bounded
  metadata, source revalidation, 6-hour refresh frequency, 24-hour freshness and 7-day
  expiry. Ordinary text searches do not query this visual-only catalog.
- Relative official offer parsing, explicit variant/color locking, same-color saleable
  size selection, size/stock scope on cards, stale stock-evidence removal, and safe
  availability/merchant/requirements/price reason messages in both languages.
- Formal acceptance v2 freezes cohort, labels, support denominator and style-family
  split before capture. Known six-image development cases cannot become held-out data.

## Real development checks

Independent category discovery used a reviewed DÔEN source with generic `dress`,
not the six expected URLs. It discovered 11 records. A new process could search the
cache without a brand; an immediate second refresh was skipped by persisted limits.
That proves the adapter operates, not that the whole storefront is indexed.

Intermediate bundle d98adb814f37512cbe5e46aafe8fce10e2f6afb1df5087318051a35fd3317a91:
12/12 development runs reached a terminal result, with 72 actual candidate-image
inspections. Target recall remained 0/6 unbranded, 1/6 branded (Faye). One official
read timed out; no run exhausted its overall budget. Faye's selected colorway was
reported out of stock and research-only, without falsely blaming merchant trust.

The live review exposed another queue bug: zero-structure-score official cache
entries crowded out a previously eligible/pooled similar product. The intermediate
run is retained under `artifacts/pdf-six-trial/runs/fix2-*`; it is not a passing
release benchmark. The queue was subsequently corrected: reliable color/pattern
signals now rank weak metadata candidates, below the reliable structural tier;
official/trust preference breaks equal-relevance ties rather than erasing relevance.
The final visual/identity gate was not weakened.

## Final verification

Final bundle: 86b9f6832aa4551af849bf3a1dedd8e815eae0f31e7613cbcae3008d6eaf893a.
Base commit remains 9a6fc1c39fd1dda5f486c87e8a737e164ecb8049, with approved local
uncommitted changes. Version remains 0.17.12; this is not a published release.

| Check | Result |
| --- | --- |
| Full test suite | 71 files, 869/869 tests passed |
| Typecheck / lint | Passed |
| MCP bundle + image worker / Awin service build | Passed |
| Fresh bundled stdio smoke | 3/3 passed |
| Dependency audit, high threshold | No known vulnerabilities reported |
| Git diff whitespace check | Passed with repository line-ending configuration |
| Final real development runs | 12/12 completed, 72/72 images actively inspected |
| Duplicate product/image presentations | 0 |
| Read timeouts / exhausted budgets | 0 / 0 |

Final fresh captures are `artifacts/pdf-six-trial/runs/fix3-*`; the local summary
is `artifacts/pdf-six-trial/results-fix3.json`. No old model verdict was automatically
replayed. Inputs retained the frozen image observations and original brand mode.

| Expected product | Image only | Image + brand |
| --- | --- | --- |
| Julia, expected rose floral colorway | Not returned | Not returned; wrong colorway rejected |
| Faye, Alderbrook Plaid | Not returned | Returned; out of stock, research only |
| Zeno top | Not returned | No candidates from supported branded sources |
| Oren silk dress | Not returned | No candidates from supported branded sources |
| Nataly knit dress | Only a differently patterned similar card | No candidates from supported branded sources |
| Belden mini dress | Not returned | No candidates from supported branded sources |

Target recall therefore remains **0/6 image-only and 1/6 with brand**. This does not
meet the intended real-world finding outcome. Similar cards are not target hits.
The queue correction improves candidate relevance: case 06 changed from nine
official-cache images to eight external candidates plus one official candidate;
case 04's nine images were all brown strapless dresses instead of five unrelated
official-cache dresses. Structural conflicts still prevented false recommendations.
The earlier Satin Tempt record disappeared from the provider's normalized response
in the final live run; its specific top-nine recovery is unit-tested, not claimed
as a demonstrated final live hit.

## Remaining acceptance and rollout boundaries

Reformation's verified-domain/platform evidence has been collected, but its manual
official registry approval remains pending. No trust record was silently promoted.
The 11-record local cache is an incremental subset; populating broader reviewed
source coverage is separate from implementing the adapter.

The original >=40 human-confirmed samples, >=10 held-out styles, >=95% pool recall,
>=90% top-three recall, >=95% displayed precision and zero safety/identity violations
are unchanged. Six known development examples cannot establish those thresholds.
Approval of code changes is not approval to publish or claim production accuracy.
