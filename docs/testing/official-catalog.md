# Reviewed official catalog

The catalog adds unbranded visual retrieval alongside existing Backend ports. It is a small, public metadata cache, not a new product authority, a crawler daemon, or visual verification.

## Runtime

`stdio.ts` installs `backend.catalog.officialCatalog`. Visual searches query this cache concurrently with existing providers. Text-only searches do not use it. Default file: `$FINDCHEAP_STATE_DIR/official-catalog-v1.json`, or the normal FindCheap state directory when unset.

Search rechecks each source against the currently reviewed official registry. An imported domain does not grant trust. Bad, revoked, foreign-host or expired records are excluded. Cached prices and inventory retain their original timestamps; after 24 hours the cache omits price and returns unknown availability. Records older than seven days are not served. Failed reloads retain the process's last valid snapshot.

## Operator refresh

Use the same `FINDCHEAP_OFFICIAL_STOREFRONTS_URL` or `AWIN_PRODUCT_SEARCH_URL` environment as the runtime to load its managed reviewed registry. Without either setting, only embedded reviewed stores can resolve. Never promote a source merely because it is reachable or has JSON-LD.

```powershell
pnpm exec tsx scripts/official-catalog.ts refresh reviewed-categories.json path/to/official-catalog-v1.json
pnpm exec tsx scripts/official-catalog.ts import reviewed-product-urls.json path/to/official-catalog-v1.json
```

Refresh manifest: `{"sources":[{"host":"reviewed-store.example","queries":["dress","tops","skirts"]}]}`. The placeholder must be replaced with an already approved storefront host. Each refresh independently discovers public products through that source's existing platform adapter, using its bounded search/sitemap flow. It never uses a reference photograph or a hidden expected answer. Import manifest: `{"urls":["https://reviewed-store.example/products/public-product"]}`; exact URL import is diagnostic/maintenance, not proof of unbranded recall.

Limits: six source plans per batch; 100 category queries per plan; one next query per source and batch; at most 20 returned products per batch; each adapter call at most 12 products and ten seconds. The persisted per-source query cursor resumes after restart. Each source, including failed attempts, can refresh only once per six hours. There is no timer or background loop. Manual repeated runs cannot bypass the persisted limit; an exclusive lock prevents concurrent importers.

Snapshots are atomic, validated, bounded to 2,000 products and 8 MiB, and restored before mutation. A corrupt snapshot blocks writes. A failed source keeps its old records. Successful updates merge by composite product identity and evict oldest records only when capped. An abandoned `.lock` file requires operator inspection before removal; it is not silently stolen.

## Diagnostics and scope

`officialCatalogDiagnostics` exposes `EMPTY`, `FRESH`, `STALE`, `EXPIRED` or `CACHE_UNAVAILABLE`, cached/returned counts, approved matched-source count, expired count and covered-query count. Covered queries are persisted as hashes, not user inputs. These counts describe a bounded incremental subset, never full-site or all-size coverage. A fresh empty cache is not proof a product is unavailable.

`availableSizes` describes the eligible colorway's saleable sizes; `availabilityScope` distinguishes `PRODUCT_COLOR` from `SELECTED_VARIANT`. Actual handles and exact selected-variant URLs remain authoritative. Relative JSON-LD offer URLs are allowed only on the reviewed host and matching product path/identifier. Explicit color/variant selectors cannot silently disappear, switch colors, or cross product identities.

Release acceptance requires actual discovery, cache restoration, unbranded cache retrieval, source revocation/expiry, rate persistence, cancellation and visual workflow traces. Unit fixtures do not count as real visual-recall samples. Newly discovered official domains still need normal independent review and approval.
