# Batch 2: Watch and quote evidence

Final cross-module status is recorded in
[root integration verification](2026-09-06-batch2-final-verification.md).
The build/test ownership and counts below describe this module's historical
handoff, not the current final gate or proof of a real host/Cart operation.

> Quote decision revised, 2026-09-06: the main record's Frozen Plan v5 replaces
> blanket shutdown with reviewed fixed operations and actual MCP user consent.
> Q1's unauthorized zero-write regression remains valid. Earlier Q1-Q4 decisions
> below are preserved as history, not current implementation instructions.

## Authority and baseline

This supporting record refines the Watch and quote scope in the
[batch-2 plan](2026-09-06-design-alignment-batch-2.md). It does not independently
authorize a larger implementation. The applicable contracts are total-design
sections 6, 8, 9 and 10 and the five-stage development protocol.

Read-only baseline: clean `0a0b45c`, runtime 0.17.23. This investigation did not
create a Watch, call a merchant Cart mutation, change an Automation, build a
bundle, or alter deployment/cache state. The separate visual implementation can
change the shared working tree after this baseline.

## Research

- FACT: `stdio.ts:24` is the only production caller of
  `createShopifyCartQuotePort`. It injects the result through Backend. The other
  constructor callers are in `shopify-cart-quote.test.ts`.
- FACT: Cart consumers are the single quote (`server.ts:3660`), batch quote
  (`server.ts:3790`), delivered-total Watch creation (`server.ts:4252`) and its
  subsequent evaluation (`watch-service.ts:167`). There is no verified recurring
  consent or no-reservation qualification at these interfaces.
- FACT: `server.ts:2141` derives quote capability from port presence and performs
  Awin Shopify resolution. Both comparison UIs already suppress their ZIP action
  when entries have `MERCHANT_CHECKOUT_ONLY`; this state follows the card field
  through `product-comparison.ts:293`.
- FACT: `watch-service.ts:42-55` records satisfaction but leaves a triggered
  RESTOCKED rule active. It has no delivery acknowledgement or scheduler API.
- FACT: WatchStore has five methods (`watch-store.ts:166-172`). `save` currently
  unconditionally upserts. JSON replacement is a direct write, and creation
  deduplication is list-then-write without a cross-instance critical section.
- FACT: Watch consumers save through `watch-service.ts:25/50` and
  `server.ts:4333/4355/4469`; deletion is at `server.ts:4507`. Repository tests use
  the real memory/JSON adapters rather than handwritten WatchStore objects.
- FACT: Several service tests reuse `baseline.watch` for the next evaluation.
  Incrementing a stored revision while returning the old record would introduce
  false concurrency conflicts.
- UNKNOWN: No trusted Automation stop/read-back interface accessible directly to
  this MCP process has been established. A model-provided ID is not a receipt.
  Cross-task ownership and archive/delete binding remain separate unknowns.

The existing pinned transport remains independently testable. Do not replace its
private-DNS rejection assertion with an earlier policy rejection, which would
silently remove network-safety coverage.

## Quote plan clarification

The root froze the strict Q1/Q2/Q3 option, not the alternative that allowed
injected mock ports to bypass public policy. Therefore:

1. The production factory always rejects `QUOTE_POLICY_UNVERIFIED`, including
   tokenless configuration. No environment switch, model field or test-mode flag
   enables a production Cart mutation.
2. The existing calculation/validation algorithm may be exercised through an
   explicitly supplied request seam without any implicit HTTPS implementation.
   Its fixtures prove arithmetic and validation only, not merchant eligibility.
3. Public single/batch handlers preserve reference validation but reject before
   injected or real quote calls. New cards advertise merchant-checkout-only.
4. Delivered-total Watch creation and existing persisted Watch evaluations reject
   before the quote port, including a supplied mock port. No empty rule is saved.

Success-oriented MCP tests must now assert precise unsupported behavior, zero
writes, stable IDs and preserved item prices. The previous independent arithmetic
expectations remain in estimation/comparison seams. Relevant cases are in
`server.test.ts:599/675/738/1927/1993/2440`,
`product-comparison-server.test.ts:245` and `product-reference.test.ts:78`.
Variant inspection followed by quote (`server.test.ts:913`) also needs the new
policy outcome while retaining the exact-variant inspection assertions.

## W1 proposal: interface and sequencing

This section is a proposed refinement of W1, awaiting root confirmation before
implementation. It does not activate terminal Watch behavior yet.

Keep `create/get/list/delete` call shapes. Extend records with an optional
nonnegative safe-integer revision. Missing legacy revision has logical value 0;
reads must not rewrite legacy files or invent deadlines/bindings. New creation
uses revision 0. Change `save(record)` to return `Promise<WatchRecord>` containing
the committed revision, incremented by exactly one. Existing callers may ignore
the return value, but the two service save sites must return the committed record
to callers. Do not mutate the caller's object to hide this contract change.

`save` validates the complete new record, then updates only an existing record
whose revision matches the supplied revision. A missing record, conflicting
revision or terminal-state reversal produces a distinct safe store error. It
must not insert a missing ID or turn a concurrency error into a stock observation.
Memory get/list/save/create results are detached values, so callers cannot mutate
the adapter's stored object without going through its interface.

Two implementation approaches were compared:

| Dimension | Short exclusive directory-wide lock | Immutable revision journal |
| --- | --- | --- |
| Coordination | One critical section covers dedupe, limit, save and delete | Per-revision publication needs a separate dedupe/limit strategy |
| Storage | Retain current record filenames and JSON read format | Introduce multiple files per Watch and a latest-revision reader |
| Failure | Bounded lock failure; never steal an unknown owner | Interrupted publication and journal compaction need new contracts |
| Cost | Small private helper; no package dependency | More format, cleanup and migration work |
| Recommendation | Selected for W1 | Defer; no current benefit warrants the wider format |

The proposed lock uses exclusive creation in the configured Watch directory, not
an in-memory mutex. All cooperating adapter instances use the same lock. A bounded
wait (proposed maximum 2 seconds) returns `WATCH_STORE_BUSY`; it never deletes or
steals a lock merely because its timestamp is old. A crashed owner can therefore
leave writes unavailable until safely reconciled. Do not claim automatic stale-lock
recovery or uninterrupted monitoring from this initial implementation.

Inside the short critical section, read/validate the current record, compare
revision, write a unique temporary file in the same directory, flush and close it,
then rename it over the target. Release only the acquired lock. Never hold the
lock while fetching merchant data. Failed publication preserves the previous
committed record; leftover temporary files do not count as Watch records. Do not
silently fall back to unconditional direct writes on Windows rename errors.

Node documents exclusive `wx` creation, rename and file flushing; file-flush
durability is OS/device dependent. This design does not claim power-loss durability
or cross-machine/network-filesystem locking without separate verification.
References: [Node 24 file flags](https://nodejs.org/docs/latest-v24.x/api/fs.html#file-system-flags),
[rename](https://nodejs.org/docs/latest-v24.x/api/fs.html#fspromisesrenameoldpath-newpath),
[sync](https://nodejs.org/docs/latest-v24.x/api/fs.html#filehandlesync).

For W1's deletion race, rejecting save of a missing record is sufficient to stop
an in-flight observation from resurrecting that ID. W3 must separately retain a
minimal unresolved scheduler-stop identifier before deleting bound business data.
That retention must not pretend the host was stopped. Do not introduce a second
unconsumed outbox or broad journal during W1.

Required sequencing refinement:

- W1.1: memory adapter/revision interface plus the two service save-return
  compatibility changes; immediately build MCP and run store/service assertions.
- W1.2: JSON adapter short lock and atomic replacement with the same interface;
  immediately build MCP and run store/service assertions.
- W2: activate RESTOCKED completion/event behavior. Any new status requires server
  output-schema compatibility before that status can be emitted through MCP.
- W3: apply terminal behavior to bind/resume/delete and expose stop-required
  handoff without claiming a trusted stop acknowledgement.

## W1 public assertions and compatibility

Use the real memory adapter and two real JSON adapters in a newly created temporary
directory. Observe through create/get/list/save/delete, not private lock helpers.
Each regression is written and confirmed red immediately before its implementation.

- Two saves from revision 0 produce exactly one committed revision 1. The loser
  cannot overwrite the winner.
- Saving a stale ACTIVE observation cannot undo a committed pause.
- Delete followed by stale save leaves get undefined and list without the Watch.
- Concurrent duplicate creation produces one ID and retains the original expiry.
- A modified returned object cannot mutate persisted data without save.
- Legacy revisionless files load unchanged and can be updated once using logical
  revision 0. A second stale legacy save fails instead of overwriting revision 1.
- Corrupt records fail closed rather than disappearing from the list or being
  overwritten with a new plausible record.
- A completed save returns its new revision so service results can safely become
  inputs to a subsequent evaluation.

Temporary corrupt/legacy fixture files are permitted only as input setup; assertions
still use the public store interface. Stale-lock and publication-failure testing may
need an agreed filesystem-fault seam, or a subprocess fixture. Do not claim those
paths tested merely from ordinary two-instance success.

Rollback must not run a pre-revision writer concurrently with the new adapter.
Old binaries can reject new strict-schema fields and do not honor the lock. Preserve
files and report incompatibility; do not strip revisions or completion state to make
an older binary appear to work. No existing user Watch files are migrated or deleted
by this development task.

## Verification status

Research and proposal only. No tests or runtime source were written for Q/W at this
record's creation. Required future local build: `pnpm build:mcp`; final integration
commands remain owned by the root plan. Real notification delivery, host stop,
trusted scope and crash/host recovery remain unverified.

## Q1 red evidence

The root authorized one standalone factory regression while visual implementation
still owns runtime/build writes. At 2026-09-06 05:15:23 -04:00,
`pnpm exec vitest run apps/mcp-server/test/quote-policy.test.ts` exited 1: one test,
one expected failure. Tokenless factory evaluation called the injected DNS and
HTTPS substitutes once each and returned `MERCHANT_CART_UNAVAILABLE`; the approved
contract requires zero calls and `QUOTE_POLICY_UNVERIFIED`. No real network request
occurred. This is the intended defect, not a test setup failure. No source or bundle
change accompanied the regression. Whole-suite execution is withheld while it is red.

## Frozen Q4 instruction alignment

The root requested this additional atomic step after Q3 and before Watch changes.
It is frozen here before any Q4 test or runtime instruction change. Visual V5 and
Q4 touch the same skill files, so Q4 waits for the explicit runtime lock handoff and
preserves the completed visual wording.

Research found active instructions still suggesting ZIP quote calls and delivered
total Watch creation. `.mcp.json` still supplies obsolete tokenless mode/timeout.
The README presents this path as usable. Historical versioned release/product
records describe earlier behavior and are not current execution instructions.

Compare two feasible ways to align instructions: adding one policy banner leaves
contradictory per-action ZIP advice; editing only the relevant current action rules
removes that contradiction without adding a new workflow. Choose the latter.

Scope:

- `plugins/findcheap-agent/skills/compare-products/SKILL.md`: selected comparisons
  remain item-price comparisons. Explain that quote tools are retained only for
  compatibility and currently return unsupported. Do not request ZIP/address,
  retry a policy denial, create a cart, or suggest direct Cart workarounds.
- `plugins/findcheap-agent/skills/deals-and-watch/SKILL.md`: do not request ZIP for
  quoting or create a delivered-total Watch. Preserve other Watch/Coupon rules.
- `plugins/findcheap-agent/.mcp.json`: remove only the now-unused Cart mode/timeout
  environment defaults; no version change or unrelated configuration alteration.
- `README.md`: align the current quote usage/configuration statements with this
  shutdown. Retain historical pricing interpretation only as historical evidence,
  not a promise that a new quote is available. Coordinate with root documentation
  edits before writing this file.

Public seam: existing shipped-plugin contract in
`tests/contract/findcheap-chrome-v0.test.ts`, plus parsed distributed `.mcp.json`.
Add one red policy assertion first, implement only the related instruction change,
then immediately run `pnpm build:mcp` and the contract test. Preserve skill byte and
line limits, tool/reference names, current-language behavior, selected identity
rules and visual V5 changes. Add the configuration regression in its own red/green
step before removing obsolete fields. Verify documentation links/diff as well.

This closes misleading instructions, not the missing real authorization mechanism
or merchant qualification. Restoring quote access still needs a separate plan.

## Quote counterevidence and revised proposal, 05:22 -04:00

The root supplied a relevant primary source that the initial research missed.
[Shopify Checkout](https://help.shopify.com/en/manual/checkout-settings) states that
Shopify holds inventory when a customer submits payment information. It does not
say ordinary cart creation holds inventory. It is incorrect to imply that Shopify
generally reserves stock at cart creation or that no official no-reservation
evidence exists.

The two operation references now inspected are
[cartCreate](https://shopify.dev/docs/api/storefront/2026-07/mutations/cartCreate)
and [cartSelectedDeliveryOptionsUpdate](https://shopify.dev/docs/api/storefront/2026-07/mutations/cartSelectedDeliveryOptionsUpdate).
Their URLs redirect to latest, but their page headers explicitly identify
`2026-07 latest`. The previous statement that redirection left no version evidence
was too strong. These operations create a buyer-session cart and select its shipping
option. Neither submits payment or an order. Current code requests neither checkout
URL nor any payment operation, uses one unit, and supplies only US country and ZIP.

The total design says the corresponding interface must be reviewed and confirmed
not to reserve inventory. It does not mandate a per-merchant qualification table.
That table was an earlier proposed implementation, not an approved hard requirement.
An explicitly bounded, source-backed review of these Shopify interfaces is a viable
way to satisfy the rule. Merchant trust and exact host/variant checks remain separate.

### Functions and schema compatibility

[Functions network access](https://shopify.dev/docs/apps/build/functions/network-access#api-restrictions)
requires Storefront `@defer`; unsupported calls run locally without issuing external
HTTP requests. Neither current mutation contains `@defer`. This directly limits the
earlier concern about arbitrary external Function requests; it must not be presented
as a reason to require blanket shutdown of these fixed operations.

[Cart Transform](https://shopify.dev/docs/api/functions/latest/cart-transform) can
change lines, prices, bundles, titles or attached services. That is a distinct quote
identity issue, not evidence of stock reservation. A qualified implementation should
validate returned line identity/quantity and reject added or substituted lines rather
than silently label the total as the original selected item. CartSchema currently
does not request or validate line merchandise identity.

The [2026-07 buyer identity input](https://shopify.dev/docs/api/storefront/2026-07/input-objects/CartBuyerIdentityInput)
still lists `deliveryAddressPreferences` as deprecated. Do not claim it was removed
merely because mutation examples omit deprecated fields. The modern delivery-address
input is available, but its migration is separate from the no-reservation finding.

[Shopify versioning](https://shopify.dev/docs/api/usage/versioning) documents version
fall-forward and the response `X-Shopify-API-Version` header. API qualification must
expire before the reviewed version is unavailable; a response-version mismatch must
stop any subsequent mutation and reject the estimate. Do not assume a versioned URL
provides perpetual qualification.

### Two now-viable choices

| Dimension | Retain temporary full shutdown | Review fixed API plus real one-call consent |
| --- | --- | --- |
| Safety | Zero Cart writes | Zero writes without live consent; narrowly qualified operations only |
| Product value | No shipping/tax quotes on any host | Authorized single/batch quotes work on capable hosts |
| Scope | Smaller implementation, substantial changed success tests | One shared consent/permit interface plus existing handlers and transport |
| Evidence | No need for positive host path | Existing MCP elicitation supports contract testing; real desktop remains separate |
| Remaining gap | Quote function intentionally unavailable | Unsupported/denying hosts return permission-unavailable/denied, never simulate consent |
| Recommendation | Fallback if interface review cannot be completed | Preferred given the newly verified platform evidence |

The second option is feasible with the existing MCP SDK and does not require trusted
cross-restart task identity. [App Server](https://learn.chatgpt.com/docs/app-server)
documents MCP form elicitation; `server.ts` already uses `elicitInput` with the active
request ID and abort signal. Public transport tests already supply
`ElicitRequestSchema` handlers. This proves an implementation/testing seam, not that
the current desktop will show or accept the dialog.

Proposed revised atomic increments, not yet frozen:

1. Record interface qualification for API 2026-07 and these exact two operations:
   no `@defer`, no checkout/payment/login/order/selling-plan operation, quantity one,
   ZIP-only input, bounded HTTPS and operation count. Add an expiry and preserve
   source evidence. Guard the final quote port: missing, copied, expired or consumed
   internal permit means zero DNS/HTTP. No model approval field or environment
   approval switch creates a permit.
2. Add one request-bound consent function used by single and batch handlers.
   Describe the exact selected products, merchant hosts, ZIP and maximum cart count.
   Only a validated host `accept` response creates a short-lived internal permit.
   Recheck snapshot, IDs, quantities, ZIP and cancellation after awaiting consent.
   Keep permits in the server invocation, never tool output, disk or a later turn.
   A batch approval covers exactly its selected 2-4 products, not future additions.
3. Exercise the existing quote/price path through positive MCP consent fixtures,
   while all denied/unavailable/cancelled/timed-out/changed-reference cases remain
   zero-write. Keep per-call host deadline headroom; the existing 30-second tool
   deadline must include authorization and both bounded merchant requests.
4. Keep delivered-total Watch creation and legacy recurring evaluation blocked.
   Interactive one-call approval never authorizes repeated future Cart mutations.
   Align current skill/README instructions with conditional authorization rather
   than unconditional availability or unconditional shutdown.

Q1's existing red probe has no authorization, so its zero-write requirement survives
either choice. Its exact policy-error label may be clarified only when the revised
interface is frozen; this does not turn the observed unauthorized DNS/HTTP into a
passing result. No source, test or bundle changed during this counterevidence review.

## Frozen QR1-QR4 refinement, 05:28 -04:00

The root selected and froze the conditional authorization option in the main plan
v5 before quote source edits. This is within total-design section 6, not a change to
the approved user permission boundary. Runtime and build work still waits for the
explicit visual-owner handoff. Only the existing standalone Q1 red test has run.

1. **QR1:** an internal WeakMap-backed permit binds exactly one or two to four
   selected merchant/host/variant/ZIP targets, the active request's abort signal,
   a short monotonic deadline and one consumption per target. The final production
   factory accepts it as an optional third argument; the unchanged two-argument
   interface fails before DNS or HTTP with `QUOTE_POLICY_UNVERIFIED`. No serialized
   object, tool input, environment approval switch, future turn or recurring Watch
   can recreate the permit. The production issuer is called only after real form
   acceptance in QR3. Simulated test acceptance proves the mechanism, not live consent.
2. **QR2:** retain API 2026-07 and the two fixed mutations, quantity one, US/ZIP-only
   buyer input, no `@defer`, credentials, selling plan, payment or order. Review
   expires no later than 2027-07-01. Validate the actual response API version and
   both returned cart line sets; reject partial, extra, grouped, replaced or wrong
   quantity merchandise. Invalid create response means no delivery mutation;
   invalid update response means no quote. Expiry/cancellation is checked again
   before the second mutation. A version mismatch can only be observed after the
   first authorized request, so it is not falsely reported as a zero-write outcome.
3. **QR3:** single and batch handlers use the existing MCP form capability and
   `elicitInput` with `relatedRequestId` and `extra.signal`. Show the exact products,
   merchant hosts, ZIP and maximum cart count. Bound user waiting to 20 seconds;
   leave time for at most two bounded merchant requests per selected product.
   Only strict `action: accept` and `approved: true` can issue the permit, after
   rechecking reference ownership, snapshot object/TTL, selection, ZIP and abort.
   Decline, unavailable capability, malformed approval, timeout or changed scope
   performs zero quote calls, including injected quote ports. A batch accepts once
   for its fixed two to four targets. Public tools expose no approval/token field.
4. **QR4a:** create and evaluate delivered-total Watch fail before quoting; no
   recurring permission contract exists. **QR4b:** update current distributed skills
   and the scoped README paragraphs to require the interactive request and actual
   host approval, never ZIP alone. Preserve quote tools, references and tokenless
   configuration; do not replace the feature with the superseded shutdown policy.

Every module increment uses the pre-agreed public seam, a red regression, immediate
`pnpm build:mcp`, and targeted green assertions before its dependents. Existing
USD, tax, stable-ID, expiry and private-DNS assertions remain meaningful. No live
merchant Cart write or desktop approval is claimed. W1-W3 follow QR4; retained Awin
quote-preflight is a read, and the budget slice owns its bounded signal propagation.

### QR2 schema verification

Verified against the pages labeled **2026-07 latest** on 2026-09-06:

- [Cart](https://shopify.dev/docs/api/storefront/2026-07/objects/Cart) exposes
  `lines: BaseCartLineConnection!`; `first` bounds the returned set. Carrier rates
  default off and require `@defer` when requested. The reviewed request keeps them
  off, so stores that expose only dynamic rates can remain unsupported.
- [BaseCartLine](https://shopify.dev/docs/api/storefront/2026-07/interfaces/BaseCartLine)
  has merchandise, quantity and sellingPlanAllocation. Its two implementations are
  CartLine and ComponentizableCartLine. The bounded selection can request
  `__typename`, `quantity` and a ProductVariant fragment for merchandise ID.
- [CartLine](https://shopify.dev/docs/api/storefront/2026-07/objects/CartLine) can
  still have sellingPlanAllocation or parentRelationship. A plain type label alone
  does not rule out subscriptions or attached items. Requiring these fields to be
  null is the root-approved minimal refinement of the frozen plain-line/no-selling-plan
  rule, confirmed before implementation.
- [ComponentizableCartLine](https://shopify.dev/docs/api/storefront/2026-07/objects/ComponentizableCartLine)
  groups merchandise and contains lineComponents. Rejecting this type prevents a
  bundle from being silently priced under one original selected variant.

The intended line check is one ordinary line, the requested ProductVariant ID,
quantity one, no next page, no selling plan and no parent relationship. It adds only
response fields to the reviewed requests, not a third operation or new authority.

### QR3 trust prerequisite, frozen before implementation

The root confirmed that user consent cannot override merchant or source safety.
FACT: the current single and batch quote handlers check quote capability and snapshot
ownership, but do not require `isTrustedMerchant` before calling the quote adapter
(`server.ts`, quote_selected_shopify_product / quote_and_compare_selected_products).
`merchant-trust.ts:isTrustedMerchant` already checks independent verification and
one of OFFICIAL, AUTHORIZED_RETAILER or ESTABLISHED_RETAILER. QR3 will reuse it on
the selected immutable card before asking for consent; UNKNOWN/RISKY cards are not
upgraded by a positive form response. This intentionally narrows the previous
explicit-quote behavior, consistent with total-design sections 5 and 10.

The Awin quote resolver intentionally marks its returned Shopify object unverified
(`awin-shopify-quote.ts`, lines 107-115); it proves quote-target identity, not merchant
trust. The original Awin card supplies the previously verified merchant evidence.
Rejecting all Awin quotes because the bridge result does not duplicate that trust
would be incorrect. The resolved object must remain associated with the same card
key and merchant ID, with its final host/path supported by the existing resolver.
Its resolved variant is shown and bound into the permit. Ordinary Shopify quotes
continue to require the source object's exact product reference key to match the card.
No new merchant trust source, allowlist expansion or price-based inference is added.

Verification adds unavailable/unsafe-card zero-elicitation and zero-quote cases,
while preserving trusted Awin and ordinary Shopify price/identity tests through
simulated positive MCP approvals. Real merchant coverage is still unverified.

### W1.2 pending-stop interface, frozen before implementation

The root approved `WatchStore.listPendingStops(): Promise<WatchStopIntent[]>` so
W3 can recover unresolved scheduler handoffs after restart or a repeated delete.
WatchStopIntent contains only watchId, automationId, reason, requestedAt and the
literal status `STOP_REQUIRED`. The allowed reasons are RESTOCKED, EXPIRED, PAUSED
and DELETED. The identifier is an unverified handoff reference, not proof of host
ownership, permission or scheduler state. There is no ACK/STOPPED mutation.

An existing rule may retain a stopIntent. Deletion first atomically writes a minimal
`<watchId>.deleted.json` tombstone, then unlinks the product rule. Reads and save
must check the tombstone first: if the unlink fails, the shopping data is still
inaccessible and cannot be resurrected. A retry can finish file cleanup. The
pending-stop list combines live rule intents with tombstones, deduplicated by
watchId. A tombstone without an Automation identifier still prevents resurrection
but does not invent a scheduler to stop. No query, title, source URL, variant, ZIP,
last observation or original rule spec is copied into the tombstone.

This adds no host bridge and migrates no real user data during development. Both
store adapters implement the same method. Public store tests exercise delayed
save after delete, two-instance concurrency, deletion retry and the failed-unlink
ordering, alongside legacy-read/default-expiry compatibility. File names and
content are bounded/validated; lock acquisition is bounded and never steals an
unknown owner. Each store increment still requires immediate build and assertions.

## QR1 implementation evidence, 05:36-05:37 -04:00

Root handed off the exclusive source/build lock after the visual slice's local
424 assertions passed. Added the internal request-local WeakMap authority and the
optional third quote argument. The final factory rejects missing, forged, copied,
consumed, expired, cancelled and foreign-scope permits before DNS/HTTP. The fixed
2026-07 qualification expires at 2027-07-01. Added the required safe error-message
case to the server's exhaustive failure-code consumer; no quote handler accepts
user approval yet. QR2/QR3 remain necessary before conditional production quoting.

- `pnpm build:mcp`: exit 0 immediately after the interface/factory change.
- 05:36:37, quote-policy + shopify-cart-quote tests: exit 1. Original Q1 red turned
  green; eight old unqualified offline quote tests correctly failed at the new
  policy boundary. This was a contract-fixture adaptation, not eight price regressions.
- Added explicit controlled offline permits to those existing fixtures. Preserved
  their USD/tax/TTL/error assertions and the private-DNS test's actual resolver call.
  No production bypass or environment approval flag was added.
- 05:36:54, the same two files: exit 0, 10/10 tests.
- Added scope, replay and invalid-authority assertions using the agreed factory seam;
  05:37:26, the same two files: exit 0, 18/18 tests. These eight additional assertions
  test the QR1 guard already implemented, not separately claimed red regressions.

Q1 was renamed from an unreviewed quote to a quote without current authorization;
the required `QUOTE_POLICY_UNVERIFIED` and zero-DNS/HTTP expectation did not change.
All network behavior above is an in-memory fixture. No actual Cart was created.
At the root's request, the source/build lock is yielded at this green QR1 boundary
for a newly discovered visual-policy regression. QR2 has not started.

QR2/QR3 identity refinement approved during the green-boundary pause: factor one
pure target-validation interface for both pre-consent server checks and final
factory checks. Preserve HTTPS, public host syntax, matching product host/path and
numeric variant requirements. An explicitly conflicting or duplicated `variant`
query parameter is rejected; an absent parameter remains valid. This closes a
source-identity contradiction, not a new merchant policy. Add invalid numeric ID,
HTTPS, host, path and explicit-variant cases with zero elicitation/Cart. QR3 uses an
explicit quote-capability allowlist (DELIVERED_TOTAL_SUPPORTED / ZIP_ESTIMATE_ONLY),
so a future NOT_CHECKED value cannot silently grant access. The later budget slice
owns that new capability and its display semantics.

Expiry or cancellation after the first authorized mutation is a QUOTE_TIMEOUT.
An unexpected response API version is MERCHANT_CART_UNAVAILABLE. Do not reuse the
pre-dispatch policy-denial message to falsely imply that an already authorized
first request never occurred. DNS completion must recheck abort/deadline before
HTTPS dispatch, and a late source response cannot permit the next mutation.

## QR2 implementation evidence, 05:41-05:45 -04:00

After the root returned the runtime/build lock from V6, QR2 progressed through
separate red/build/green increments in shopify-cart-quote.ts:

| Increment | Confirmed red before source change | Immediate build and targeted green |
| --- | --- | --- |
| Returned merchandise identity | 05:41:09, changed variant still returned USD 111.98; exit 1 | build:mcp exit 0; 05:41:31 quote files 19/19 |
| Explicit source-URL identity | 05:41:49, wrong/duplicate variant each still quoted; exit 1 | build:mcp exit 0; 05:42:03 quote files 21/21 |
| Request-local transaction lifetime | 05:42:26, expired/cancelled first response still allowed delivery update; exit 1 | build:mcp exit 0; 05:42:47 quote files 23/23 |
| Cancellation while DNS pending | 05:43:13, cancelled request still dispatched HTTPS once; exit 1 | build:mcp exit 0; 05:43:35 quote files 24/24 |
| Actual API response version | 05:43:57, missing/2026-10 response each still quoted; exit 1 | build:mcp exit 0; 05:44:05 quote files 26/26 |

The two responses now request and verify one plain CartLine, exact ProductVariant,
quantity one, no extra page, no parent and no selling plan. The same pure target
validator serves the factory now and the pre-consent handler in QR3. Request-local
signals and the remaining five-second permit budget reach the transport; DNS/body
waiting is bounded and late responses cannot enable another mutation. Response
version must equal 2026-07. No additional mutation or `@defer` was introduced.

Additional post-implementation boundary assertions verify extra/grouped/attached
lines, changed update response, a valid version through the pinned transport, and
a 500ms stalled body. These are not separately claimed red regressions. Final local
gate at 05:45:38: two quote test files 35/35, exit 0; `pnpm typecheck`, exit 0.
An earlier package-filtered typecheck command exited 1 because that package has no
typecheck script; the verified root command above is the correct entry point.
Latest source build remains 05:44:05 and matches the current source; only tests and
this evidence changed afterward. No live Cart or desktop consent was exercised.

W1 follow-on refinement approved before its source changes: Automation identifier
uniqueness must be checked inside each store's mutation critical section, against
other bound records and unresolved stop intents/tombstones. Per-record revision CAS
alone cannot prevent two different watches from binding the same Automation.
Same-watch idempotent binding remains allowed. A deleted Watch's STOP_REQUIRED
identifier stays reserved, preventing a later cleanup from stopping a newly bound
Watch; no fake ACK releases it. Public memory/two-JSON-instance tests must produce
exactly one successful concurrent bind of the same identifier to different watches.

QR3 refinement approved before implementation: late results from an injected port
must not replace snapshot state after request cancellation or selection/TTL change.
Recheck context after quote completion; report discarded results without claiming
that an already authorized Cart did not occur. Single-quote input adds optional
responseLocale, taking precedence over the prior snapshot locale; this changes no
authority. Add public MCP delayed-port and language-switch assertions before source.

QR3 partial evidence: correct single no-form red at 05:46:59 observed one provider
call (the prior attempt lacked a required search argument and was not a valid red).
Single guard build and targeted green at 05:48:39, root typecheck green. Batch
no-form red at 05:52:02 observed two calls; shared form/target validation build,
two new assertions and root typecheck green at 05:52:24. Explicit simulated form
approval was added only to existing quote success/error fixtures, with numeric
variant IDs and /products/ URLs where required. Original price, delta, reference
collision and failure assertions remain. Server/reference/comparison tests: 91
green at 05:53:14. Simulated approval is not desktop or real user consent evidence.

QR3 closed: correct late-selection/locale red at 05:54:08 (the previous search
fixture used an unsupported legacy locale field and was corrected first). Source
build and five direct assertions green at 05:55:12. Added positive two/four-item
MCP approval, per-target/ZIP consumption/replay, strict refusal, unsafe target,
waiting selection/TTL change, cancellation, and 20s timeout/late acceptance tests.
Four cards use the legacy snapshot fixture; current unified search presents at
most three in this synthetic group. No presentation limit was changed. Failed
fixture attempts (four-card limit and invalid trust enum) were fixed without
loosening product/price/authorization assertions. Final QR3 six-file gate at
05:57:42: 150/150, typecheck 0. All consent is simulated; no actual Cart writes.

QR4a service: legacy recurring quote red at 05:58:16 observed one provider call.
Removed its quote-producing observer and refuse before clarification with
RECURRING_QUOTE_AUTHORIZATION_UNAVAILABLE. Build and 25 Watch assertions green at
05:58:34. Server preflight/clarification red at 05:58:59: three public cases failed
for existing preflight creation and ZIP solicitation. Removed preflight/persisted
selection construction; default refusal preserves legacy read schemas. Build and
126 service/server/authorization assertions green at 05:59:27; typecheck 0.
The previous delivered-total Watch success assertions now require unavailable,
zero provider calls and no saved rule, reflecting the frozen recurring-consent
boundary rather than weakening price calculations (retained in quote tests).

QR4b runtime guidance: initial contract at 06:00:36 correctly failed missing quote
consent guidance and the pre-existing 7046-byte compare Skill against its 6400-byte
cap (an earlier regex syntax error was corrected before this valid run). The
writing-for-agents skill informed colocating quote scope/refusal and pruning
duplicate prose, without changing model invocation or introducing references.
Both skills retain safety, visual gates, receipt handling and fast-path rules.
The quoted YAML description is accepted by a scalar extraction assertion instead
of requiring an unquoted literal; byte/line bounds are unchanged. Current sizes:
compare 6355 bytes, Watch 3650 bytes. Runtime guidance and three tool descriptions
were built immediately at 06:03:21, 14/14 contract assertions green. README now
describes the bounded API audit, actual one-time host acceptance, recurring quote
refusal, and real-host acceptance gaps rather than ZIP-only permission.

Final QR gate 06:03:57: eight targeted files, 190/190 assertions; root typecheck 0;
targeted ESLint 0. Latest runtime build is 06:03:21 and matches source. Skill
quick_validate passed both with Python UTF-8; git diff --check 0. No version bump,
publish, deployment, installed cache change, real Automation or Cart operation.
W1–W3 remain unimplemented. Source/build lock yields to V7 before Watch begins.

W implementation refinements confirmed by the root before source changes:
W1.1 must also make the existing JSON save return its validated record so the
shared Promise<WatchRecord> interface builds; JSON is not claimed CAS-safe until
W1.2 replaces its persistence path. This is the minimum compatibility adaptation,
not a second complete JSON implementation. W3 refuses resume whenever any
STOP_REQUIRED intent exists, returning AUTOMATION_SYNC_REQUIRED while preserving
the intent and local status. No trusted acknowledgement path exists to clear it.
Ordinary unbound PAUSED rules without an intent can resume; COMPLETED/EXPIRED
cannot. A new explicit Watch after completion creates a new ID rather than
matching the completed rule; its old Automation identifier remains reserved.

QR4c refinement, approved during read-only Watch preparation before code: the
WatchSpec priceBasis description and missing-basis clarification still advertise
DELIVERED_TOTAL. After V7 releases the lock, first assert that the public PRICE_BELOW
clarification asks the user to confirm ITEM_PRICE without offering DELIVERED_TOTAL.
Update those two watch-store instruction consumers, retaining the legacy schema
enum and never silently choosing ITEM_PRICE. Immediate build:mcp and Watch/server
assertions must pass before W1. The already-implemented explicit delivered-total
refusal stays unchanged. W1 concurrency conflicts are rethrown as the distinct
WatchStateConflictError, not mislabeled as a source failure; existing executor safe
errors suffice, without a new business-status enum.

QR4c: at 06:11:50 the explicit-price-basis MCP assertion failed because the old
question offered DELIVERED_TOTAL. Updated only the Watch schema description and
question; immediate 06:11:59 build plus 116 store/service/server assertions green.
W1.1: memory concurrent-save red at 06:12:16 observed two successful writes from
the same revision. Implemented detached reads, revision CAS, no missing/terminal
upsert, immutable existing binding/stop intent, and in-store Automation uniqueness.
Added compatible optional record fields and server output enums; service returns
the committed revision and rethrows conflicts. JSON only returns its validated
record at this intermediate stage; no JSON safety claim. Immediate 06:13:00 build,
117 assertions and typecheck green; three further public memory boundary tests
are green (four concurrency tests total). No real Watch files were accessed.

W1.2: two JSON adapters both saved one revision at 06:14:02 (correct red). Added a
directory-wide exclusive wx lock with a 2s bounded wait and no lock stealing,
256 KiB bounded records, a 2048-entry directory bound, same-directory temporary
write/flush/close/rename, revision CAS and Automation uniqueness in the critical
section. Tombstones are saved before business-data unlink and win over leftover
records. No lock spans provider calls. Immediate build at 06:14:55 plus 45 tests
and typecheck green. Added nine public adapter/file-fault boundary cases: concurrent
dedupe/binding, reserved deleted ID, data-free tombstone with unlink failure and
retry, rename publication failure, legacy no-rewrite/logical revision, corrupt/
oversized/wrong-ID records, existing lock preserved. At 06:15:50, four Watch files
54/54 and typecheck green. These extra fault cases are not separately claimed red.
No real user files, real Automation, crash/power-loss durability or host ACK tested.

W2: correct service red at 06:16:27 found ACTIVE and no completion/stop event after
verified restock. Persisted COMPLETED/event/STOP_REQUIRED in the same CAS, terminal
checks do no source work, and expiry retains one stop request. Immediate build at
06:16:52, 119 assertions and typecheck green. Completed-rule dedupe red at 06:19:15
failed for both memory and JSON; excluding terminal records from matching fixed it.
Immediate build at 06:19:29 and 57 assertions green. Five additional service tests
cover adapter restart, one winner from concurrent evaluations, pause/delete while
source is in flight, and repeated expiry. At 06:20:12 five Watch files / 64 assertions
and typecheck passed. Additional boundaries were not separately claimed red.
Completion is durable notification eligibility, not guaranteed actual delivery;
the host may still be scheduled until it independently handles STOP_REQUIRED.

W3 local-first clarification frozen with root before changes: omitted Automation
ID does not block local pause/delete, including old unbound rules. An explicitly
different ID remains a consistency error with zero state changes, not authority.
The actual saved identifier alone is returned for handoff. Resume is refused for
legacy rules or any STOP_REQUIRED, and terminal rules never resume/rebind. Store
saving ACTIVE with a stop intent is rejected too, so the public handler is not the
only barrier. Existing tests requiring host-first or legacy binding before local
stopping will change to the new exact PAUSED/DELETED contract; mismatched-ID tests
remain. Binding and ACTIVE are local compatibility statuses only, not verified
host activity. Public check/list/pause/delete expose minimal pending stops and the
stable completion event. Deleted rules expose no query, price, ZIP or observations.
W3 instructions replace host-first order in the Watch Skill/reference and current
README paragraphs; no trusted host bridge, ACK, STOPPED or notification-delivery
guarantee is introduced.

Root review refinement within W3 before its corrective store source change:
an existing completionEventId must be immutable, like a saved stop intent. The
correct-revision public save test at 06:23:02 confirmed it could be removed; add
one nextRevision guard for deletion/replacement, then build and targeted tests.

W3 evidence: pending-stop ACTIVE save red at 06:20:50, immediate store build at
06:20:57 and 47 assertions green. Public pause-without-host-ACK red at 06:21:21
returned the old refusal. Server local-first lifecycle, terminal refusal, minimal
stop/event outputs and truthful handoff wording built at 06:22:42; focused MCP tests
and typecheck green. Completion-event preservation red at 06:23:02 was fixed with
one store guard; build at 06:23:11 and 48 assertions green. Seven further public MCP
boundary cases cover terminal repeats, deleted handoff/id reservation, explicit ID
mismatch, ordinary unbound resume, legacy stopping, paused binding, and expired
resume. At 06:24:03 three files / 86 assertions and typecheck passed. The prior
legacy test now expects local PAUSED before binding and a PAUSED stop request after
binding; no mismatch, threshold, price, identity or dedup assertions were weakened.

W3 runtime instruction red at 06:24:42 found the old active-after-binding claim.
The Watch Skill, its lifecycle reference and two current README paragraphs now
describe local-first stopping, unverified BOUND/ACTIVE, persistent STOP_REQUIRED,
real host ownership/scope checks, no fabricated ACK and no pending-stop resume.
Builds at 06:25:10/06:25:38 passed; the unchanged Skill byte gate correctly rejected
3785/3704 bytes. Semantic-preserving compression then built at 06:25:48 and passed
all 15 contracts. Watch Skill is 3699 bytes; compare Skill remains V7's 6382 bytes.
Writing-for-agents informed keeping detailed lifecycle safety in its existing
on-demand reference, not expanding initial live-shopping overhead.

Final QR/W local gate at 06:26:12: 13 files / 238 assertions, typecheck green.
Scoped ESLint found three test-only import-type-style violations in the JSON fault
fixture; explicit type namespace imports fixed them without changing behavior.
Typecheck and scoped ESLint then passed; JSON fault tests 9/9 at 06:26:56 and
git diff --check passed. Both distributed Skills passed quick_validate. Last
runtime bundle matches the 06:25:48 build; later changes are test type imports only.

Test inventory added by QR/W: quote-policy 11, quote-authorization-server 25,
watch-concurrency 7, watch-json-atomic 9, watch-lifecycle-server 8 (60 in new files);
existing shopify-cart-quote gains 16, watch-service gains 7, plugin contract gains
one QR consent test. Existing quote success fixtures use explicit simulated MCP
approval, retaining price/identity assertions. No full suite was run while B1 has
an intentional failing budget test; root owns the final integrated suite.

Runtime file ownership in this slice: quote-authorization.ts (new),
shopify-cart-quote.ts, watch-store.ts, watch-service.ts, server.ts (shared visual
changes preserved), their generated MCP bundle/notices; test fixtures and runtime
guidance described above. No version bump, commit, push, deployment, cache install,
real merchant Cart, real Automation, existing user Watch file access/migration,
trusted scheduler ACK or guaranteed notification delivery was performed. QR/W is
locally verified only. Source/MCP build lock is released to root for budget work.
