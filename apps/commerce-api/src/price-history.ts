import { createHash } from "node:crypto";
import { z } from "zod";
import type { Database } from "../../../packages/db/src/client.js";

const PriceHistoryInputBaseSchema = z.object({
  merchantId: z.string().trim().min(1).max(80),
  merchantProductId: z.string().trim().min(1).max(200),
  basis: z.enum(["ITEM_PRICE", "DELIVERED_TOTAL"]),
  zipCode: z.string().regex(/^\d{5}(?:-\d{4})?$/u).optional(),
  membershipIds: z.array(z.string().trim().min(1).max(80)).max(20).default([])
    .transform((memberships) => [...new Set(memberships)].sort())
}).strict();

function requireDeliveredContext(
  input: { basis: "ITEM_PRICE" | "DELIVERED_TOTAL"; zipCode?: string | undefined },
  context: z.RefinementCtx
): void {
  if (input.basis === "DELIVERED_TOTAL" && input.zipCode === undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "DELIVERED_TOTAL requires zipCode" });
  }
}

export const PriceHistoryInputSchema = PriceHistoryInputBaseSchema.superRefine(requireDeliveredContext);

export type PriceHistoryInput = z.infer<typeof PriceHistoryInputSchema>;
export type PriceHistoryObservation = {
  amountCents: number;
  currency: "USD";
  basis: "ITEM_PRICE" | "DELIVERED_TOTAL";
  observedAt: string;
};

export const PriceObservationInputSchema = PriceHistoryInputBaseSchema.extend({
  amountCents: z.number().int().positive().max(100_000_000),
  currency: z.literal("USD"),
  sourceKind: z.enum([
    "AWIN_PRODUCT_FEED",
    "SHOPIFY_GLOBAL_CATALOG",
    "EBAY_BROWSE",
    "SHOPIFY_CART_ESTIMATE"
  ]),
  observedAt: z.string().datetime({ offset: true })
}).strict().superRefine(requireDeliveredContext);

export type PriceObservationInput = z.infer<typeof PriceObservationInputSchema>;

export interface PriceHistoryRepository {
  record(input: PriceObservationInput, now: Date): Promise<"RECORDED" | "DUPLICATE" | undefined>;
  lookup(input: PriceHistoryInput, now: Date): Promise<PriceHistoryObservation[] | undefined>;
}

type HistoryRow = { amount_cents: string | number; observed_at: Date };

export function createPriceHistoryRepository(
  db: Database
): PriceHistoryRepository {
  return {
    async record(input, now) {
      const observedAt = new Date(input.observedAt);
      if (
        !Number.isFinite(observedAt.getTime()) ||
        observedAt.getTime() > now.getTime() + 120_000 ||
        observedAt.getTime() < now.getTime() - 7 * 86_400_000
      ) return undefined;
      const result = await db.query<{ id: string | number }>(
        `INSERT INTO price_observations (
           merchant_id, merchant_product_id, basis, amount_cents, currency,
           context_hash, source_kind, observed_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [input.merchantId, input.merchantProductId, input.basis, input.amountCents,
          input.currency, contextHash(input), input.sourceKind, observedAt]
      );
      return result.rows.length === 0 ? "DUPLICATE" : "RECORDED";
    },
    async lookup(input, now) {
      if (input.basis === "DELIVERED_TOTAL" && input.zipCode === undefined) return undefined;
      const result = await db.query<HistoryRow>(
        `SELECT DISTINCT ON ((observed_at AT TIME ZONE 'UTC')::date)
           amount_cents::text, observed_at
         FROM price_observations
         WHERE merchant_id = $1
           AND merchant_product_id = $2
           AND basis = $3
           AND context_hash = $4
           AND observed_at <= $5
           AND observed_at >= $5 - INTERVAL '365 days'
         ORDER BY ((observed_at AT TIME ZONE 'UTC')::date) DESC, observed_at DESC, id DESC
         LIMIT 366`,
        [input.merchantId, input.merchantProductId, input.basis, contextHash(input), now]
      );
      return result.rows.flatMap((row) => {
        const amountCents = Number(row.amount_cents);
        const observedAt = new Date(row.observed_at).toISOString();
        return Number.isSafeInteger(amountCents) && amountCents > 0 && Number.isFinite(Date.parse(observedAt))
          ? [{ amountCents, currency: "USD" as const, basis: input.basis, observedAt }]
          : [];
      });
    }
  };
}

function contextHash(input: Pick<PriceHistoryInput, "basis" | "zipCode" | "membershipIds">): string {
  const context = input.basis === "ITEM_PRICE"
    ? { basis: input.basis }
    : { basis: input.basis, zipCode: input.zipCode, membershipIds: input.membershipIds };
  return createHash("sha256").update(JSON.stringify(context)).digest("hex");
}
