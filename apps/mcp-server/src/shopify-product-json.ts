import { z } from "zod";

const VariantIdSchema = z.union([
  z.number().int().positive().transform(String),
  z.string().regex(/^\d{1,30}$/u)
]);

const ProductOptionSchema = z.object({
  name: z.string().trim().min(1).max(100),
  position: z.number().int().min(1).max(3),
  values: z.array(z.string().trim().min(1).max(300)).max(100)
}).passthrough();

const ProductVariantSchema = z.object({
  id: VariantIdSchema,
  title: z.string().trim().min(1).max(1_000),
  available: z.boolean(),
  price: z.number().int().nonnegative().max(100_000_000),
  sku: z.string().trim().max(300).nullable().optional(),
  barcode: z.string().trim().max(300).nullable().optional(),
  options: z.array(z.string().trim().min(1).max(300)).max(3).optional(),
  option1: z.string().trim().min(1).max(300).nullable().optional(),
  option2: z.string().trim().min(1).max(300).nullable().optional(),
  option3: z.string().trim().min(1).max(300).nullable().optional()
}).passthrough();

export const ShopifyProductJsonSchema = z.object({
  title: z.string().trim().min(1).max(1_000),
  handle: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,200}$/u),
  vendor: z.string().trim().max(300).optional(),
  product_type: z.string().trim().max(300).optional(),
  type: z.string().trim().max(300).optional(),
  description: z.string().max(100_000).optional(),
  featured_image: z.string().max(4_096).nullable().optional(),
  options: z.array(ProductOptionSchema).max(3).default([]),
  variants: z.array(ProductVariantSchema).min(1).max(100)
}).passthrough();

export type ShopifyProductJson = z.infer<typeof ShopifyProductJsonSchema>;
export type ShopifyProductJsonVariant = z.infer<typeof ProductVariantSchema>;

export function shopifyVariantDimensions(
  productOptions: z.infer<typeof ProductOptionSchema>[],
  variant: ShopifyProductJsonVariant
): Record<string, string> {
  const values = variant.options ?? [variant.option1, variant.option2, variant.option3]
    .filter((value): value is string => value !== undefined && value !== null && value !== "");
  return Object.fromEntries(productOptions
    .sort((left, right) => left.position - right.position)
    .map((option, index) => [option.name, values[index]])
    .filter((entry): entry is [string, string] => entry[1] !== undefined));
}
