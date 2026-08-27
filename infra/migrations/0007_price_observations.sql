SELECT set_config('search_path', quote_ident(current_schema()) || ', pg_catalog', true);

CREATE TABLE price_observations (
  id bigserial PRIMARY KEY,
  merchant_id text NOT NULL CHECK (length(merchant_id) BETWEEN 1 AND 80),
  merchant_product_id text NOT NULL CHECK (length(merchant_product_id) BETWEEN 1 AND 200),
  basis text NOT NULL CHECK (basis IN ('ITEM_PRICE', 'DELIVERED_TOTAL')),
  amount_cents bigint NOT NULL CHECK (amount_cents BETWEEN 1 AND 100000000),
  currency text NOT NULL CHECK (currency = 'USD'),
  context_hash text NOT NULL CHECK (context_hash ~ '^[a-f0-9]{64}$'),
  source_kind text NOT NULL CHECK (source_kind IN (
    'AWIN_PRODUCT_FEED',
    'SHOPIFY_GLOBAL_CATALOG',
    'EBAY_BROWSE',
    'SHOPIFY_CART_ESTIMATE'
  )),
  observed_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (merchant_id, merchant_product_id, basis, context_hash, observed_at, amount_cents)
);

CREATE INDEX price_observations_lookup_idx
  ON price_observations (
    merchant_id,
    merchant_product_id,
    basis,
    context_hash,
    observed_at DESC
  );
