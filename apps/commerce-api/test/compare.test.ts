import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { compareProducts, type CompareDeps } from "../src/compare-products.js";

const canonicalProduct = {
  productId: "lg-oled-c4-65",
  brand: "LG",
  manufacturerPartNumber: "OLED65C4PUA",
  gtins: ["195174077021"],
  title: "LG C4 65 inch OLED TV",
  categoryPath: ["Electronics", "Televisions"],
  attributes: [],
  variantDimensions: { size: "65 inch", color: "black" }
};

const quote = (offerId: string, amountCents: number) => ({
  quoteId: `quote-${offerId}`,
  offerId,
  itemPriceCents: amountCents,
  shippingCents: 0,
  taxCents: 500,
  mandatoryFeeCents: 0,
  taxVerified: true,
  shippingVerified: true,
  evidenceRefs: ["evidence-1"],
  checkedAt: "2026-08-13T12:00:00.000Z",
  expiresAt: "2026-08-13T12:15:00.000Z"
});

const candidate = (overrides: Record<string, unknown> = {}) => ({
  offerId: "offer-exact",
  merchantId: "merchant-1",
  sellerName: "Merchant One",
  merchantUrl: "https://merchant.example/products/offer-exact",
  product: {
    brand: "LG",
    mpn: "OLED65C4PUA",
    gtins: ["195174077021"],
    title: "LG C4 65 inch OLED TV",
    variantDimensions: { size: "65 inch", color: "black" },
    coreSimilarity: 1
  },
  quote: quote("offer-exact", 100000),
  ...overrides
});

const deps = (candidates = [candidate()]): CompareDeps => ({
  offers: {
    async search() {
      return { status: "RESOLVED", product: canonicalProduct, candidates };
    }
  },
  clock: { now: () => new Date("2026-08-13T12:00:00.000Z") }
});

describe("POST /v1/comparisons", () => {
  it("separates exact offers and unpriced similar offers", async () => {
    const app = buildApp(deps([
      candidate(),
      candidate({
        offerId: "offer-similar",
        merchantUrl: "https://merchant.example/products/offer-similar",
        product: {
          brand: "LG",
          gtins: [],
          title: "LG OLED TV",
          variantDimensions: {},
          coreSimilarity: 0.9
        }
      })
    ]));
    const response = await app.inject({
      method: "POST",
      url: "/v1/comparisons",
      payload: { query: "OLED65C4PUA", zipCode: "33433", memberships: ["costco"] }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().exactOffers.every((x: { matchStatus: string }) => x.matchStatus === "EXACT")).toBe(true);
    expect(response.json().similarOffers).toEqual([{
      offerId: "offer-similar",
      merchantId: "merchant-1",
      sellerName: "Merchant One",
      matchStatus: "SIMILAR",
      merchantUrl: "https://merchant.example/products/offer-similar",
      recommendationReasons: ["core attributes similar; identity absent"]
    }]);
  });

  it("rejects non-US five-digit ZIP codes and unknown request fields", async () => {
    const app = buildApp(deps());
    const response = await app.inject({
      method: "POST",
      url: "/v1/comparisons",
      payload: { query: "OLED65C4PUA", zipCode: "3343-3", memberships: [], extra: true }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "VALIDATION_ERROR" });
  });

  it("maps unexpected failures to a safe deterministic response", async () => {
    const app = buildApp({
      offers: {
        async search() {
          throw new Error("merchant credentials: secret");
        }
      },
      clock: { now: () => new Date("2026-08-13T12:00:00.000Z") }
    });
    const response = await app.inject({
      method: "POST",
      url: "/v1/comparisons",
      payload: { query: "OLED65C4PUA", zipCode: "33433" }
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: "INTERNAL_SERVER_ERROR" });
  });
});

describe("compareProducts", () => {
  it("does not expose a quote that expires exactly at the injected clock time", async () => {
    const staleAtBoundary = candidate({
      quote: { ...quote("offer-exact", 100000), expiresAt: "2026-08-13T12:00:00.000Z" }
    });
    const clockedDeps = {
      ...deps([staleAtBoundary]),
      clock: { now: () => new Date("2026-08-13T12:00:00.000Z") }
    } as CompareDeps;

    const result = await compareProducts(
      { query: "OLED65C4PUA", zipCode: "33433", memberships: [] },
      clockedDeps
    );

    expect(result.exactOffers).toEqual([]);
    expect(result.questions).toContain("A current price is unavailable for an exact product match.");
  });

  it("exposes an exact quote that expires after the injected clock time", async () => {
    const clockedDeps = {
      ...deps([candidate({
        quote: { ...quote("offer-exact", 100000), expiresAt: "2026-08-13T12:00:01.000Z" }
      })]),
      clock: { now: () => new Date("2026-08-13T12:00:00.000Z") }
    } as CompareDeps;

    const result = await compareProducts(
      { query: "OLED65C4PUA", zipCode: "33433", memberships: [] },
      clockedDeps
    );

    expect(result.exactOffers.map((offer) => offer.offerId)).toEqual(["offer-exact"]);
  });

  it("returns repository clarification without reading candidate data", async () => {
    const ambiguousDeps = {
      offers: {
        async search() {
          return {
            status: "NEEDS_CLARIFICATION",
            questions: ["Which AirPods model would you like to compare?"],
            get candidates() {
              throw new Error("candidate data must not be classified or quoted");
            }
          };
        }
      }
    } as unknown as CompareDeps;

    const result = await compareProducts(
      { query: "AirPods", zipCode: "33433", memberships: [] },
      ambiguousDeps
    );

    expect(result).toEqual({
      productId: "",
      exactOffers: [],
      similarOffers: [],
      questions: ["Which AirPods model would you like to compare?"]
    });
  });

  it("returns a clarification question instead of guessing a variant", async () => {
    const result = await compareProducts(
      { query: "AirPods", zipCode: "33433", memberships: [] },
      deps([candidate({ product: { ...candidate().product, variantDimensions: { size: "55 inch" } } })])
    );

    expect(result.exactOffers).toEqual([]);
    expect(result.questions[0]).toMatch(/model|variant/i);
  });

  it("keeps a valid exact offer when another merchant quote is invalid", async () => {
    const result = await compareProducts(
      { query: "OLED65C4PUA", zipCode: "33433", memberships: [] },
      deps([candidate(), candidate({ offerId: "bad-offer", quote: { ...quote("bad-offer", 90000), itemPriceCents: 90000.5 } })])
    );

    expect(result.exactOffers.map((offer) => offer.offerId)).toEqual(["offer-exact"]);
    expect(result.questions).toContain("Some merchant prices could not be verified.");
  });

  it("keeps valid results when another merchant source is malformed", async () => {
    const result = await compareProducts(
      { query: "OLED65C4PUA", zipCode: "33433", memberships: [] },
      deps([candidate(), candidate({
        offerId: "bad-source",
        merchantUrl: "not-a-url",
        product: {
          brand: "LG",
          gtins: [],
          title: "LG OLED TV",
          variantDimensions: {},
          coreSimilarity: 0.9
        }
      })])
    );

    expect(result.exactOffers.map((offer) => offer.offerId)).toEqual(["offer-exact"]);
    expect(result.questions).toContain("Some merchant data could not be verified.");
  });
});
