SELECT set_config('search_path', quote_ident(current_schema()) || ', pg_catalog', true);

-- Price quotes remain operational rows, while this validated derived snapshot is immutable with
-- the promotion decision. Commerce reads the snapshot so later writes through legacy mutable
-- repositories cannot alter an audited price. Existing decisions remain fail-closed (NULL).
ALTER TABLE merchant_promotion_decisions
  ADD COLUMN promoted_quote_snapshot jsonb;

ALTER TABLE merchant_promotion_decisions
  ADD CONSTRAINT merchant_promotion_decisions_quote_snapshot_shape CHECK (
    (entity_kind = 'QUOTE' AND status = 'QUOTE_PROMOTED' AND
      promoted_quote_snapshot IS NOT NULL AND
      jsonb_typeof(promoted_quote_snapshot) = 'object')
    OR
    (NOT (entity_kind = 'QUOTE' AND status = 'QUOTE_PROMOTED') AND
      promoted_quote_snapshot IS NULL)
  ) NOT VALID;
