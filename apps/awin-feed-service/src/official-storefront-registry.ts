import { createHash } from "node:crypto";

import {
  OfficialStorefrontRegistrySchema,
  type OfficialStorefrontRegistry
} from "../../../packages/contracts/src/index.js";

const DEFAULT_REGISTRY: OfficialStorefrontRegistry = OfficialStorefrontRegistrySchema.parse({
  version: "official-storefronts-2026-08-28",
  stores: [
    shopify("DÔEN", [], "shopdoen.com", "www.shopdoen.com", "https://www.shopdoen.com/", "2026-08-20"),
    shopify("SKIMS", ["NikeSKIMS"], "skims.com", undefined, "https://skims.com/", "2026-08-27"),
    shopify("Death Wish Coffee", ["Death Wish"], "deathwishcoffee.com", "www.deathwishcoffee.com", "https://www.deathwishcoffee.com/", "2026-08-27"),
    shopify("BLK & Bold", ["BLK and Bold"], "blkandbold.com", undefined, "https://blkandbold.com/", "2026-08-27"),
    shopify("Verve Coffee", ["Verve"], "vervecoffee.com", "www.vervecoffee.com", "https://www.vervecoffee.com/", "2026-08-27"),
    shopify("Steve Madden", [], "stevemadden.com", "www.stevemadden.com", "https://www.stevemadden.com/", "2026-08-27"),
    shopify("Allbirds", [], "allbirds.com", "www.allbirds.com", "https://www.allbirds.com/", "2026-08-27"),
    shopify("Brooklinen", [], "brooklinen.com", "www.brooklinen.com", "https://www.brooklinen.com/", "2026-08-27"),
    shopify("Glossier", [], "glossier.com", "www.glossier.com", "https://www.glossier.com/", "2026-08-27"),
    shopify("ColourPop", [], "colourpop.com", undefined, "https://colourpop.com/", "2026-08-27"),
    {
      brand: "Free People",
      aliases: ["FP", "Intimately"],
      officialHost: "freepeople.com",
      storefrontHost: "www.freepeople.com",
      platform: "GENERIC_JSON_LD",
      productPathPrefixes: ["/shop/"],
      searchPathTemplate: "/search/?q={query}",
      imageHosts: ["images.urbndata.com"],
      evidenceUrl: "https://www.freepeople.com/",
      reviewedAt: "2026-08-28",
      status: "APPROVED"
    }
  ]
});

export type ServedOfficialStorefrontRegistry = {
  body: string;
  etag: string;
  registry: OfficialStorefrontRegistry;
};

export function officialStorefrontRegistryFromEnvironment(
  environment: Readonly<Record<string, string | undefined>>
): ServedOfficialStorefrontRegistry {
  const configured = environment.FINDCHEAP_OFFICIAL_STOREFRONTS_JSON?.trim();
  const registry = configured === undefined || configured === ""
    ? DEFAULT_REGISTRY
    : OfficialStorefrontRegistrySchema.parse(JSON.parse(configured));
  const body = JSON.stringify(registry);
  return {
    body,
    etag: `"${createHash("sha256").update(body).digest("base64url")}"`,
    registry
  };
}

function shopify(
  brand: string,
  aliases: string[],
  officialHost: string,
  storefrontHost: string | undefined,
  evidenceUrl: string,
  reviewedAt: string
) {
  return {
    brand,
    aliases,
    officialHost,
    ...(storefrontHost === undefined ? {} : { storefrontHost }),
    platform: "SHOPIFY" as const,
    productPathPrefixes: ["/products/"],
    imageHosts: ["cdn.shopify.com"],
    evidenceUrl,
    reviewedAt,
    status: "APPROVED" as const
  };
}
