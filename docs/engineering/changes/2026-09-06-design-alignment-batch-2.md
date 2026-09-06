# Design alignment, batch 2

Publication follow-up: Chris subsequently authorized the separate [v0.17.24 release](../../releases/v0.17.24.md). Unpublished/local-only statements below describe their original checkpoints, not that later release; development-sample evidence remains tied to its recorded artifacts.

## Read this record in revision order

The Research snapshots and earlier frozen plans below are retained as audit history,
not concurrent instructions. **Frozen Plan v5 / QR1–QR4 supersedes the earlier
Q1–Q4 blanket quote shutdown.** The implemented quote path is conditionally authorized,
not universally disabled. Later named refinements govern their specific interfaces:
V7 for brand/colorway eligibility, V8 for terminal visual consistency, W1–W3 for
local Watch consistency and pending stops, and B1–B3 for service-observed budgets
and NOT_CHECKED quote capability. The latest integration and actual six-image
evidence is in the [final verification record](2026-09-06-batch2-final-verification.md);
slice records and handoff entries retain historical checkpoints. A freeze alone
is not evidence that its work has completed.

## Authority and baseline

Chris requested release of the previous batch first, then continued implementation of
the remaining total-design gaps. The approved business rules remain unchanged:
`docs/architecture/agent-design.md` sections 4, 6–10 and 13. This record follows the
five-stage development protocol; unverified host capabilities are not implementation facts.

Previous batch release is complete: runtime **0.17.23**, package
**0.17.23+codex.20260906085854**, source
`0a0b45cf8ac5250cbdf62b96c27d5a1a3b1bf9e2`, pushed to origin/main.
GitHub plugin-ci 34023575519 and windows-installer-ci 34023575547 succeeded.
Railway production deployment `efbece61-aa13-4a38-9f5a-3bfb153a8b37` succeeded;
health, readiness and read-only search passed, deployed artifact hash matched.
New installed cache is enabled, 13/13 distributed files match, installed stdio 4/4
passed. Installer reported a locked old cache; no forced overwrite occurred. A new
Codex process is required to load the new package. No GitHub Release/tag was created.
See [release record](../../releases/v0.17.23.md) for build and test evidence.

Second-batch baseline: clean release commit above; 96 default test files / 1,412
assertions passed, plus 4 installed stdio assertions. Default tests exclude database
integration tests. No production database, registry or schema migration is authorized.
New changes below remain local; the first release does not silently publish this batch.

## Research: facts, topology and constraints

FACT — retained entry chain: stdio → createShoppingServer → tool registrar/executor →
existing Backend ports → source adapters / network safety. No new provider, production
multi-agent orchestrator, local product catalog, raw-image upload or trust expansion.
Node 24, pnpm 10.34.5, TypeScript, Zod 3 and existing MCP SDK are retained; no new package.
Builds: `pnpm build:mcp`; Awin build only if its consumers change. Typecheck is not a build.

| Contract | Observed implementation / affected consumers |
| --- | --- |
| Visual review | server initial/finalize handlers, visual-review-policy, search-products, candidate-ranking, ranking-assessment; HIGHLY_SIMILAR already works, SAME_STYLE is gated and SIMILAR always blocks primary |
| Visual OOS | official adapter retains stock evidence; queryShopify does not request includeOutOfStock; recovered web products drop OOS; possible same-item can stop round two without considering stock |
| Recommendation | product-recommendation, product-card-ui, product-comparison and server snapshot/variant consumers; same-product offer identity must remain independent of similar recommendation eligibility |
| Budget | SearchRun defaults to 30 seconds of concurrent network-active time using Date.now; no parent abort; model gaps omitted; registrar gives SDK extra to handlers, not executor context |
| Memory | server Maps are process-local; stdio persists Watch only; SDK transport sessionId / requestId are not documented trusted Codex task IDs |
| Watch | service detects stock transition but remains ACTIVE; JSON save is unconditional and non-atomic; server binds model-submitted automation IDs without trusted read-back |
| Quote | ShopifyCartQuotePort.quote reaches cartCreate / delivery selection; consumers are single quote, batch quote, delivered-total Watch preflight and Watch evaluation; no reviewed no-reservation policy or trusted recurring consent |

Source evidence: `apps/mcp-server/src/server.ts` search/visual/quote/watch registrations;
`search-products.ts` queryShopify/finalizeCodexVisualCandidates; `visual-review-policy.ts`
assessVisualVerdict; `ranking-assessment.ts` assessRanking; `product-comparison.ts`
buildProductComparison; `search-run.ts`; `execution/tool-registry.ts`;
`shopify-cart-quote.ts`; `watch-service.ts`; `watch-store.ts`.
Public test seam: MCP Client + InMemoryTransport via conversation-replay-support,
real server policy and deterministic source substitutes. Synthetic source results are
not real merchant or host acceptance.

FACT — official Hooks expose host session/turn IDs, but SessionEnd conflates close,
idle, archive and delete (`reason: other`). App Server documents thread lifecycle and
turn events, but this does not prove a trusted connection to the current Windows
desktop. Installed CLI 0.153.4 reports its daemon lifecycle as Unix-only.
References: [Hooks](https://learn.chatgpt.com/docs/hooks),
[App Server](https://learn.chatgpt.com/docs/app-server).

UNKNOWN gates: trusted per-MCP-call task binding; current desktop lifecycle feed and
offline reconciliation; complete model/visual/user-wait timing; automation stop API
accessible to the plugin with trusted read-back; audited fixed-version merchant quote
side effects. Model fields, local unrestricted signing keys, fixtures, environment
variables or connection IDs do not resolve these gates. No speculative persistence
is enabled without trustworthy task isolation. Building a new Codex host/client is
a product-form expansion requiring separate approval.

Real samples: six user PDF images exist privately in artifacts/pdf-six-trial. They and
their style families are DEVELOPMENT, not held-out. Historical 5/6 retrieval is not
current-version evidence. Both total-design and visual-acceptance-v2 independent
cohort requirements remain unchanged; no missing human review may be fabricated.

## Propose

| Dimension | A: policy inside existing services | B: separate policy adapters / result channels |
| --- | --- | --- |
| Visual | service-owned scope and outcome alongside existing snapshot | separate same-item and similar pools/output channels |
| Benefit | small contract additions; existing tools and references retained | explicit pool ownership; easier future independent routing |
| Risk | scope can be lost by comparison/variant consumers; test all | more schema/UI migration and pool duplication |
| Cost / rollback | low–medium; revert scoped policy without weakening ordinary text | medium–high; retain legacy output adapter on rollback |
| Budget | one monotonic SearchRun lifetime, preserve network/read limits | execution-context adapter also consumes trusted host time events |
| Feasibility | service-visible interval enforceable now, not whole-turn guarantee | complete timing only after trusted host connection proven |
| Quote | close unqualified final transport; supported quotes disabled | policy-wrapped quote port with qualifications and internal permits |
| Watch | terminal local state + optimistic store consistency | lifecycle coordinator + outbox and trusted scheduler reconciliation |
| Host dependencies | clearly reports unverified scheduling/identity | can deliver complete lifecycle once real bridge exists, not before |

Selected: A for visual and service-visible budgeting; retain source/read quotas.
Close unqualified quote writes first; do not build a pretend permission issuer while
no production merchant meets the eligibility requirement. Watch uses minimal terminal
state and store concurrency protection; full host coordination remains a separate gate.
B remains the viable longer-term integration path, not a rewrite of Backend.

## Frozen Plan v1 — visual slice

Frozen before new tests or runtime edits. User authorized autonomous implementation
within the approved total design. Runtime/bundle writes are serialized; independent
read-only research may proceed. Each step must show a correct red regression, minimal
source change, immediate `pnpm build:mcp`, then its targeted assertions before dependent
work. Failures stay in the current step; new scope requires an appended plan revision.

| ID / dependency | Module and minimum contract | Public assertions / verification |
| --- | --- | --- |
| V1 / baseline | search-products Shopify query and web recovery: retain OOS only in visual discovery; original IDs, variants, prices unchanged | source tests verify actual includeOutOfStock argument and adapter filter; ordinary text unchanged; OOS never primary |
| V2 / V1 | server visual finalization and small shared outcome policy: OOS possible-item does not prematurely stop bounded round two; preserve OOS anchor within card cap; completion does not mean exhaustive web | MCP visual-round tests: OOS + unreviewed candidate gets second round, never third; timeout/failed authorization remains incomplete |
| V3 / V2 | reviewed-visual scope in ranking/presentation: automatic SAME_STYLE eligibility only with valid structural review, trusted merchant, all hard requirements, IN_STOCK and valid price | default visual similar allowed; plain text SIMILAR remains blocked; user-required color/brand remains hard; unknown/OOS/untrusted/missing price cannot become similar buying primary |
| V4 / V3 | card/comparison/variant snapshot consumers preserve server-owned scope and labels; no upgrade to EXACT or same-product price comparison | MCP select→compare; changed variant recomputes restrictions; same-item price basis and immutable refs unchanged; localized incomplete/similar/OOS text; no automatic Watch |
| V5 / V4 | relevant tool/skill instructions align with actual outcomes; then integrate offline visual tests | build:mcp after runtime instructions, affected MCP/contract/UI tests; both visual rounds/foreign IDs/replayed verdicts still enforced |

Budget, quote and Watch atomic interfaces are still being narrowed by read-only
Research. Their implementation is NOT authorized by this v1 freeze until their
dependency-specific plan revision below is recorded. Cross-restart/archival code
remains blocked by trusted host binding; do not substitute an unused storage kernel.

## Implement / Test evidence

Not started for this batch at v1 freeze. Required final integration: typecheck, lint,
build:mcp, complete default tests, stdio smoke, diff check, total-design status update.
No DB integration or destructive user-task lifecycle tests without suitable authority.
Real-image development replay and actual host acceptance are separately labeled;
missing evidence cannot be included in PASS counts.

## Frozen Plan v2 — quote shutdown and Watch consistency

Additional Research confirmed `stdio.ts` is the only production quote-factory caller.
`preflightQuoteCapabilities` advertises support from port presence and performs Awin
page probing. Existing successful quote tests cover useful arithmetic and stable-ID
rules, but do not prove user consent or no-reservation eligibility. Both proposed
quote approaches require external evidence before re-enabling writes. Since no
eligible production merchant is established, choose the smallest safe shutdown,
not an unused permit issuer or a model-set approval flag.

| ID / dependency | Module and minimum contract | Red regression / immediate verification |
| --- | --- | --- |
| Q1 / V5, runtime lock | shopify-cart-quote: production factory always rejects QUOTE_POLICY_UNVERIFIED, even tokenless configuration; existing estimation algorithm retained only behind an explicitly supplied request seam with no implicit network implementation | factory with tokenless has zero HTTP/DNS; preserve offline USD/tax/variant/expiry/error assertions and direct pinned-request DNS/redirect/body assertions; build:mcp + quote tests |
| Q2 / Q1 | server: keep quote tool names/reference schema for compatibility, reject before all single/batch external writes; advertise MERCHANT_CHECKOUT_ONLY; no quote-purpose Awin probing; delivered-total Watch creation rejects without preflight or saving | MCP single/batch valid ref→unsupported+zero quote; foreign/stale/mixed refs remain rejected; cards preserve identity/item price, comparison stays item-price; delivered Watch zero quote/record; build:mcp + affected server/reference/comparison tests |
| Q3 / Q2 | watch-service: existing DELIVERED_TOTAL records fail policy before any quote; do not create false stock evidence | existing persisted Watch + injected quote spy→zero calls and explicit policy reason; build:mcp + watch service tests |
| W1 / Q3 | watch-store: optimistic revisions, serialized atomic JSON replacement and delete protection; legacy records load with initial revision; save cannot insert missing IDs, overwrite a changed revision or restore terminal records | memory and two JSON instances: concurrent save one winner, pause beats stale check, deleted record cannot be resaved, duplicate create, corrupt record fails closed; build:mcp + store tests |
| W2 / W1 | watch-service: RESTOCKED first verified transition persists irreversible local completion and stable event ID; repeat wake does no source work; expire/stop intent remains explicit, no claimed host ACK | OUT→IN one trigger then zero source work; stable event ID across store reload; stale/pause/delete conflict emits no trigger; other watch conditions not made one-shot; build:mcp + service tests |
| W3 / W2 | server Watch output/schema/instructions: surface local completion and scheduler stop-required separately; no model-submitted ID proves stop; terminal Watch cannot resume; deletion keeps minimal unresolved-stop identifier if necessary | MCP check/list/pause/bind cases do not revive terminal; unavailable/forged ACK never claims stopped; repeat handoff idempotent; build:mcp + Watch server/contract tests |

W1 format changes require legacy read tests and explicit rollback notes. No real user
Watch data migration or destructive lifecycle tests run in this task. Lock acquisition
must be bounded and cannot steal an unknown live owner; failure returns safely.
Do not claim exactly-once notification delivery from event deduplication. A missing
host stop bridge remains STOP_REQUIRED/UNVERIFIED, not STOPPED. Real task ownership
and archive/delete synchronization remain blocked independently of store consistency.

Old success tests changed by Q2 must retain independent price/ID assertions in pure
comparison/estimation seams, and add real MCP zero-write assertions. Do not delete
security tests or replace DNS checks with early policy denial. There is no production
override/test mode/environment approval switch. Re-enabling quotes requires a new
reviewed qualification + real user-authorization design and separate verification.

W1 interface refinement, frozen before implementation: `WatchStore.save(record)`
returns the saved `WatchRecord` with incremented revision (old ignored-return callers
remain valid). Missing legacy revision compares as 0. Reads return copies. Conflict
throws a distinct WatchStateConflictError; no upsert on save. A bounded directory
lock covers local create/save/delete only, not source/network work; atomic rename
publishes writes. Unknown stale lock ownership is never bypassed by time-based stealing.
Delete persists only a minimal tombstone/stop identifier before removing shopping
data; save cannot revive it. New COMPLETED and stopIntent fields first enter storage
and compatible server output enums without being produced (W1 compatibility step,
own immediate build/tests); W2 activates them. Evaluate must use save's returned
record and suppress triggering on conflicts. W3 finishes handoff consumers and
forbids resuming COMPLETED/EXPIRED. Full host ownership/lifecycle remains unverified.

W1 dependency split: W1.1 changes the memory store and save return contract, together
with the two watch-service save consumers accepting the returned revision (no new
terminal behavior yet); build:mcp + memory/service tests. W1.2 applies the same
contract to JSON atomic updates, short lock and tombstones; build:mcp + JSON/service
tests. Output enums get compatibility additions before W2 activates COMPLETED.
This consumer adaptation is necessary: returning an old revision after a successful
save would make the next legitimate check appear stale. No source edits preceded this
refinement.

## Frozen Plan v3 — service-observed budget

Research correction: visual snapshot TTL is currently ten minutes and round two
renews reference TTL. TTL is not a work budget. Text snapshots currently lack the
SearchRun reference, so web recovery can start fresh accounting. Awin quote-preflight
network work disappears under Q2; no unused resolver interface is added for it.

Compared direct SearchRun extension with a separate injectable budget object.
Both can enforce the service interval; neither supplies unknown host timing. Choose
direct extension to avoid duplicate lifetime ownership and preserve existing ports.
Network-active 30-second budget, request counts, 10-second reads and source-specific
limits stay in force. New budget starts at the first service search, not user message.

| ID / dependency | Module / atomic interface | Assertions and build |
| --- | --- | --- |
| B1 / Q3 + runtime lock | SearchRun adds monotonicNow/serviceBudgetMs, signal, remainingServiceMs, throwIfCancelled, withRequestSignal and withVerifiedUserWait; no public model time/pause/ID fields | 90/180 boundary; concurrent IO union; original 30s IO contract; ordinary gaps count; verified wait finally resumes; no pause while IO active/after expiry; parent abort/late provider/cache checks; Date wall-clock jump; each piece build:mcp + search-run tests |
| B2a / B1 | Registry refresh accepts optional signal for each caller's waiting only; shared refresh retains independent existing 5s deadline | A cancellation does not cancel B or poison cache; cancelled caller gets no result; build:mcp + each registry adapter tests separately |
| B2b / B1 | Deals port helper gains optional signal outside business input; combines source timeout/parent cancellation through fetch/body | preabort zero fetch, body stall bounded, existing verified deal contracts; build:mcp + deals tests |
| B2c / B1 | readWebCandidates optional signal; cap by remaining flow / lease / existing 25s slice, zero duration means zero dispatch | retain page/concurrency cap, abort and late response; build:mcp + web recovery tests |
| B2d / B2a,b,c | search-products forwards SearchRun read signal into registry/deals; existing other provider signal support remains | consumer cancellation + source tests; build:mcp |
| B3 / B2d,W3 | five MCP handlers (text/visual initial, finalize, begin/complete web) share original flow via snapshots; bind actual SDK extra.signal; verified elicitation only pauses, keep 25s wait limit; check cancellation after awaits and before state writes | actual MCP cancel reaches provider; late result creates no snapshot; second visual/web do not reset clock; expired flow local finalization retains evidence but no IO; lease min(60s,remaining); unrelated flow/history unaffected; build:mcp + MCP visual/web/selection tests |

B1 can split implementation modules further with a recorded red/build/green per
increment. Cancellation permanently terminates that service flow. Timeout may still
accept bounded local visual verdicts and return useful already-reviewed evidence,
but never more IO or a false absence claim. New diagnostics distinguish existing
activeDurationMs (IO) from serviceBudget {scope: SERVICE_OBSERVED_FLOW, limitMs,
elapsedMs, verifiedUserWaitMs, activeMs, remainingMs, cancelled}.

Shared registry refresh may continue independently for up to its existing five-second
cap after one caller aborts; do not claim immediate cancellation of shared work.
New independent searches retain their current behavior. Without a trusted host turn,
the backend cannot prove a model never starts a fresh flow to reset the timer, measure
pre-first-tool time, reliably subtract all user waits, or interrupt external Chrome
and model execution. Complete 90/180 whole-turn acceptance therefore remains open.

## Frozen Plan v4 — real development replay and final gates

E1 depends on V5/Q3/W3/B3 and a stable built artifact. Replay all six private PDF
DEVELOPMENT references, WITH_BRAND only, once per case plus the native maximum two
review rounds. Original first-call arguments from realtime-only-verified-01..06 are
fixed before replay (no target names, target URLs or direct URL recovery). Reuse the
existing read-only harness with isolated state, actual bundle hash and fresh run IDs.
Inspect actual reference and returned candidate images; do not generate verdicts
from expected labels or old titles. Score existing target labels only afterward.
Keep initial/final tool calls, images/hashes, failures and denominator 6. No synthesized
host authorization or manually injected web results; missing capability remains missing.

This is a known-example WITH_BRAND development regression, not blinded population
acceptance. Prior observations and target families are already known; no human
blindness attestation is invented. Six reference images were inspected locally while
preparing this plan; no raw image upload or local catalog occurs. A missing final
capture is incomplete, not a successful empty result. Failed/timed-out cases stay
in the denominator. Held-out and 40-image requirements remain unfulfilled.

E2 final mandatory local gates: typecheck, lint, build:mcp, full default tests,
stdio smoke and diff check. Update total-design implementation status and this
record with exact evidence; failures remain visible. DB integration and real
user-task destructive lifecycle tests are not run. No new release is implied.

Execution scheduling refinement: Q1's standalone factory red regressions and B1's
standalone SearchRun red regressions may be prepared and run in parallel with V3–V5,
because neither implementation module nor their exclusive test files is touched by
the visual slice. Do not run whole-suite checks while another step is intentionally
red. Runtime/source and bundle writes remain serialized; Q/B source changes wait
for the explicit lock handoff. This exception changes no behavior or acceptance.

E1 scoring clarification, before capture: report target-style/page retrieval and
exact photographed colorway separately. A matching product slug or family name is
not proof of the same color/variant. Actual image differences cannot be overruled
by the PDF URL label, and ambiguous image/link correspondence remains uncertain.
Existing label field names (not target values) were inspected to confirm color and
correspondence metadata exist. No target names/URLs are added to frozen search input.

## Research correction — quote plan v2 on hold before source changes

Primary counterevidence found during root review changes the feasibility assessment.
[Shopify Checkout](https://help.shopify.com/en/manual/checkout-settings) states that
inventory is held at payment submission. The two API pages requested at 2026-07
redirect to latest but explicitly display **2026-07 latest** at this capture; the
redirect alone does not mean the version is unverified. CartBuyerIdentityInput still
lists deliveryAddressPreferences as deprecated, not removed. Do not invent a break.
[Functions network restrictions](https://shopify.dev/docs/apps/build/functions/network-access)
require @defer for Storefront-triggered external requests; the existing fixed
mutations contain no @defer. CartTransform can change line composition/prices, so
response-line identity is a real validation concern, not evidence of inventory hold.

The total design requires review of the corresponding interface; a mandatory
per-merchant no-reservation review table was an earlier conservative proposal, not
a user-approved requirement. No claim that ordinary Shopify carts reserve inventory
is made. The unconditionally-disabled Q1–Q4 source plan is **superseded / paused**;
only its initial unauthorized-write red test has run, with zero real network.

Revised Propose: A temporarily disables all quote behavior (safe but loses utility);
B retains the reviewed fixed API behind real SDK elicitation and a private,
short-lived, single-use permit bound to exact snapshot/products/ZIP (more contract
tests, but implements the approved anonymous-quote exception). Select B within
the existing product design. Unknown/unsupported authorization still means zero
writes. Recurring DELIVERED_TOTAL Watch remains unsupported until separate ongoing
consent exists. The revised atomic QR plan will be frozen before source changes.
Consequently B's cancellation Research must not assume Awin quote-preflight has
been removed; if retained, propagate its signal and cap its read too.

## Frozen Plan v5 — reviewed API plus real authorization (replaces Q1–Q4)

The QR contract below supersedes blanket shutdown, before quote source changes.
Existing Q1 red (no authorization must mean zero DNS/HTTP) remains valid unchanged.
No live Cart mutation is authorized for development testing; positive protocol
fixtures are explicitly simulated host approvals, not actual desktop acceptance.

| ID / dependency | Atomic module contract | Red / build / green verification |
| --- | --- | --- |
| QR1 / V5 runtime lock | internal quote-authorization module owns non-serializable WeakMap permits, exact merchant/host/variant/ZIP set (1 or 2–4), caller signal, short monotonic deadline, one consumption per item; quote port optional third permit parameter, missing/forged/expired scope fails before DNS; fixed-interface qualification in factory | old two-arg tokenless call zero writes; foreign product/ZIP, reused/serialized permit, cancellation, expiry fail; controlled test issuer proves only mechanism; build:mcp after each contract/module increment + permit/quote tests |
| QR2 / QR1 | fixed 2026-07, only cartCreate and delivery selection; no @defer, login, payment, order, selling plan or quantity other than one; validate response API version and both Cart lines (one plain line, original variant, quantity one, no next page/bundle/replacement) | added/replaced/bundle/quantity/version/missing-version failures; first invalid response prevents second mutation; abort/expiry checked again before second; preserve existing USD/tax/TTL/private DNS assertions; build:mcp + quote transport tests |
| QR3 / QR2 | shared server MCP consent helper: actual form capability, elicitInput tied to related request/signal, product+merchant+ZIP+operation bound shown; only accepted form approval issues permit; 20s bounded wait, after-wait reference/TTL/selection/cancel revalidation; batch one consent, at most four item transactions | real MCP transport test with ElicitRequestSchema fixture; no capability/decline/cancel/timeout/malformed/expired/foreign→zero quote calls; positive fixture retains original ID/price math tests; no public token or approved tool field; build:mcp + consent/server/reference/comparison tests |
| QR4a / QR3 | server delivered-total Watch creation refuses before quote/save; ongoing Watch service refuses even with injected port, as no recurring permission contract exists | zero cart/record for create; persisted legacy total Watch zero cart, explicit unsupported; each changed module build:mcp + Watch tests |
| QR4b / QR4a | distributed skills and README say explicit interactive request + actual authorization; no ZIP-triggered quote or retry after refusal; keep qualified tokenless runtime configuration; do not promise delivered-total Watch | build:mcp + distributed contract assertions, preserve all visual instructions |

Qualification review is interface-level, based on the cited 2026-07 documentation
and the actual fixed request builder, not a claim that every merchant was manually
audited for this API. Pin the approved version and a review expiry no later than
2027-07-01; source changes outside the reviewed request shape require re-review.
The source store/URL/variant evidence and existing network safety checks still
apply. Local cart transforms may affect prices, but changed merchandise cannot be
quoted under the original selection identity. Retain the deprecated address field
for this bounded change because the current documented API still supports it.

W1–W3 now depend on QR4, replacing Q3. B1/B2 can follow QR4/W3 under the same runtime
lock. B2 adds the retained AwinShopifyQuoteResolver signal (optional options argument)
and pins its safe fetch to the caller's remaining read budget; B3 preflight runs under
the original SearchRun rather than outside its cancellation/deadline contract.
Real desktop permission UI and real merchant Cart results remain separate acceptance
gates, not grounds to simulate user consent during this development task.

## Frozen interface refinements — before QR/W/B source changes

- W1.2 exposes `WatchStore.listPendingStops(): Promise<WatchStopIntent[]>` for
  W3's actual consumer. Only watch/automation identifiers, stop reason, request time
  and `STOP_REQUIRED` survive deletion. Tombstones take precedence over a leftover
  rule file if unlink fails; retries may finish cleanup, and stale save cannot
  resurrect shopping data. The Automation identifier remains an unverified handoff
  reference, not host ownership or a scheduler acknowledgement. Exact contract and
  failure-order assertions are in [Watch/quote evidence](2026-09-06-batch2-watch-quote-evidence.md).
- B2 retained Awin preflight uses optional caller signals on `resolve` and its
  product fetch, reusing existing safe-fetch cancellation. Its namespaced read
  consumes the existing `VARIANT` quota. Exhaustion skips this enhancement while
  preserving cards; a skipped check is not proof that the merchant cannot quote.
  B3 checks cancellation again after preflight and before snapshot writes.
- Visual finalization receives immutable required/excluded features. Admissible
  visual evidence cannot override an explicit user constraint even when source
  metadata claims a match. Image-inferred preferences remain distinct from those
  hard requirements. The red/build/green sequence and scope refinements are in
  [visual evidence](2026-09-06-batch2-visual-evidence.md).

### V6 corrective review and B3 unknown quote capability

Independent read-only probes after the V1-V5 sweep found two violations of the
already-approved gates: admitted matching evidence could bypass an explicit
excluded color, and a scoped HIGHLY_SIMILAR discovery card with unknown stock
could bypass the IN_STOCK-only alternative-primary condition. V6 is two atomic
domain fixes, each red/build/green: inspect all admissible match/conflict candidate
evidence for hard requirements; apply the existing SIMILAR gate to all scoped
alternatives, regardless of source matchStatus. No broader visual threshold or
trust changes. QR yields only after its current atomic step is green; V6 then
returns the source/build lock before QR/W continue.

For B3, compare adding one `quoteCapability=NOT_CHECKED` value with retaining the
old enum plus a second `quoteResolution` object. Choose the enum: one authoritative
state, no unsupported/unchecked contradiction. It requires output schemas,
comparison-derived status, both UIs and explicit single/batch quote allowlists to
change together in a bounded compatibility step. Budget-skipped preflight keeps
the same product, price and identity, produces no resolved quote target, and shows
capability unverified rather than unsupported. Unknown status permits neither ZIP
prompts nor authorization/Cart calls. Hydration preserves the original status;
diagnostics distinguish skipped/failed checks from a proven unsupported source.
The detailed consumer map is recorded by the budget owner before implementation.

W1 review refinement before implementation: the existing server's Automation
uniqueness check is list-then-save, so per-record revision CAS alone cannot prevent
two different Watch records concurrently binding the same Automation. Both stores
must enforce the existing cross-record uniqueness constraint in the same critical
section as save. Unresolved stop intents/tombstones reserve their Automation ID:
a later Watch cannot reuse it while an old stop handoff may still target it.
Test two JSON instances binding one ID and reuse after deletion. This strengthens
existing binding consistency without treating a model-supplied ID as trusted host
identity or adding an acknowledgement interface.

## V7 — enforce the approved similarity directions

Read-only public-function probes confirmed that both other-brand/other-color and
unknown-brand/other-color candidates could become READY. Total design 4.1 limits
the image exception to 4.2; its approved directions are same-color/structure across
brands or same-brand colorways. A structural match alone does not authorize both
brand and color to drift. This is an omitted joint gate, not a new product policy.

Propose A applies one finalizer eligibility rule, reused by review diagnostics;
B keeps such cards but adds a ranking-only research limitation propagated through
cards, comparisons and inspection. Choose A: less state and no display outside the
approved directions. Preserve existing source/category/hard-requirement gates.

Frozen V7 sequence, after QR4 yields at a green atomic boundary:

1. Domain gate: admitted COLOR/PATTERN differences require positive same-brand
   source evidence. Reference brand comes from the immutable request, falling back
   to its visual brand; candidate brand comes from explicit source brand fields,
   never merchant names or title guesses. Conflicting or absent brand evidence is
   unknown. Compare full brands with existing case/diacritic normalization, not
   token-subset matching. Awin lacks an independent brand field and stays unknown;
   do not expand its Feed or create a merchant/catalog database for this change.
   Red public finalizer assertions, immediate build:mcp, then targeted green.
2. MCP consumer: pass the bound reference context and reuse the exact candidate
   gate for accepted/conflict diagnostics, including recovered-web sessions.
   Red MCP assertions, immediate build:mcp and visual/recovery/comparison tests.
3. Runtime instructions: align the existing colorway guidance with that gate;
   preserve invocation policy and unrelated text. Build:mcp, skill validation and
   public contract tests, then release the source/build lock back to Watch.

Test other/unknown reference or candidate brands with color differences, confirmed
normalized same-brand colorways, same-color cross-brand alternatives, misleading
titles/merchant names, unchanged hard black requirements and inadmissible/occluded
differences. Stable source EXACT without an admitted conflict remains unchanged.

## QR handoff verification — 2026-09-06 06:04 -04:00

QR1–QR4 finished their local gates before V7 received the exclusive runtime/build
lock: immediate MCP build at 06:03:21, eight targeted files / 190 assertions at
06:03:57, root typecheck, scoped ESLint, both distributed Skill validators and
diff checks passed. Compare Skill is 6,355 bytes, below its existing 6,400-byte
contract; the cap was not relaxed. The separate Watch/quote evidence preserves
the red/build/green sequence and fixture adaptations.

Root independently reran the public MCP authorization file at 06:04:57:
`pnpm exec vitest run --silent=true apps/mcp-server/test/quote-authorization-server.test.ts`
passed 25/25 assertions. This uses explicit simulated MCP forms, not actual desktop
permission or live merchant Cart evidence. W1–W3 and the budget implementation
remain pending; no second-batch release is implied.

### W interface details frozen before source changes

W1.1 adapts the existing JSON adapter's returned validated record in the same
atomic `save(): Promise<WatchRecord>` interface step, so the immediate build
remains meaningful. JSON CAS, locking and atomic replacement still belong to
W1.2; the intermediate adapter is not claimed to provide those guarantees.

W3 must not erase an unresolved `STOP_REQUIRED` on resume: a pending scheduler
stop could otherwise race and stop a resumed rule. Return `AUTOMATION_SYNC_REQUIRED`
without state change while such an intent exists. Ordinary unbound PAUSED rules
without an intent may resume; COMPLETED/EXPIRED rules cannot. No trusted host ACK
or scheduler synchronization is invented to bypass this boundary.

## V7 handoff and QR4c clarification — before Watch source changes

V7 completed its domain, MCP and distributed-instruction red/build/green steps.
Final sweep at 06:10:23 -04:00 passed 32 files / 612 assertions; typecheck, scoped
ESLint, Skill validation and diff checks passed. Compare Skill is 6,382 bytes /
33 lines, within unchanged limits. Runtime/build lock transfers to the Watch owner;
the detailed evidence is in the visual slice record. No live-image result is claimed.

Read-only QR4 follow-through found two stale Watch consumers: priceBasis schema
description still advertises DELIVERED_TOTAL, and missing-price-basis clarification
still offers it. Before W1, QR4c adds a public failing assertion, describes that value
as legacy/unavailable, and asks only to confirm ITEM_PRICE rather than defaulting
consent or offering an unusable choice. Immediate build and targeted assertions
precede W1. Existing explicit DELIVERED_TOTAL requests remain rejected with zero Cart
calls or Watch writes; this is clarification alignment, not an expanded policy.

W3 store-consumer review refinement, before its guard change: W2 promises a stable
completion event ID, but `nextRevision` protects existing bindings/stop intents
without protecting that ID. A same-status save at the correct revision could
replace or remove it. Add a failing public store assertion and one immutable-ID
guard in the W3 store step, followed immediately by build and targeted tests.
No new event type, acknowledgement or unrelated record-field policy is added.

## Watch handoff verification — 2026-09-06 06:27 -04:00

QR/W completed 13 targeted files / 238 assertions at 06:26:12; MCP build,
typecheck, scoped lint, both Skill validators and diff checks passed. The final
test-only import correction was followed by JSON adapter 9/9 at 06:26:56.
The slice evidence records every atomic red/build/green step and the compatibility
changes. Watch Skill is 3,699/3,700 bytes; compare remains 6,382/6,400.

Before handing runtime/build ownership to B, root independently ran all six Watch
files at 06:27:45: `pnpm exec vitest run --silent=true apps/mcp-server/test/watch-`.
All 72 assertions passed, including two-instance JSON races and the bounded existing-
lock refusal. Only repetitive FindCheap trace lines were filtered from the console;
the original command exit code was preserved. No user Watch state was accessed.

This verifies local consistency and policy guards. Actual host identity/binding,
scheduler stop, notification delivery, desktop permission and merchant Cart behavior
remain separate unverified gates. Budget's original intentional red assertions are
still pending, so no full-suite PASS or second-batch release is claimed here.

### B1 late-provider review refinement — before B2 implementation

After B1's first green gate, root observed that the read timer alone cannot reject
a provider resolved in a microtask after an event-loop stall: the fulfilled race
may run before the overdue timer, and the success path checked cancellation only.
This violates the frozen requirement to ignore late providers. Add public red cases
where the injected monotonic clock crosses the read/service deadline inside the
provider before its promise resolves. Retain the per-read deadline and recheck it
on success; distinguish read timeout from service/active budget exhaustion, without
double-counting timeout or changing cancellation semantics. Immediate build and
targeted green precede B2. This adds no new budget or permission interface.

### B3 initial-call boundary — frozen before handler implementation

Compare A, reuse an old clock for every CONTINUE/CORRECT call, with B, retain one
new flow per initial search invocation while binding its derived continuation
tools to that flow. A would reject genuine later user requests merely because the
previous request expired; there is no verified user-turn boundary to distinguish
those requests from model retries. Select B without granting model fields authority:
each `search_products` invocation starts 90 seconds, including CONTINUE/CORRECT;
each `search_visual_candidates` invocation starts 180 seconds. Derived native visual
rounds and either web-recovery path retain their originating snapshot's exact run.
Test both new independent calls and old-flow continuation; no model-submitted
approval, changed-constraint flag or contextMode is treated as user-turn evidence.

Consequently repeated initial calls can still start new service flows. Preventing
model resets across them requires the unverified trusted-host boundary. This is
another explicit reason the batch cannot claim a whole-user-turn 90/180-second
guarantee, even after service-observed continuation tests pass. Existing skill
instructions prohibit model budget-reset retries, but instructions are not an
execution-layer substitute for that missing host integration.

B1 independent checkpoint: after the late-provider correction, root reran
SearchRun, flow-budget and visual-budget-diagnostics at 06:32:46 -04:00.
Three files / 23 assertions passed; trace-only console filtering retained the
Vitest exit code. The two newly added clock-jump cases had first failed against
the old success path, then passed after immediate build. This verifies the core
clock module, not completion of its B3 handler consumers or whole-host timing.

### Final consumer gate correction — frozen before edits

Root's first full-suite run at 06:53:49 found 4 failures / 1,587 assertions.
Two legacy deal-port consumers observe an extra undefined options argument.
Choose preserving the original one-argument call when options are absent over
loosening those assertions; real signal-bearing calls retain both arguments.
The stdio schema assertion must include the deliberately added optional
`responseLocale`, while preserving exact allowed keys and required fields.
Restore the Skill runtime-version marker removed during compression, rather
than weakening the version-consistency gate; keep the 6,400-byte / 36-line cap.
Each source edit receives an immediate build and focused rerun. Full gates and
the six-image capture remain blocked until these failures are green.

Final read-only adversarial review reproduced delayed-dispatch gaps in SearchRun
and web-page workers: a prior synchronous operation can advance the monotonic
clock before overdue timers run, so subsequent operations still dispatch although
their results are later rejected. Choose a final dispatch-time check against each
existing deadline over adding another timer. Add both behavioral RED assertions,
then fix/build/verify each module without raising quotas or deadline limits.

### Integrated gates and real development pilot

Root resolved all four initial consumer failures and both new delayed-dispatch
regressions. Default full suite: 107 files / 1,589 assertions PASS at 06:56:37
-04:00; typecheck, lint, MCP/Awin builds, stdio and Skill contracts passed.
Six real with-brand development captures then completed without bundle mutation.
Source-linked style coverage 5/6; exact requested colorway URL coverage 4/6;
runtime EXACT confirmations 0/6. These are not held-out acceptance. Full record:
[integrated verification](2026-09-06-batch2-final-verification.md).

### V8 terminal consistency — frozen after pilot, before source edits

Research: real cases 04/06 contain one READY visual similar card but also stale
generic Chrome/no-qualified-product advice, inherited from recall-time
`chromeFallbackEligible`. Case 05 exits through `rememberVisualFailure` before
the successful-branch-only `visualSearchOutcome` assignment.

Compare A, recompute global recovery eligibility after every ranking change, with
B, scope generic Chrome prose to non-visual search and consolidate empty visual
outcomes in the existing visual-failure boundary. Select B: smaller interface and
regression cost, preserves text recovery and the existing visual authorization
gate. No new source, catalog, permission, identity evidence or ranking threshold.

Atomic steps: (1) public MCP red cases for stale READY zh/en prose and empty
visual REQUEST_WEB_SEARCH outcome; (2) gate only generic non-visual prose,
immediate build and local green; (3) `rememberVisualFailure` emits the shared
empty outcome to remembered state, structured message and model text, marks
REQUEST_WEB_SEARCH / REPORT_INCOMPLETE as incomplete without claiming absence
or that empty images were shown, preserves failure reasons and actual recovery;
immediate build/local green; (4) initial-empty and image-load/web-failure
consumers plus text recovery regressions; full gates. Preserve all six original
captures and their hash: they remain evidence of the pre-V8 bundle, not a newly
invented real validation of V8. No publication is authorized by this refinement.

### Final local handoff

V8 completed its red/build/green sequence and consumer checks, without changing
retrieval, trust, identity, permissions or the six original live captures.
Root independently ran the final default suite at 07:10:29 -04:00:
**108 files / 1,594 assertions PASS**. Typecheck, full lint, MCP and Awin builds
passed; separate stdio at 07:10:46 was 4/4; diff check passed. Final local bundle
SHA256 `555a21847267afa686c754966d442cfc9818c96d9db85b441859fb5903afa833`.
See the [final verification record](2026-09-06-batch2-final-verification.md) for
remaining business and host gates. The total design is NOT complete. Only the
initial v0.17.23 release was published; this entire second batch remains local,
uncommitted and uninstalled. No fake host binding, lifecycle event, authorization,
notification delivery or held-out sample was introduced to close missing evidence.
