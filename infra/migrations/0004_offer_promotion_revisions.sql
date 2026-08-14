SELECT set_config('search_path', quote_ident(current_schema()) || ', pg_catalog', true);

-- Offer decisions are immutable revisions. Legacy 0003 rows remain unbound and
-- therefore fail closed until a newer staged source version is promoted.
ALTER TABLE merchant_promotion_decisions ADD COLUMN offer_promotion_decision_id text;
ALTER TABLE merchant_promotion_decisions ADD COLUMN offer_revision bigint;
ALTER TABLE merchant_promotion_decisions
  ADD CONSTRAINT merchant_promotion_decisions_offer_revision_check
    CHECK (offer_revision IS NULL OR offer_revision > 0),
  ADD CONSTRAINT merchant_promotion_decisions_offer_revision_unique
    UNIQUE (id, promoted_offer_id, offer_revision),
  ADD CONSTRAINT merchant_promotion_decisions_offer_product_revision_unique
    UNIQUE (id, promoted_offer_id, offer_revision, canonical_product_id),
  ADD CONSTRAINT merchant_promotion_decisions_current_revision_unique
    UNIQUE (
      id, promoted_offer_id, offer_revision, canonical_product_id,
      source_identity_key, source_version, staged_checked_at
    ),
  ADD CONSTRAINT merchant_promotion_decisions_revision_shape CHECK (
    (entity_kind = 'OFFER' AND status = 'EXACT_PROMOTED' AND
      offer_promotion_decision_id IS NULL AND offer_revision IS NOT NULL)
    OR
    (entity_kind = 'OFFER' AND status IN (
      'SIMILAR', 'NEEDS_CLARIFICATION', 'NO_MATCH', 'AMBIGUOUS'
    ) AND offer_promotion_decision_id IS NULL AND offer_revision IS NULL)
    OR
    (entity_kind = 'QUOTE' AND status = 'QUOTE_PROMOTED' AND
      offer_promotion_decision_id IS NOT NULL AND offer_revision IS NOT NULL)
    OR
    (entity_kind = 'QUOTE' AND status = 'PENDING_EXACT_OFFER' AND
      offer_promotion_decision_id IS NULL AND offer_revision IS NULL)
  ) NOT VALID;

ALTER TABLE merchant_promotion_decisions
  ADD CONSTRAINT promotion_decision_offer_revision_fk
    FOREIGN KEY (
      offer_promotion_decision_id, promoted_offer_id, offer_revision, canonical_product_id
    ) REFERENCES merchant_promotion_decisions (
      id, promoted_offer_id, offer_revision, canonical_product_id
    );

CREATE TABLE merchant_offer_current_promotions (
  offer_id text PRIMARY KEY REFERENCES merchant_offers(id),
  promotion_decision_id text NOT NULL UNIQUE,
  revision bigint NOT NULL CHECK (revision > 0),
  canonical_product_id text NOT NULL REFERENCES products(id),
  source_identity_key text NOT NULL CHECK (source_identity_key ~ '^[a-f0-9]{64}$'),
  source_version text NOT NULL,
  promoted_checked_at timestamptz NOT NULL,
  FOREIGN KEY (
    promotion_decision_id, offer_id, revision, canonical_product_id,
    source_identity_key, source_version, promoted_checked_at
  )
    REFERENCES merchant_promotion_decisions (
      id, promoted_offer_id, offer_revision, canonical_product_id,
      source_identity_key, source_version, staged_checked_at
    ) DEFERRABLE INITIALLY DEFERRED
);

ALTER TABLE price_quotes
  DROP CONSTRAINT price_quotes_context_unique;
ALTER TABLE price_quotes ADD COLUMN offer_promotion_decision_id text;
ALTER TABLE price_quotes ADD COLUMN offer_revision bigint;
ALTER TABLE price_quotes
  ADD CONSTRAINT price_quotes_offer_revision_check
    CHECK (offer_revision IS NULL OR offer_revision > 0),
  ADD CONSTRAINT price_quotes_offer_promotion_decision_fk
    FOREIGN KEY (offer_promotion_decision_id, offer_id, offer_revision)
    REFERENCES merchant_promotion_decisions (id, promoted_offer_id, offer_revision),
  ADD CONSTRAINT price_quotes_revision_shape CHECK (
    (offer_promotion_decision_id IS NULL AND offer_revision IS NULL)
    OR
    (offer_promotion_decision_id IS NOT NULL AND offer_revision IS NOT NULL)
  ) NOT VALID;

CREATE UNIQUE INDEX price_quotes_context_revision_unique
  ON price_quotes (offer_id, offer_revision, zip_code, context_hash)
  WHERE offer_revision IS NOT NULL;
CREATE UNIQUE INDEX price_quotes_context_legacy_unique
  ON price_quotes (offer_id, zip_code, context_hash)
  WHERE offer_revision IS NULL;
