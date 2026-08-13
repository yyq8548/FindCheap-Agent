import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { MerchantCatalogSchema, selectForBuild, weightedScore } from "./schema.js";

const catalogPath = new URL("./catalog.yaml", import.meta.url);

describe("merchant audit catalog", () => {
  it("does not select unaudited merchants", async () => {
    const seedCatalog = MerchantCatalogSchema.parse(parse(await readFile(catalogPath, "utf8")));

    expect(selectForBuild(seedCatalog)).toEqual([]);
  });

  it("seeds exactly the requested candidate universe in a disabled state", async () => {
    const catalog = MerchantCatalogSchema.parse(parse(await readFile(catalogPath, "utf8")));

    expect(catalog.candidates.map((merchant) => merchant.id)).toEqual([
      "amazon", "walmart", "target", "best-buy", "costco", "sams-club", "home-depot", "lowes",
      "macys", "nordstrom", "sephora", "ulta", "walgreens", "cvs", "chewy", "wayfair", "newegg",
      "bh-photo", "rei", "dicks"
    ]);
    expect(catalog.candidates.every((merchant) => merchant.auditState === "required" && !merchant.enabled)).toBe(true);
    expect(catalog.candidates.every((merchant) => merchant.allowedHosts.length === 0 && merchant.provenSource === undefined)).toBe(true);
  });

  it("requires every quality-gate condition before selection", () => {
    const candidate = {
      id: "approved-shop",
      name: "Approved Shop",
      segment: "general" as const,
      auditState: "approved" as const,
      legalReview: "approved" as const,
      provenSource: "api" as const,
      allowedHosts: ["api.approved-shop.example"],
      identityCompleteness: 0.9,
      weightedScore: 70
    };

    expect(selectForBuild(MerchantCatalogSchema.parse({ version: 1, candidates: [candidate] }))).toHaveLength(1);
    expect(selectForBuild(MerchantCatalogSchema.parse({
      version: 1,
      candidates: [{ ...candidate, legalReview: "not_started" }]
    }))).toEqual([]);
  });

  it("calculates the documented weighted score", () => {
    expect(weightedScore({ data: 1, identity: 1, priceAndZip: 1, legal: 1, stability: 1, coverage: 1, maintenance: 1 })).toBe(100);
    expect(weightedScore({ data: 0, identity: 1, priceAndZip: 1, legal: 1, stability: 1, coverage: 1, maintenance: 1 })).toBe(75);
  });
});
