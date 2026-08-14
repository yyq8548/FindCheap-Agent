SELECT set_config('search_path', quote_ident(current_schema()) || ', pg_catalog', true);

CREATE TABLE ingestion_evidence (
  id text PRIMARY KEY CHECK (id ~ '^[a-f0-9]{64}$'),
  source_identity_key text NOT NULL UNIQUE CHECK (source_identity_key ~ '^[a-f0-9]{64}$'),
  merchant_id text NOT NULL CHECK (octet_length(merchant_id) BETWEEN 1 AND 80),
  merchant_product_id text NOT NULL CHECK (octet_length(merchant_product_id) BETWEEN 1 AND 200),
  source_version text NOT NULL CHECK (octet_length(source_version) BETWEEN 1 AND 128),
  quote_context jsonb CHECK (quote_context IS NULL OR jsonb_typeof(quote_context) = 'object'),
  source_url text NOT NULL CHECK (lower(source_url) ~ '^https://' AND octet_length(source_url) <= 2048),
  source_type text NOT NULL CHECK (source_type IN ('feed', 'api', 'jsonld', 'http', 'crawl4ai', 'unknown')),
  content_hash text NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  raw_content text NOT NULL CHECK (octet_length(raw_content) BETWEEN 1 AND 5000000),
  captured_at timestamptz NOT NULL,
  metadata jsonb NOT NULL CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE TABLE ingestion_conflict_evidence (
  id text PRIMARY KEY CHECK (id ~ '^[a-f0-9]{64}$'),
  expected_evidence_id text NOT NULL REFERENCES ingestion_evidence(id),
  source_identity_key text NOT NULL CHECK (source_identity_key ~ '^[a-f0-9]{64}$'),
  merchant_id text NOT NULL CHECK (octet_length(merchant_id) BETWEEN 1 AND 80),
  merchant_product_id text NOT NULL CHECK (octet_length(merchant_product_id) BETWEEN 1 AND 200),
  source_version text NOT NULL CHECK (octet_length(source_version) BETWEEN 1 AND 128),
  quote_context jsonb CHECK (quote_context IS NULL OR jsonb_typeof(quote_context) = 'object'),
  source_url text NOT NULL CHECK (lower(source_url) ~ '^https://' AND octet_length(source_url) <= 2048),
  source_type text NOT NULL CHECK (source_type IN ('feed', 'api', 'jsonld', 'http', 'crawl4ai', 'unknown')),
  content_hash text NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  raw_content text NOT NULL CHECK (octet_length(raw_content) BETWEEN 1 AND 5000000),
  captured_at timestamptz NOT NULL,
  metadata jsonb NOT NULL CHECK (jsonb_typeof(metadata) = 'object'),
  UNIQUE (source_identity_key, content_hash)
);

CREATE TABLE ingestion_purge_audit (
  purge_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  record_kind text NOT NULL CHECK (record_kind IN ('evidence', 'conflict_evidence')),
  evidence_id text NOT NULL,
  source_identity_key text NOT NULL,
  content_hash text NOT NULL,
  requested_actor text NOT NULL,
  authenticated_role text NOT NULL,
  function_owner text NOT NULL,
  purge_reason text NOT NULL,
  purged_at timestamptz NOT NULL DEFAULT now()
);

CREATE FUNCTION reject_ingestion_record_mutation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'TRUNCATE') OR current_user = session_user THEN
    RAISE EXCEPTION 'ingestion evidence is immutable; use audited purge role';
  END IF;
  RETURN OLD;
END;
$$;
REVOKE ALL ON FUNCTION reject_ingestion_record_mutation() FROM PUBLIC;

CREATE TRIGGER ingestion_evidence_immutable
BEFORE UPDATE OR DELETE ON ingestion_evidence
FOR EACH ROW EXECUTE FUNCTION reject_ingestion_record_mutation();
CREATE TRIGGER ingestion_conflict_evidence_immutable
BEFORE UPDATE OR DELETE ON ingestion_conflict_evidence
FOR EACH ROW EXECUTE FUNCTION reject_ingestion_record_mutation();
CREATE TRIGGER ingestion_evidence_no_truncate
BEFORE TRUNCATE ON ingestion_evidence
FOR EACH STATEMENT EXECUTE FUNCTION reject_ingestion_record_mutation();
CREATE TRIGGER ingestion_conflict_evidence_no_truncate
BEFORE TRUNCATE ON ingestion_conflict_evidence
FOR EACH STATEMENT EXECUTE FUNCTION reject_ingestion_record_mutation();

CREATE FUNCTION reject_ingestion_audit_mutation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RAISE EXCEPTION 'ingestion purge audit is append-only';
END;
$$;
REVOKE ALL ON FUNCTION reject_ingestion_audit_mutation() FROM PUBLIC;
CREATE TRIGGER ingestion_purge_audit_no_update_delete
BEFORE UPDATE OR DELETE ON ingestion_purge_audit
FOR EACH ROW EXECUTE FUNCTION reject_ingestion_audit_mutation();
CREATE TRIGGER ingestion_purge_audit_no_truncate
BEFORE TRUNCATE ON ingestion_purge_audit
FOR EACH STATEMENT EXECUTE FUNCTION reject_ingestion_audit_mutation();

CREATE TABLE ingestion_idempotency (
  scope text NOT NULL CHECK (octet_length(scope) BETWEEN 1 AND 80),
  idempotency_key text NOT NULL CHECK (idempotency_key ~ '^[a-f0-9]{64}$'),
  input_hash text NOT NULL CHECK (input_hash ~ '^[a-f0-9]{64}$'),
  result_kind text NOT NULL,
  result_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, idempotency_key)
);

CREATE TABLE merchant_product_staging (
  id text PRIMARY KEY CHECK (id ~ '^[a-f0-9]{64}$'),
  source_identity_key text NOT NULL UNIQUE CHECK (source_identity_key ~ '^[a-f0-9]{64}$'),
  merchant_id text NOT NULL CHECK (octet_length(merchant_id) BETWEEN 1 AND 80),
  merchant_product_id text NOT NULL CHECK (octet_length(merchant_product_id) BETWEEN 1 AND 200),
  source_version text NOT NULL CHECK (octet_length(source_version) BETWEEN 1 AND 128),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  primary_evidence_id text NOT NULL REFERENCES ingestion_evidence(id),
  external_evidence_refs text[] NOT NULL CHECK (
    cardinality(external_evidence_refs) <= 50 AND array_position(external_evidence_refs, '') IS NULL
    AND octet_length(array_to_string(external_evidence_refs, '')) <= 12800
  ),
  checked_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL CHECK (expires_at > checked_at)
);

CREATE TABLE merchant_quote_staging (
  id text PRIMARY KEY CHECK (id ~ '^[a-f0-9]{64}$'),
  source_identity_key text NOT NULL UNIQUE CHECK (source_identity_key ~ '^[a-f0-9]{64}$'),
  merchant_id text NOT NULL CHECK (octet_length(merchant_id) BETWEEN 1 AND 80),
  merchant_product_id text NOT NULL CHECK (octet_length(merchant_product_id) BETWEEN 1 AND 200),
  source_version text NOT NULL CHECK (octet_length(source_version) BETWEEN 1 AND 128),
  zip_code text NOT NULL CHECK (zip_code ~ '^\d{5}(-\d{4})?$'),
  memberships jsonb NOT NULL CHECK (jsonb_typeof(memberships) = 'array'),
  context_hash text NOT NULL CHECK (context_hash ~ '^[a-f0-9]{64}$'),
  delivered_price_cents bigint NOT NULL CHECK (delivered_price_cents BETWEEN 0 AND 9007199254740991),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  primary_evidence_id text NOT NULL REFERENCES ingestion_evidence(id),
  external_evidence_refs text[] NOT NULL CHECK (
    cardinality(external_evidence_refs) <= 50 AND array_position(external_evidence_refs, '') IS NULL
    AND octet_length(array_to_string(external_evidence_refs, '')) <= 12800
  ),
  checked_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL CHECK (expires_at > checked_at)
);
CREATE INDEX merchant_quote_staging_history ON merchant_quote_staging (
  merchant_id, merchant_product_id, zip_code, context_hash, checked_at DESC
);

CREATE TABLE merchant_ingestion_quarantine (
  id text PRIMARY KEY CHECK (id ~ '^[a-f0-9]{64}$'),
  source_identity_key text NOT NULL UNIQUE CHECK (source_identity_key ~ '^[a-f0-9]{64}$'),
  merchant_id text NOT NULL CHECK (octet_length(merchant_id) BETWEEN 1 AND 80),
  merchant_product_id text NOT NULL CHECK (octet_length(merchant_product_id) BETWEEN 1 AND 200),
  source_version text NOT NULL CHECK (octet_length(source_version) BETWEEN 1 AND 128),
  zip_code text,
  memberships jsonb,
  context_hash text,
  reason text NOT NULL,
  previous_price_cents bigint CHECK (previous_price_cents BETWEEN 0 AND 9007199254740991),
  current_price_cents bigint CHECK (current_price_cents BETWEEN 0 AND 9007199254740991),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  primary_evidence_id text NOT NULL REFERENCES ingestion_evidence(id),
  conflict_evidence_id text REFERENCES ingestion_conflict_evidence(id),
  external_evidence_refs text[] NOT NULL CHECK (
    cardinality(external_evidence_refs) <= 50 AND array_position(external_evidence_refs, '') IS NULL
    AND octet_length(array_to_string(external_evidence_refs, '')) <= 12800
  ),
  checked_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((reason = 'SOURCE_VERSION_CONFLICT') = (conflict_evidence_id IS NOT NULL))
);

CREATE FUNCTION purge_ingestion_evidence(
  target_evidence_id text,
  requested_actor text,
  purge_reason text
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  deleted_count integer;
BEGIN
  IF NULLIF(pg_catalog.btrim(requested_actor), '') IS NULL OR
     NULLIF(pg_catalog.btrim(purge_reason), '') IS NULL THEN
    RAISE EXCEPTION 'purge actor and reason are required';
  END IF;

  INSERT INTO ingestion_purge_audit (
    record_kind, evidence_id, source_identity_key, content_hash, requested_actor,
    authenticated_role, function_owner, purge_reason
  )
  SELECT 'conflict_evidence', id, source_identity_key, content_hash, trim(requested_actor),
         session_user, current_user, trim(purge_reason)
  FROM ingestion_conflict_evidence WHERE expected_evidence_id = target_evidence_id;
  INSERT INTO ingestion_purge_audit (
    record_kind, evidence_id, source_identity_key, content_hash, requested_actor,
    authenticated_role, function_owner, purge_reason
  )
  SELECT 'evidence', id, source_identity_key, content_hash, trim(requested_actor),
         session_user, current_user, trim(purge_reason)
  FROM ingestion_evidence WHERE id = target_evidence_id;

  DELETE FROM ingestion_idempotency WHERE result_id IN (
    SELECT id FROM merchant_product_staging WHERE primary_evidence_id = target_evidence_id
    UNION ALL SELECT id FROM merchant_quote_staging WHERE primary_evidence_id = target_evidence_id
    UNION ALL SELECT id FROM merchant_ingestion_quarantine WHERE primary_evidence_id = target_evidence_id
  );
  DELETE FROM merchant_ingestion_quarantine WHERE primary_evidence_id = target_evidence_id;
  DELETE FROM merchant_quote_staging WHERE primary_evidence_id = target_evidence_id;
  DELETE FROM merchant_product_staging WHERE primary_evidence_id = target_evidence_id;
  DELETE FROM ingestion_conflict_evidence WHERE expected_evidence_id = target_evidence_id;
  DELETE FROM ingestion_evidence WHERE id = target_evidence_id;
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count = 1;
END;
$$;

DO $security$
DECLARE
  install_schema name := pg_catalog.current_schema();
BEGIN
  EXECUTE pg_catalog.format(
    'ALTER FUNCTION %I.reject_ingestion_record_mutation() SET search_path TO pg_catalog, %I, pg_temp',
    install_schema, install_schema
  );
  EXECUTE pg_catalog.format(
    'ALTER FUNCTION %I.reject_ingestion_audit_mutation() SET search_path TO pg_catalog, %I, pg_temp',
    install_schema, install_schema
  );
  EXECUTE pg_catalog.format(
    'ALTER FUNCTION %I.purge_ingestion_evidence(text,text,text) SET search_path TO pg_catalog, %I, pg_temp',
    install_schema, install_schema
  );
  EXECUTE pg_catalog.format(
    'REVOKE ALL ON FUNCTION %I.purge_ingestion_evidence(text,text,text) FROM PUBLIC',
    install_schema
  );
END
$security$;

REVOKE UPDATE, DELETE, TRUNCATE ON ingestion_evidence, ingestion_conflict_evidence FROM PUBLIC;
REVOKE ALL ON ingestion_purge_audit FROM PUBLIC;
