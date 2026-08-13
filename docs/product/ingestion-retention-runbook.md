# Ingestion Evidence Retention

`ingestion_evidence` is immutable. Application and worker roles must not receive direct `UPDATE`, `DELETE`, or `TRUNCATE` privileges on ingestion evidence or its staging tables.

Retention deletion must call:

```sql
SELECT purge_ingestion_evidence(:evidence_id, :operator, :reason);
```

Both operator and reason are required. The function deletes dependent ingestion staging records and their idempotency ledger entries in the same transaction. Its trigger writes the evidence ID, source identity, content hash, operator, reason, and time to the append-only `ingestion_purge_audit` table. The purge audit is not deleted by the function.

Grant production execution of this function only to the designated retention role. Do not grant that role table ownership or `TRUNCATE`. Back up the purge audit according to the organization's legal retention policy before database-level maintenance.
