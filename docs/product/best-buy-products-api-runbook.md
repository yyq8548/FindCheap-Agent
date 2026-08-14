# Best Buy Products API pilot

Status: adapter implemented; merchant remains disabled until audit approval.

## What this source provides

The official Products API supplies SKU, title, manufacturer, model number, UPC, image, current item
price, online availability, and a Best Buy product link. It does not provide a verified ZIP-specific
tax total. FindCheap-Agent must not turn the catalog price into a delivered-price quote.

Official references:

- Developer portal and API-key registration: <https://developer.bestbuy.com/>
- Products API documentation: <https://bestbuyapis.github.io/api-documentation/>
- Terms, branding rules, caching restrictions, and rate limits: <https://developer.bestbuy.com/legal>

## Credential handling

Create a Best Buy developer account and API key. Never place the key in YAML, Git, command-line
arguments, logs, evidence, or issue/PR text. Supply it only through the process environment:

```powershell
$env:BEST_BUY_API_KEY='<key from developer.bestbuy.com>'
pnpm merchants:bestbuy-probe -- --query 'Sony WH-1000XM5' --limit 5
pnpm merchants:bestbuy-probe -- --sku 6568600
```

The probe is read-only. It prints sanitized product records and removes `apiKey` from stored source
URLs and evidence. A missing or malformed key fails closed.

## Enablement configuration shape

This example documents shape only. Do not add it under `config/merchants/enabled` or change the
catalog until the audit decision and 100-SKU sample are complete.

```yaml
merchantId: best-buy
enabled: true
killSwitch: false
allowedHosts:
  - api.bestbuy.com
source:
  type: api
  provider: bestbuy-products
  host: api.bestbuy.com
  credentialEnv: BEST_BUY_API_KEY
ttlSeconds:
  product: 900
  price: 300
  inventory: 300
  coupon: 900
seller:
  name: Best Buy
  condition: NEW
```

Catalog approval must independently record `provenSource: api`, `allowedHosts: [api.bestbuy.com]`,
legal approval, identity completeness, weighted score, normal-link or approved-affiliate status,
reviewer, and date. UI using Best Buy API content must follow current Best Buy branding rules.

## Before enabling

1. Accept and archive the applicable API terms and branding evidence.
2. Run the probe against at least 100 representative SKUs.
3. Verify SKU, UPC, manufacturer plus model number, price, availability, and official product URL.
4. Confirm the API response and retention policy satisfy the evidence design; Best Buy documentation
   restricts caching beyond temporary use.
5. Add an immutable product/offer revision before allowing promoted records into live Commerce.
6. Keep delivered-price and coupon operations unavailable until audited ZIP tax, shipping, and
   coupon sources exist.
