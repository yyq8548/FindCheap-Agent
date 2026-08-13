CREATE TABLE products (
  id text PRIMARY KEY,
  brand text NOT NULL,
  manufacturer_part_number text,
  gtins text[] NOT NULL DEFAULT '{}',
  title text NOT NULL,
  category_path text[] NOT NULL,
  attributes jsonb NOT NULL,
  variant_dimensions jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX products_mpn_unique
  ON products (lower(brand), manufacturer_part_number)
  WHERE manufacturer_part_number IS NOT NULL;
CREATE INDEX products_gtins_gin ON products USING gin (gtins);

CREATE TABLE merchant_offers (
  id text PRIMARY KEY,
  merchant_id text NOT NULL,
  merchant_product_id text NOT NULL,
  product_id text REFERENCES products(id),
  seller_name text NOT NULL,
  condition text NOT NULL,
  match_status text NOT NULL,
  inventory_status text NOT NULL,
  merchant_url text NOT NULL,
  evidence_refs text[] NOT NULL DEFAULT '{}',
  match_evidence jsonb NOT NULL DEFAULT '[]',
  checked_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  CHECK (expires_at > checked_at),
  UNIQUE (merchant_id, merchant_product_id)
);

CREATE TABLE evidence (
  id text PRIMARY KEY,
  merchant_id text NOT NULL,
  source_url text NOT NULL,
  source_type text NOT NULL,
  content_hash text NOT NULL,
  captured_at timestamptz NOT NULL,
  metadata jsonb NOT NULL
);

CREATE TABLE price_quotes (
  id text PRIMARY KEY,
  offer_id text NOT NULL REFERENCES merchant_offers(id),
  zip_code text NOT NULL,
  membership_context jsonb NOT NULL,
  status text NOT NULL,
  delivered_price_cents integer NOT NULL,
  line_items jsonb NOT NULL,
  eligibility_conditions jsonb NOT NULL,
  evidence_refs text[] NOT NULL,
  checked_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  CHECK (expires_at > checked_at)
);
CREATE INDEX price_quotes_offer_expiry ON price_quotes (offer_id, expires_at DESC);

CREATE TABLE coupons (
  id text PRIMARY KEY,
  merchant_id text NOT NULL,
  code text,
  discount_rule jsonb NOT NULL,
  eligibility jsonb NOT NULL,
  stacking_rule text NOT NULL CHECK (
    stacking_rule IN ('STACKABLE_WITH_MEMBERSHIP', 'NOT_STACKABLE_WITH_MEMBERSHIP')
  ),
  verification_status text NOT NULL,
  evidence_refs text[] NOT NULL DEFAULT '{}',
  valid_from timestamptz NOT NULL,
  valid_to timestamptz NOT NULL,
  CHECK (valid_to > valid_from)
);
CREATE INDEX coupons_merchant_expiry ON coupons (merchant_id, valid_to DESC);

CREATE TABLE offer_evidence (
  offer_id text NOT NULL REFERENCES merchant_offers(id) ON DELETE CASCADE,
  evidence_id text NOT NULL REFERENCES evidence(id),
  PRIMARY KEY (offer_id, evidence_id)
);
CREATE TABLE quote_evidence (
  quote_id text NOT NULL REFERENCES price_quotes(id) ON DELETE CASCADE,
  evidence_id text NOT NULL REFERENCES evidence(id),
  PRIMARY KEY (quote_id, evidence_id)
);
CREATE TABLE coupon_evidence (
  coupon_id text NOT NULL REFERENCES coupons(id) ON DELETE CASCADE,
  evidence_id text NOT NULL REFERENCES evidence(id),
  PRIMARY KEY (coupon_id, evidence_id)
);
