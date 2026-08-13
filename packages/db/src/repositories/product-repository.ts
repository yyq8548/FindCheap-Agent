import type { Database } from "../client.js";
import type { CanonicalProduct } from "../schema.js";

export interface ProductRepository {
  upsert(input: CanonicalProduct): Promise<void>;
}

export function createProductRepository(db: Database): ProductRepository {
  return {
    async upsert(input) {
      await db.query(
        `INSERT INTO products (
          id, brand, manufacturer_part_number, gtins, title, category_path, attributes, variant_dimensions
        ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb)
        ON CONFLICT (id) DO UPDATE SET
          brand = EXCLUDED.brand,
          manufacturer_part_number = EXCLUDED.manufacturer_part_number,
          gtins = EXCLUDED.gtins,
          title = EXCLUDED.title,
          category_path = EXCLUDED.category_path,
          attributes = EXCLUDED.attributes,
          variant_dimensions = EXCLUDED.variant_dimensions,
          updated_at = now()`,
        [
          input.productId,
          input.brand,
          input.manufacturerPartNumber ?? null,
          input.gtins,
          input.title,
          input.categoryPath,
          JSON.stringify(input.attributes),
          JSON.stringify(input.variantDimensions)
        ]
      );
    }
  };
}
