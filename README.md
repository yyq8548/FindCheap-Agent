# FindCheap Agent

[![Latest release](https://img.shields.io/github/v/release/yyq8548/FindCheap-Agent?label=release)](https://github.com/yyq8548/FindCheap-Agent/releases/latest)
[![Plugin CI](https://github.com/yyq8548/FindCheap-Agent/actions/workflows/ci.yml/badge.svg)](https://github.com/yyq8548/FindCheap-Agent/actions/workflows/ci.yml)

English | [简体中文](README.zh-CN.md)

Product form: **Codex Plugin Agent**.

Current package: **v0.17.22** — model-visible context receipts keep clarification,
selection, comparison and authorized recovery bound to the original goal. See the
[release scope and known limits](docs/releases/v0.17.22.md).

FindCheap Agent is a read-only Codex plugin for product search, offer matching, price checks, product cards, evidence-backed comparison views, verified deals, and shopping watches. It returns up to eight products in three tiers: 2 official-store matches, 3 trusted matches, and 3 best-value high-match options.

Codex calls one public `search_products` tool through a local stdio MCP server. The router searches eligible Awin, Shopify, eBay, and verified official-store sources, then ranks qualifying products by product relevance and merchant tier. It automatically runs one broader internal search when the first pass cannot fill the requested cards. It offers an authorized bounded Chrome search only after both API passes return no usable verified product.

The plugin does not order, check out, or submit payment. It also does not reserve inventory.

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

Add a ZIP code when you want available shipping, tax, and estimated-total details:

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

For a follow-up quote, refer to a result by its number or choose it from the card. FindCheap Agent reuses the original product and variant instead of searching its title again. Stable selections remain available for up to two hours in the active MCP process; the cache keeps at most 128 recent search snapshots and asks for a new search after expiry.

## Product search

The plugin uses one constrained search request with parallel, eligible Awin, Shopify, eBay and known official sources. Source-specific short queries preserve identity anchors; all final results must still satisfy the original category, variant, budget and required-feature checks. A query compiler separates retrieval wording from eligibility, and typed failures distinguish local invalid queries, source rejection, timeout, rate limiting, schema and security errors.

Continuations bind an explicit `parentRenderId` or server-issued `goalId` plus exact `goalRevision`. Requirements and prior candidates are rechecked without mutating old cards or treating old prices as fresh observations. Correcting product identity does not silently withdraw unrelated requirements. No global latest-result lookup or persistent product catalog is used.

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
- Results use three recommendation groups, with caps rather than quotas: requested-brand official matches (2), independently reviewed or manually verified approved-Awin matches (3), and trusted matches with comparable-price or confirmed-Coupon savings evidence (3). Unverified merchants and missing hard evidence belong in a separate collapsed research group, never a purchase recommendation. Ratings do not establish merchant trust. Domains classified as `RISKY` are excluded.
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

Without a ZIP code, prices are public item prices. With a US ZIP, the plugin may create a short-lived anonymous Shopify cart and display item price, selected shipping, tax, and estimated total separately. Free delivery appears as `$0.00`.

Shopify tax is used only when the merchant returns `totalTaxAmount`. Otherwise, the card can show a ZIP-based state and average local tax estimate. That estimate is not checkout tax. Some merchants require a full address or checkout before they return shipping or tax. Merchants that do not support Cart quoting remain item-price-only.

Follow-up questions reuse the selected result's `renderId` and stable product identity. Native Shopify cards use their Variant ID. Supported Awin merchant pages resolve the exact prior merchant product path to one Shopify Variant before creating a quote. The plugin never searches the title again, so item price, shipping, and tax stay attached to the same selected product.

## Product cards

Codex can display up to eight results as interactive cards inside the conversation: at most 2 verified official-store matches, 3 trusted exact or similar matches, and 3 best-value high-match options. Cards show merchant trust evidence, image, merchant, price, model or SKU when available, identity evidence, variants, condition, availability, observation time, and a button to open the merchant page. Product cards stay bound to the search or selected-variant quote that produced them.

The complete text result remains available when a Codex client cannot display the card interface.

## Verified deals

The Coupon and promotion path fails closed. It returns a Coupon, promo code, membership offer, Cashback offer, or offline Coupon only when a configured Deals API supplies current evidence.

Without that evidence, the plugin reports the deal source as unavailable. It does not invent codes, discounts, expiration dates, or Cashback rates.

The default plugin exposes unified product search, product cards, evidence-backed product comparison, current deal checks, and Watch tools. The retired Commerce-platform comparison is still excluded; the active comparison is generated directly from immutable FindCheap search snapshots. The standalone verified Deals tool appears only when its complete provider URL and token are configured.

## Current deal check

After the user selects a product card, the deal checker keeps that stable product and variant identity. It checks current item price, inventory, current verified merchant deal candidates, and optional ZIP delivered-price evidence. It never searches the selected title again.

Price-history collection and buy-or-wait forecasting are disabled. A merchant promotion remains a candidate until the merchant confirms product eligibility and stacking.

Codex creates a recurring Watch only after the user explicitly asks to be notified or monitored.

## Shopping watches

Users can ask Codex to monitor a product and notify them when:

- the price falls below a target
- a verified Coupon or promotion appears
- an item returns to stock
- a requested size, color, or variant is restocked

Scheduling and notifications use native Codex Automation. A watch becomes active only after its Automation ID is bound successfully. The plugin persists the rule, last observation, and transition state across MCP restarts, which prevents repeated alerts for the same observation.

Price thresholds are exclusive. A request for "below $40" stores `4000` cents and triggers at `$39.99`, not `$40.00`.

Pause, resume, and delete operations synchronize the Automation and Watch rule. Older rules without a verified Automation binding are labeled `LEGACY_UNVERIFIED` until they are reconciled.

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

Feed rows always provide item price, availability, and merchant product ID; GTIN, MPN, brand, and condition may be absent. Results remain `DISCOVERY_MATCH`, `DISCOVERY_ONLY`, and `condition: UNKNOWN`; they are not exact or same-product comparisons. When an exact prior merchant product path safely resolves to one supported Shopify Variant, a ZIP follow-up can show selected shipping, tax, and estimated total. Otherwise the result remains item-price-only. Coupons and member price remain unavailable unless separately verified. Other product sources keep canonical merchant links unless their own approved relationship is configured. Commission never affects ranking.

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

The unified router uses approved affiliate sources and Shopify Global Catalog, while authorized Chrome remains a complete-zero-result fallback.
