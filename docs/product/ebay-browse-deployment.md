# eBay Browse deployment

FindCheap v0.11.0 keeps eBay as an opt-in source and supports separate Sandbox review and
Production operation. The plugin calls a bounded Railway endpoint; eBay credentials and the EPN
campaign ID never enter the plugin or browser. While `EBAY_BROWSE_ENABLED=false`, the gateway
reports not configured and the router skips eBay without degrading other sources.

## Sandbox review

Use a separate Railway staging environment with an eBay Sandbox keyset:

```dotenv
EBAY_BROWSE_ENABLED=true
EBAY_ENVIRONMENT=SANDBOX
EBAY_CLIENT_ID=REPLACE_WITH_SANDBOX_CLIENT_ID
EBAY_CLIENT_SECRET=REPLACE_WITH_SANDBOX_CLIENT_SECRET
EBAY_MARKETPLACE_ID=EBAY_US
EBAY_BROWSE_TIMEOUT_MS=5000
EBAY_BROWSE_CACHE_SECONDS=60
```

Sandbox mode calls only `api.sandbox.ebay.com`, accepts only sandbox item URLs, ignores any EPN
campaign ID, and never returns affiliate links. Cards label the result as Sandbox review-only.

## Production

Before enabling production traffic, obtain eBay Buy API production access and any EPN approval
required for the product's AI/search-comparison use. Account enrollment alone is not approval for
a special business model.

Configure Railway:

```dotenv
EBAY_BROWSE_ENABLED=true
EBAY_ENVIRONMENT=PRODUCTION
EBAY_CLIENT_ID=REPLACE_WITH_PRIVATE_CLIENT_ID
EBAY_CLIENT_SECRET=REPLACE_WITH_PRIVATE_CLIENT_SECRET
EBAY_EPN_CAMPAIGN_ID=REPLACE_WITH_NUMERIC_CAMPAIGN_ID
EBAY_MARKETPLACE_ID=EBAY_US
EBAY_BROWSE_TIMEOUT_MS=5000
EBAY_BROWSE_CACHE_SECONDS=60
```

Installed clients contain only:

```dotenv
EBAY_PRODUCT_SEARCH_URL=https://findcheap-agent-production.up.railway.app/v1/ebay/search
EBAY_PRODUCT_SEARCH_TIMEOUT_MS=5000
```

The gateway requests an application OAuth token, caches it until shortly before expiry, and calls
Browse `item_summary/search` for EBAY_US fixed-price listings. Requests and responses are bounded;
URLs, USD prices, affiliate campaign IDs, and image hosts are validated before a listing reaches
the MCP server.

eBay remains merchant checkout only. Cards show `merchant: eBay` separately from `sellerName`,
keep the seller unverified, and show this disclosure beside an approved affiliate action:

> As an eBay Partner, FindCheap may be compensated if you make a purchase.

No shipping, tax, fee, delivered total, Watch, checkout, reservation, order, or payment action is
inferred from Browse results.

After deployment, check `GET /health` for `ebayStatus: ready`, then POST one bounded search to
`/v1/ebay/search`. In Production, confirm approved links contain the configured campaign ID. In
Sandbox, confirm no affiliate URL is returned. No credential may appear in health output, logs,
the plugin bundle, or Git history.
