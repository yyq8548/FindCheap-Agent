import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { createWooStoreReader } from "../src/woocommerce-store.js";
import { WooMerchantSchema } from "../src/woocommerce-registry.js";

const saved = JSON.parse(await readFile(new URL("fixtures/woocommerce-expansion-200/oversized-description.json", import.meta.url), "utf8"));
const store = WooMerchantSchema.parse({ merchantId: "ula", name: "ULA Equipment", origin: "https://www.ula-equipment.com", productPathPrefixes: ["/product/"], currency: "USD", reviewedAt: "2026-09-08", evidenceUrl: saved.permalink, enabled: true, capabilities: { search: true, variations: true } });
const resolve = async () => [{ address: "8.8.8.8", family: 4 }];
const budget = () => ({ signal: new AbortController().signal, requests: 0, bytes: 0, maxRequests: 1, maxBytes: 1024 * 1024 });
const reader = (value: unknown) => createWooStoreReader({ resolve, request: async () => new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } }) });

describe("optional Woo description bounds", () => {
  it("omits the oversized saved page-builder description while preserving strict identity and price fields", async () => {
    expect(saved.description.length).toBeGreaterThan(200_000);
    const result = await reader(saved).product(store, saved.id, budget());
    expect(result.description).toBeUndefined();
    expect(result).toMatchObject({ id: saved.id, name: saved.name, permalink: saved.permalink, prices: saved.prices });
  });
  it.each([null, 42, {}, []])("still rejects non-string description data: %j", async description => {
    await expect(reader({ ...saved, description }).product(store, saved.id, budget())).rejects.toMatchObject({ reason: "INVALID_RESPONSE" });
  });
  it("retains valid descriptions and does not relax identity or total response limits", async () => {
    expect((await reader({ ...saved, description: "A real pack." }).product(store, saved.id, budget())).description).toBe("A real pack.");
    await expect(reader({ ...saved, name: "x".repeat(501) }).product(store, saved.id, budget())).rejects.toMatchObject({ reason: "INVALID_RESPONSE" });
    await expect(reader({ ...saved, description: "x".repeat(1024 * 1024) }).product(store, saved.id, { ...budget(), maxBytes: 8 * 1024 * 1024 })).rejects.toMatchObject({ reason: "SECURITY_REJECTED" });
  });
});
