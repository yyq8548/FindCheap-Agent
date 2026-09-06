# Known-product recovery after the Sony acceptance failure

## Research

Authorization: Chris requested fixes, commit/push, Railway deployment and installed-cache replacement on 2026-09-06. Baseline: clean `099f8c11dd9f972c13580d82ceebe8ed051db663`, runtime 0.17.24. Applicable design: sections 2, 4.1, 5, 7, 10 and 13. No local product directory, merchant-trust expansion, cart, Watch, global permission changes or new provider is included.

FACT: the original Sony WH-1000XM6 / Black / NEW / REQUIRED Sony request returned no cards. The original server trace records four unique source candidates, four brand exclusions, no identity/requirement/visual exclusions, no official HTTP requests and approximately 88.8 seconds of remaining service budget. The installed MCP reproduction also returned zero cards. The user confirmed no authorization popup; the host returned `decline` in 2 ms. These are two different failures, not an upstream timeout or user refusal.

FACT: `stdio.ts` wires the existing Backend and selected-product inspector. `searchProducts` calls Catalog adapters, performs bounded inspection, applies domain gates and selects presentation groups. `shopify-global-catalog-client.ts:toCandidate` does not supply brand. `search-products.ts:assessBrand` requires explicit brand evidence, except the existing reviewed Apple product-line aliases; a Sony title is not sufficient. `inspectRequiredVariants` skips candidates whose feature requirements already pass. `shopify-selected-product.ts` validates the exact host/product path and original variant, but does not copy the fetched JSON vendor or JSON-LD brand into the inspected product. These combined contracts prevent recovery of missing brand evidence.

FACT: a bounded live Catalog read returned NEW Black Sony candidates, and rejected an Audio46 candidate because `variants.0.description.plain` exceeded 20,000 characters. The response itself was about 100 KB, below the existing 4 MB transport cap. Optional prose currently invalidates a whole otherwise valid product.

FACT: Sony has static official trust but no selectable official storefront seed. The original trace confirms that the official path was not used. Actual Sony discovery/read compatibility remains a separate research gate; adding a registry label alone cannot demonstrate functioning retrieval.

FACT: `server.ts` maps SDK `answer.action === "decline"` to hostAction DECLINE. Form support is a capability declaration, not proof of a displayed popup. Host configuration causality remains UNKNOWN. A model boolean or a user-text claim must not replace actual host consent.

Dependencies: Node 24, pnpm 10.34.5, pinned MCP SDK 1.30.0 and Zod 3.25.76; existing tsx/Vitest/esbuild only. No dependency changes. MCP consumers are search, selected-variant inspection, comparison and quote selection. Shared registry changes, if separately frozen, require both MCP and Awin builds. Default Vitest excludes database integration tests. No applicable CONTEXT.md/ADR was found in this scope.

## Propose

| Dimension | A: demand-driven evidence completion | B: re-read every exact-product candidate |
| --- | --- | --- |
| Placement | Existing Catalog normalizer, inspector and search inspection gate | Existing inspector invoked for every exact candidate |
| Evidence | Recover missing structured evidence before rejection; preserve domain gates | Refresh all candidates, even when metadata is complete |
| Benefit | Addresses the observed broken contract with bounded additional reads | Broader freshness checks |
| Cost/risk | At most the existing four inspections and two concurrent operations; coverage remains bounded | More network latency, failures and budget contention; fewer distinct merchants may fit |
| Compatibility | No new public tool fields or permission channels | No new tool fields, but observable latency/failure behavior changes broadly |
| Rollback | Revert scoped modules; no stored-data migration | Revert the broader inspection policy |

Select A under the user's implementation authorization. Missing evidence does not authorize title-based brand invention, unknown-as-new, merchant promotion or changed product/variant prices. Overlong optional descriptions are omitted rather than partially quoted, so a truncated positive prefix cannot hide a later contradiction.

## Plan v1 — frozen before implementation

| Step / dependency | Module and minimal contract change | Build and assertions |
| --- | --- | --- |
| K1 / Research | Catalog: omit invalid optional description metadata while keeping strict identity/URL/price/condition/envelope/4 MB limits | First-red Catalog tests for long product/variant descriptions and unchanged critical-field rejection; `pnpm build:mcp`; focused Catalog suite |
| K2 / K1 | Existing selected-product inspector: retain structured vendor/brand from the identity-bound document, preserve selected-variant facts and conflict rejection | First-red inspector tests for JSON and JSON-LD brand recovery; missing/conflicting evidence and source/variant isolation; `pnpm build:mcp`; inspector and text-reliability suites |
| K3 / K2 | Existing search gate: inspect missing required-brand evidence even when color already passes; skip known conflicts; retain four-inspection limit, deduplication, cancellation and original gates | First-red Catalog/real-inspector/unified-search regression for Sony Black NEW; negative wrong brand/color/model/condition, untrusted merchant, cap and dedup cases; `pnpm build:mcp`; relevant search/public-MCP suites |
| K4 / independent research gate | Sony official discovery: freeze supported source shape, URLs, contracts and tests after real read-only inspection | No implementation until the Sony research/plan addendum is recorded; both affected consumer builds if shared registry changes |
| K5 / independent research gate | Host consent compatibility: implement only a proven plugin-side correction; otherwise improve truthful diagnostics/instructions and retain host limitation explicitly | No bypass, repeated decline request or global settings edits. Freeze exact changes/tests after research |
| K6 / K1–K5 disposition | Integrate and package 0.17.25; document remaining host limits; no whole-design acceptance claim | typecheck, lint, MCP/Awin builds, full default tests, stdio, diff checks; original live Sony request against release bundle |
| K7 / K6 | Commit/push, verify GitHub, targeted existing Railway production deployment, new versioned plugin cache | CI, remote SHA, deployment SUCCESS, health/readiness/search, source/artifact provenance, enabled installed version, installed-file hashes and stdio |

Shared MCP build output has one owner at a time. Independent research may run concurrently; no concurrent source/build writes. Each step must pass its local build and assertions before dependent implementation. New facts changing safety or feasibility require a recorded plan revision. Preserve 0.17.24 cache and production persistent data; no migration or forced overwrite of a locked cache. No fake host click or general accuracy claim. Real Codex popup interaction and user acceptance remain separate from offline tests and installed stdio checks.

## Implement / Test

K1: two new long-description tests failed on the old adapter with CATALOG_SCHEMA_CHANGED; the invalid-price negative test already passed. Optional metadata omission implemented; immediate MCP build and all 27 Catalog assertions passed.

K2: all three new brand/color inspector assertions failed before implementation. Structured vendor/brand and JSON-LD variant color are now retained from the identity-bound document. Immediate MCP build and 29 inspector/text-reliability assertions passed.

### Plan v2 — K3 condition contract correction

K3's new cross-adapter regression initially failed four assertions with no inspected candidates. After the missing-brand gate change, it exposed a separate existing contract defect: `explicitConditionPreference` clears an explicitly supplied NEW field to ANY whenever the compact source query omits a condition word. The schema already defaults omitted condition to ANY, so the clearing is not necessary to avoid inferring new condition. The old MacBook test explicitly expected this loss of a supplied constraint; its premise contradicts design 4.1 and structured requirements.

| Route | Benefit | Cost/risk |
| --- | --- | --- |
| Honor the typed condition field; keep omitted default ANY | Preserves the original Sony request and aligns native/web recovery contracts | Intent extraction must obey the documented rule not to invent condition |
| Duplicate the condition into the text query before every consumer | Also prevents this exact loss | Changes discovery queries and every caller, with translation and inheritance coupling |

Select the first route. K3 now additionally removes the redundant text-only condition reset. Tests separately cover omitted condition, explicit NEW with a model-only query, UNKNOWN rejection and existing explicit-condition cases. This strengthens the approved hard-condition rule; it does not infer NEW for omitted input. The synthetic success fixture also supplies a source SKU matching the model, because a title plus brand alone must not be upgraded to EXACT. The initial no-SKU result was correctly DISCOVERY_MATCH, not an identity-engine defect; an additional assertion will preserve that boundary.

Remaining step evidence and release evidence are pending; no publication implied.

### Plan v3 — K5 consent scope frozen

Research found the current standard form schema, relatedRequestId and SDK 1.30.0 capability normalization correct. Official host documentation describes policy-based MCP elicitation refusal, but the original task's precise refusal cause is still unknown. Comparing a shared HostConsent adapter with a localized truthful-diagnostics patch, select the latter: a new adapter would affect quote authorization without fixing host policy. Do not edit global or task permissions, use `openai/form` speculatively, or replace consent with a model/user-text boolean.

K5 scope is limited to server tool description/denial wording, the distributed Chrome recovery reference and real-SDK-action regression tests. Do not promise an upcoming popup; explain that host permission was not granted and visible interaction is unknown. Preserve every current status, no-token rejection, denial lock, cancellation, timeout/error distinction and related request. Tests must cover action=decline, cancel, approved=false, approved=true, unavailable capability and no repeat/no webpage read after refusal. Immediate MCP build and relevant recovery/public-contract tests required. Actual host popup recovery remains explicitly unverified, not a completed plugin fix.

K3 completed: immediate MCP build and four relevant suites passed 139 assertions after the condition-contract correction. The fixture without model/SKU remains DISCOVERY_MATCH, and UNKNOWN does not satisfy an explicit NEW request.

### Plan v4 — identity-bound inspection correction before release

Independent review reproduced a new admission risk: the missing-brand read can expand a NEW Catalog variant into a cheaper Used sibling, while the inspector inherits the original condition. The red fixture uses one product page containing both variants and therefore exercises the real contract rather than a standalone condition helper.

Select a narrow correction over refreshing every variant's complete evidence: when only brand is missing and requirements already pass, invoke the inspector without a sibling-selection request, locking the original variant. When an existing size/color request does legitimately select a sibling, explicit variant condition wins; an otherwise unproven sibling condition is UNKNOWN, never inherited NEW. Preserve original variant condition only for that original identity when the document supplies no contradictory condition. Keep exact price/stock/URL binding and test a Used-first page, a changed unknown-condition sibling and explicit conflict on the original variant. Also add explicit same-SearchRun reuse and cancellation/late-result tests. Rebuild MCP and rerun inspector, Sony and requirement tests before release.

### Plan v5 — K4 Sony official read-only integration frozen

Research: the official PDP `https://electronics.sony.com/audio/headphones/headband/p/wh1000xm6-b` declares `occ-backend-base-url=https://api.cqiypyix22-sonyelect1-p1-public.model-t.cc.commerce.ondemand.com`. Its public application scripts and page state identify `/occ/v2/`, base site `sna`, and `products/search` / `products/{productCode}`. Both an independent researcher and the root agent verified direct production-safe HTTP 200 without credentials or user-agent workarounds. The root read the exact black product FULL response: code/selected code `wh1000xm6-b`, matching canonical/selected product paths, Black, USD 398, inStock. Search can return another color or related accessories first, so a search result is not final product evidence.

The root independently read [Sony's product terms](https://electronics.sony.com/terms-conditions): products are new unless identified as refurbished. This reviewed 2026-09-06 policy applies only to this fixed Sony source; it is not inferred from merchant trust or extended to other merchants. Explicit used/refurbished/open-box/unknown/conflicting source evidence overrides default-new classification. Missing identity or required product data is not proof of NEW. Read failures remain unavailable/partial, not whole-market absence.

| Route | Benefit | Cost and risk |
| --- | --- | --- |
| Fixed Sony OCC adapter via existing official port | Works against the verified public source; no new runtime service or tool | Narrow source schema, exact variant and policy tests needed |
| Generic SAP OCC with configurable host/baseSite/mapping | Could support other future SAP merchants | Larger configurable network surface and migration burden without current need |

Select fixed Sony adapter. Generic HTML is not a viable alternative for this site: production returns 403, and the observed page exceeds the generic reader's 1 MB cap. Do not add Firecrawl to production or increase generic limits.

| Atomic step / dependency | Contract and files | Build / independent assertions |
| --- | --- | --- |
| S1 / Research | Add SONY_OCC to official-storefront contract and fill the already trusted Sony record, including explicit product path and exact observed image host; do not add API host as merchant trust | First-red schema/resolver tests; MCP and Awin builds; registry tests; managed registry without Sony still uses existing static fallback |
| S2 / S1 | New sony-official-store-search.ts via existing OfficialShopifySearchPort; fixed API origin and GET search/product paths, source-owned candidate codes | First-red public adapter tests; MCP build; at most 7 HTTP calls/search, 512 KiB/response, 2 MiB/search, concurrency <=2, inherited signal; malformed code/URL/currency/stock/variant rejection |
| S3 / S2 | Existing official factory dispatch; source-aware 512 KiB limit and per-request onRead rejects a second redirect before HTTP execution; no shared network API change | Immediate MCP build; real source-shaped factory/unified/public-MCP fixtures, original Sony request; search first-color differs, exact black detail is required, wrong model/accessory/currency/condition does not recommend |

Only the selected source option may choose another color SKU; read its detail and bind requested code, selected code, canonical/selected URL, base product, color, currency, price and stock before returning a card. Never fill model/SKU from the requested query; any source base-model normalization must be documented and tested. Preserve explicit source model evidence separately from a variant SKU where necessary. Current hard gates decide EXACT versus DISCOVERY_MATCH. Direct approved CDN images can be used for text cards; no new proxy or dynamic registry publication is implied. Root owns later integration validation and release.

K5 completed: two new denial-wording assertions first failed, then its immediate MCP build and six suites / 92 assertions passed. No permission state-machine changes; actual popup acceptance remains unverified. K4 is the next exclusive runtime/build owner after root completes K3's review follow-up.

### Plan v6 — S2 source model and variant SKU separation

The verified Sony FULL response distinguishes `gwSku=WH1000XM6/B` from `gwModel=WH-1000XM6` and `superModelName=WH-1000XM6`, consistent with `baseProduct=wh-1000xm6_base`. Existing internal matching overloads SKU as model number. Prefer an additive optional `mpn` on ShopifyProduct and ShopifyMatchCandidate over replacing SKU with a model or weakening identifier comparison. The adapter must validate the source model fields against each other and the base product; never derive MPN from user input.

S2 may additionally change shopify-client.ts, shopify-match.ts and the single candidate-field forwarding seam in search-products.ts. Include MPN in identifier/search text evidence and prefer explicit MPN over legacy SKU for model matching, retaining legacy behavior when MPN is absent. No new public tool input, persistence migration or broader visual policy change. Add regression assertions for honest variant SKU retention, matching model, wrong model and inconsistent source model fields. The Sony implementer retains exclusive source/build ownership until S3 completes. Root will then finish explicit unknown and JSON-LD itemCondition preservation under K3/v4, before final release gates.

### K3/v4 review follow-up — explicit condition evidence

The first variant-isolation fix passed 30 inspector/Sony assertions, but independent review found two remaining paths: a same-identity explicit Unknown option still inherits old NEW, and structured JSON-LD Offer.itemCondition is discarded before inspection. The original variant may inherit prior condition only when the fresh document has no condition evidence at all.

Freeze the narrow follow-up: retain bounded condition evidence from JSON-LD offers/variants/groups and Shopify JSON variant/product condition fields; explicit unknown, malformed or conflicting condition must not become NEW. Variant-specific evidence takes precedence over a product-level default, and negative condition evidence cannot be overridden by a positive New label. Preserve no-evidence original-variant compatibility and unknown siblings. Add first-red tests for explicit Unknown, structured condition, Product and ProductGroup fallback, sibling isolation and conflicts; rebuild MCP and run affected parser/inspector/retrieval suites. No general stock or price parser redesign is included.

The follow-up produced nine failing condition assertions before implementation. A second review added two failing cases: the refreshed product title states Refurbished, or the identity-bound USD-price fallback page states Used. Both now retain this negative evidence. Immediate MCP rebuild and four suites / 81 assertions passed at 08:20 EDT. This remains separate from the pending Sony factory and final release gates.

### S2 live-shape clarification

Direct live FULL reads showed an existing but empty `description` on WH-1000XM6, WF-1000XM6 and a related accessory. Allow the bounded description string to be empty; identity and nonempty summary remain mandatory, and explicit condition fields/negative labels still override the reviewed default. Do not fail an otherwise valid source record solely for empty optional prose.

For a strong model query, bounded discovery may exclude a source candidate whose entire normalized model/SKU identifier conflicts, before reading its details. The filter uses source-owned candidate codes for recall only; it must not manufacture MPN, make a partial model match (XM5 versus XM6), or establish EXACT. Matching-model alternate-color candidates remain eligible for the exact selected-color detail step. The final identity gate still requires consistent source MPN/SKU/URL. Malformed relevant details and network failures still report source failure, never a complete empty market.

Independent S2 review reproduced release-blocking contract gaps before integration: mutually consistent model fields could contradict the SKU family (XM6 model fields on an XM5 link), and Damaged/For Parts/Like New labels could inherit Sony's default NEW. Source model-family binding must also run for direct PDP reads, not just query filtering. These negative conditions must defeat default-new classification. A bounded transport fixture additionally observed about 2.50 MB before the nominal 2 MiB aggregate budget rejected a search; enforce the aggregate limit during transport/body reads and cancel source-local sibling work on failure. These are corrections to the frozen identity/condition/budget contracts, not new scope or permission expansion.

Root's final K3 cleanup will cover explicit title `Condition: Unknown/Unspecified`, strip old optional MPN with the other stale variant identity fields, and correct a test-only SDK structuredContent type assertion without weakening its message assertion. Then freeze the release-version artifacts and run complete gates.

K3 cleanup: three new assertions failed before implementation; immediate MCP build and inspector/Sony/consent suites passed 89 assertions after correction. The SDK message assertion now uses object matching rather than accessing an untyped field; its semantics are unchanged. Release metadata is frozen as runtime `0.17.25`, package `0.17.25+codex.20260906122817`. Both consumer builds and four version/UI/network/manifest suites passed 232 assertions at 08:28 EDT. S3's first public fixture correctly used OFFICIAL_STORE, not the mistaken test enum OFFICIAL; raw Sony status now uses the existing classifier, preserving independently validated MPN rather than assigning EXACT directly. Sony's remaining condition/budget review fixes and final gates are still pending.

Sony budget enforcement uses a source-local controller and ledger: native safeFetch reports bytes per chunk, injected Response streams have bounded read fallback, and cache hits are not new network bytes. The existing internal scoped fetch forwards per-call signal/observer only where supplied and preserves other-source behavior. Sony still forwards SearchRun accounting. A crossing final network chunk may already have arrived when the limit is detected; reject it, retain/process no data beyond the 2 MiB limit and stop subsequent/sibling reads. Do not claim a byte-perfect socket cap. No shared safeFetch API or domain allowlist expansion is included.

### Plan v7 — Sony card image resource admission

Root traced the live card image consumer and found that the UI CSP uses PRODUCT_CARD_RESOURCE_DOMAINS, not the merchant registry's imageHosts. The existing static list only admits Shopify/eBay images (and the configured Awin origin), so a correctly returned direct Sony CDN image would be blocked in the UI. Compare adding the single reviewed CDN origin with routing through a newly published managed proxy registry: select the former as the minimal existing-UI change without backend publication or proxy expansion.

Add only `https://d1ncau8tqf99kp.cloudfront.net` to the UI resource domains after a first-red resource-metadata test. Keep connect permissions, script behavior, wildcards, URL validation and redirects unchanged. Rebuild MCP and run card/resource/server/stdio assertions. This completes the already frozen Sony image-host admission, not arbitrary CloudFront trust. Actual desktop rendering remains part of the user's acceptance run.

## Final implementation and local release gates

S1–S3 completed with immediate module builds and 111 focused assertions; independent reviewers reproduced the model/condition/budget failures before repair and verified their rejection afterward. Direct and factory aggregate reads stop on the crossing chunk, cancel source-local siblings and issue no subsequent requests. Cached reads retain global accounting without counting cached bytes as new network bytes. Raw Sony card status is calculated by the existing classifier, and irrelevant results are filtered rather than emitted with an invalid public status.

V7 produced three failing resource-metadata assertions before the single-origin CSP change. Immediate MCP build and three UI/server/stdio suites passed 131 assertions. The complete release gate first found a stale Awin registry version assertion and an unused Sony type import; both were corrected, locally rebuilt and retested. Final default suite: **111 files / 1,678 assertions**, all passing at 08:34:55 EDT; typecheck, lint, both release builds, separate four-assertion stdio and diff checks passed. No separate database integration or desktop-interaction acceptance is claimed.

Final live original-request verification: 1,955 ms, Sony official EXACT / NEW / Black, USD 398 item price, READY, recovery NONE; two source requests / 53,370 bytes. Unverified cheaper merchants remain research-only. Actual source image HTTP 200 and RIFF/WEBP content were verified; application/octet-stream is the CDN header, not evidence of a non-image. Only the diagnostic MIME assumption changed, not runtime image safety. Full artifact hashes and remaining limitations are in the [v0.17.25 release record](../../releases/v0.17.25.md). K7 publication, deployment and installed-cache verification follow these completed local gates.
