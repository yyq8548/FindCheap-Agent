# Product Identity Key Backfill

Migration `0003_merchant_promotion.sql` adds normalized Brand+MPN identity columns without guessing values for existing products. Those legacy rows remain fail-closed: startup must reject any configuration that can use Brand+MPN matching until every product with a manufacturer part number has both keys.

Run the database migration first, then inspect the scope. The command is a dry run unless `--apply` is present:

```powershell
pnpm products:backfill-identity-keys
```

The JSON result reports `scanned`, `updated`, and `remaining`. A dry run never writes. Review the count, take the normal database backup, then apply in bounded transactions:

```powershell
pnpm products:backfill-identity-keys -- --apply
```

The default batch size is 100. It can be reduced for a busy database and cannot exceed 1,000:

```powershell
pnpm products:backfill-identity-keys -- --apply --batch-size 25
```

Each batch locks only its selected rows, derives keys with the same Unicode-aware `normalizeToken` function used by product matching, and updates a row only if its brand, MPN, and `updated_at` value are unchanged. A normalization failure rolls back the batch. If concurrent work leaves rows behind, the command fails and must be retried.

Run the dry command again and require `remaining: 0` before enabling a merchant source that can use Brand+MPN identity. Worker startup applies the same preflight and reports the exact apply command when legacy rows remain. Products without an MPN are not part of this backfill and continue through GTIN-only matching.
