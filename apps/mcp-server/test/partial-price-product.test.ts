import { describe, expect, it } from "vitest";
import { classifyShopifyCandidate, isPartialPriceListing } from "../src/shopify-match.js";
import { boundNamedIdentityRequirement } from "../src/named-product-identity.js";
import { evaluateProductRequirements } from "../src/product-requirements.js";

const title = "[Cakycos] Cosplay Professionally Styling Commission Wig - custom";
const partialPriceReason = "listed amount is a quote fee or deposit, not the complete product price";
// Verbatim opening of the product description recorded in the second search
// in artifacts/prompt-replay-acceptance-20260905/wig.jsonl, not a paraphrase.
const liveQuoteDescription = "[Cakycos] Cosplay Professionally Styling Commission Wig - custom Custom commission for a professionally styled, personalized cosplay wig tailored to your preferences. " +
  "How to Order Submit a Quote Request Fill out the required information and submit your commission request. " +
  "If we are unable to agree on a final quote or move forward with the commission, your quote request fee will be refunded. " +
  "If the commission proceeds, the quote request fee will be applied toward your final order total.";

describe("complete product price eligibility", () => {
  it("rejects the live commission quote-request fee instead of treating USD1 as the wig price", () => {
    expect(classifyShopifyCandidate("wig", { title, description: liveQuoteDescription, productType: "wig" })).toMatchObject({
      status: "IRRELEVANT", evidence: [partialPriceReason]
    });
  });

  it.each([
    { title: "Custom cosplay wig - deposit only", description: "Remaining balance is due before dispatch." },
    { title: "Custom cosplay wig", description: "This listing is a deposit only. The remaining balance is charged later." },
    { title: "Cosplay wig quote request fee", description: "The fee is credited toward your final order." },
    { title: "定制假发定金链接", description: "仅支付定金，尾款另付。" }
  ])("rejects an explicit partial-price listing: $title", product => {
    expect(classifyShopifyCandidate("wig", { ...product, productType: "wig" }).status).toBe("IRRELEVANT");
  });

  it.each([
    "No deposit required. This is the full price for the completed wig.",
    "This listing is not a deposit. The displayed price covers the finished wig.",
    "Professionally styled custom cosplay wig. Made to order and delivered ready to wear.",
    "Commission wig with a complete item price of USD80 including styling and the finished wig.",
    "Other products use a quote request fee applied toward their final order total. This wig is ready to ship.",
    "Custom order policy: quote request fees are applied toward final order totals. This ready-made wig costs USD80.",
    "Custom order policy. Your quote request fee is applied toward your final order total. Ready-made cosplay wig.",
    "The displayed price is the full product price. Your quote request fee is applied toward your final order total.",
    "The displayed price is the full product price. If the commission proceeds, the quote request fee will be applied toward your final order total.",
    "Custom order policy. If the commission proceeds, the quote request fee will be applied toward your final order total.",
    "For other products, the quote request fee will be applied toward your final order total.",
    "The quote request fee will not be applied toward your final order total. The listed price covers the completed wig.",
    "Our general policy allows a deposit on special orders, with the balance due later. Ready-made cosplay wig.",
    "No quote request fee is charged. A custom commission includes the completed wig."
  ])("does not convert full-price items or unrelated policy into partial-price listings: %s", description => {
    expect(classifyShopifyCandidate("wig", { title, description, productType: "wig" }).status).toBe("DISCOVERY_MATCH");
  });

  it.each(["the", "your"])("recognizes %s quote fee credited to your final order in a direct listing claim", determiner => {
    expect(isPartialPriceListing({ title, description: `If the commission proceeds, ${determiner} quote request fee will be applied toward your final order total.` })).toBe(true);
  });

  it("recognizes postfixed fee negation and keeps explicit fee searches identifiable as partial-price listings", () => {
    expect(isPartialPriceListing({ title: "Cosplay wig - quote request fee is not required" })).toBe(false);
    const deposit = { title: "Cosplay wig deposit only", productType: "wig" };
    expect(classifyShopifyCandidate("cosplay wig deposit", deposit).status).toBe("DISCOVERY_MATCH");
    expect(isPartialPriceListing(deposit)).toBe(true);
  });
});

describe("query-only named appearance eligibility", () => {
  it("accepts the independent agent's default character appearance wording without widening identity", () => {
    const query = "Honor of Kings Li Bai wig";
    expect(boundNamedIdentityRequirement("default character appearance", query)).toBe("honorofkings libai default");
    const input = { query, requiredFeatures: ["default character appearance"], excludedFeatures: [], preferences: [] };
    expect(evaluateProductRequirements({ title: "王者荣耀 李白 原皮 假发" }, input).assessment.status).toBe("SATISFIED");
    expect(evaluateProductRequirements({ title: "Honor of Kings Li Bai Phoenix wig",
      description: "Naruto default wig is available separately." }, input).assessment.status).toBe("NEEDS_VERIFICATION");
  });
  it("does not borrow another product's default appearance when no requiredFeatures were supplied", () => {
    expect(classifyShopifyCandidate("Honor of Kings Li Bai default appearance wig", {
      title: "Honor of Kings Li Bai Phoenix wig",
      description: "Honor of Kings Li Bai Phoenix wig. Naruto default wig is available separately.", productType: "wig"
    }).status).toBe("IRRELEVANT");
  });

  it("keeps direct same-product default appearance discoverable without an exact SKU claim", () => {
    expect(classifyShopifyCandidate("Honor of Kings Li Bai default appearance wig", {
      title: "王者荣耀 李白 原皮 假发", productType: "wig"
    }).status).toBe("DISCOVERY_MATCH");
  });
});
