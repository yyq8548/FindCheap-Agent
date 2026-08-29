# Registry Builder

Registry Builder expands FindCheap's official-storefront and merchant-trust registries without treating discovery as approval.

## Safety boundary

- Awin, Shopify, and search observations create `CANDIDATE` records only.
- A successful technical probe proves only that a public storefront responds. It does not prove brand ownership, retailer authorization, or merchant trust.
- An approval file and explicit `approve` command are required before a candidate can enter a public release.
- `publish` rebuilds both public registries from `APPROVED` rows and validates them with the same schemas used by clients.
- The Railway service keeps its last valid or embedded registry when PostgreSQL is unavailable, has no release, or returns invalid data.

## Database setup

Run migrations against the Railway PostgreSQL database:

```powershell
$env:DATABASE_URL = '<Railway PostgreSQL URL>'
pnpm db:migrate
```

Use `FINDCHEAP_REGISTRY_DATABASE_URL` for Registry Builder and the Awin Feed service. Production Railway private URLs must use the repository's accepted PostgreSQL TLS form.

Seed the currently reviewed records:

```powershell
pnpm registry:build seed
```

## Collect Awin candidates

Use the validated merged Awin archive already stored by the Feed service:

```powershell
pnpm registry:build collect-awin --feed C:\path\to\current.csv.gz
```

This deduplicates merchant hosts and stores Awin merchant IDs, names, and sample product URLs. Every new row remains `CANDIDATE`.

Shopify Catalog and search-observation pipelines can import bounded candidate JSON:

```json
{
  "source": "SHOPIFY_CATALOG",
  "candidates": [
    {
      "kind": "MERCHANT_TRUST",
      "host": "merchant.example",
      "sourceReference": "catalog observation 2026-08-29",
      "payload": { "merchantName": "Candidate Merchant" }
    }
  ]
}
```

```powershell
pnpm registry:build collect-json --file C:\path\to\candidates.json
```

Probe up to 100 candidates:

```powershell
pnpm registry:build probe --limit 100
```

Probes use bounded concurrency (`--concurrency 6` by default, maximum 12) so a large review batch is not serialized behind anti-bot timeouts.

The probe uses bounded HTTPS, DNS and redirect checks. It records HTTP, HTML, Shopify, and Product JSON-LD signals without approving the merchant.

Review candidates:

```powershell
pnpm registry:build list --status CANDIDATE --limit 100
```

## Approve one reviewed record

Official-storefront approval file:

```json
{
  "kind": "OFFICIAL_STOREFRONT",
  "record": {
    "brand": "Example Brand",
    "aliases": [],
    "officialHost": "example.com",
    "platform": "SHOPIFY",
    "productPathPrefixes": ["/products/"],
    "imageHosts": ["cdn.shopify.com"],
    "evidenceUrl": "https://example.com/",
    "reviewedAt": "2026-08-29",
    "status": "APPROVED"
  },
  "note": "Brand-controlled domain reviewed.",
  "evidenceKind": "BRAND_DOMAIN",
  "evidenceUrl": "https://example.com/"
}
```

Run:

```powershell
pnpm registry:build approve --file C:\path\to\approval.json
```

For a reviewed expansion, wrap unique approval objects in an `approvals` array and apply them atomically:

```powershell
pnpm registry:build approve-batch --file C:\path\to\reviewed-approvals.json
```

The whole batch rolls back when any record, evidence URL, or approval gate is invalid. Discovery exports must still be imported and probed before this explicit review step.

For Shopify-heavy expansion, the batch file may instead contain `reviewedAt`, reviewed `officialStorefronts`, and `additionalTrustedMerchants`. Registry Builder expands the compact review into explicit official-storefront and merchant-trust approvals while preserving the same transaction and evidence gates.

Import that reviewed file as unapproved candidates first, then run the technical probe before approval:

```powershell
pnpm registry:build collect-reviewed --file config\registries\reviewed-expansion-2026-08-29.json
pnpm registry:build probe --limit 500
pnpm registry:build approve-batch --file config\registries\reviewed-expansion-2026-08-29.json
```

Merchant approval uses `kind: MERCHANT_TRUST` and one of `OFFICIAL`, `AUTHORIZED_RETAILER`, or `ESTABLISHED_RETAILER`. Affiliate participation alone is not acceptable evidence.

Reject or suspend a candidate:

```powershell
pnpm registry:build reject --kind MERCHANT_TRUST --host example.com --note "Identity evidence failed."
pnpm registry:build suspend --kind OFFICIAL_STOREFRONT --host example.com --note "Domain ownership changed."
```

## Publish

Publish one immutable approved snapshot:

```powershell
pnpm registry:build publish --version registry-2026-08-29-01
```

Configure the Awin Feed service:

```text
FINDCHEAP_REGISTRY_DATABASE_URL=<Railway PostgreSQL URL>
FINDCHEAP_REGISTRY_REFRESH_MINUTES=15
```

After deployment, verify `/v1/official-storefronts` and `/v1/merchant-trust`, then repeat each request with `If-None-Match` and confirm `304`.
