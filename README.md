# FindCheap Agent

Product form: **Codex Plugin Agent**.

FindCheap Agent is a Codex plugin for finding products, checking whether offers refer to the same item, and comparing verified public prices. It returns up to three options with product images, merchant links, match labels, condition, availability, and the evidence used to rank them.

Codex calls a local stdio MCP server for catalog search, matching, ranking, product cards, deals, and watch rules. An authorized Chrome skill handles the bounded fallback search when the catalog has no usable result.

The agent is read only. It does not order, check out, or submit payment.

## What it can do

### Search for products

The agent searches Shopify Global Catalog across eligible merchants. It understands common product details such as brand, model, SKU, GTIN, color, size, and capacity.

Results are classified as `EXACT`, `DISCOVERY_MATCH`, or `SIMILAR`. `EXACT` requires strong UPID, GTIN, or brand-plus-MPN/SKU evidence with the requested variant. Keyword matches remain discovery results instead of being presented as the same product.

When the catalog returns no usable result, the agent can use a user authorized Chrome session for a bounded, read only search of public merchant pages. Chrome is a fallback, not the default search path.

### Compare offers

The agent compares offers only when the available identity evidence indicates that they are the same product and variant. Exact matches rank ahead of similar alternatives.

Each result can include:

- merchant and product name
- verified public item price
- product image and canonical merchant link
- stock signal and product condition
- model, SKU, GTIN, or variant evidence
- observation time and source status

Without a ZIP, the result is the public item price. With a US ZIP, v0.6.11 may create a short-lived anonymous Shopify cart and separate item price, selected shipping, tax, and estimated total. When a user selects a product from an earlier result, `quote_selected_shopify_product` reuses that card's exact `renderId` and Shopify `variantId`; it never searches the title again. Free delivery is shown as `$0.00`. Shopify `totalTaxAmount` is used only when explicitly returned; otherwise the card shows a ZIP-inferred 2026 state-plus-average-local tax estimate. Some merchants require a full address or checkout before calculating final tax. Merchants that do not support Cart quoting remain item-price-only. Product cards are bound directly to the Shopify search or selected-variant quote result.

The default plugin advertises only working Shopify, card, and product-Watch tools. Commerce comparison and verified Deals tools are added automatically only when their complete provider URL and token are configured. This keeps model tool selection focused without removing future commercial integrations.

### Show product cards

Codex can render the top results as interactive product cards grouped into exact matches, discovery matches, and similar options. Each card shows the image, merchant, price, identity evidence, model/SKU when available, variants, condition, availability, observation time, and a button that opens the merchant's product page.

The complete text result remains available when a Codex client cannot display the card interface.

### Find verified deals

The plugin has a fail closed Coupon and promotion path. It can return a code, promotion, membership offer, Cashback offer, or offline Coupon only when a configured Deals API provides current evidence.

Without that evidence, the agent reports the deal as unavailable. It does not invent codes, savings, or Cashback rates.

### Create persistent Watch reminders

Users can ask Codex to watch a product and notify them when a condition is met. Supported watch conditions include:

- price falls below a target
- a promotion or verified Coupon appears
- inventory returns
- a specific size, color, or variant is restocked

Scheduling and notifications use native Codex Automation. v0.6.0 stores the Automation ID with the Watch and does not report monitoring as active until that binding succeeds. The plugin persists the rule, last observation, and transition state across MCP restarts so it can report a change once instead of repeating the same alert.

Pause, resume, and delete synchronize the bound Automation and Watch rule. Existing pre-v0.6.0 rules remain runnable but are labeled `LEGACY_UNVERIFIED` until their Automation ID is reconciled.

Example requests:

```text
Watch AirPods Pro and notify me when the verified item price falls below $170.
```

```text
Tell me when this jacket is back in stock in black, size M.
```

## Affiliate status

Affiliate tracking is not connected yet.

Product cards currently use ordinary canonical merchant links. FindCheap Agent does not claim an affiliate relationship, add tracking parameters, report commission, or promise Cashback. The repository includes a guarded Affiliate ready boundary, but it stays disabled until a merchant or network approves the relationship and supplies the required credentials.

Affiliate status does not influence search or ranking.

## Current limits

- Search coverage depends on Shopify Global Catalog and the public pages available to the authorized Chrome fallback.
- A product marked `DISCOVERY_MATCH` is relevant but lacks independently verified same-product identity.
- A product marked `SIMILAR` is an alternative, not the same item.
- `UNKNOWN` condition does not mean new.
- Stock signals and item prices can change after the observation time.
- ZIP-specific Shopify Cart shipping and total estimates are best effort; unsupported merchants remain item-price-only.
- Tax and mandatory fees are never independently calculated or invented, and membership prices remain unavailable.
- The agent cannot check out, purchase, reserve inventory, or pay.
- Watch runs require Codex Automation and a currently available verified source. Automated checks never use Chrome.

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

## Project structure

- `plugins/findcheap-agent/` contains the distributable Codex plugin.
- `apps/mcp-server/` contains the local MCP server and product card resource.
- `apps/commerce-api/` contains the audited comparison API.
- `apps/ingestion-worker/` contains merchant ingestion and watch state processing.
- `docs/product/` contains deployment, data source, Coupon, Watch, and Affiliate runbooks.

The Commerce API path fails closed when no merchant has passed its audit gate. Shopify Global Catalog remains the primary product discovery source, and user authorized Chrome remains the zero result fallback.
