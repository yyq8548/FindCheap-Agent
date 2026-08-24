import { PriceQuoteSchema, type PriceQuote } from "../../../contracts/src/index.js";
import type { PublishedQuote } from "../../../ingestion-contracts/src/index.js";
import type { SqlExecutor } from "../client.js";
import type { QuoteStagingRow } from "./promotion-types.js";

export function quoteLineItems(quote: PublishedQuote): PriceQuote["lineItems"] {
  const money = (amountCents: number) => ({ amountCents, currency: "USD" as const });
  return [
    { kind: "ITEM" as const, amount: money(quote.itemPriceCents), label: "Item price" },
    { kind: "SHIPPING" as const, amount: money(quote.shippingCents), label: "Shipping" },
    { kind: "TAX" as const, amount: money(quote.taxCents), label: "Tax" },
    { kind: "MANDATORY_FEE" as const, amount: money(quote.mandatoryFeeCents), label: "Mandatory fee" }
  ];
}

export function promotedQuoteSnapshot(
  staging: QuoteStagingRow,
  quoteId: string,
  offerId: string
): PriceQuote {
  return PriceQuoteSchema.parse({
    quoteId,
    offerId,
    status: staging.payload.status,
    deliveredPrice: {
      amountCents: Number(staging.delivered_price_cents),
      currency: "USD"
    },
    lineItems: quoteLineItems(staging.payload),
    eligibilityConditions: staging.payload.conditions,
    evidenceRefs: [staging.primary_evidence_id],
    checkedAt: staging.checked_at.toISOString(),
    expiresAt: staging.expires_at.toISOString()
  });
}

export async function replaceEvidence(
  transaction: SqlExecutor,
  table: "offer_evidence" | "quote_evidence",
  key: "offer_id" | "quote_id",
  recordId: string,
  evidenceId: string
): Promise<void> {
  await transaction.query(`DELETE FROM ${table} WHERE ${key} = $1`, [recordId]);
  await transaction.query(
    `INSERT INTO ${table} (${key}, evidence_id) VALUES ($1, $2)`,
    [recordId, evidenceId]
  );
}
