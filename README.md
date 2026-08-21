# FindCheap Agent

[![Latest release](https://img.shields.io/github/v/release/yyq8548/FindCheap-Agent?label=release)](https://github.com/yyq8548/FindCheap-Agent/releases/latest)
[![Plugin CI](https://github.com/yyq8548/FindCheap-Agent/actions/workflows/ci.yml/badge.svg)](https://github.com/yyq8548/FindCheap-Agent/actions/workflows/ci.yml)

FindCheap Agent is a read-only Codex plugin for product search, offer matching, price checks, product cards, verified deals, and shopping watches. It returns up to three products with images, merchant links, price evidence, match labels, condition, and availability.

Codex calls the plugin through a local stdio MCP server. Shopify Global Catalog is the primary product source. If the catalog returns no usable product, the user can authorize a bounded Chrome search of public merchant pages.

The plugin does not order products, reserve inventory, check out, or submit payment.

## Product search

The plugin searches Shopify Global Catalog across eligible merchants. It preserves details such as brand, model, SKU, GTIN, color, size, and capacity. Supported Chinese product terms are translated while identity and variant details remain unchanged.

Results use three match labels:

- `EXACT` requires strong UPID, GTIN, or brand plus MPN/SKU evidence for the requested variant.
- `DISCOVERY_MATCH` is relevant but does not have enough evidence for a same-product claim.
- `SIMILAR` is an alternative, not the same item.

Exact merchant domains can be labeled `OFFICIAL`, `AUTHORIZED_RETAILER`, `ESTABLISHED_RETAILER`, `UNKNOWN`, or `RISKY` when checked-in evidence supports the label. Trusted merchants rank before price. Unknown merchants are shown separately and do not fill the top three when trusted results are available. Risky hosts are excluded. Affiliate status never affects ranking.

If the first catalog request returns no usable product, the plugin may run one bounded relaxed request. Relaxed results remain `DISCOVERY_MATCH`. If Shopify still returns nothing, the plugin can offer the authorized Chrome fallback instead of silently changing data sources.

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

Follow-up questions reuse the selected result's `renderId` and Shopify Variant ID. The plugin does not search the title again, so product price, shipping, and tax stay attached to the same variant.

## Product cards

Codex can display the top results as interactive cards inside the conversation. Cards are grouped by merchant trust and match quality. They show merchant trust evidence, image, merchant, price, model or SKU when available, identity evidence, variants, condition, availability, observation time, and a button to open the merchant page. Product cards stay bound to the search or selected-variant quote that produced them.

The complete text result remains available when a Codex client cannot display the card interface.

## Verified deals

The Coupon and promotion path fails closed. It returns a Coupon, promo code, membership offer, Cashback offer, or offline Coupon only when a configured Deals API supplies current evidence.

Without that evidence, the plugin reports the deal source as unavailable. It does not invent codes, discounts, expiration dates, or Cashback rates.

The default plugin exposes working Shopify, product-card, and Watch tools. Commerce comparison and verified Deals tools appear only when their complete provider URL and token are configured.

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

Affiliate tracking is not connected yet.

Product cards use canonical merchant links. FindCheap Agent does not claim an affiliate relationship, add tracking parameters, report commission, or promise Cashback. The repository contains guarded affiliate infrastructure, but it remains disabled until a merchant or network approves the relationship and supplies the required credentials.

## Current limits

- Coverage depends on Shopify Global Catalog and the public pages available to the authorized Chrome fallback.
- Shopify Global Catalog does not provide an official-seller flag. Merchant trust uses exact domains with checked-in independent evidence. Other merchants remain `UNKNOWN`.
- `UNKNOWN` condition does not mean new.
- Stock and prices can change after the observation time.
- Shipping and total estimates are best effort. Unsupported merchants remain item-price-only.
- ZIP-based tax is an estimate. Final tax and mandatory fees may remain unavailable until checkout.
- Membership prices remain unavailable unless a merchant source verifies them.
- Watch runs require Codex Automation and a currently available verified source. Automated checks never use Chrome.
- The plugin cannot purchase, reserve, check out, or pay.

## Install

Requirements: Codex desktop or CLI and Node.js 22.

```powershell
codex plugin marketplace add yyq8548/FindCheap-Agent --ref main
codex plugin add findcheap-agent@findcheap-agent
```

Restart Codex, open a new task, and try:

```text
FindCheap Agent 搜索 DÔEN dress，显示三个商品卡片
```

See [sharing and installation](docs/product/findcheap-agent-share-package.md) for testing and update instructions.

## Repository map

- `plugins/findcheap-agent/` contains the distributable Codex plugin.
- `apps/mcp-server/` contains the local MCP server and product card resource.
- `apps/commerce-api/` contains the audited comparison API.
- `apps/ingestion-worker/` contains merchant ingestion and watch state processing.
- `docs/product/` contains deployment, data-source, Coupon, Watch, and affiliate runbooks.

The Commerce API fails closed until a merchant passes its audit gate. Shopify Global Catalog remains the primary discovery source, and authorized Chrome remains the zero-result fallback.
