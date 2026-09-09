import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { DEFAULT_WOO_REGISTRY } from "../../apps/awin-feed-service/src/woocommerce-registry.js";
import { OfficialStorefrontRegistrySchema } from "../../packages/contracts/src/official-storefront.js";
import { parseRegistryApprovalBatch } from "../../scripts/registry-builder.js";

type Decision = {
  merchantId: string;
  name: string;
  origin: string;
  decision: "OFFICIAL" | "ESTABLISHED_RETAILER" | "SEARCH_ONLY";
  brand?: string;
  aliases: string[];
  evidenceUrl: string;
  identitySummary: string;
  supportSummary: string;
  reason: string;
  limitations: string[];
  evidence: { url: string; checkedAt: string; status: string | number; summary: string }[];
};

const review = JSON.parse(readFileSync(new URL(
  "../../docs/engineering/changes/2026-09-08-woocommerce-trust-200-evidence.json", import.meta.url
), "utf8")) as {
  reviewedAt: string;
  accessRegistryVersion: string;
  counts: { reviewed: number; official: number; retailer: number; searchOnly: number };
  stores: Decision[];
};
const approvals = parseRegistryApprovalBatch(JSON.parse(readFileSync(new URL(
  "../../config/registries/reviewed-woocommerce-trust-2026-09-08.json", import.meta.url
), "utf8")));
const official = approvals.filter((approval) => approval.kind === "OFFICIAL_STOREFRONT");
const trusted = approvals.filter((approval) => approval.kind === "MERCHANT_TRUST");
const hostFor = (origin: string) => new URL(origin).hostname.replace(/^www\./u, "");
const normalizedBrand = (brand: string) => brand.normalize("NFKD").replace(/\p{M}+/gu, "")
  .toLocaleLowerCase("en-US").replace(/[^a-z0-9]+/gu, "");

describe("reviewed WooCommerce merchant trust data", () => {
  it("covers each of the original 200 access merchants exactly once without changing its identity", () => {
    expect(review.accessRegistryVersion).toBe("2026-09-08-expanded-200");
    expect(review.stores).toHaveLength(200);
    expect(new Set(review.stores.map((store) => store.merchantId)).size).toBe(200);
    expect(new Set(review.stores.map((store) => hostFor(store.origin))).size).toBe(200);
    expect(review.stores.map((store) => store.merchantId).sort())
      .toEqual(DEFAULT_WOO_REGISTRY.stores.slice(0, 200).map((store) => store.merchantId).sort());
    for (const store of review.stores) {
      expect(DEFAULT_WOO_REGISTRY.stores.find((entry) => entry.merchantId === store.merchantId), store.merchantId)
        .toMatchObject({ name: store.name, origin: store.origin });
    }
  });

  it("does not extend the historical trust approvals to the 800 new access merchants", () => {
    const added = DEFAULT_WOO_REGISTRY.stores.slice(200);
    expect(added).toHaveLength(800);
    const approvedHosts = new Set(approvals.map((approval) => approval.kind === "OFFICIAL_STOREFRONT"
      ? approval.record.officialHost : approval.record.host));
    for (const store of added) expect(approvedHosts.has(hostFor(store.origin)), store.merchantId).toBe(false);
  });

  it("retains the reviewed outcome denominator and the 319 bounded approvals", () => {
    const counts = {
      reviewed: review.stores.length,
      official: review.stores.filter((store) => store.decision === "OFFICIAL").length,
      retailer: review.stores.filter((store) => store.decision === "ESTABLISHED_RETAILER").length,
      searchOnly: review.stores.filter((store) => store.decision === "SEARCH_ONLY").length
    };
    expect(counts).toEqual({ reviewed: 200, official: 137, retailer: 45, searchOnly: 18 });
    expect(review.counts).toEqual(counts);
    expect(official).toHaveLength(137);
    expect(trusted).toHaveLength(182);
    expect(approvals).toHaveLength(319);
    const reviewedHosts = new Set(review.stores.map((store) => hostFor(store.origin)));
    for (const approval of approvals) {
      const host = approval.kind === "OFFICIAL_STOREFRONT" ? approval.record.officialHost : approval.record.host;
      expect(reviewedHosts.has(host), host).toBe(true);
    }
  });

  it("maps each decision to the exact permitted records and reviewed evidence", () => {
    for (const store of review.stores) {
      const host = hostFor(store.origin);
      const storefronts = official.filter((approval) => approval.record.officialHost === host);
      const trustRecords = trusted.filter((approval) => approval.record.host === host);
      expect(storefronts, store.merchantId).toHaveLength(store.decision === "OFFICIAL" ? 1 : 0);
      expect(trustRecords, store.merchantId).toHaveLength(store.decision === "SEARCH_ONLY" ? 0 : 1);
      for (const approval of [...storefronts, ...trustRecords]) {
        expect(approval.evidenceUrl, store.merchantId).toBe(store.evidenceUrl);
        expect(approval.record).toMatchObject({ evidenceUrl: store.evidenceUrl, reviewedAt: review.reviewedAt, status: "APPROVED" });
        expect(approval.evidenceKind).toBe(store.decision === "OFFICIAL" ? "BRAND_DOMAIN" : "BUSINESS_IDENTITY");
      }
      if (store.decision !== "SEARCH_ONLY") {
        expect(trustRecords[0]!.record.level, store.merchantId).toBe(store.decision);
      }
      if (store.decision === "OFFICIAL") {
        const access = DEFAULT_WOO_REGISTRY.stores.find((entry) => entry.merchantId === store.merchantId)!;
        expect(storefronts[0]!.record, store.merchantId).toMatchObject({
          brand: store.brand, platform: "WOOCOMMERCE", storefrontHost: new URL(store.origin).hostname,
          productPathPrefixes: access.productPathPrefixes, imageHosts: access.imageHosts
        });
      } else {
        expect(store.brand, store.merchantId).toBeUndefined();
        expect(store.aliases, store.merchantId).toEqual([]);
      }
    }
  });

  it("requires readable identity evidence and separate support evidence for approvals", () => {
    for (const store of review.stores) {
      expect(store.identitySummary.trim().length, store.merchantId).toBeGreaterThan(0);
      expect(store.supportSummary.trim().length, store.merchantId).toBeGreaterThan(0);
      expect(store.reason.trim().length, store.merchantId).toBeGreaterThan(0);
      expect(Array.isArray(store.limitations), store.merchantId).toBe(true);
      expect(store.evidence.length, store.merchantId).toBeGreaterThan(0);
      for (const evidence of store.evidence) {
        expect(Number.isNaN(Date.parse(evidence.checkedAt)), `${store.merchantId}: ${evidence.url}`).toBe(false);
        expect(evidence.summary.trim().length, `${store.merchantId}: ${evidence.url}`).toBeGreaterThan(0);
      }
      if (store.decision === "SEARCH_ONLY") continue;
      const read = store.evidence.filter((evidence) => evidence.status === "READ" || String(evidence.status) === "200");
      expect(new Set(read.map((evidence) => evidence.url)).size, store.merchantId).toBeGreaterThanOrEqual(2);
      expect(read.some((evidence) => evidence.url === store.evidenceUrl), store.merchantId).toBe(true);
      expect(new URL(store.evidenceUrl).pathname, store.merchantId).not.toMatch(/\/wp-json\//u);
    }
  });

  it("keeps evidenced brand names unique under the production normalizer", () => {
    expect(OfficialStorefrontRegistrySchema.safeParse({
      version: "woo-trust-2026-09-08", stores: official.map((approval) => approval.record)
    }).success).toBe(true);
    for (const approval of official) {
      const store = review.stores.find((entry) => hostFor(entry.origin) === approval.record.officialHost)!;
      const evidenced = new Set([store.brand!, ...store.aliases].map(normalizedBrand));
      const registered = [approval.record.brand, ...approval.record.aliases].map(normalizedBrand);
      expect(new Set(registered).size, store.merchantId).toBe(registered.length);
      expect(new Set(registered), store.merchantId).toEqual(evidenced);
    }
  });

  it("keeps mixed catalogs as retailers so missing product brands cannot inherit an owned brand", () => {
    for (const merchantId of [
      "pine-store", "reily-products", "rug-doctor", "matrix-shad", "blue-mountain-coffee",
      "douglas-connection", "hifiberry", "lithiumhub", "mid-south-ceramics"
    ]) {
      const store = review.stores.find((entry) => entry.merchantId === merchantId)!;
      expect(store, merchantId).toMatchObject({ decision: "ESTABLISHED_RETAILER", aliases: [] });
      expect(store.brand, merchantId).toBeUndefined();
      expect(official.some((approval) => approval.record.officialHost === hostFor(store.origin)), merchantId).toBe(false);
    }
  });
});
