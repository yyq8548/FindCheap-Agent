import { describe, expect, it } from "vitest";
import { assessCoffeeCategory } from "../src/coffee-category.js";
import { classifyShopifyCandidate } from "../src/shopify-match.js";

describe("capsule form and non-coffee evidence", () => {
  it.each([
    { title: "French Market Coffee Dark Roast 100% Ground Chicory 16 oz Can", productType: "Chicory" },
    { title: "Pallo COFFEETOOL Grouphead Brush", productType: "Espresso" },
    { title: "Pallo COFFEETOOL Grouphead Replacement Bristles, 3 pack", productType: "Espresso" },
    { title: "Peru Cajamarca FT Org. Norte – Lima Coffee – Washed Processed", productType: "All Coffees",
      merchantUrl: "https://burmancoffee.com/product/green-coffee-beans/peru-fto-lima-coffee-norte/" }
  ])("excludes the real non-capsule observation $title, instead of making a research lead", candidate => {
    // Exact title/type/product path from the 2026-09-08 original and repaired-bundle MCP receipts.
    expect(assessCoffeeCategory("PODS", candidate).status).toBe("CONTRADICTED");
    expect(assessCoffeeCategory("COFFEE", candidate).status).toBe("CONTRADICTED");
    expect(classifyShopifyCandidate("coffee capsules", candidate).status).toBe("IRRELEVANT");
  });
  it.each([
    { title: "Espresso Capsules", productType: "Coffee" },
    { title: "Coffee Single Serve Cups" },
    { title: "Nespresso Original Capsules", productType: "Coffee" },
    { title: "Coffee Capsules compatible with Nespresso Original machines" },
    { title: "Brush Mountain Coffee Capsules", productType: "Coffee" }
  ])("recognizes explicit primary capsule facts in $title", candidate => {
    // Synthetic vocabulary controls; no merchant compatibility is asserted.
    expect(assessCoffeeCategory("PODS", candidate).status).toBe("MATCHED");
    expect(classifyShopifyCandidate("coffee capsules", candidate).status).toBe("DISCOVERY_MATCH");
  });
  it.each(["Coffee Empty Capsules", "Refillable Coffee Capsules", "Reusable Coffee Pods", "Coffee Capsule Holder",
    "Coffee Capsule Machine", "Coffee Cup", "Coffee Capsules Storage Rack", "Coffee Capsule Cleaning Tablets"])(
    "excludes equipment, packaging or supplies: %s", title => {
      expect(assessCoffeeCategory("PODS", { title, productType: "Coffee" }).status).toBe("CONTRADICTED");
      expect(classifyShopifyCandidate("coffee capsules", { title, productType: "Coffee" }).status).toBe("IRRELEVANT");
    });
  it("keeps known wholebean and selected ground conflicts even when the parent advertises capsules", () => {
    expect(assessCoffeeCategory("PODS", { title: "Coffee – Wholebean" }).status).toBe("CONTRADICTED");
    expect(assessCoffeeCategory("PODS", { title: "Coffee Capsules", variantDimensions: { Grind: "Ground" } }).status).toBe("CONTRADICTED");
  });
  it("does not use unrelated descriptions or URL query text as current-product evidence", () => {
    expect(assessCoffeeCategory("PODS", { title: "House Blend Coffee", description: "We also sell Espresso Capsules." }).status).toBe("UNKNOWN");
    expect(assessCoffeeCategory("PODS", { title: "Coffee Capsules",
      merchantUrl: "https://coffee.example/products/capsules?related=green-coffee-beans" }).status).toBe("MATCHED");
  });
  it("preserves the coffee-and-chicory blend identity without accepting pure chicory", () => {
    expect(assessCoffeeCategory("GROUND", { title: "Ground Coffee and Chicory", productType: "Coffee & Chicory" }).status).toBe("MATCHED");
  });
  it("does not turn generic coffee evidence into the exact named coffee requested", () => {
    expect(classifyShopifyCandidate("Acme Glacier Roast Coffee BB1234", {
      title: "Other Coffee Capsules", productType: "Coffee", sku: "ZZ9999"
    }).status).not.toBe("EXACT");
  });
});
