# FindCheap Agent

[![Latest release](https://img.shields.io/github/v/release/yyq8548/FindCheap-Agent?label=release)](https://github.com/yyq8548/FindCheap-Agent/releases/latest)
[![Plugin CI](https://github.com/yyq8548/FindCheap-Agent/actions/workflows/ci.yml/badge.svg)](https://github.com/yyq8548/FindCheap-Agent/actions/workflows/ci.yml)

English | [简体中文](README.zh-CN.md)

[Agent design](docs/architecture/agent-design.md) is the maintained architecture and approved-behavior reference. It separates implemented behavior from targets and outstanding acceptance. Contributor entry: [AGENTS.md](AGENTS.md).

Product form: **Codex Plugin Agent**.

Current source package: **v0.18.7** — recognized Shopify product links now supply compiled product text to WooCommerce search instead of becoming foreign direct-product targets. Exact identity, Woo URL security and merchant-selection rules remain enforced. This patch includes the earlier search, variant, comparison, recovery and Windows installation repairs. WooCommerce has 1,003 technical search storefronts; registration does not grant merchant trust. Publication, deployment, installation and native acceptance are verified separately in the release record.
Nine-row comparisons and immutable selections remain.
[v0.18.7 release and verification status](docs/releases/v0.18.7.md). [Native test instructions](docs/engineering/changes/2026-09-09-native-user-checks.md). [9/9 repair and test status](<改进计划 9_9.md>). [1,000-store baseline evidence](docs/engineering/changes/2026-09-08-woocommerce-expansion-1000-data.md). [Existing 200-merchant trust review](docs/product/woocommerce-merchant-trust-200.md).

FindCheap Agent is a shopping-research Codex plugin for product search, offer matching, price checks, product cards, evidence-backed comparison views, verified deals, and shopping watches. Search is read-only; quotes and Watches have separate authorization boundaries. It returns up to eight products in three tiers: 2 official-store matches, 3 trusted or high-rated matches, and 3 best-value high-match options.

Codex starts text product discovery with `search_products` through a local stdio MCP server; image, comparison and follow-up operations have their own tools. Eligible Awin, Shopify, configured eBay/WooCommerce and official-store sources can run in parallel. Insufficient recommendable results may trigger bounded complementary retrieval; the card limit is not a quota. An authorized bounded Chrome search requires a server-issued recovery action and host authorization, not merely an empty result.

The plugin does not order, check out, or submit payment. Inventory reservation is outside the permitted product scope. Anonymous-cart quotes have separate approval and side-effect requirements; their target rules and verification gaps are recorded in the Agent design.

## Usage

Call FindCheap Agent directly in Codex:

```text
@FindCheap Agent search for Sony WH-1000XM6 and show product cards.
```

Or ask in plain language after enabling the plugin:

```text
Find me three trusted offers for AirPods Pro 2.
```

Compare 2–4 cards from one result:

```text
Compare the first three products side by side.
```

Attach a product photo or screenshot and ask for visual discovery:

```text
Find this item, then show highly similar and same-style options.
```

For a supported selected product, explicitly request shipping, tax, and an estimated total with a US ZIP; then approve the host's one-time anonymous Cart form:

```text
Quote the first product for ZIP 33065.
```

Create a shopping watch:

```text
Watch this product and notify me when a new item falls below $170.
```

Ask whether to buy a selected product now:

```text
Is this worth buying now, or should I wait?
```

For a follow-up quote, refer to a result by its number or choose it from the card. FindCheap Agent reuses the original product and variant instead of searching its title again. Active selections expire after two hours, and the active cache keeps at most 128 recent search snapshots. Supported persistence restores history within the same trusted task; it does not refresh prices or stock, or restore expired quotes and authorizations. Desktop restart and UI acceptance remain separate checks.

## Product search

The plugin uses one constrained search request with parallel, eligible Awin, Shopify, eBay, WooCommerce and known official sources. Source-specific short queries preserve identity anchors; all final results must still satisfy the original category, variant, budget and required-feature checks. A query compiler separates retrieval wording from eligibility, and typed failures distinguish local invalid queries, source rejection, timeout, rate limiting, schema and security errors.

Coffee form and machine compatibility are separate checks. Capsule discovery preserves the shopping goal and other requirements, excludes equipment and conflicting forms, and asks for the machine system when needed. Unknown compatibility cannot produce a primary recommendation. Within the existing two-pass budget, Shopify uses an available cursor for a new page; receipts distinguish actual pages and merchants read from estimated totals. A Woo-specific limit or unsupported store does not block otherwise eligible independent recovery.

Continuations bind an explicit `parentRenderId` or server-issued `goalId` plus exact `goalRevision`. Requirements and prior candidates are rechecked without mutating old cards or treating old prices as fresh observations. Correcting product identity does not silently withdraw unrelated requirements. No global latest-result lookup or persistent product catalog is used.

After reading a supported official Shopify product URL, FindCheap retains its product path and selected variant through search and follow-ups. Another same-store product or variant cannot qualify merely by sharing the title; a Shopify variant ID that contradicts its own selected URL is rejected. Cross-store identity requires a shared GTIN or matching brand and MPN, together with the selected attributes. Merchant-local IDs are not compared across stores.

Explicitly allowed alternatives remain labeled research candidates, not confirmed versions of the requested product. Continuing the request retains the URL identity; correcting or replacing the product releases that identity while other requirements follow the existing continuation rules. To change options on a verified same-item offer from another store, inspection must return one matching variant from the actual selected merchant and parent product. Inspecting an alternative cannot silently replace the original target.

Shopify and WooCommerce identity anchors are private server state, not model-supplied search fields. WooCommerce snapshots now validate and persist the original merchant, product, selected variation and URL binding; old snapshots without anchors remain readable, and another task cannot read them. Public MCP contracts verify recovery across two server instances; final-package native acceptance remains pending. See the [URL identity and snapshot recovery record](docs/engineering/changes/2026-09-09-shopify-url-identity-followup.md).

Explicit non-price requirements are hard filters, not ranking hints. The matcher normalizes display size, memory, storage, package count, volume, weight, resolution, refresh rate, power, apparel and shoe size, color, model generation, and compatibility wording. It understands common metric, US customary, and Chinese forms, including equivalent expressions such as `14-inch`, `14"`, and `35.56 cm`, along with minimum, maximum, and approximate requirements. Memory, storage, physical dimensions, quantity, and marketing refresh-rate labels remain separate so that a shared number does not create a false match.

Product searches reject common accessories such as sleeves, hubs, mounts, screen protectors, and replacement earpads when the user asks for the main product. Accessories remain eligible when the request explicitly asks for one. Model and generation tokens must match at their boundaries, so a longer model number cannot pass as a shorter requested model.

Clear product families such as `MacBook Pro` count as identity evidence during category checks. When a query already includes a product family or model, translation does not add a generic category such as `laptop`, `phone`, or `headphones`. A matching product is not rejected simply because its title omits that generic word. The router does not assume that an item is new when the user has not stated a condition. Each result keeps its observed condition label, and `UNKNOWN` remains eligible. An explicit request for new, used, refurbished, open-box, or unknown condition becomes a filter.

Results use three match labels:

- `EXACT` requires strong UPID, GTIN, or brand plus MPN/SKU evidence for the requested variant.
- `DISCOVERY_MATCH` is relevant but does not have enough evidence for a same-product claim.
- `SIMILAR` is an alternative, not the same item.

### Visual product discovery

For an attached product image or screenshot, Codex separates direct observations from lower-confidence inferences. Product family and explicit brand/model remain hard constraints; pixel-inferred neckline, trim, bow, material, seam placement, and silhouette guide ranking unless the user explicitly makes them requirements. `search_visual_candidates` returns at most six safely loaded images for Codex review. If every first-pass candidate visibly conflicts, FindCheap automatically runs one broader metadata search and may return one final labeled set for a second review. No third pass is allowed. Text search continues to use one `search_products` call; Watch and batch checks do not perform image reranking.

The finalizer accepts only candidate IDs from one immutable, ten-minute, single-use visual session. Conflicts exclude candidates; `POSSIBLE_SAME_ITEM` requires at least three distinct matching attributes and `HIGHLY_SIMILAR` requires at least two. Weaker evidence becomes `SAME_STYLE` and is hidden unless the user requested alternatives. This local Codex-assisted flow does not require an external visual model or visual-service credentials.

Visual similarity is not exact product identity. A visual result remains `DISCOVERY_MATCH` or `SIMILAR` unless a stable model, style number, SKU, or GTIN independently confirms identity. If the image lacks one decision-critical detail, the agent asks at most one compact clarification about product type, size, budget, color, or occasion. The matcher is covered by 30 visual-attribute Golden Tasks with a 95% minimum grouping gate; live human-rated screenshot relevance remains a release evaluation metric rather than an automatic identity claim.

### Result reliability

FindCheap Agent keeps product identity, merchant trust, condition, and price evidence separate:

- Match labels describe product identity only. `EXACT` requires strong identity evidence. `DISCOVERY_MATCH` and `SIMILAR` do not prove that two listings are the same product.
- Results use three groups, with caps rather than quotas: requested-brand official matches (2), trusted or qualifying high-rated product matches (3), and trusted matches with comparable-price or confirmed-Coupon savings evidence (3). A product rating above 3.8/5 with at least two reviews can admit a matching product to the second group; it does not verify the merchant or grant primary, best-value or quote eligibility. Other unresolved candidates remain separate research leads. Domains classified as `RISKY` are excluded.
- Approved Awin merchants are eligible for the trusted-match group. Commission never changes product relevance scoring.
- A displayed item price is the value returned by the configured source at observation time. Shipping, tax, mandatory fees, member price, coupons, and delivered total stay unavailable until the relevant merchant evidence or a successful quote provides them. ZIP tax may be labeled as an estimate, and checkout can change the final amount.
- `UNKNOWN` condition means the source did not verify condition. It must not be described as new. For merchants with limited trust evidence, users should check seller identity, returns, and payment protection before buying.

Affiliate commission never affects relevance scoring. Normal discovery stops after enough recommendable results (at most three as its retrieval target), not merely to fill eight cards. Explicit same-product comparison retains its coverage target. A bounded complementary pass rechecks unchanged requirements. Only an explicit server `REQUEST_WEB_SEARCH` action permits requesting Chrome authorization; typed transient source failures may permit independent recovery, but invalid queries, schema/security failures and exhausted budgets cannot be bypassed.

Primary recommendations remain highlighted in their original presentation group so visible ordinal positions and snapshot IDs agree. Unit prices use explicit compatible package quantities; different-product item prices do not produce a misleading same-product savings delta. Product quality is separately reported as source-rated or unknown, never guaranteed by merchant trust. See [implementation and acceptance status](docs/product/shopping-improvement-implementation-2026-09-05.md) for remaining business-validation gates.

## Offer comparison and delivery estimates

The plugin compares offers only when the identity evidence shows that they refer to the same product and variant. Exact matches rank ahead of discovery results and similar alternatives.

`compare_selected_products` builds a real 2–4 column view from stable `selectionId` values in one live search snapshot. The server determines whether the entries are verified same-product offers or different product choices. It also generates every comparison fact, unknown value, limitation, comparable price basis, price delta, and recommended selection. The model cannot submit product facts, pros, cons, prices, or a recommendation ID. Item prices and delivered totals are never mixed in one price comparison.

Each result can include:

- merchant and product name
- verified public item price
- image and canonical merchant link
- stock signal and product condition
- model, SKU, GTIN, or variant evidence
- observation time and source status

Search and Coupon research use public item prices; providing a ZIP alone does not create a cart or authorize a quote. Selected-product quotes require a trusted, stable product reference and actual MCP host form acceptance for that single item or 2–4-item batch. Missing, declined, cancelled, timed-out, stale, or forged approval causes no Cart request. The reviewed Shopify Storefront `2026-07` Cart operations create an anonymous Cart and select a delivery option, not an order, payment, or inventory reservation. The runtime verifies the returned API version, exact variant, quantity, and ordinary non-subscription line before accepting totals. Review expires before July 2027; different request shapes require a new review. These controls are automatically tested with simulated hosts and offline transports; real Codex approval UI and merchant results remain separate acceptance gates in the [Agent design](docs/architecture/agent-design.md#11-v01722-基线与本地实现差距).

Shopify tax is used only when the merchant returns `totalTaxAmount`; otherwise a labeled ZIP-based state/local average estimate may be shown, not checkout tax. Only verified free shipping is `$0.00`. The bounded flow does not request carrier-rate calculation, full addresses, checkout, bundles, subscriptions, or transformed variants. Unsupported merchant responses remain item-price-only, and checkout can change the final amount.

Follow-up questions reuse the selected result's `renderId` and stable product identity. Native Shopify cards use their Variant ID. Supported Awin merchant pages resolve the exact prior merchant product path to one Shopify Variant before creating a quote. The plugin never searches the title again, so item price, shipping, and tax stay attached to the same selected product.

## Product cards

Codex can display up to eight results as interactive cards inside the conversation: at most 2 verified official-store matches, 3 trusted exact or similar matches, and 3 best-value high-match options. Cards show merchant trust evidence, image, merchant, price, model or SKU when available, identity evidence, variants, condition, availability, observation time, and a button to open the merchant page. Product cards stay bound to the search or selected-variant quote that produced them.

The complete text result remains available when a Codex client cannot display the card interface.

## Verified deals

The Coupon and promotion path fails closed. It returns a Coupon, promo code, membership offer, Cashback offer, or offline Coupon only when a configured Deals API supplies current evidence.

Without that evidence, the plugin reports the deal source as unavailable. It does not invent codes, discounts, expiration dates, or Cashback rates.

The default plugin exposes unified product search, product cards, evidence-backed product comparison, current deal checks, and Watch tools. The retired Commerce-platform comparison is still excluded; the active comparison is generated directly from immutable FindCheap search snapshots. The standalone verified Deals tool appears only when its complete provider URL and token are configured.

## Current deal check

After selection, the deal checker keeps that product and variant identity and checks item price, inventory, and verified merchant deal candidates. It never searches the title again or creates a Cart; a separate explicit quote and one-time host approval are required for delivered-price evidence.

Price-history collection and buy-or-wait forecasting are disabled. A merchant promotion remains a candidate until the merchant confirms product eligibility and stacking.

Codex creates a recurring Watch only after the user explicitly asks to be notified or monitored.

## Shopping watches

### Task history

On Codex stdio connections with trusted host task metadata, `get_shopping_history` restores saved requirements, original selection/comparison references and historical observations after restart. It does not refresh prices, stock, expired quote references or web permissions. Explicitly requested `clear_shopping_history` clears only this task's shopping history; Watch rules and host schedules are separate.

Local storage uses `shopping-state-v1.sqlite` and `task-watches-v1/<task-id>` beneath `FINDCHEAP_STATE_DIR` (default `~/.findcheap-agent/watches-v1`). History retention is 30 days, at most 8 MiB per task and 500 task records including revision tombstones. It does not store chat transcripts, raw reference images or authorization tokens. Connections without trusted task metadata retain connection-local shopping state. Corruption, capacity exhaustion and concurrent-write conflicts return an error instead of silently losing or overwriting history. Automatic cleanup on task deletion awaits an authoritative host deletion receipt; explicit history clearing is available.

Users can ask Codex to monitor a product and notify them when:

- the price falls below a target
- a verified Coupon or promotion appears
- an item returns to stock
- a requested size, color, or variant is restocked

Scheduling and notifications use native Codex Automation. New records are isolated by trusted Codex task metadata. Binding an Automation ID still records only a local scheduling reference. Confirmed task archive pauses local work and records any required stop; unarchive does not resume it. Unknown host state prevents new or executing task-bound Watch work. The plugin persists rules and observations with revision-checked atomic saves and crash-released locks. A verified restock completes once with a stable event and recoverable historical notification payload; later checks do no source work. Actual notification delivery and host stopping remain unverified acceptance gates.

**Upgrade compatibility:** pre-v0.18.4 Watch records without trusted task ownership remain in their original directory. A new task-bound connection cannot claim them using a Watch ID. Their existing host schedules are not automatically stopped or migrated; verified ownership reconciliation is still required. Do not create duplicate schedules to bypass this restriction.

Price thresholds are exclusive. A request for "below $40" stores `4000` cents and triggers at `$39.99`, not `$40.00`. Item-price monitoring remains available. Delivered-total Watch is currently refused before ZIP/reference clarification: one-time Cart approval does not authorize recurring mutations. Legacy delivered-total records remain readable but cannot request quotes.

Pause/delete disable local work first. A bound rule retains a minimal `STOP_REQUIRED` handoff, including after deletion; the real host must verify ownership/scope before stopping its Automation. No host ACK is fabricated. Pending stops, completed/expired rules, and unreconciled legacy rules cannot resume. Older unbound records remain `LEGACY_UNVERIFIED` and can still be stopped locally. New rules default to 30 days; deduplication does not extend the deadline.

Example requests:

```text
Watch AirPods Pro and notify me when the verified item price falls below $170.
```

```text
Tell me when this jacket is back in stock in black, size M.
```

## Affiliate status

Production uses the private Awin Feed List for publisher `3047955` to discover every `Joined`, US,
English Feed. The Railway service serves the last valid snapshot immediately, then refreshes in the
background. It downloads only Feeds whose `Last Imported` value changed, retries failures per Feed,
and falls back to that Feed's last valid cache. Newly joined programmes become searchable without
adding another source URL or product-category rule.
Only links that carry this publisher ID and the row's merchant ID are returned, with an affiliate disclosure.

Feed rows provide item price, availability, and merchant product ID; GTIN, MPN, brand, and condition may be absent. Results remain `DISCOVERY_MATCH`, `DISCOVERY_ONLY`, and `condition: UNKNOWN`, not exact comparisons. A safely resolved prior merchant path and Shopify Variant can be quoted only after an explicit request, ZIP, and one-time host form approval; otherwise it remains item-price-only. Coupons and member price require separate verification. Other sources retain canonical merchant links unless their approved relationship is configured. Commission never affects ranking.

See [Awin Product Feed production deployment](docs/product/awin-feed-deployment.md) for the scheduled downloader, persistent volume, authenticated endpoint, and required secrets.

## Install

### Windows one-click installer

[Download `Install-FindCheap-Agent.cmd`](https://github.com/yyq8548/FindCheap-Agent/raw/refs/heads/main/installers/windows/Install-FindCheap-Agent.cmd), double-click it, then restart Codex and open a new task. The installer adds or updates the marketplace, installs the latest plugin from `main`, and configures an official portable Node.js 24 runtime when required. It never requests affiliate, merchant, payment, or account credentials.

### Manual install

Requirements: Codex desktop or CLI and Node.js 24.

```powershell
codex plugin marketplace add yyq8548/FindCheap-Agent --ref main
codex plugin add findcheap-agent@findcheap-agent
```

Restart Codex, open a new task, and try:

```text
FindCheap Agent, search for DÔEN dresses and show product cards.
```

See [sharing and installation](docs/product/findcheap-agent-share-package.md) for testing and update instructions.

## Repository map

- `plugins/findcheap-agent/` contains the distributable Codex plugin.
- `apps/mcp-server/` contains the local MCP server and product card resource.
- `apps/awin-feed-service/` contains the active Railway catalog, registry, and affiliate service.
- `archive/commercial-platform/` preserves the retired Commerce and ingestion data plane outside active builds.
- `packages/registry-builder/` and `scripts/registry-builder.ts` collect registry candidates, record evidence, require explicit review, and publish approved Railway PostgreSQL snapshots.
- `docs/product/` contains deployment, data-source, Coupon, Watch, and affiliate runbooks.

Registry expansion never turns an Awin relationship or technical storefront response into merchant trust. See [Registry Builder](docs/product/registry-builder.md).

The unified router uses eligible configured sources; bounded Chrome recovery follows server eligibility and host consent. See the Agent design for target behavior and current gaps.

### Optional WooCommerce catalog

WooCommerce joins the existing Backend search, visual candidates, comparisons, selected-product inspection, deals and item-price/stock Watch. Its Store API is per merchant: FindCheap supplies the access registry and aggregation. Registration or a WooCommerce platform key is not required for public product GETs; merchant access restrictions still apply.

The v0.18.6 access table contains **1,003 storefronts**. Hidden Secrets Wigs adds standard, priced color variants; GR-Research's headphone metadata and Orleans Coffee's canonical origin are corrected. The earlier Recool Hair and Silent Sound System additions still expose extra options whose final price/stock cannot be established by their Store API, so those fields remain UNKNOWN. These additions receive no automatic official, trusted-retailer or affiliate status. Relevant stores are preferred; unrelated exploration is limited to two per round. The count does not mean every store is queried or Sony products are covered. See the [current coverage evidence](docs/engineering/changes/2026-09-09-woo-coverage-followup.md), [earlier two-store evidence](docs/engineering/changes/2026-09-09-woo-priority-admission.json) and [1,000-store baseline](docs/engineering/changes/2026-09-08-woocommerce-expansion-1000-data.md).

Search selects at most six merchants per pass, with at most two Woo passes per Backend search. It does not scan all 1,000 stores. Coverage, stock, price and local-delivery limits remain visible; USD pricing does not guarantee delivery to a particular address. Product links and selected attributes must agree with the exact product and variant; incomplete choices cannot supply a confirmed price. Woo Cart and checkout remain unsupported.

The source service remains disabled unless `WOOCOMMERCE_SOURCE_ENABLED=true`. The distributed plugin config points `WOOCOMMERCE_API_BASE_URL` to the public FindCheap source gateway; standalone MCP processes can supply a compatible HTTPS origin. An explicit MCP `WOOCOMMERCE_SOURCE_ENABLED=false` also disables this source. No checkout, account or administrative credentials are needed. Setup, response budgets and rollback are in the [WooCommerce runbook](docs/product/woocommerce-source-setup.md); production and cache rollout status is recorded in the [current release](docs/releases/v0.18.7.md).
