import { describe, expect, it } from "vitest";
import { DEFAULT_WOO_REGISTRY } from "../src/woocommerce-registry.js";
import { planWooMerchants } from "../src/woocommerce-routing.js";
import { WooSearchInputSchema } from "../../../packages/contracts/src/woocommerce.js";

describe("reviewed wig and headphone research coverage", () => {
  it.each([["human hair wig", "recool-hair"], ["假发", "recool-hair"], ["headphones", "silent-sound-system"], ["耳机", "silent-sound-system"]])(
    "routes %s to an evidenced source within the existing budget", (query, merchantId) => {
      const plan = planWooMerchants(DEFAULT_WOO_REGISTRY.stores, WooSearchInputSchema.parse({ query: query! }));
      expect(plan.stores[0]?.merchantId).toBe(merchantId);
      expect(plan.routing.relevantPlanned).toBeGreaterThan(0);
      expect(plan.stores.length).toBeLessThanOrEqual(6);
      expect(plan.routing.explorationPlanned).toBeLessThanOrEqual(2);
      expect(plan.stores[0]?.requiresOptionSelection).toBe(true);
    }
  );
});
