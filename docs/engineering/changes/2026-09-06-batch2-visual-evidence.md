# Batch 2 visual implementation evidence

Authority: frozen V1–V5 in [batch 2](2026-09-06-design-alignment-batch-2.md).
Baseline: v0.17.23, `0a0b45cf8ac5250cbdf62b96c27d5a1a3b1bf9e2`.
No publication, trust expansion, live image upload, or automatic Watch is authorized here.

## Atomic sequence

The approved public seams are MCP Client/InMemoryTransport, source adapter ports,
and existing recommendation/comparison/UI contracts. Source substitutes represent
external evidence only, never a mocked recommendation or acceptance decision.

V1 is split into V1a (global Shopify visual requests retain OOS) and V1b (visual
web recovery retains OOS). Both change search-products independently and each gets
a red assertion, immediate `pnpm build:mcp`, and targeted assertions. V2–V5 retain
the frozen dependencies; any further split is recorded before its tests.

## Execution

Test counts below represent local synthetic regressions, not current merchant
results, host acceptance, or held-out accuracy.

- V1a red, 2026-09-06 05:10:43 -04:00: `pnpm exec vitest run
  apps/mcp-server/test/visual-fallback-server.test.ts`, exit 1, 1 failed. No image
  candidate was returned because includeOutOfStock was absent at the source port.
- V1a minimal change: image search alone supplies the existing includeOutOfStock
  option. Immediate `pnpm build:mcp` passed at 05:10:51. Target run of
  visual-fallback-server, shopify-global-catalog-client and realtime-official-search
  passed 27/27 (3 files). Actual catalog adapter filter tests are included, as well
  as unchanged ordinary text behavior and non-primary OOS evidence.
- V1b red at 05:11:12: web-product-recovery, exit 1, 1 failed / 36 passed;
  the unavailable web variant disappeared before image review. Minimal visual-only
  retention followed by immediate build at 05:11:23 passed. Web recovery,
  visual-fallback-server and realtime-official-search: 40/40, 3 files.

V2 is split before implementation: V2a preserves one reviewed possible-same-item
OOS anchor within the existing final card limit through the public finalizer;
V2b reuses that policy when merging review rounds and prevents OOS from satisfying
the stopping condition. A small visual-search-outcome module owns these two rules.
The existing source/variant identity remains authoritative; possible is not confirmed.

- V2a red at 05:12:00: visual-review-policy, 1 failed / 31 passed, the OOS
  candidate was fourth and disappeared. Immediate build at 05:12:17 passed;
  visual-review-policy + visual-identity-server: 34/34.
- V2b red at 05:13:07: visual-round-recovery, 1 failed / 4 passed, no second
  review was returned after the accepted OOS possible item. Shared stopping/cap
  policy integrated into server; immediate build at 05:13:28 passed. Four affected
  suites passed 40/40, including terminal round two and replay rejection.

V3 refinement before tests: keep the service-owned scope inside the existing
VisualReviewAssessment object, already transported by candidate/card/comparison
contracts. V3a adds the optional SIMILAR recommendation scope and a narrowly
conditioned ranking exception; V3b grants that scope only in the visual finalizer;
V3c updates the MCP output schema and orchestration consumer. No model input schema
accepts this scope. Each substep uses its public seam and an immediate build.

- V3a red at 05:14:48: product-recommendation, 1 failed / 39 passed (SIMILAR_ONLY
  blocked the explicitly scoped valid review). Immediate build at 05:15:00 passed;
  recommendation, ranking-assessment and visual-review-policy passed 75/75.
- V3b red at 05:15:37: visual-review-policy, 1 failed / 32 passed (default visual
  SAME_STYLE was dropped). Finalizer now grants the scope after a bound valid
  review and synchronizes source matchStatus without changing identity facts.
  Immediate build at 05:15:55 passed; three target files passed 75/75.
- V3c red at 05:16:29: MCP returned an output-schema rejection for the new scope;
  a second diagnostic confirmed products[0].visualReviewAssessment UNSUPPORTED_FIELDS.
  Output-only schema and accepted-review accounting updated; immediate build at
  05:16:53 passed. Four target files passed 80/80; typecheck passed.

V4 refinement, approved by the coordinating agent before tests: inspection builds
a fresh source-identity card and drops old visual assessment. Merely clearing scope
would still permit an EXACT primary. Add an independent output-only
visualReviewRequired fact / VISUAL_REVIEW_REQUIRED ranking reason, not a user hard
requirement. V4a establishes that domain contract with bilingual reason text;
V4b sets it only for changed image/variant evidence in visual-derived snapshots and
preserves historical snapshots. Ordinary text inspection remains unchanged. Then
V4c adds final outcome/scope and comparison contracts, followed by V4d rendered UI.

- V4a red 05:19:09: product-recommendation 1 failed / 40 passed; fresh variant
  source EXACT became primary without reviewed visual evidence. Independent fact
  and bilingual limitation added, build 05:21:22 passed, three files 51/51.
- V4b public MCP red 05:21:56: 1 failed / 2 passed, changed variant lacked gate.
  Build 05:22:13 passed, visual-fallback + requirements-workflow + recommendation
  66/66. Old snapshot re-render remains scoped SIMILAR and READY; ordinary text
  inspection regression suite remains green.
- V4c comparison red 05:22:46: 1 failed / 20 passed. Initial fixture accidentally
  retained coffee unit quantity; corrected to dresses and reran 05:22:55: still
  red only for missing scope. Comparison output retains review/evidence/gate and
  scoped recommendation; build 05:23:09 passed, three files 33/33.
- V4c outcome domain red 05:23:41: 3/3 failed (missing function). Build 05:24:00
  passed; outcome + visual policy 36/36. MCP outcome red 05:24:22: 2 failed / 6
  passed. Intermediate build passed but tests/typecheck exposed a patch placed in
  the wrong similarly-shaped handler (undefined snapshot); corrected within this
  step before proceeding. Build 05:25:20, 51/51 across four files and typecheck
  passed. Public MCP checks default SAME_STYLE -> primary -> compare, no like-for-
  like price delta, preserved SIMILAR entries; source PARTIAL stays incomplete.
- V4d cards/inline comparison red 05:26:03: 4 failed / 44 passed. Build 05:26:18
  passed, 48/48. Separate comparison UI red 05:26:30: 2 failed / 12 passed.
  Build 05:26:46 passed; both UI files 62/62. Localized similar primary and new
  variant review notices, outcome banner and visual difference rows rendered.
- Root review refinement: source EXACT is independently stable even with a
  HIGHLY_SIMILAR visual group; stopping, OOS anchor and outcome now use the union
  of stable EXACT and POSSIBLE_SAME_ITEM. Empty outcome must not claim cards shown.
  Red 05:28:13: 3 failed / 3 passed. Build 05:28:26 passed; three files 44/44.

V3 adversarial gate discovered 05:28:50: MCP 1 failed / 2 passed. Required black,
metadata black, but admissible ivory visual conflict + three structural matches
still produced READY. Finalizer lacks typed hard constraints. Proposed narrow
refinement sent to coordinating agent: pass immutable required/excluded features,
reuse existing feature matcher only on admissible review evidence, and exclude
conflicting hard constraints without rewriting source facts. Awaiting scope
confirmation before source change. Pure image-only color differences remain valid.

Coordinating agent approved this refinement before source change. Implement in
two atomic steps: V3d assessVisualVerdict accepts optional immutable typed hard
features and checks only admissible conflict pairs through evaluateFeature; V3e
finalizer and its sole shared MCP entry pass the original session constraints
(including recovered-web sessions) and use the same assessment for diagnostics.
Required color/pattern differences exclude; matching explicitly excluded visible
attributes exclude. Occluded/uncertain evidence does not. No user requirements or
source facts are rewritten; pure image-only colorway alternatives remain valid.

- V3d domain red 05:30:41: 1 failed / 33 passed. Build 05:30:54 passed;
  visual policy + existing constraint matcher 76/76. Cases include required black,
  excluded white, required floral, allowed black-or-white, and uncertain evidence.
- V3e public finalizer red 05:31:07: 1 failed / 33 passed. Build 05:31:18,
  34/34. MCP still red 05:31:38: 1 failed / 2 passed until the sole shared handler
  passed immutable session requirements into review accounting and finalization.
  Build 05:31:41 passed, four affected files 48/48, typecheck passed.
- V4 scope alignment approved by root: non-EXACT HIGHLY_SIMILAR is also an
  alternative scope. Red visual policy 05:32:26: 2 failed / 32 passed. Build
  05:32:35 passed, three files 40/40. Scoped ranking guard for HIGHLY_SIMILAR
  source-SIMILAR red 05:33:02: 1 failed / 41 passed; build 05:33:04, 66/66.
  Both grades retain the same trust, IN_STOCK, price, hard requirement and fresh-
  visual-review gates; plain text SIMILAR remains blocked.
- Root review colorway refinement: user may request black while their reference
  image is ivory. Admissible candidate white must still contradict required black,
  irrespective of reference match. Red 05:33:34: 2 failed / 36 passed. Existing
  evaluator now rejects candidate CONTRADICTED, or reference MATCHED with candidate
  UNKNOWN; unrelated UNKNOWN attributes are not rejected. Build 05:33:36, 46/46.
- V5 runtime descriptions now state automatic reviewed image alternatives,
  server-owned scope, immutable hard constraints, tentative/confirmed OOS, bounded
  and incomplete outcomes, variant re-review and opt-in-only Watch. Immediate
  build 05:34:11 passed; public MCP/contract smoke 13/13. Distributed Skill and
  invocation prompt aligned; no new frontmatter routing or release/version change.
  Skill validator first exposed Windows encoding, then a pre-existing unquoted
  colon in description. UTF-8 mode and quoting that existing description are the
  minimal validation corrections; validator is rerun below.
- Final targeted sweep 05:35:00: 26 files, 424/424 passed (visual, recovery,
  ranking/recommendation, comparison/cards, reference/requirements/adapter seams).
  An earlier PowerShell array invocation joined all filters into one and found no
  tests; corrected to explicit individual file arguments before this result.
  Targeted runtime ESLint, typecheck and git diff --check passed at 05:34:30.
- Final UTF-8 quick_validate at 05:35 returned `Skill is valid!`; diff check
  returned zero. Runtime source/bundle/test write lock released to coordinating
  agent after these gates; this evidence file is the final V1–V5 handoff.

Remaining acceptance is unchanged: these are synthetic/offline policy and transport
regressions, not image recognition accuracy. No six-image current live replay or
held-out >=40-image accuracy acceptance is claimed here. No host whole-turn budget,
authorization bridge, restart memory, actual Watch, new merchant trust, raw image
upload, local catalog, commit/push/release/install/deploy was performed in V1–V5.

## V6 — approved adversarial corrections (frozen before source edits)

Independent read-only review after V5 used the actual public exported policy and
recommendation functions via `node --import tsx --input-type=module`; no files,
builds or network were used. Two concrete failures were observed: admissible
COLOR:white in `matches` bypassed explicit excluded white, because only conflicts
were checked; scoped HIGHLY_SIMILAR with DISCOVERY_MATCH and UNKNOWN stock returned
READY, because only matchStatus SIMILAR activated the eligibility guard.

Root approved precisely two atomic modules, after the next source/build handoff:

1. V6a: hard user requirements/exclusions evaluate candidate evidence from all
   admissible matches and conflicts. Reuse the existing matcher and uncertainty
   filters; model image clues remain distinct from user hard constraints. Red
   direct policy and MCP tests: metadata black, image matching reference white,
   explicit excluded white / required black must not reach primary. Public MCP
   review diagnostics must agree. Preserve color-only similarity without a hard
   user restriction; uncertain/occluded evidence remains inadmissible. Immediate
   build:mcp, then public finalizer / MCP / recovered-web tests.
2. V6b: scoped alternatives activate the guard even with DISCOVERY_MATCH. Only
   valid scoped structural review and IN_STOCK clear SIMILAR_ONLY; no new enum.
   Red ranking/MCP tests for UNKNOWN, invalid review and valid IN_STOCK; normal
   unscoped text behavior and stable EXACT/POSSIBLE unchanged. Immediate
   build:mcp, then recommendation, ranking, comparison and MCP tests.

No new source/provider/trust/catalog/authorization behavior is authorized by V6.
Awaiting exclusive source/build lock before writing tests or runtime code.

V6 lock was granted after QR1 finished its atomic build/tests. Root requested a
same-policy defensive refinement before V6 completion: retain all admissible
matching witnesses for hard constraints, while still counting unique attributes
for review strength. MCP already rejects duplicate verdict attributes through its
strict input schema; the public legacy domain function must not lose an earlier
hard conflict when later duplicate evidence overwrites the score Map. Direct
duplicate-witness regression plus explicit schema rejection covers this boundary.

- V6a red 05:38:28: policy/finalizer plus real MCP, 3 failed / 38 passed.
  Hard gate expanded to admissible matching evidence; immediate build 05:38:38
  passed, four target files 52/52. Both required black and excluded white reject
  a matching white image even if source metadata says black; review diagnostics
  agree. Existing image-only similarity and uncertainty remain allowed.
- Duplicate-witness refinement red 05:39:37: 1 failed / 35 passed. Raw
  admissible matches retained for hard gating, unique attributes retained for
  scoring. Immediate build 05:39:39 passed, three files 50/50. MCP's duplicate-
  attribute schema rejection is explicitly asserted; this is legacy-domain
  hardening, not a newly observed MCP input bypass.
- V6b red 05:39:07: 2 failed / 46 passed, actual UNKNOWN-stock highly-similar
  MCP primary and public recommendation invalid-review gate. Minimal ranking
  predicate now activates for source SIMILAR or server SIMILAR scope. Immediate
  build 05:39:51 passed. First target run: 71 passed / 1 failed because old OOS
  test asserted only VARIANT_OUT_OF_STOCK; valid new output also includes the
  scoped alternative's SIMILAR_ONLY guard. Updated exact expected reason list;
  no assertion weakened and no source behavior broadened.
- Final V6 sweep 05:40:14: 26 files 431/431 passed. `pnpm typecheck`, scoped
  ESLint over both changed runtime modules and four changed test files, and
  `git diff --check` completed successfully. No quote, Watch or budget source
  files were edited in V6. Generated MCP bundle reflects the current shared
  tree including the preceding QR1 work. Exclusive source/build lock released
  back to root after all gates completed.

## V7 — approved colorway/brand eligibility correction (frozen before tests)

Read-only public-domain replay confirmed another gap against total design 4.2:
reference brand A / black, source brand B / white, three admissible structural
matches and one COLOR conflict, with allowAlternatives=false, still produced
HIGHLY_SIMILAR plus SIMILAR scope and READY primary. Missing candidate brand also
produced READY. The approved directions are same-color/structure cross-brand, or
same-brand different-color structural alternatives; earlier broad statements that
image-only colorway differences remain valid did not authorize both changes together.

Compared A, a shared candidate-eligibility gate before finalization, with B, retaining
the candidate as ranking-only secondary. Root approved A: B requires a new propagated
blocker across ranking/card/comparison/inspection and risks DISCOVERY_MATCH becoming
primary when scope alone is removed. A keeps acceptance, cards and diagnostics aligned
with fewer interfaces. No new model-submitted permission or brand-relation field.

Frozen source evidence/context:

- Only already-admissible COLOR/PATTERN differences trigger this extra gate. A known
  positive same-brand relationship is required to retain that visual alternative.
- The reference brand is immutable snapshot.input.brand ?? snapshot.input.visualInput.brand.
  It is passed explicitly to finalization and diagnostics; a requestedBrand boolean is
  not brand identity. Direct legacy finalizer callers default to visualInput.brand.
  Neither the original user requirements nor reference image facts are rewritten.
- Candidate brand comes only from ShopifyProduct.brand or the eBay attributes explicitly
  labeled brand/manufacturer/make. Conflicting labeled values mean UNKNOWN. Awin's
  public product type has no isolated brand field, so its brand is UNKNOWN here.
  Merchant name, title, model verdict and flattened requirementEvidence never prove brand.
- Compare complete normalized brand values using existing NFKD/diacritic/case token
  normalization, not containsBrand token-subset matching. No registry or Feed expansion.
- Unknown reference/candidate brand or a different source brand cannot authorize a
  colorway change. Same-color cross-brand choices, immutable hard constraints,
  stable EXACT without an admissible conflict and ordinary text behavior stay unchanged.

Atomic sequence, after QR4 is green and the exclusive runtime/build lock is handed over:

1. V7a: shared candidate-review gate in search-products plus its public finalizer;
   optional immutable reference-brand argument, no public tool input changes. Red
   public finalizer assertions cover other/unknown/conflicting brands with differences,
   unknown reference, full normalized same-brand positive, same-color cross-brand,
   misleading merchant/title, hard-required color and legacy/stable-EXACT boundaries.
   Existing colorway-positive fixtures must state their source-proven same brand.
   Minimal source change, immediate build:mcp, then domain assertions.
2. V7b: the sole shared MCP finalize handler uses the same candidate gate for diagnostic
   acceptance and finalization and passes the immutable reference brand. Initial,
   second-round and recovered-web visual sessions all flow through this handler.
   Red MCP assertions cover final cards/primary/compare and REVIEW_ACCEPTED versus
   REVIEW_CONFLICT consistency, including top-level-only brand and recovered web.
   Align that tool's colorway description; immediate build:mcp then targeted assertions.
3. V7c if applicable: update distributed visual Skill/invocation language that currently
   allows unrestricted colorway differences, after reading the applicable writing
   instructions. Red distributed-contract assertion, minimal documentation change,
   immediate build:mcp, contract/Skill validation, then a bounded visual sweep.

No source or tests have been changed for V7 at this freeze. QR/W owns the runtime/build
lock. No network, actual shopping action, release, upload or new acceptance claim.

V7b sequencing refinement: the shared MCP acceptance/context module gets its own
immediate build/green before V7b's tool-description contract. Then the distributed
Skill/invocation step follows separately, keeping the 6,400-byte / 36-line Skill cap
and every QR4 authorization/receipt boundary unchanged.

- V7a red 06:05:35: 9 failed / 3 passed in the public colorway finalizer suite.
  Minimal shared candidate gate and reference-brand argument followed by immediate
  build 06:05:56. New suite 12/12; four older colorway-positive fixtures failed as
  expected because they lacked brand evidence. Added explicit same-brand fixtures;
  Awin now asserts exclusion and unchanged source facts. Domain suites 48/48 at
  06:06:17. Typecheck first found a test union-narrowing issue; explicit source-union
  type fixed the fixture without changing runtime. Typecheck then passed.
- V7b MCP red 06:07:49: 5 failed / 8 passed. Same-brand top-level-only context was
  lost, and other/unknown brand rejection still counted as accepted, including web
  recovery. Shared candidate gate and immutable original brand now feed both paths.
  Immediate build passed at 06:08. Corrected the optional vitest --silent invocation;
  it was a CLI failure, not a test result. Two existing positive metadata-downgrade
  fixtures now include an image brand clue without adding a user-required brand.
  Four MCP suites passed 24/24 at 06:08:31.
- V7b tool-description red 06:09:04: 1 failed / 3 passed through MCP listTools.
  Description now states source-proven same brand, three structural matches,
  unknown-brand refusal and same-color cross-brand retention. Immediate build
  passed; public MCP suite 4/4 at 06:09:24.
- V7c distributed contract red 06:09:35: 1 failed / 14 passed. Replaced only the
  colorway sentence in the current Skill and invocation prompt. Immediate build
  passed; contract suite 15/15 at 06:10:05. Skill is 6,382 UTF-8 bytes and 33 lines,
  below the unchanged 6,400-byte / 36-line caps. QR4 consent and reference rules
  remain covered by the same contract suite.
- Final V7 sweep 06:10:23: 32 files, 612/612 passed. Command: `pnpm exec vitest run
  apps/mcp-server/test/visual- apps/mcp-server/test/product-
  apps/mcp-server/test/ranking-assessment.test.ts apps/mcp-server/test/server.test.ts
  apps/mcp-server/test/workflow-replay.test.ts apps/mcp-server/test/web-product-recovery.test.ts
  apps/mcp-server/test/requirements-workflow.test.ts apps/mcp-server/test/realtime-official-search.test.ts
  tests/contract/findcheap-chrome-v0.test.ts`. Console filtering suppressed only
  repetitive findcheap trace lines, not assertion failures or the process exit code.
  `pnpm typecheck`, scoped ESLint over the two runtime files and six changed test
  files, UTF-8 Skill quick_validate and `git diff --check` all passed afterward.

V7 source changes are confined to search-products.ts and the visual handler/tool
description in server.ts. Tests: two new visual-colorway suites, visual-review-policy,
visual-identity-server, visual-web-recovery and the distributed plugin contract.
The two compare-products instruction files and this evidence record are updated;
the MCP bundle is regenerated from the shared tree. Quote/Watch/budget runtime
behavior is untouched. V7 is complete; exclusive runtime/source/build lock is
released back to root for Watch work. This remains offline contract verification,
not real image accuracy, live host acceptance or publication.

## V8 terminal consistency — approved atomic execution

Follow the V8 refinement frozen in the batch-2 plan. The public seam is MCP
search/finalize/render output, with synthetic provider fixtures only. V8a scopes
generic Chrome/no-product prose to non-visual searches without changing recovery
eligibility. V8b gives every remembered empty visual failure the existing shared
outcome, consistently in structured state, message and model text, retaining its
specific failure and existing authorization boundary. Pending REQUEST_WEB_SEARCH
and REPORT_INCOMPLETE remain incomplete, never evidence of product absence.

Each runtime module follows red, minimal change, immediate build:mcp and focused
green. Initial-empty/image-load/web-failure and text recovery consumers follow,
then typecheck and scoped lint. No Skill, retrieval/ranking/permission, quote or
Watch changes. The six original real captures and frozen pre-V8 bundle hash are
not overwritten or reclassified as live validation of V8.

- V8a: the first fixture included the default unavailable Awin adapter, correctly
  producing incomplete coverage. Replaced it with an explicitly complete empty
  synthetic adapter to reproduce the real stale-recall condition. Public MCP
  zh/en assertions then failed specifically on the contradictory no-product prose:
  2 failed at 07:06:44 -04:00. One-line non-visual gate, immediate `pnpm build:mcp`
  passed; 2/2 passed at 07:06:54, including retained READY selection, similar scope,
  model text and immutable render replay.
- V8b: public initial-empty and all-conflicted zh/en cases failed 4/4 on absent
  `visualSearchOutcome` at 07:07:34 (8 other assertions passed). The shared failure
  helper now adds the existing empty/incomplete outcome to the remembered content
  and its message. Immediate build passed. The model-text assertion was corrected
  to preserve the existing external-data fence instead of expecting an unfenced
  singleton content array. Finalize-only zh/en cases passed 2/2 at 07:08:06.
- V8 consumer refinement: initial zero-image output projects only selected fields
  from remembered content, so its two existing red cases required the optional
  `visualSearchOutcome` output schema field and explicit field projection. This is
  output-only, not a new model authority or recovery path. Immediate build passed;
  both suites passed 14/14 at 07:08:32. Intermediate review-required responses still
  omit terminal outcomes and still prohibit final answers.
- Consumer regression now includes initial empty/all-conflicted with real simulated
  consent recovery, recovered-image failure, image budget exhaustion, wrong-category
  rejection, and two-round exhaustion. Each retains specific failure and recovery;
  final empty outcomes never claim reviewed cards are shown. No third recovery or
  new authorization is introduced. Existing ordinary text recovery remains tested.
- Final scoped sweep at 07:09:42: 7 files / 163 assertions passed. Command:
  `pnpm exec vitest run apps/mcp-server/test/visual-web-recovery.test.ts
  apps/mcp-server/test/visual-terminal-outcome.test.ts
  apps/mcp-server/test/web-product-recovery.test.ts
  apps/mcp-server/test/text-recovery.test.ts
  apps/mcp-server/test/visual-round-recovery.test.ts
  apps/mcp-server/test/visual-fallback-server.test.ts
  apps/mcp-server/test/server.test.ts`. Console filtering removes only repetitive
  trace lines and preserves the Vitest exit code. Initial typecheck exposed the
  SDK's unknown content union in new assertions; public `CallToolResultSchema`
  parsing fixed that without weakening text assertions. `pnpm typecheck`, scoped
  ESLint on server.ts and both changed tests, and `git diff --check` passed.

V8 changes only server.ts terminal assembly/output projection, the new
visual-terminal-outcome test, visual-web-recovery tests, this evidence record and
the regenerated MCP artifacts. The root owns final full-suite/stdio verification.
Exclusive runtime/source/build lock is released to root. No commit, push, deploy,
installed-cache replacement, Skill edit or new real six-image acceptance occurred.
