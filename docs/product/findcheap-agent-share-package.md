# FindCheap Agent GitHub Beta

This repository is the distributable GitHub marketplace for **FindCheap Agent**.

## Install

Requirements:

- Codex desktop or Codex CLI
- Node.js 22 available as `node`
- Internet access for Shopify Global Catalog and product images

```powershell
codex plugin marketplace add yyq8548/FindCheap-Agent --ref main
codex plugin add findcheap-agent@findcheap-agent
```

Restart Codex and create a new task so the new skills and MCP tools load.

## Verify

Open the Plugins Directory and confirm:

- marketplace: `FindCheap Agent`
- plugin: `FindCheap Agent`
- plugin ID: `findcheap-agent`
- version: `0.8.1`

Test prompt:

```text
FindCheap Agent 搜索 DÔEN dress，显示三个商品卡片
```

Expected behavior: one Shopify Global Catalog search, one immutable product-card render, at most
three product cards, and no Chrome fallback when API results exist.

Approved Awin Feed test prompt:

```text
FindCheap Agent 搜索 Amazonliss keratin mask
```

Expected behavior: one `search_awin_products` call reading the authenticated remote Feed when
`AWIN_PRODUCT_FEED_URL` is configured, otherwise `datafeed_3047955.csv.gz` from Downloads; up to
three `DISCOVERY_MATCH` results with `condition: UNKNOWN`, disclosed approved Awin links, and no
Shopify or Chrome call. See `docs/product/awin-feed-deployment.md` for production setup.

Haircare category routing test prompt:

```text
FindCheap Agent 搜索角蛋白发膜
```

Expected behavior: translate the hair-specific category into a concise English Feed query and call
`search_awin_products` first. Return only relevant Awin results when present; use Shopify once only
after a complete zero-result Feed response. Never merge the two sources or rank by commission.

## Update

```powershell
codex plugin marketplace upgrade findcheap-agent
codex plugin add findcheap-agent@findcheap-agent
```

Restart Codex and test in a new task.

## Current limits

- Without a ZIP, Shopify results are item-price-only. With a US ZIP, supported merchants may
  return a short-lived Shopify Cart shipping and total estimate; unsupported merchants fail back
  to item-price-only.
- Shopify tax is used only when explicitly returned. Otherwise tax is a labeled ZIP-inferred 2026
  state-average estimate; some merchants need a full address or checkout for final tax.
- Coupon and Cashback require a configured approved Deals API.
- Amazonliss (US) Awin Feed links use the approved publisher/merchant relationship with disclosure.
  Other sources remain canonical until their own relationship is approved.
- The plugin never orders, checks out, submits payment, or auto-buys.
