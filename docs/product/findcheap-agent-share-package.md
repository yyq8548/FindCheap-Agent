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
- version: `0.8.6`

Test prompt:

```text
FindCheap Agent 搜索 DÔEN dress，显示三个商品卡片
```

Expected behavior: one unified product search, one immutable product-card render, at most three
cards, no Memory or repository scan, and no Chrome fallback when API results exist.

Approved Awin Feed test prompt:

```text
FindCheap Agent 搜索 Amazonliss keratin mask
```

Expected behavior: one `search_products` call reading configured sources; up to three relevant
cards with explicit identity and condition labels. See `docs/product/awin-feed-deployment.md` for
production Feed setup.

Haircare category routing test prompt:

```text
FindCheap Agent 搜索角蛋白发膜
```

Expected behavior: translate the category into concise English and call `search_products` once.
Source routing stays internal; commercial relationships never affect ranking.

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
