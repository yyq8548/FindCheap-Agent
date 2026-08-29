# Ingestion Evidence Retention

`ingestion_evidence`, `ingestion_conflict_evidence`, and `ingestion_purge_audit` are immutable. Application, worker, and retention roles must not own these tables or receive direct `UPDATE`, `DELETE`, or `TRUNCATE` privileges.

Run this once in a transaction as a superuser/bootstrap administrator, replacing `commerce` and role names for the environment. The migration itself intentionally contains no environment-specific roles:

```sql
BEGIN;
CREATE ROLE ingestion_purge_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
CREATE ROLE ingestion_retention NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
-- Create or select the environment's authenticated service login separately.
-- Example only: CREATE ROLE retention_service LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT;

-- CREATE is temporary and exists only so ownership transfer is valid.
GRANT USAGE, CREATE ON SCHEMA commerce TO ingestion_purge_owner;
GRANT SELECT, DELETE ON
  commerce.ingestion_evidence,
  commerce.ingestion_conflict_evidence,
  commerce.ingestion_idempotency,
  commerce.merchant_product_staging,
  commerce.merchant_quote_staging,
  commerce.merchant_ingestion_quarantine
TO ingestion_purge_owner;
GRANT INSERT ON commerce.ingestion_purge_audit TO ingestion_purge_owner;
GRANT USAGE, SELECT ON SEQUENCE commerce.ingestion_purge_audit_purge_id_seq
TO ingestion_purge_owner;

ALTER FUNCTION commerce.purge_ingestion_evidence(text,text,text)
OWNER TO ingestion_purge_owner;
REVOKE CREATE ON SCHEMA commerce FROM ingestion_purge_owner;
REVOKE ALL ON FUNCTION commerce.purge_ingestion_evidence(text,text,text) FROM PUBLIC;

GRANT USAGE ON SCHEMA commerce TO ingestion_retention;
GRANT EXECUTE ON FUNCTION commerce.purge_ingestion_evidence(text,text,text)
TO ingestion_retention;
GRANT ingestion_retention TO retention_service;
COMMIT;
```

The owner needs only schema `USAGE`, evidence/staging/ledger `SELECT, DELETE`, audit `INSERT`, and audit-sequence `USAGE, SELECT`; it must not retain schema `CREATE`, table ownership, `INSERT`/`UPDATE`/`TRUNCATE` on evidence, or read/delete/truncate access to the audit. The `NOLOGIN` retention role needs only schema `USAGE` and function `EXECUTE`; grant it to the authenticated operator/service login and revoke that membership when the service is retired. Never grant the caller membership in `ingestion_purge_owner`, and do not allow untrusted roles to create objects in the installation schema.

Retention deletion must call:

```sql
SELECT commerce.purge_ingestion_evidence(:evidence_id, :operator, :reason);
```

Both operator and reason are required. The function deletes dependent ingestion staging records, immutable conflict captures, and their idempotency ledger entries in the same transaction. It records the caller-supplied operator separately from authenticated `session_user`, plus the function owner, evidence identity/hash, reason, and time in the append-only `ingestion_purge_audit` table. The purge audit is not deleted by the function.

The migration pins the security-definer search path to `pg_catalog`, the installation schema, and `pg_temp` (last), and revokes `PUBLIC` execution. Verify those properties and the grants after every deployment. Back up the purge audit according to the organization's legal retention policy before database-level maintenance.
