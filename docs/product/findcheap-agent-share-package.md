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
- version: `0.6.9`

Test prompt:

```text
FindCheap Agent 搜索 DÔEN dress，显示三个商品卡片
```

Expected behavior: one Shopify Global Catalog search, one immutable product-card render, at most
three product cards, and no Chrome fallback when API results exist.

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
- Affiliate links remain canonical merchant links until a relationship is approved.
- The plugin never orders, checks out, submits payment, or auto-buys.
