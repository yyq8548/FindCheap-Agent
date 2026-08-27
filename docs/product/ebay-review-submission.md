# eBay review submission packet

Use this document when requesting eBay Buy API Production access and special-business-model
approval for FindCheap Agent.

## Product summary

FindCheap Agent is a search-and-comparison assistant. It searches configured Awin, Shopify, and
eBay sources in parallel, normalizes public listing data, then ranks products by request match,
merchant reliability, verified Coupon evidence, and price. Affiliate compensation never changes
eligibility or ranking. The product does not complete checkout, create an order, reserve inventory,
or collect payment.

## Reviewer setup

1. Deploy the current release to a separate Railway staging environment.
2. Set `EBAY_BROWSE_ENABLED=true` and `EBAY_ENVIRONMENT=SANDBOX`.
3. Add an eBay Sandbox Client ID and Client Secret. Do not add an EPN campaign ID.
4. Point the review plugin's `EBAY_PRODUCT_SEARCH_URL` to that staging service.
5. Search for an EBAY_US fixed-price item and open the returned eBay Sandbox link.

Expected behavior:

- only eBay Sandbox OAuth and Browse endpoints are called;
- results are clearly labeled as Sandbox review-only;
- no affiliate URL or commission tracking is emitted;
- eBay is shown as the marketplace and the listing seller remains unverified;
- shipping, tax, fees, and final total are deferred to eBay;
- no checkout, order, reservation, purchase, or payment action exists.

## Production disclosure

When approved Production credentials and a numeric EPN campaign ID are configured, the purchase
action displays this nearby disclosure:

> As an eBay Partner, FindCheap may be compensated if you make a purchase.

## Data and security

The integration reads public Browse listing fields needed for search cards: item ID, title, image,
item URL, price, condition, seller name, seller feedback, and availability. Credentials remain in
Railway server variables. They are not shipped in the plugin, browser, response payload, health
output, or Git history. FindCheap does not request eBay user identity, order, payment, or address
data.

## Submitter fields

Complete these before submission:

- production website or product URL;
- Sandbox reviewer URL and test instructions;
- supported countries and languages;
- expected traffic and request volume;
- data retention and deletion policy URL;
- privacy policy and contact email;
- EPN account and campaign ID;
- screenshots showing the search result, disclosure, and outbound action.
