import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  buildProductComparison,
  type ComparableProduct,
  type ProductComparisonInput
} from "../../apps/mcp-server/src/product-comparison.js";

const goldenPath = new URL("./product-comparison-golden.json", import.meta.url);

type GoldenCase = {
  id: string;
  mode: ProductComparisonInput["mode"];
  products: Array<{
    selectionId: string;
    merchant: string;
    sku: string;
    gtin: string;
    itemPriceCents?: number;
    deliveredTotalCents?: number;
    deliveredTotalExpiresAt?: string;
  }>;
  expected: {
    status: string;
    mode: string;
    priceBasis: string;
    entryCount: number;
    lowestSelectionId?: string;
    highestSelectionId?: string;
    deltaCents?: number;
    forbiddenReasonCodes?: string[];
  };
};

function product(value: GoldenCase["products"][number]): ComparableProduct {
  return {
    selectionId: value.selectionId,
    title: `Fixture ${value.sku}`,
    merchant: value.merchant,
    merchantUrl: `https://merchant.example/${value.selectionId}`,
    brand: "Fixture Brand",
    sku: value.sku,
    gtins: [value.gtin],
    variantDimensions: { Size: "Standard" },
    matchStatus: "EXACT",
    presentationGroup: "TRUSTED_MATCH",
    recommendationTier: "TRUSTED_OR_AFFILIATE",
    ...(value.itemPriceCents === undefined
      ? {}
      : { itemPrice: { amountCents: value.itemPriceCents, currency: "USD" as const } }),
    pricing: {
      deliveredPrice: value.deliveredTotalCents === undefined
        ? { status: "UNAVAILABLE" }
        : {
            status: "ESTIMATED",
            amount: { amountCents: value.deliveredTotalCents, currency: "USD" },
            expiresAt: value.deliveredTotalExpiresAt ?? "2026-09-03T07:00:00.000Z"
          }
    },
    availability: "IN_STOCK",
    condition: "NEW",
    merchantTrust: { level: "ESTABLISHED_RETAILER", verification: "INDEPENDENT" },
    coupons: { verified: [] },
    matchEvidence: ["golden identity evidence"],
    requiredFeatureLimitations: [],
    checkedAt: "2026-09-03T06:00:00.000Z"
  };
}

describe("product comparison golden eval", () => {
  it("keeps comparison modes and price bases deterministic", async () => {
    const golden = JSON.parse(await readFile(goldenPath, "utf8")) as { cases: GoldenCase[] };
    expect(golden.cases).toHaveLength(5);
    expect(new Set(golden.cases.map((item) => item.id)).size).toBe(golden.cases.length);

    for (const item of golden.cases) {
      const result = buildProductComparison({
        selectionIds: item.products.map((product) => product.selectionId),
        mode: item.mode,
        focus: [],
        responseLocale: "en-US"
      }, item.products.map(product), {
        comparisonId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        renderId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        expiresAt: "2026-09-03T08:00:00.000Z",
        evaluatedAt: "2026-09-03T06:00:00.000Z"
      });

      expect(result.status, item.id).toBe(item.expected.status);
      expect(result.mode, item.id).toBe(item.expected.mode);
      expect(result.priceBasis, item.id).toBe(item.expected.priceBasis);
      expect(result.entries, item.id).toHaveLength(item.expected.entryCount);
      if (item.expected.deltaCents === undefined) {
        expect(result.priceDelta, item.id).toBeUndefined();
      } else {
        expect(result.priceDelta, item.id).toMatchObject({
          lowestSelectionId: item.expected.lowestSelectionId,
          highestSelectionId: item.expected.highestSelectionId,
          amountCents: item.expected.deltaCents
        });
      }
      for (const reason of item.expected.forbiddenReasonCodes ?? []) {
        expect(result.recommendation?.reasonCodes, item.id).not.toContain(reason);
      }
    }
  });
});
