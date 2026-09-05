# Two-product causal pilot: Zeno and Oren

Local development verification on 2026-09-04 (America/New_York).
This is an unreleased patch on 0.17.13, not a production or held-out acceptance result.

Release packaging note: the user subsequently approved publishing this exact
pilot as 0.17.14. Only version metadata and version-specific test assertions were
changed for packaging. The hashes and unpublished-state statements below describe
the original pilot checkpoint, not the subsequent deployment state.

Current follow-up: see [remaining-remediation status](visual-search-remaining-remediation.md)
for the verified 0.17.14 publication and subsequent local fixes. This historical
report's unresolved Julia/color statements are superseded there, not silently
rewritten as if the earlier run had passed.

## Scope and outcome

The approved experiment was to locate where two known failures disappear, make
the smallest demonstrated fixes, and replay identical image-derived attributes
plus the merchant brand. Faye and Julia are retained as controls. Registry
expansion, full catalog crawling, new retrieval services and deployment are excluded.

| Case | Baseline | Patched bundle | Interpretation |
| --- | --- | --- | --- |
| Zeno Top, blue colorway | No candidate image; `OFFICIAL_ZERO_RESULTS` | Four images reviewed; one final card, Zeno, backend primary | Target recovered; `HIGHLY_SIMILAR`, not exact identity |
| Oren Silk Dress, brown colorway | One wrong dress image; rejected; `CANDIDATES_CONFLICTED` | Six images reviewed; one final card, Oren, backend primary | Target recovered; `HIGHLY_SIMILAR`, not exact identity |
| Faye, Alderbrook Plaid | Previously successful control; not replayed on baseline this turn | Six images reviewed; Faye `POSSIBLE_SAME_ITEM`, out of stock, `RESEARCH_ONLY` | Target retained without an unsupported buy recommendation |
| Julia, original red/pink bouquet print | Previously missing colorway; not replayed on baseline this turn | Nine images reviewed across two rounds; Dahlia Floral returned only as `HIGHLY_SIMILAR` | Original colorway still missing; explicit color and pattern differences retained |

Paired target recall improved from **0/2 to 2/2**. This is evidence that these
specific retrieval/parser fixes work, not evidence of overall accuracy, 6/6
success, or readiness to claim exact identity. Nataly and Belden were not rerun.

## Observed causes and changes

1. **Search language did not match the official site's retrieval behavior.**
   Live `blue cami` results contained Zeno on the first page, whereas the long
   visual query and several striped-top queries did not. `brown strapless dress`
   contained Oren on the first page. The descriptor dictionary omitted `strapless`.
   Generic JSON-LD official stores now try a compact visible-color + structural
   category query first; a spaghetti-strap top maps to `cami`. Suspected names,
   when actually supplied, retain their existing priority. Full visual evidence
   remains unchanged for review. Shopify-specific routing is not switched to this
   compact strategy. This is a retrieval heuristic, not a claim that fewer words
   always improve search.
2. **Returned official results were discarded before product parsing.**
   The old HTML link scan required query words in titles/URLs. A style name such
   as Zeno need not contain `blue` or `cami`; swatch anchors can also lack text.
   The adapter now reads explicit ranked JSON-LD `ItemList` results, validates
   every product URL, deduplicates, and hydrates at most six pages. Existing HTML
   and sitemap fallback remains when a usable list is absent. Site ranking is
   discovery evidence only; category, brand, trust and visual checks still apply.
3. **Valid alphabetic size variants were rejected.**
   The Oren page returned Product JSON-LD successfully, but its offer URL suffixes
   include `0XS`, `00S` and `00L`. The old sibling-SKU check accepted only digits.
   Alphabetic suffixes now require agreement between the product base, offer URL,
   explicit offer SKU and explicit size. Same-host/path/color checks remain.
   Mismatched SKU, size or color is still rejected; explicit unavailable sizes
   are not silently changed to an available size.

No byte, timeout, redirect, image, source-trust, identity or final-review limits
were relaxed. No expected product ID, name or URL was added to runtime search,
registries or cached catalogs. Changes are limited to three source files and
their regression coverage/build outputs.

## Experiment method and evidence

- Baseline commit: `663b17f4ea5b75576666b72d77b3d1d4b0f3d038`.
- Baseline bundle SHA-256: `157b8e96168955ccc04101bbe212a4e20f59bfb7122806289034e9d4d7535498`.
- Patched bundle SHA-256: `1d4d3ad17e637bbd20f375fd20227d20cc1d946c8b498a302596e16e0fe73adc`.
- Both bundles were executed through actual MCP stdio and live provider requests,
  using an isolated empty official-catalog state. No expected-answer catalog was
  imported. Expected official URLs were used separately for diagnosis and scoring,
  not passed to either image-search run.
- Search inputs were frozen before the paired runs: image-visible attributes plus
  brand, with uncertain/occluded clues retained as uncertain. This tests retrieval
  and actual candidate-image review; it is not a blind rerun of image extraction.
- Actual returned images were inspected before structured verdicts. All candidate
  IDs were finalized within their originating live session; no synthetic snapshots
  or acceptance receipts were created. Backend labels remain authoritative.
- The paired runs reached terminal results with no budget exhaustion or read
  timeout. Initial calls: Zeno 4,350 ms before / 6,126 ms after; Oren 1,558 ms
  before / 7,104 ms after. These single observations exclude interactive image
  inspection and are not latency benchmarks. Success costs additional PDP/image
  work; it is not a speed improvement.
- Local ignored evidence: `artifacts/pdf-six-trial/runs/pilot-base-03`,
  `pilot-base-04`, `pilot-new-03`, `pilot-new-04`, `pilot-new-02-valid`,
  `pilot-new-01`; raw public-page diagnostics under `artifacts/visual-pilot`.
  User photos and raw captures are not added to Git.
- `node artifacts/visual-pilot/verify-pilot.mjs` checks identical inputs/reference
  hashes, empty catalogs, saved image hashes, complete same-session verdict IDs,
  target style/colorway URLs, terminal results, conservative labels and controls.
  It passed and wrote `artifacts/visual-pilot/verification.json`. This verifies
  recorded evidence; it does not independently judge the image verdicts.
- One Faye test-driver request contained an unsupported `uncertainties` field.
  The executor correctly rejected it. That attempt is retained as `pilot-new-02`
  and excluded from success counts; a fresh complete run `pilot-new-02-valid`
  used supported fields. Its six image hashes matched the images already viewed
  during this active task. An initial baseline Oren command omitted the harness
  `name` field and was corrected before any MCP search occurred.

## Verification gates

| Gate | Result |
| --- | --- |
| New focused regression tests | 10/10 passed |
| Full suite | 72 files, 886/886 tests passed |
| Fresh bundled MCP stdio smoke | 3/3 passed (also included in full suite) |
| Typecheck, lint, MCP bundle build | Passed |
| Git whitespace check | Passed; normal repository LF/CRLF warnings |
| Paired live target tests | 2/2 target cards, both backend primary |
| Faye positive / Julia no-false-same control | Passed; Julia target recall remains a failure |

The enterprise-agent evaluation skill informed the frozen-input experiment,
separation of unit tests from live outcomes, and explicit non-release boundary.

## Unresolved and not claimed

- Julia's original colorway is not recovered. Existing text evidence still falsely
  includes `color: red` because substring matching can match `inspired`. Image
  review records the true yellow-vs-red/pink difference and prevents a same-item
  label, but the contradictory text evidence remains a separate defect.
- Generic short queries can still miss products or favor another structure.
  ItemList parsing supports the observed bounded shape, not every JSON-LD layout;
  it is not full catalog coverage. First-page discovery does not prove absence.
- These are known development examples, not held-out samples. No general accuracy
  target or full six-image acceptance has been met by this pilot.
- No commit, push, version bump, Railway deployment, registry publication or
  installed Codex cache replacement was performed.
