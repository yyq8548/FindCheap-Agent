# Batch 2 budget evidence

Final integration supersedes local checkpoint status/byte counts below:
[root verification and six-image pilot](2026-09-06-batch2-final-verification.md).
Root preserved the Skill version marker at 6,397 bytes and fixed/tested both
delayed-dispatch gaps after this module handoff. Earlier 6,396-byte values are
historical checkpoints, not current artifact sizes. No second-batch release.

## Scope and authority

Execution follows the service-observed budget contract in
[batch 2 Frozen Plan v3](2026-09-06-design-alignment-batch-2.md), including its
standalone-test scheduling refinement. Production baseline is release commit
`0a0b45cf8ac5250cbdf62b96c27d5a1a3b1bf9e2` (0.17.23). Other batch-2 slices may be
changing their own files concurrently. This record covers budget work only.

The first test seam is the public `SearchRun.read` / `canRead` interface with an
injected monotonic clock and a deterministic source operation. No private field,
host identity, real merchant response, saved conversation or visual verdict is used.
The original network-active budget tests remain unchanged.

## B1.1 red: service deadline includes gaps between calls

At 2026-09-06 09:15:39 UTC, ran:

```text
pnpm exec vitest run apps/mcp-server/test/search-run-flow-budget.test.ts
```

Result: exit 1; one file, two failed assertions. The ordinary-search case uses
90,000 ms; the visual-search case uses 180,000 ms. Both first read successfully,
then read successfully one millisecond before the deadline, and require a new
source read at the deadline to reject with `SearchBudgetError`.

Both failed because the existing implementation returned `verified candidate`
instead of rejecting at the deadline. These are observed behavioral failures,
not a missing-method `TypeError`. The current constructor does not consume the
new internal service-budget and monotonic-clock options.

At 2026-09-06 09:15:59 UTC, ran the unchanged compatibility baseline:

```text
pnpm exec vitest run apps/mcp-server/test/search-run.test.ts
```

Result: exit 0; one file, eight assertions passed. This preserves evidence for
the existing network-active clock behavior; it is not a green result for B1.1.

No source or bundle was changed. No build was run: runtime changes are waiting
for the explicit lock handoff after the quote/Watch slices. A build and targeted
green assertions are required immediately after each subsequent runtime increment.

Cancellation and verified-wait assertions have not been written or run yet. They
will be added as separate red/build/green increments once B1.1 can be implemented;
this avoids writing the entire future interface test suite before its first slice.

## Status

- B1-B3: implemented; targeted assertions, build, typecheck and lint passed.
- The runtime/build lock was returned to the coordinator at 06:52 -04:00 for
  independent full-suite and stable-bundle development-image replay.
- No full-suite check, artifact replay, commit, deployment or installation by this
  budget slice. Whole-turn host timing and lifecycle acceptance remain unverified.
- Earlier sections below are chronological checkpoints, not the current status.

## Readiness refinement after Frozen Plan v5

The blanket quote shutdown in earlier plan v2 is superseded by v5. B2/B3 must
therefore retain and bound the Awin product-document preflight. The root coordinator
approved this refinement before any related test or source edit:

- Extend `AwinShopifyQuoteResolver.resolve(seed, options?)` with an optional
  `{ signal?: AbortSignal }` execution argument. Give its injected `ProductFetch`
  the same optional third argument. The production fetch forwards the signal to
  existing `safeFetchWithProvenance`; no network-safety API change is needed.
- Execute the preflight under the original `SearchRun.read("VARIANT", ...)`, using
  an `awin-preflight:` namespaced stable product key. Retain the existing variant
  and total read quotas. Skip optional preflight when the budget cannot admit it;
  preserve the original products, identity, price evidence and ordering.
- Keep cancellation distinct from an unavailable merchant: check after awaits
  and before writing either the resolved-product map or a public snapshot. The
  existing preflight catches errors, so an outer `Promise.race` alone is not a
  sufficient cancellation guarantee.
- Recompute final timing diagnostics after preflight, not only inside the earlier
  `buildUnifiedResponse`. The new visual outcome's `incomplete` flag must include
  service-budget exhaustion, including expiry between the visual tool calls.

Source inspection: `awin-shopify-quote.ts` `resolve`/`ProductFetch`; existing
`safe-fetch.ts` `FetchPolicy.signal` and DNS/body/redirect abort checks; server
`preflightQuoteCapabilities`, its two callers, `buildUnifiedResponse`, and the new
`describeVisualOutcome` consumer. No new external source or live Cart was invoked.

Base Awin cards already use `MERCHANT_CHECKOUT_ONLY`, which the UI and quote tool
describe as unsupported. The root coordinator approved the following refinement
after comparing an extra `quoteResolution` field with extending the existing enum:
use `quoteCapability: "NOT_CHECKED"` as the single authority for unresolved
capability. Do not combine an unsupported capability with a contradictory secondary
status. No supported quote capability may be inferred from `NOT_CHECKED`.

Before producing the new value, update the top-level and nested card schemas,
comparison input capability and derived `deliveredTotalStatus`, both card/comparison
renderers, and the deal-concierge input type. Comparison quote controls use explicit
allowed statuses rather than merely excluding `MERCHANT_CHECKOUT_ONLY`. Single and
batch quote handlers accept only the two supported capability values; `NOT_CHECKED`
must not cause an authorization prompt or a Cart write. The existing recoverable
quote helper cannot overwrite the new value with unsupported. Hydration and model
context preserve the server-owned value. Instructions say capability remains
unverified and do not ask for ZIP or reset the search budget automatically.

Budget diagnostics separately identify skipped preflight, failed preflight and
established unsupported capability. This does not add a second product-state field.
QR owns current runtime changes; B will introduce the enum and consumers only after
the runtime handoff. QR was notified to use an explicit supported-state allowlist
with its existing three-value contract in the meantime.

At this readiness checkpoint there are still only the two original B1.1 failing
regressions. No additional tests, runtime code, build output or installed state
were changed. Implementation continues to wait for the explicit runtime lock.

## B1 diagnostic refinement: service time is not an image quota

Read-only inspection found `SearchRun.noteUnattemptedImages` currently selects
`ACTIVE_TIME_LIMIT` when network-active time is exhausted and otherwise assumes
`IMAGE_REQUEST_LIMIT`. Once service time also affects `canRead("IMAGE")`, that
fallback would incorrectly report an image quota with fewer than twelve images
and less than thirty seconds of network activity.

The root coordinator approved adding `SERVICE_TIME_LIMIT` to the internal
`imageReviewStop.reason` union before implementation. Preserve existing
`ACTIVE_TIME_LIMIT` for the network-active limit and `IMAGE_REQUEST_LIMIT` for the
actual image count. Cancellation does not create a new budget-exhaustion or image
quota event; an already recorded legitimate stop remains historical evidence.
No request limit or timeout is increased by this correction.

Consumer trace: `search-run.ts` owns and serializes the reason; server
`loadVisualCandidates` calls `noteUnattemptedImages`; `search-diagnostics.ts` passes
the safe run diagnostics into `findcheap/searchTrace`. No other runtime enum
parses `imageReviewStop.reason`. Existing visual failure schemas continue to use
the aggregate `SEARCH_BUDGET_EXHAUSTED` code, and per-image transport cancellation
continues to use `REQUEST_ABORTED`; neither code should be renamed to a quota code.

Affected assertions: `search-run.test.ts` verifies existing image/network reasons;
`visual-budget-diagnostics.test.ts` checks the thirteen-candidate quota boundary;
`search-diagnostics.test.ts` preserves useful matches after bounded work stops.
The later B1 service-clock slice will add a public-interface case with remaining
image/network capacity but no service time, plus cancellation without a fabricated
stop reason. B3 will verify the same reason through the real MCP test transport.
These additional assertions have not been written or run at this checkpoint.

## B3 boundary confirmation after QR3

The root coordinator confirmed that B3 remains limited to the five search
handlers: `search_products`, `search_visual_candidates`, `finalize_visual_search`,
`begin_web_search` and `complete_web_search`. An expired original search budget
must not prevent a later, independently requested explicit quote.

Read-only inspection of `server.ts` lines 2354-2380 shows `authorizeQuote` has no
`SearchRun` dependency. Its real elicitation uses the current request signal and
a fixed 20-second maximum. Only after accepted consent and reference revalidation
does it issue a fresh internal permit. `quote-authorization.ts` lines 19 and 29-38
give that permit its own five-second monotonic transaction budget. The single and
batch quote callers at `server.ts` lines 3766 and 3904 use current-request
cancellation plus snapshot/selection revalidation; their authority is not the
original search clock.

Accordingly, B3 applies `withVerifiedUserWait` only to the search-recovery
elicitation in `begin_web_search`, not indiscriminately to every `elicitInput` call.
The Awin product-document preflight remains a search-owned read and is still
included. Do not place a search cancellation or service-budget guard in global
`rememberSnapshot`: quotation, history and hydration consumers must not inherit
the old search deadline. Search-specific post-await and pre-write guards remain
at their five-handler boundaries.

This confirmation adds no new runtime scope. No source, test, build or deployment
was changed during the precheck; implementation still waits for the runtime lock.

## B1 implementation after runtime handoff

At 2026-09-06 10:28 UTC the coordinator released the exclusive runtime/build lock.
B1.1 immediately added the monotonic service clock and retained the independent
network-active/read limits. `pnpm build:mcp` passed; at 06:28:42 -04:00 the original
two red assertions plus eight unchanged SearchRun assertions passed (10/10).

The cancellation increment first ran at 06:29:05: two assertions failed because
`withRequestSignal` did not exist. These are missing-interface failures, not
claims of observed old-method behavior. The increment added permanent flow abort,
cached/late-result checks and listener cleanup; immediate build passed and 12/12
assertions passed at 06:29:30.

The next red at 06:29:55 had four failures: two missing verified-wait methods,
one actual timeout listener leak in the preceding increment, and one actual
`IMAGE_REQUEST_LIMIT` instead of `SERVICE_TIME_LIMIT`. The same module was fixed;
immediate build and 19/19 targeted assertions passed at 06:30:22. Supplementary
public-interface assertions confirmed concurrent IO is counted once, wall-clock
changes do not reset service time, and cancellation closes a verified wait.
Diagnostics capture one timestamp so their elapsed/active/remaining values agree.

Final B1 build at 06:30:56 passed. At 06:30:58, SearchRun, flow-budget and
visual-budget-diagnostics tests passed three files / 21 assertions. Root typecheck
also passed at 06:30:38. Existing 30-second network-active semantics remain covered.
B2 and B3 remain pending; this is not whole-host 90/180-second acceptance.

## B1 late-result correction

Root review found an event-loop-stall boundary: a provider can resolve after its
monotonic deadline before the timeout callback gets a turn. At 06:31:58 the public
read test moved the clock past 10 seconds or 90 seconds inside the operation and
failed because the value was accepted. `read` now rechecks its own deadline after
await; it classifies its current read/service/IO limits, not an unrelated prior
budget flag, and records a timeout only once. Immediate build and 20 SearchRun
assertions passed at 06:32:13. Root independently passed three files / 23 tests at
06:32:46. Cancellation and earlier cached/late-response behavior remained covered.

## B2 adapter increments

Each source module was followed immediately by `pnpm build:mcp` and local tests.

- Official and merchant registries: optional caller signal cancels only that
  caller's wait. Shared refresh remains independently bounded at five seconds;
  fetch/body are bounded and a late result cannot update the managed registry.
  Precancellation dispatches no new HTTP. Official four tests passed at 06:33:07;
  both registry files passed nine tests at 06:33:34. Shared refresh surviving one
  caller's cancellation is intentional, not a globally cancelled operation.
- Deals: optional execution options outside the business schema carry parent
  cancellation through fetch and streamed body. Source five-second timeout remains
  distinct. Red at 06:34:18 showed precancellation returning an empty result and
  two body-stall test timeouts; immediate build and 15 tests passed at 06:34:50.
  Tests also cover late legacy ports and reader cancellation.
- Web pages: zero budget dispatches no reads; parent cancellation reaches page IO
  and ignored late results cannot be returned. The two red assertions at 06:35:21
  passed after immediate build; 39 tests were green at 06:35:26. Existing page,
  merchant and concurrency bounds remain unchanged.
- Awin preflight resolver: optional `resolve(seed, { signal })` and optional third
  injected ProductFetch argument forward to existing safe fetch. The initial
  failing test exposed missing signal forwarding; its assertion was caught and
  wrapped by the old resolver, so it was not a pure cancellation-error red.
  Immediate build and three tests passed at 06:35:53 and 06:36:50.
- Unified search supplies the SearchRun signal to registries and Deals. Its new
  public test initially found missing signals; all 87 search tests passed. Five
  adapter/search files passed 114 tests at 06:36:27. Typecheck then caught two
  exact-optional-property violations; conditional option spreading fixed them,
  each source fix was rebuilt, and typecheck passed at 06:36:54.

The small `awaitWithSignal` helper only races a promise and cleans up its listener;
it does not invent a shared executor or change network policy. Callers check
precancellation before constructing a source promise.

## B3 contracts and handler integration

`NOT_CHECKED` was introduced before producers: comparison returned it instead of
`NOT_QUOTED` (23 tests, 06:38:14); both actual VM-rendered comparison UIs use explicit
quote-status allowlists and show localized unverified capability without ZIP
controls (16 comparison-UI tests at 06:38:45, 50 card-UI tests at 06:38:49). Schema,
nested card, comparison, deal-concierge type, single/batch quote and hydration
consumers preserve the same single state. Unresolved preflight is not unsupported.

Text and visual snapshots now retain their own SearchRun. Awin preflight uses the
existing VARIANT quota and an `awin-preflight:` key; budget skips preserve cards,
prices and order, report zero attempted resolution plus skipped count, and produce
NOT_CHECKED. Public MCP tests round-trip this through comparison, hydration and
both quote tools, with zero consent requests and zero Cart calls. All relevant
post-await and pre-map writes check cancellation. This guard was deliberately not
put in global `rememberSnapshot`, because independent quote/history consumers must
not inherit an old search deadline.

An intermediate callback-closing placement accidentally nested later tool
registrations inside the text handler. Product-reference/visual tests caught
missing tools immediately; the placement was corrected and rebuilt before work
continued. Four files / 110 tests passed at 06:42:02. Native visual second-round
and cancellation tests passed three files / 16 assertions at 06:43:43.

Web lease tests first showed an expired flow still receiving READY. A server test
fixture initially lacked a healthy empty Awin source and therefore reached
REPORT_INCOMPLETE instead of web authorization; this was a fixture error, not the
budget defect. After correcting the fixture, the two MCP reds at 06:47:42 proved
the unconditional 60-second lease and missing original-run diagnostics.
WebRecoverySessions gained a server-owned remaining-budget callback checked before
and after consent; immediate build and 40 tests passed at 06:47:55.

The five-handler integration now:

- Binds `extra.signal` only for that request, while cancellation terminates its
  original flow across later recovery/finalization calls.
- Pauses only the real web elicitation, with a fixed 25-second MCP maximum and no
  progress-reset extension. Quote consent remains independent at 20 seconds,
  followed by QR's fresh five-second private permit.
- Grants web leases for the smaller of 60 seconds or remaining service time;
  reports the actual bound and never grants a fresh 90/180 clock on recovery.
- Counts exact web page reads under the original catalog/IO budget, propagating
  both page-lease and parent signals. Text and visual recovery snapshots retain
  the same trace and clock. Expiry prevents new IO, preserves old references and
  reports incomplete retrieval rather than product absence.
- Allows bounded local final visual verdicts after time expires so previously
  verified candidates remain useful, without additional provider reads.

An intermediate method/property typo caused all web leases to expire; local tests
caught it, and correcting `remainingServiceMs()` restored the existing contracts.
Three files / 57 tests passed at 06:49:14. Additional public MCP assertions cover
cancelled page reads with an ignored late provider, 180-second visual web recovery
and finalization, and a separately consented quote 95 seconds after search. Initial
numeric-variant/source-kind fixture errors were corrected; ten MCP tests passed
at 06:50:09. No live Cart or actual desktop approval is claimed by these simulations.

## Entry boundary and acceptance limit

The coordinator explicitly froze this compatibility rule: every `search_products`
invocation starts a new 90-second service flow, including CONTINUE and CORRECT;
every `search_visual_candidates` starts a new 180-second flow. Derived native
rounds and both web-recovery routes retain the original run. A later explicit
continuation receiving a fresh 90 seconds is covered by a public MCP assertion.

This is not an assertion that a model may automatically reset its budget. The
Skill still forbids automatic new searches or NEW_PRODUCT to bypass a failure.
However, the service has no trusted user-turn boundary that distinguishes an
actual new user request from another initial tool invocation. Therefore repeated
initial tool calls can open new flows; whole-host/user-turn reset prevention
remains blocked on real trusted host integration. Pre-first-tool work, unknown
user waits, external Chrome cancellation, restart memory and archive/delete
acceptance are not proved here. No speculative host identity was added.

## Final budget-slice verification

- 06:51:07: `pnpm lint` exited zero, and the following 17-file targeted run passed
  334/334 tests: search-run, search-run-flow-budget, search-flow-server,
  search-products, both registries, Deals, Awin resolver, web-product-recovery,
  visual-web-recovery, visual-round-recovery, product-reference, product-comparison,
  both product UIs, quote-authorization-server, and findcheap-chrome-v0 contract.
- 06:51:51: callback indentation was mechanically corrected; immediate build and
  five files / 80 tests passed.
- 06:52:27: final trace audit added a red assertion for `returned`, which preflight
  trace recomputation had omitted. The fix preserves the earlier safe outcome and
  restores the returned count while refreshing timing. Immediate build plus
  search-flow-server/search-diagnostics passed 16/16 at 06:52:40.
- 06:52:45: `pnpm typecheck` passed. Earlier typecheck failures (two nullable
  closure references and three fixture literal types) were corrected and rebuilt;
  these were not suppressed or asserted away.
- Compare Skill adds NOT_CHECKED to the existing no-ZIP rule by an equivalent
  replacement. The current file is 6,396 bytes / 33 split lines; original 6,400-byte
  and 36-line limits remain intact. The corresponding old exact-string assertion
  was updated without weakening either limit. Skill-creator `quick_validate.py`
  passed. `git diff --check` passed with only Windows line-ending warnings.

Runtime/build lock released to root at 06:52. Root owns independent full validation
and the six known development-image replay. This slice has not performed a release,
deployment, installed-cache replacement, real merchant write or user-data mutation.
