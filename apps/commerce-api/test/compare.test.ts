import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { compareProducts, type CompareDeps } from "../src/compare-products.js";

const bearerToken = "test-commerce-bearer-token-with-32-characters";
const testApp = (dependencies: CompareDeps) => buildApp(dependencies, { bearerToken });
const authorization = { authorization: `Bearer ${bearerToken}` };

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
  canonicalProductId: "lg-oled-c4-65",
  promotionDecisionId: "promotion-1",
  offerRevision: 1,
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
  ...overrides
});

const deps = (
  candidates = [candidate()],
  quoteExactOffer: CompareDeps["quoteExactOffer"] = async (candidate) =>
    quote(candidate.offerId, 100000)
): CompareDeps => ({
  offers: {
    async search() {
      return { status: "RESOLVED", product: canonicalProduct, candidates };
    }
  },
  quoteExactOffer,
  clock: { now: () => new Date("2026-08-13T12:00:00.000Z") }
});

describe("POST /v1/comparisons", () => {
  it("separates exact offers and unpriced similar offers", async () => {
    const quotedOfferIds: string[] = [];
    const app = testApp(deps([
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
    ], async (candidate) => {
      quotedOfferIds.push(candidate.offerId);
      return quote(candidate.offerId, 100000);
    }));
    const response = await app.inject({
      method: "POST",
      url: "/v1/comparisons",
      headers: authorization,
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
    expect(quotedOfferIds).toEqual(["offer-exact"]);
  });

  it("rejects non-US five-digit ZIP codes and unknown request fields", async () => {
    const app = testApp(deps());
    const response = await app.inject({
      method: "POST",
      url: "/v1/comparisons",
      headers: authorization,
      payload: { query: "OLED65C4PUA", zipCode: "3343-3", memberships: [], extra: true }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "VALIDATION_ERROR" });
  });

  it("rejects a whitespace-only product query", async () => {
    const app = testApp(deps());
    const response = await app.inject({
      method: "POST",
      url: "/v1/comparisons",
      headers: authorization,
      payload: { query: "   ", zipCode: "33433" }
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "VALIDATION_ERROR" });
  });

  it("maps unexpected failures to a safe deterministic response", async () => {
    const app = testApp({
      offers: {
        async search() {
          throw new Error("merchant credentials: secret");
        }
      },
      quoteExactOffer: async () => quote("offer-exact", 100000),
      clock: { now: () => new Date("2026-08-13T12:00:00.000Z") }
    });
    const response = await app.inject({
      method: "POST",
      url: "/v1/comparisons",
      headers: authorization,
      payload: { query: "OLED65C4PUA", zipCode: "33433" }
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: "INTERNAL_SERVER_ERROR" });
  });

  it("requires the configured bearer without leaking token details", async () => {
    const token = "secret-commerce-token-that-is-long-enough";
    const app = buildApp(deps(), { bearerToken: token });
    const unauthorized = await app.inject({
      method: "POST",
      url: "/v1/comparisons",
      headers: { authorization: "Bearer wrong" },
      payload: { query: "OLED65C4PUA", zipCode: "33433" }
    });
    expect(unauthorized.statusCode).toBe(401);
    expect(unauthorized.json()).toEqual({ error: "UNAUTHORIZED" });
    expect(unauthorized.body).not.toContain(token);
    const health = await app.inject({ method: "GET", url: "/health" });
    expect(health.json()).toEqual({ status: "ok" });
  });

  it("never serves v1 when the app was composed without a token", async () => {
    const app = buildApp(deps());
    const response = await app.inject({
      method: "POST",
      url: "/v1/comparisons",
      payload: { query: "OLED65C4PUA", zipCode: "33433" }
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "UNAUTHORIZED" });
  });

  it("maps malformed quote output to a sanitized 500 instead of an input 400", async () => {
    const app = testApp(deps([candidate()], async () => ({
      ...quote("offer-exact", 100000),
      itemPriceCents: 100000.5
    })));
    const response = await app.inject({
      method: "POST",
      url: "/v1/comparisons",
      headers: authorization,
      payload: { query: "OLED65C4PUA", zipCode: "33433", memberships: [] }
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: "INTERNAL_SERVER_ERROR" });
    expect(response.body).not.toContain("100000.5");
  });

  it("maps malformed repository clarification to a sanitized 500", async () => {
    const app = testApp({
      offers: {
        async search() {
          return { status: "NEEDS_CLARIFICATION", questions: [42] };
        }
      },
      quoteExactOffer: async () => quote("offer-exact", 100000),
      clock: { now: () => new Date("2026-08-13T12:00:00.000Z") }
    } as unknown as CompareDeps);
    const response = await app.inject({
      method: "POST",
      url: "/v1/comparisons",
      headers: authorization,
      payload: { query: "AirPods", zipCode: "33433", memberships: [] }
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: "INTERNAL_SERVER_ERROR" });
  });

  it("maps malformed final comparison output to a sanitized 500", async () => {
    const app = testApp(deps([candidate({ merchantUrl: "ftp://merchant.example/offer" })]));
    const response = await app.inject({
      method: "POST",
      url: "/v1/comparisons",
      headers: authorization,
      payload: { query: "OLED65C4PUA", zipCode: "33433", memberships: [] }
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: "INTERNAL_SERVER_ERROR" });
  });
});

describe("compareProducts", () => {
  it("does not expose a quote that expires exactly at the injected clock time", async () => {
    const clockedDeps = {
      ...deps([candidate()], async () => ({
        ...quote("offer-exact", 100000),
        expiresAt: "2026-08-13T12:00:00.000Z"
      })),
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
      ...deps([candidate()], async () => ({
        ...quote("offer-exact", 100000),
        expiresAt: "2026-08-13T12:00:01.000Z"
      })),
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
      },
      quoteExactOffer() {
        throw new Error("clarification must not invoke quote");
      },
      clock: { now: () => new Date("2026-08-13T12:00:00.000Z") }
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
    let quoteCalls = 0;
    const result = await compareProducts(
      { query: "AirPods", zipCode: "33433", memberships: [] },
      deps(
        [candidate({ product: { ...candidate().product, variantDimensions: { size: "55 inch" } } })],
        async () => {
          quoteCalls += 1;
          return quote("offer-exact", 100000);
        }
      )
    );

    expect(result.exactOffers).toEqual([]);
    expect(result.questions[0]).toMatch(/model|variant/i);
    expect(quoteCalls).toBe(0);
  });

  it("passes exact request ZIP and canonical memberships to contextual quoting", async () => {
    const contexts: Array<{ zipCode: string; memberships: string[]; now: Date }> = [];
    const contextualDeps = deps([candidate()], async (candidate, context) => {
      contexts.push(context);
      const amount = context.zipCode === "33433" && context.memberships.includes("costco")
        ? 90000
        : 110000;
      return quote(candidate.offerId, amount);
    });

    const floridaMember = await compareProducts(
      { query: "OLED65C4PUA", zipCode: "33433", memberships: ["costco", "costco"] },
      contextualDeps
    );
    const newYorkRegular = await compareProducts(
      { query: "OLED65C4PUA", zipCode: "10001", memberships: [] },
      contextualDeps
    );

    expect(floridaMember.exactOffers[0]?.regularQuote.deliveredPrice.amountCents).toBe(90500);
    expect(newYorkRegular.exactOffers[0]?.regularQuote.deliveredPrice.amountCents).toBe(110500);
    expect(contexts).toEqual([
      { zipCode: "33433", memberships: ["costco"], now: new Date("2026-08-13T12:00:00.000Z") },
      { zipCode: "10001", memberships: [], now: new Date("2026-08-13T12:00:00.000Z") }
    ]);
  });

  it("uses an independently stored member-context quote only when supplied", async () => {
    const actualQuote = (id: string, amountCents: number) => ({
      quoteId: id,
      offerId: "offer-exact",
      status: "VERIFIED" as const,
      deliveredPrice: { amountCents, currency: "USD" as const },
      lineItems: [{
        kind: "ITEM" as const,
        amount: { amountCents, currency: "USD" as const },
        label: "Item price"
      }],
      eligibilityConditions: [],
      evidenceRefs: ["evidence-1"],
      checkedAt: "2026-08-13T12:00:00.000Z",
      expiresAt: "2026-08-13T12:15:00.000Z"
    });
    const result = await compareProducts(
      { query: "OLED65C4PUA", zipCode: "33433", memberships: ["club"] },
      deps([candidate()], async () => ({
        regularQuote: actualQuote("regular", 100_000),
        memberQuote: {
          programId: "club",
          programName: "Club",
          memberships: ["club"],
          quote: actualQuote("member", 90_000)
        }
      }))
    );

    expect(result.exactOffers[0]).toMatchObject({
      regularQuote: { deliveredPrice: { amountCents: 100_000 } },
      memberQuote: { eligible: true, quote: { deliveredPrice: { amountCents: 90_000 } } },
      rankingQuote: { deliveredPrice: { amountCents: 90_000 } }
    });
  });
});
