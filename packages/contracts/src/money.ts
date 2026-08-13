import { z } from "zod";

export const MoneySchema = z
  .object({
    amountCents: z.number().int(),
    currency: z.literal("USD")
  })
  .strict();

export type Money = z.infer<typeof MoneySchema>;
