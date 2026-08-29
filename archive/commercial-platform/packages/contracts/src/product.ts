import { z } from "zod";

export const AttributeSchema = z
  .object({
    name: z.string().min(1),
    value: z.string().min(1),
    unit: z.string().min(1).optional(),
    source: z.string().min(1),
    confidence: z.number().min(0).max(1)
  })
  .strict();

export const CanonicalProductSchema = z
  .object({
    productId: z.string().min(1),
    brand: z.string().min(1),
    manufacturerPartNumber: z.string().min(1).optional(),
    gtins: z.array(z.string().regex(/^\d{8,14}$/)),
    title: z.string().min(1),
    categoryPath: z.array(z.string().min(1)),
    attributes: z.array(AttributeSchema),
    variantDimensions: z.record(z.string(), z.string())
  })
  .strict();

export type CanonicalProduct = z.infer<typeof CanonicalProductSchema>;
