# FindCheap Agent

[![Latest release](https://img.shields.io/github/v/release/yyq8548/FindCheap-Agent?label=release)](https://github.com/yyq8548/FindCheap-Agent/releases/latest)
[![Plugin CI](https://github.com/yyq8548/FindCheap-Agent/actions/workflows/ci.yml/badge.svg)](https://github.com/yyq8548/FindCheap-Agent/actions/workflows/ci.yml)

English | [简体中文](README.zh-CN.md)

Product form: **Codex Plugin Agent**.

FindCheap Agent is a read-only Codex plugin for product search, offer matching, price checks, product cards, verified deals, and shopping watches. It returns up to three products with images, merchant links, price evidence, match labels, condition, and availability.

Codex calls one public `search_products` tool through a local stdio MCP server. The router considers relevant products from approved affiliate programs first, fills remaining slots from Shopify Global Catalog, and automatically runs one broader internal search when the first pass cannot fill the requested cards. It offers an authorized bounded Chrome search only after both API passes return no usable verified product.

The plugin does not order, check out, or submit payment. It also does not reserve inventory.

## Usage

Call FindCheap Agent directly in Codex:

```text
@FindCheap Agent search for Sony WH-1000XM6 and show three product cards.
```

Or ask in plain language after enabling the plugin:

```text
Find me three trusted offers for AirPods Pro 2.
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

For a follow-up quote, refer to a result by its number or choose it from the card. FindCheap Agent reuses the original product and variant instead of searching its title again.

## Product search

The plugin uses one constrained search request across its eligible sources. Products from joined Awin programmes are considered for every product category when they satisfy the requested identity, condition, required features, availability, and price limits. Shopify Global Catalog fills remaining slots. Supported Chinese product terms are translated while identity and variant details remain unchanged.

Explicit non-price requirements are hard filters, not ranking hints. The matcher normalizes display size, memory, storage, package count, volume, weight, resolution, refresh rate, power, apparel and shoe size, color, model generation, and compatibility wording. It understands common metric, US customary, and Chinese forms, including equivalent expressions such as `14-inch`, `14"`, and `35.56 cm`, along with minimum, maximum, and approximate requirements. Memory, storage, physical dimensions, quantity, and marketing refresh-rate labels remain separate so that a shared number does not create a false match.

Product searches reject common accessories such as sleeves, hubs, mounts, screen protectors, and replacement earpads when the user asks for the main product. Accessories remain eligible when the request explicitly asks for one. Model and generation tokens must match at their boundaries, so a longer model number cannot pass as a shorter requested model.

Clear product families such as `MacBook Pro` count as identity evidence during category checks. When a query already includes a product family or model, translation does not add a generic category such as `laptop`, `phone`, or `headphones`. A matching product is not rejected simply because its title omits that generic word. The router does not assume that an item is new when the user has not stated a condition. Each result keeps its observed condition label, and `UNKNOWN` remains eligible. An explicit request for new, used, refurbished, open-box, or unknown condition becomes a filter.

Results use three match labels:

- `EXACT` requires strong UPID, GTIN, or brand plus MPN/SKU evidence for the requested variant.
- `DISCOVERY_MATCH` is relevant but does not have enough evidence for a same-product claim.
- `SIMILAR` is an alternative, not the same item.

### Visual product discovery

For an attached product image or screenshot, Codex extracts only visible product type, brand or logo text, model/style clues, color, material, pattern, silhouette, and length. The same `search_products` router searches eligible sources and keeps results in three visibly separate groups: `POSSIBLE_SAME_ITEM`, `HIGHLY_SIMILAR`, and `SAME_STYLE`.

Visual similarity is not exact product identity. A visual result remains `DISCOVERY_MATCH` or `SIMILAR` unless a stable model, style number, SKU, or GTIN independently confirms identity. If the image lacks one decision-critical detail, the agent asks at most one compact clarification about product type, size, budget, color, or occasion. The v0.12 matcher is covered by 30 visual-attribute Golden Tasks with an 80% minimum grouping gate; live human-rated screenshot relevance remains a release evaluation metric rather than an automatic identity claim.

### Result reliability

FindCheap Agent keeps product identity, merchant trust, condition, and price evidence separate:

- Match labels describe product identity only. `EXACT` requires strong identity evidence. `DISCOVERY_MATCH` and `SIMILAR` do not prove that two listings are the same product.
- Normal discovery orders merchants in three tiers. Independently reviewed official, authorized, or established retailers and approved Awin programs come first. Shopify products rated above `3.8` with at least `2` reviews come next when the merchant has not been independently verified. Other relevant merchants may appear last with a limited-trust warning. A product rating does not verify the merchant. Domains classified as `RISKY` are excluded.
- Awin approval confirms the configured affiliate program and link path. It is not an independent endorsement of the merchant or product. Commission does not affect relevance or ranking.
- A displayed item price is the value returned by the configured source at observation time. Shipping, tax, mandatory fees, member price, coupons, and delivered total stay unavailable until the relevant merchant evidence or a successful quote provides them. ZIP tax may be labeled as an estimate, and checkout can change the final amount.
- `UNKNOWN` condition means the source did not verify condition. It must not be described as new. For merchants with limited trust evidence, users should check seller identity, returns, and payment protection before buying.

Affiliate commission never affects routing or ranking. `LOWEST_PRICE` compares qualifying item prices across sources; normal discovery preserves merchant diversity. If the first routed pass cannot fill the requested cards, the plugin runs one feature-enriched, larger-pool API search and reapplies the original hard constraints and merchant checks. Expanded results remain `DISCOVERY_MATCH` unless exact identity evidence exists. Chrome is offered only after the expanded pass also returns no usable product; partial coverage and source errors fail closed.

## Offer comparison and delivery estimates

The plugin compares offers only when the identity evidence shows that they refer to the same product and variant. Exact matches rank ahead of discovery results and similar alternatives.

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

Codex can display the top results as interactive cards inside the conversation. Cards are grouped by merchant trust and match quality. They show merchant trust evidence, image, merchant, price, model or SKU when available, identity evidence, variants, condition, availability, observation time, and a button to open the merchant page. Product cards stay bound to the search or selected-variant quote that produced them.

The complete text result remains available when a Codex client cannot display the card interface.

## Verified deals

The Coupon and promotion path fails closed. It returns a Coupon, promo code, membership offer, Cashback offer, or offline Coupon only when a configured Deals API supplies current evidence.

Without that evidence, the plugin reports the deal source as unavailable. It does not invent codes, discounts, expiration dates, or Cashback rates.

The default plugin exposes unified product search, product cards, current deal checks, and Watch tools. Commerce comparison and the standalone verified Deals tool appear only when their complete provider URL and token are configured.

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
English Feed. The Railway service downloads and validates every matching Feed on startup and every
six hours, so newly joined programmes become searchable without adding another source URL or product-category rule.
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
FindCheap Agent, search for DÔEN dresses and show three product cards.
```

See [sharing and installation](docs/product/findcheap-agent-share-package.md) for testing and update instructions.

## Repository map

- `plugins/findcheap-agent/` contains the distributable Codex plugin.
- `apps/mcp-server/` contains the local MCP server and product card resource.
- `apps/commerce-api/` contains the audited comparison API.
- `apps/ingestion-worker/` contains merchant ingestion and watch state processing.
- `docs/product/` contains deployment, data-source, Coupon, Watch, and affiliate runbooks.

The Commerce API fails closed until a merchant passes its audit gate. The unified router uses approved affiliate sources and Shopify Global Catalog, while authorized Chrome remains a complete-zero-result fallback.
