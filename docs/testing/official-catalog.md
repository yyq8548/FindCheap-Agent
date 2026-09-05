# Local official-product catalog retired

On 2026-09-05 the user cancelled the local product-directory design.

The MCP runtime no longer opens `official-catalog-v1.json`, and the Backend and
search executor no longer accept a local official-catalog provider. The importer,
refresh/discovery command, sitemap inventory, persistence and local ranking were
removed. Old data files are not deleted or migrated automatically; they are
ignored by the new code. Earlier release notes describe historical behavior.

Reviewed official-storefront and trusted-merchant registries remain. They contain
source/trust configuration, not a prebuilt product inventory. Real-time official,
Awin, Shopify and configured eBay searches remain, along with same-search bounded
memory reuse, immutable selection snapshots, and user-authorized Watch storage.
The remote Awin feed index is not part of this removal.

See `docs/product/visual-search-realtime-only.md` for implementation and validation.
