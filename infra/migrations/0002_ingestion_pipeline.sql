CREATE TABLE ingestion_evidence (
  id text PRIMARY KEY CHECK (id ~ '^[a-f0-9]{64}$'),
  source_identity_key text NOT NULL UNIQUE CHECK (source_identity_key ~ '^[a-f0-9]{64}$'),
  merchant_id text NOT NULL,
  merchant_product_id text NOT NULL,
  source_version text NOT NULL,
  quote_context jsonb,
  source_url text NOT NULL,
  source_type text NOT NULL,
  content_hash text NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  raw_content text NOT NULL CHECK (length(raw_content) > 0),
  captured_at timestamptz NOT NULL,
  metadata jsonb NOT NULL CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE TABLE ingestion_purge_audit (
  purge_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  evidence_id text NOT NULL,
  source_identity_key text NOT NULL,
  content_hash text NOT NULL,
  purged_by text NOT NULL,
  purge_reason text NOT NULL,
  purged_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION protect_ingestion_evidence_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'ingestion evidence is immutable';
  END IF;
  IF
    COALESCE(current_setting('shopping.ingestion_purge_actor', true), '') = '' OR
    COALESCE(current_setting('shopping.ingestion_purge_reason', true), '') = ''
  THEN
    RAISE EXCEPTION 'ingestion evidence deletion requires audited purge function';
  END IF;
  INSERT INTO ingestion_purge_audit (
    evidence_id, source_identity_key, content_hash, purged_by, purge_reason
  ) VALUES (
    OLD.id,
    OLD.source_identity_key,
    OLD.content_hash,
    current_setting('shopping.ingestion_purge_actor'),
    current_setting('shopping.ingestion_purge_reason')
  );
  RETURN OLD;
END;
$$;

CREATE TRIGGER ingestion_evidence_immutable
BEFORE UPDATE OR DELETE ON ingestion_evidence
FOR EACH ROW EXECUTE FUNCTION protect_ingestion_evidence_mutation();

CREATE TABLE ingestion_idempotency (
  scope text NOT NULL,
  idempotency_key text NOT NULL CHECK (idempotency_key ~ '^[a-f0-9]{64}$'),
  input_hash text NOT NULL CHECK (input_hash ~ '^[a-f0-9]{64}$'),
  result_kind text NOT NULL,
  result_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, idempotency_key)
);

CREATE TABLE merchant_product_staging (
  id text PRIMARY KEY CHECK (id ~ '^[a-f0-9]{64}$'),
  source_identity_key text NOT NULL UNIQUE,
  merchant_id text NOT NULL,
  merchant_product_id text NOT NULL,
  source_version text NOT NULL,
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  primary_evidence_id text NOT NULL REFERENCES ingestion_evidence(id),
  evidence_refs text[] NOT NULL,
  checked_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL CHECK (expires_at > checked_at)
);

CREATE TABLE merchant_quote_staging (
  id text PRIMARY KEY CHECK (id ~ '^[a-f0-9]{64}$'),
  source_identity_key text NOT NULL UNIQUE,
  merchant_id text NOT NULL,
  merchant_product_id text NOT NULL,
  source_version text NOT NULL,
  zip_code text NOT NULL,
  memberships jsonb NOT NULL CHECK (jsonb_typeof(memberships) = 'array'),
  context_hash text NOT NULL CHECK (context_hash ~ '^[a-f0-9]{64}$'),
  delivered_price_cents bigint NOT NULL CHECK (delivered_price_cents >= 0),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  primary_evidence_id text NOT NULL REFERENCES ingestion_evidence(id),
  evidence_refs text[] NOT NULL,
  checked_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL CHECK (expires_at > checked_at)
);
CREATE INDEX merchant_quote_staging_history
  ON merchant_quote_staging (
    merchant_id, merchant_product_id, zip_code, context_hash, checked_at DESC
  );

CREATE TABLE merchant_ingestion_quarantine (
  id text PRIMARY KEY CHECK (id ~ '^[a-f0-9]{64}$'),
  source_identity_key text NOT NULL UNIQUE,
  merchant_id text NOT NULL,
  merchant_product_id text NOT NULL,
  source_version text NOT NULL,
  zip_code text,
  memberships jsonb,
  context_hash text,
  reason text NOT NULL,
  previous_price_cents bigint,
  current_price_cents bigint,
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  primary_evidence_id text NOT NULL REFERENCES ingestion_evidence(id),
  evidence_refs text[] NOT NULL,
  checked_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION purge_ingestion_evidence(
  target_evidence_id text,
  purge_actor text,
  purge_reason text
) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE
  deleted_count integer;
BEGIN
  IF length(trim(purge_actor)) = 0 OR length(trim(purge_reason)) = 0 THEN
    RAISE EXCEPTION 'purge actor and reason are required';
  END IF;
  PERFORM set_config('shopping.ingestion_purge_actor', trim(purge_actor), true);
  PERFORM set_config('shopping.ingestion_purge_reason', trim(purge_reason), true);

  DELETE FROM ingestion_idempotency
  WHERE result_id IN (
    SELECT id FROM merchant_product_staging WHERE primary_evidence_id = target_evidence_id
    UNION ALL
    SELECT id FROM merchant_quote_staging WHERE primary_evidence_id = target_evidence_id
    UNION ALL
    SELECT id FROM merchant_ingestion_quarantine WHERE primary_evidence_id = target_evidence_id
  );
  DELETE FROM merchant_ingestion_quarantine WHERE primary_evidence_id = target_evidence_id;
  DELETE FROM merchant_quote_staging WHERE primary_evidence_id = target_evidence_id;
  DELETE FROM merchant_product_staging WHERE primary_evidence_id = target_evidence_id;
  DELETE FROM ingestion_evidence WHERE id = target_evidence_id;
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count = 1;
END;
$$;
