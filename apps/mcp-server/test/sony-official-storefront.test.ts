import { afterEach, describe, expect, it } from "vitest";

import { OfficialStorefrontRecordSchema } from "../../../packages/contracts/src/index.js";
import { DEFAULT_OFFICIAL_STOREFRONT_REGISTRY } from "../../awin-feed-service/src/official-storefront-registry.js";
import { replaceManagedOfficialStorefronts, resolveMerchantTrust, resolveVerifiedOfficialStorefront } from "../src/merchant-trust.js";

const sony = {
  brand: "Sony", aliases: [], officialHost: "electronics.sony.com", platform: "SONY_OCC",
  productPathPrefixes: ["/audio/"],
  imageHosts: ["d1ncau8tqf99kp.cloudfront.net"],
  evidenceUrl: "https://electronics.sony.com/", reviewedAt: "2026-09-06", status: "APPROVED"
};

afterEach(() => replaceManagedOfficialStorefronts([]));

describe("reviewed Sony official source", () => {
  it("accepts the fixed Sony OCC contract, not a caller-selected API origin", () => {
    expect(OfficialStorefrontRecordSchema.parse(sony)).toEqual(sony);
    expect(OfficialStorefrontRecordSchema.safeParse({ ...sony, apiOrigin: "https://other.example" }).success).toBe(false);
    expect(OfficialStorefrontRecordSchema.safeParse({ ...sony, officialHost: "other.example" }).success).toBe(false);
  });

  it("retains the static Sony source when an older managed registry omits Sony", () => {
    replaceManagedOfficialStorefronts([DEFAULT_OFFICIAL_STOREFRONT_REGISTRY.stores[0]!]);
    expect(resolveVerifiedOfficialStorefront("Sony")).toMatchObject({
      brand: "Sony", host: "electronics.sony.com", platform: "SONY_OCC",
      imageHosts: ["d1ncau8tqf99kp.cloudfront.net"]
    });
  });

  it("includes the reviewed source in the default served registry without trusting its API host as a merchant", () => {
    expect(DEFAULT_OFFICIAL_STOREFRONT_REGISTRY.stores.find(store => store.brand === "Sony")).toMatchObject(sony);
    expect(resolveMerchantTrust("api.cqiypyix22-sonyelect1-p1-public.model-t.cc.commerce.ondemand.com").level).toBe("UNKNOWN");
  });
});
