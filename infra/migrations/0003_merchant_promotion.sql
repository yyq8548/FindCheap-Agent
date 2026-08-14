SELECT set_config('search_path', quote_ident(current_schema()) || ', pg_catalog', true);

-- These keys are produced by the same Unicode-aware TypeScript normalizer used by
-- product matching. Existing rows remain fail-closed until re-saved by the product repository.
ALTER TABLE products
  ADD COLUMN identity_brand_key text,
  ADD COLUMN identity_mpn_key text;
CREATE INDEX products_identity_brand_mpn
  ON products (identity_brand_key, identity_mpn_key, id)
  WHERE identity_brand_key IS NOT NULL AND identity_mpn_key IS NOT NULL;

ALTER TABLE price_quotes
  ALTER COLUMN delivered_price_cents TYPE bigint,
  ADD COLUMN context_hash text CHECK (context_hash IS NULL OR context_hash ~ '^[a-f0-9]{64}$'),
  ADD CONSTRAINT price_quotes_safe_cents
    CHECK (delivered_price_cents BETWEEN 0 AND 9007199254740991),
  ADD CONSTRAINT price_quotes_context_unique UNIQUE (offer_id, zip_code, context_hash);

CREATE INDEX merchant_product_staging_lookup
  ON merchant_product_staging (merchant_id, merchant_product_id, checked_at DESC, id);
CREATE INDEX merchant_offers_exact_current
  ON merchant_offers (product_id, expires_at DESC, id)
  WHERE match_status = 'EXACT' AND product_id IS NOT NULL;
CREATE INDEX price_quotes_context_current
  ON price_quotes (offer_id, zip_code, context_hash, checked_at DESC, expires_at DESC, id);

-- Immutable audit snapshots deliberately do not FK to ingestion staging/evidence:
-- the audited retention function may purge those rows. Core evidence contains no raw body.
CREATE TABLE merchant_promotion_decisions (
  id text PRIMARY KEY CHECK (id ~ '^[a-f0-9]{64}$'),
  input_hash text NOT NULL CHECK (input_hash ~ '^[a-f0-9]{64}$'),
  entity_kind text NOT NULL CHECK (entity_kind IN ('OFFER', 'QUOTE')),
  source_identity_key text NOT NULL CHECK (source_identity_key ~ '^[a-f0-9]{64}$'),
  decision_version integer NOT NULL CHECK (decision_version > 0),
  staging_record_id text NOT NULL CHECK (staging_record_id ~ '^[a-f0-9]{64}$'),
  merchant_id text NOT NULL,
  merchant_product_id text NOT NULL,
  source_version text NOT NULL,
  status text NOT NULL CHECK (status IN (
    'EXACT_PROMOTED', 'SIMILAR', 'NEEDS_CLARIFICATION', 'NO_MATCH',
    'AMBIGUOUS', 'PENDING_EXACT_OFFER', 'QUOTE_PROMOTED'
  )),
  canonical_product_id text REFERENCES products(id),
  promoted_offer_id text REFERENCES merchant_offers(id),
  promoted_quote_id text REFERENCES price_quotes(id),
  primary_evidence_id text NOT NULL REFERENCES evidence(id),
  source_url text NOT NULL,
  source_type text NOT NULL,
  source_content_hash text NOT NULL,
  source_captured_at timestamptz NOT NULL,
  external_evidence_refs jsonb NOT NULL CHECK (jsonb_typeof(external_evidence_refs) = 'array'),
  match_basis text CHECK (match_basis IS NULL OR match_basis IN ('GTIN', 'BRAND_MPN')),
  match_evidence jsonb NOT NULL CHECK (jsonb_typeof(match_evidence) = 'array'),
  reason text NOT NULL,
  questions jsonb NOT NULL CHECK (jsonb_typeof(questions) = 'array'),
  candidate_product_ids jsonb NOT NULL CHECK (jsonb_typeof(candidate_product_ids) = 'array'),
  zip_code text,
  memberships jsonb,
  context_hash text CHECK (context_hash IS NULL OR context_hash ~ '^[a-f0-9]{64}$'),
  staged_checked_at timestamptz NOT NULL,
  staged_expires_at timestamptz NOT NULL,
  staged_record_hash text NOT NULL CHECK (staged_record_hash ~ '^[a-f0-9]{64}$'),
  decided_by text NOT NULL,
  decided_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (entity_kind, source_identity_key, decision_version),
  CHECK (
    (entity_kind = 'OFFER' AND status = 'EXACT_PROMOTED' AND
      canonical_product_id IS NOT NULL AND promoted_offer_id IS NOT NULL AND
      promoted_quote_id IS NULL AND match_basis IS NOT NULL AND
      zip_code IS NULL AND memberships IS NULL AND context_hash IS NULL)
    OR
    (entity_kind = 'OFFER' AND status IN (
      'SIMILAR', 'NEEDS_CLARIFICATION', 'NO_MATCH', 'AMBIGUOUS'
    ) AND canonical_product_id IS NULL AND promoted_offer_id IS NULL AND
      promoted_quote_id IS NULL AND match_basis IS NULL AND
      zip_code IS NULL AND memberships IS NULL AND context_hash IS NULL)
    OR
    (entity_kind = 'QUOTE' AND status = 'QUOTE_PROMOTED' AND
      canonical_product_id IS NOT NULL AND promoted_offer_id IS NOT NULL AND
      promoted_quote_id IS NOT NULL AND match_basis IS NULL AND
      zip_code IS NOT NULL AND memberships IS NOT NULL AND context_hash IS NOT NULL)
    OR
    (entity_kind = 'QUOTE' AND status = 'PENDING_EXACT_OFFER' AND
      canonical_product_id IS NULL AND promoted_offer_id IS NULL AND
      promoted_quote_id IS NULL AND match_basis IS NULL AND
      zip_code IS NOT NULL AND memberships IS NOT NULL AND context_hash IS NOT NULL)
  )
);
CREATE INDEX merchant_promotion_decisions_history
  ON merchant_promotion_decisions (merchant_id, merchant_product_id, decided_at DESC, id);

CREATE FUNCTION reject_promotion_decision_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'TRUNCATE' AND NOT EXISTS (SELECT 1 FROM merchant_promotion_decisions) THEN
    RETURN NULL;
  END IF;
  RAISE EXCEPTION 'promotion decisions are append-only; create a new decision version';
END;
$$;
CREATE TRIGGER merchant_promotion_decisions_update_delete
BEFORE UPDATE OR DELETE ON merchant_promotion_decisions
FOR EACH ROW EXECUTE FUNCTION reject_promotion_decision_mutation();
CREATE TRIGGER merchant_promotion_decisions_no_truncate
BEFORE TRUNCATE ON merchant_promotion_decisions
FOR EACH STATEMENT EXECUTE FUNCTION reject_promotion_decision_mutation();

DO $security$
DECLARE
  install_schema name := pg_catalog.current_schema();
BEGIN
  EXECUTE pg_catalog.format(
    'ALTER FUNCTION %I.reject_promotion_decision_mutation() SET search_path TO pg_catalog, %I, pg_temp',
    install_schema, install_schema
  );
END
$security$;
