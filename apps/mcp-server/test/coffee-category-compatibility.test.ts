import { describe, expect, it } from "vitest";
import { assessCoffeeCompatibility, coffeeCompatibilityRequirement, requestedCoffeeSystem } from "../src/coffee-category.js";
import { assessRanking } from "../src/ranking-assessment.js";
import { choosePrimaryRecommendation, coffeeCompatibilityClarification } from "../src/product-recommendation.js";
import { countQualifiedMatchCandidates, countRecommendationEligibleCandidates, selectPresentationCandidates } from "../src/product-candidate-ranking.js";
import type { UnifiedCandidate } from "../src/search-products.js";
import { researchRecommendationMessage } from "../src/recommendation-message.js";

const request = { query: "coffee capsules", productType: "coffee capsules" };
const original = { ...request, requiredFeatures: ["Compatible with Nespresso Original"] };
const candidate = { title: "Coffee Capsules", variantDimensions: { System: "Nespresso Original" } };
const base = { title: "Coffee Capsules", matchStatus: "DISCOVERY_MATCH" as const, availability: "IN_STOCK" as const,
  merchantTrust: { verification: "INDEPENDENT" as const, level: "ESTABLISHED_RETAILER" as const },
  itemPriceCents: 1500, matchEvidence: [], coupons: { verified: [] }, itemPrice: { amountCents: 1500, currency: "USD" as const } };

describe("capsule compatibility is separate from product form", () => {
  it("keeps a matching capsule displayed while an unknown system blocks primary", () => {
    const coffeeCompatibility = { status: "UNKNOWN" as const, evidence: "user machine system unverified", observedSystems: [] };
    expect(assessRanking({ ...base, coffeeCompatibility })).toMatchObject({ displayEligible: true, primaryEligible: false,
      primaryBlockReasons: ["COFFEE_SYSTEM_UNVERIFIED"] });
    expect(choosePrimaryRecommendation([{ ...base, coffeeCompatibility }])).toMatchObject({ state: "MATCHES_AVAILABLE" });
    expect(choosePrimaryRecommendation([{ ...base, coffeeCompatibility }]).primaryProductIndex).toBeUndefined();
  });
  it("does not infer the user's system from a candidate, brand-only Nespresso, or a preference", () => {
    expect(assessCoffeeCompatibility(request, candidate)).toMatchObject({ status: "UNKNOWN" });
    expect(requestedCoffeeSystem({ ...request, primaryUse: "Nespresso" })).toBeUndefined();
    expect(requestedCoffeeSystem({ ...request, features: ["Nespresso Original"], featureMode: "PREFERRED" })).toBeUndefined();
  });
  it("keeps the source candidate funnel consistent with display and primary eligibility", () => {
    const entry: UnifiedCandidate = { source: "SHOPIFY_GLOBAL_CATALOG", affiliateState: "NONE", recommendationTier: "TRUSTED_OR_AFFILIATE",
      featureEvidence: [], preferenceEvidence: [], requiredFeatureLimitations: [], verifiedCoupons: [], identityStatus: "DISCOVERY_MATCH",
      identityEvidence: [], resultGroup: "DISCOVERY", coffeeCompatibility: assessCoffeeCompatibility(request, candidate),
      shopifyProduct: { ...base, merchantId: "synthetic", merchant: "Synthetic Coffee", sourceHost: "coffee.example", handle: "1",
        merchantTrust: { ...base.merchantTrust, evidence: ["synthetic reviewed merchant fixture"] }, gtins: [], variantDimensions: {},
        condition: "NEW", merchantUrl: "https://coffee.example/products/capsules", checkedAt: "2026-09-08T22:00:00.000Z" } };
    expect(countQualifiedMatchCandidates([entry])).toBe(1);
    expect(countRecommendationEligibleCandidates([entry])).toBe(0);
    expect(selectPresentationCandidates([entry], "MERCHANT_DIVERSE", false, false, false)[0]?.presentationGroup).toBe("TRUSTED_MATCH");
  });
  it.each([
    ["Nespresso Original", "NESPRESSO_ORIGINAL"], ["Nespresso Vertuo", "NESPRESSO_VERTUO"],
    ["Dolce Gusto", "DOLCE_GUSTO"], ["Keurig K-Cup", "KEURIG_K_CUP"],
    ["ESE 44mm", "ESE_44MM"], ["Espressotoria", "ESPRESSOTORIA"]
  ])("uses the explicit requested and selected %s system", (system, expected) => {
    const input = { ...request, requiredFeatures: [`Compatible with ${system}`] };
    expect(requestedCoffeeSystem(input)).toBe(expected);
    expect(assessCoffeeCompatibility(input, { ...candidate, variantDimensions: { System: system } }))
      .toMatchObject({ status: "MATCHED", requestedSystem: expected, observedSystems: [expected] });
  });
  it("rejects a selected Vertuo capsule for an Original request despite parent compatibility copy", () => {
    expect(assessCoffeeCompatibility(original, { title: "Nespresso Original Coffee Capsules", description: "Original and Vertuo options.",
      variantDimensions: { "Capsule System": "Nespresso Vertuo" } })).toMatchObject({ status: "CONTRADICTED" });
  });
  it("does not let a selected system override an explicit primary incompatibility", () => {
    expect(assessCoffeeCompatibility(original, { title: "Coffee capsules not compatible with Nespresso Original",
      variantDimensions: { system: "Nespresso Original" } })).toMatchObject({ status: "CONTRADICTED", observedSystems: [] });
  });
  it("uses one selected system when the parent lists multiple positive compatibility options", () => {
    expect(assessCoffeeCompatibility(original, { title: "Coffee capsules for Nespresso Original / Nespresso Vertuo",
      variantDimensions: { system: "Nespresso Original" } })).toMatchObject({ status: "MATCHED", observedSystems: ["NESPRESSO_ORIGINAL"] });
  });
  it.each([
    { title: "Coffee Capsules", description: "We also sell Nespresso Original capsules." },
    { title: "Nespresso Original Coffee Capsules", variantDimensions: { System: "Select a system" } },
    { title: "Coffee Capsules", variantDimensions: { System: "Nespresso Original / Nespresso Vertuo" } }
  ])("keeps unresolved or unselected compatibility unknown: %j", product => {
    expect(assessCoffeeCompatibility(original, product).status).toBe("UNKNOWN");
  });
  it("uses explicit primary compatibility and rejects explicitly negated compatibility", () => {
    expect(assessCoffeeCompatibility(original, { title: "Coffee Capsules compatible with Nespresso Original machines" }).status).toBe("MATCHED");
    expect(assessCoffeeCompatibility(original, { title: "Coffee Capsules not compatible with Nespresso Original" }).status).toBe("CONTRADICTED");
    expect(requestedCoffeeSystem({ ...request, requiredFeatures: ["Not compatible with Nespresso Original"] })).toBeUndefined();
  });
  it("applies no capsule requirement to whole beans or equipment", () => {
    expect(assessCoffeeCompatibility({ query: "whole bean coffee", productType: "whole bean coffee" }, candidate).status).toBe("NOT_APPLICABLE");
    expect(assessCoffeeCompatibility({ query: "Nespresso coffee capsule machine" }, candidate).status).toBe("NOT_APPLICABLE");
  });
  it("retains the capsule requirement when an inherited broad coffee type accompanies a refined query", () => {
    expect(assessCoffeeCompatibility({ query: "coffee capsules", productType: "coffee" }, candidate).status).toBe("UNKNOWN");
  });
  it("keeps compatibility mandatory for an explicitly named capsule-system query without changing its identity", () => {
    expect(assessCoffeeCompatibility({ query: "Nespresso Original capsules" }, {
      title: "Nespresso Original Capsules", variantDimensions: { System: "Nespresso Vertuo" }
    }).status).toBe("CONTRADICTED");
  });
  it("does not rescue a contradictory system through the common ranking gate", () => {
    const coffeeCompatibility = assessCoffeeCompatibility(original, { ...candidate, variantDimensions: { System: "Nespresso Vertuo" } });
    expect(assessRanking({ ...base, coffeeCompatibility })).toMatchObject({ displayEligible: false, primaryEligible: false });
    expect(choosePrimaryRecommendation([{ ...base, coffeeCompatibility }]).primaryProductIndex).toBeUndefined();
    expect(assessRanking({ ...base, coffeeCompatibility: assessCoffeeCompatibility(original, candidate) }).primaryEligible).toBe(true);
  });
  it("asks for the complete machine model or system only when the requested system is missing", () => {
    expect(coffeeCompatibilityClarification({ ...request, responseLocale: "zh-CN" })).toMatchObject({
      kind: "COFFEE_COMPATIBILITY", question: expect.stringContaining("完整型号") });
    expect(coffeeCompatibilityClarification(original)).toBeUndefined();
    expect(coffeeCompatibilityClarification({ query: "whole bean coffee" })).toBeUndefined();
  });
  it("explains system uncertainty in both locales without inventing a merchant-trust failure", () => {
    const summary = { productCount: 1, merchantCount: 1, reasonCodes: ["COFFEE_SYSTEM_UNVERIFIED" as const] };
    expect(researchRecommendationMessage(summary, "zh-CN")).toContain("胶囊系统兼容性尚未核实");
    expect(researchRecommendationMessage(summary, "en-US")).toContain("capsule system compatibility is unverified");
  });
  it.each(["Compatible with Nespresso Original", "Nespresso Original", "兼容 Nespresso Original"])(
    "recognizes the whole compatibility requirement %s", requirement => {
      expect(coffeeCompatibilityRequirement(requirement)).toBe("NESPRESSO_ORIGINAL");
    });
  it.each(["Compatible with Nespresso Original and organic", "Nespresso Original without caffeine", "Not compatible with Nespresso Original",
    "Nespresso", "Compatible with Nespresso Original or Vertuo"])("does not consume mixed or ambiguous requirements: %s", requirement => {
    expect(coffeeCompatibilityRequirement(requirement)).toBeUndefined();
  });
});
