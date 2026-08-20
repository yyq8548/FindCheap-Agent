import { describe, expect, it } from "vitest";
import {
  createAffiliateLinkResolver,
  parseAffiliateRegistry
} from "../src/affiliate-links.js";

const approvedRegistry = {
  version: "v1",
  relationships: [{
    merchantId: "death-wish-coffee",
    status: "APPROVED",
    providerName: "Fixture Network",
    affiliateOrigin: "https://go.fixture-affiliate.example",
    template: "https://go.fixture-affiliate.example/click?campaign={campaignId}&url={merchantUrl}",
    campaignIdEnv: "DEATH_WISH_AFFILIATE_CAMPAIGN_ID"
  }]
} as const;

describe("Shopify affiliate links", () => {
  it("allows a Global Catalog canonical product URL only on its exact observed host", () => {
    const resolver = createAffiliateLinkResolver({ version: "v1", relationships: [] }, {});
    expect(resolver.resolve({
      merchantId: "shopify-11236098",
      merchantUrl: "https://skybygramophone.com/products/sony-wh-1000xm5?variant=1#details",
      sourceHost: "skybygramophone.com"
    })).toEqual({
      kind: "CANONICAL",
      url: "https://skybygramophone.com/products/sony-wh-1000xm5?variant=1"
    });
    expect(() => resolver.resolve({
      merchantId: "shopify-11236098",
      merchantUrl: "https://evil.example/products/sony-wh-1000xm5",
      sourceHost: "skybygramophone.com"
    })).toThrow("merchant URL is not approved");
  });

  it("ships with no approved relationships and keeps canonical merchant links", () => {
    const resolver = createAffiliateLinkResolver();
    expect(resolver.resolve({
      merchantId: "death-wish-coffee",
      merchantUrl: "https://deathwishcoffee.com/products/coffee",
      sourceHost: "deathwishcoffee.com"
    })).toEqual({
      kind: "CANONICAL",
      url: "https://deathwishcoffee.com/products/coffee"
    });
  });

  it("emits an affiliate link and disclosure only after checked-in approval and runtime credential", () => {
    const resolver = createAffiliateLinkResolver(approvedRegistry, {
      DEATH_WISH_AFFILIATE_CAMPAIGN_ID: "campaign 42"
    });
    expect(resolver.resolve({
      merchantId: "death-wish-coffee",
      merchantUrl: "https://deathwishcoffee.com/products/coffee?size=12oz",
      sourceHost: "deathwishcoffee.com"
    })).toEqual({
      kind: "APPROVED_AFFILIATE",
      url: "https://go.fixture-affiliate.example/click?campaign=campaign%2042&url=https%3A%2F%2Fdeathwishcoffee.com%2Fproducts%2Fcoffee%3Fsize%3D12oz",
      providerName: "Fixture Network",
      disclosure: "We may earn a commission if you buy through this link. This does not raise your price or affect ranking."
    });
  });

  it("fails closed to the canonical URL when approval credentials are absent", () => {
    const resolver = createAffiliateLinkResolver(approvedRegistry, {});
    expect(resolver.resolve({
      merchantId: "death-wish-coffee",
      merchantUrl: "https://deathwishcoffee.com/products/coffee",
      sourceHost: "deathwishcoffee.com"
    })).toEqual({
      kind: "CANONICAL",
      url: "https://deathwishcoffee.com/products/coffee"
    });
  });

  it.each([
    { ...approvedRegistry, relationships: [{ ...approvedRegistry.relationships[0], status: "PENDING" }] },
    { ...approvedRegistry, relationships: [{ ...approvedRegistry.relationships[0], affiliateOrigin: "http://go.fixture-affiliate.example" }] },
    { ...approvedRegistry, relationships: [{ ...approvedRegistry.relationships[0], template: "https://{campaignId}.fixture-affiliate.example/click" }] },
    { ...approvedRegistry, relationships: [{ ...approvedRegistry.relationships[0], template: "https://go.fixture-affiliate.example/click?campaign={campaignId}" }] },
    { ...approvedRegistry, relationships: [{ ...approvedRegistry.relationships[0], template: "https://go.fixture-affiliate.example/click?commission={commission}" }] }
  ])("rejects unapproved or unsafe relationship configuration", (registry) => {
    expect(() => parseAffiliateRegistry(registry)).toThrow();
  });
});
