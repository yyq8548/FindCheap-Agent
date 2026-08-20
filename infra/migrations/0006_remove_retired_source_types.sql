SELECT set_config('search_path', quote_ident(current_schema()) || ', pg_catalog', true);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM ingestion_evidence WHERE source_type = 'crawl4ai'
    UNION ALL
    SELECT 1 FROM ingestion_conflict_evidence WHERE source_type = 'crawl4ai'
  ) THEN
    RAISE EXCEPTION 'cannot retire crawl4ai while retained ingestion evidence still uses it';
  END IF;
END;
$$;

ALTER TABLE ingestion_evidence
  DROP CONSTRAINT ingestion_evidence_source_type_check,
  ADD CONSTRAINT ingestion_evidence_source_type_check
    CHECK (source_type IN ('feed', 'api', 'jsonld', 'http', 'unknown'));

ALTER TABLE ingestion_conflict_evidence
  DROP CONSTRAINT ingestion_conflict_evidence_source_type_check,
  ADD CONSTRAINT ingestion_conflict_evidence_source_type_check
    CHECK (source_type IN ('feed', 'api', 'jsonld', 'http', 'unknown'));
