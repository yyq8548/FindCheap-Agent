import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createAwinOffersController } from "../src/offers.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("Awin Offers controller", () => {
  it("downloads joined active US promotions and stores normalized verified deals", async () => {
    const directory = await mkdtemp(join(tmpdir(), "findcheap-awin-offers-"));
    directories.push(directory);
    const dataPath = join(directory, "offers.json");
    const fetchRequest = vi.fn(async () => new Response(JSON.stringify({ promotions: [
      promotionFixture(),
      promotionFixture({
        promotionId: 2,
        type: "promotion",
        title: "Summer sale",
        voucher: undefined
      })
    ] }), { status: 200, headers: { "content-type": "application/json" } }));
    const controller = createAwinOffersController({
      apiToken: "s".repeat(40),
      publisherId: "3047955",
      dataPath,
      refreshIntervalMs: 3_600_000,
      sourceTimeoutMs: 15_000
    }, { fetch: fetchRequest, now: () => new Date("2026-08-26T20:00:00.000Z") });

    await controller.refresh();

    const [url, request] = fetchRequest.mock.calls[0] as unknown as [string | URL | Request, RequestInit];
    expect(String(url)).toContain("/publisher/3047955/promotions?accessToken=");
    expect(request?.headers).toMatchObject({ authorization: `Bearer ${"s".repeat(40)}` });
    expect(JSON.parse(String(request?.body))).toMatchObject({
      filters: { membership: "joined", regionCodes: ["US"], status: "active", type: "all" },
      pagination: { page: 1, pageSize: 200 }
    });
    expect(controller.search({ merchant: "Example Shop", membershipIds: [], channel: "ONLINE" })).toEqual({
      deals: [
        expect.objectContaining({
          dealId: "awin:1", kind: "PROMO_CODE", code: "SAVE10", productApplicability: "MERCHANT_WIDE"
        }),
        expect.objectContaining({
          dealId: "awin:2", kind: "BRAND_PROMOTION", productApplicability: "MERCHANT_WIDE"
        })
      ]
    });
    expect(controller.search({
      merchant: "Example Shop",
      productQuery: "A product name absent from every merchant-wide promotion",
      membershipIds: [],
      channel: "ONLINE"
    })?.deals).toHaveLength(2);
    expect(controller.search({ merchant: "Example Shop", membershipIds: [], channel: "IN_STORE" })).toEqual({ deals: [] });
    expect(JSON.parse(await readFile(dataPath, "utf8"))).toMatchObject({
      snapshotAt: "2026-08-26T20:00:00.000Z",
      deals: expect.arrayContaining([expect.objectContaining({ verificationStatus: "VERIFIED" })])
    });
  });

  it("keeps the last valid cache when a refresh fails", async () => {
    const directory = await mkdtemp(join(tmpdir(), "findcheap-awin-offers-fallback-"));
    directories.push(directory);
    const controller = createAwinOffersController({
      apiToken: "t".repeat(40),
      publisherId: "3047955",
      dataPath: join(directory, "offers.json"),
      refreshIntervalMs: 3_600_000,
      sourceTimeoutMs: 15_000
    }, {
      fetch: vi.fn()
        .mockResolvedValueOnce(new Response(JSON.stringify([promotionFixture()]), { headers: { "content-type": "application/json" } }))
        .mockResolvedValueOnce(new Response(null, { status: 503 })),
      now: () => new Date("2026-08-26T20:00:00.000Z")
    });
    await controller.refresh();
    await expect(controller.refresh()).rejects.toThrow("HTTP 503");

    expect(controller.search({ merchant: "Example Shop", membershipIds: [], channel: "ANY" })?.deals).toHaveLength(1);
    expect(controller.getState()).toMatchObject({ lastErrorCode: "SOURCE_HTTP_ERROR" });
  });
});

function promotionFixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    promotionId: 1,
    type: "voucher",
    advertiser: { id: 99, name: "Example Shop", joined: true },
    title: "Save ten percent",
    description: "Valid on selected items",
    terms: "Online orders only",
    startDate: "2026-08-01T00:00:00",
    endDate: "2026-09-01T00:00:00",
    urlTracking: "https://www.awin1.com/cread.php?awinmid=99&awinaffid=3047955",
    regions: { all: false, list: [{ countryCode: "US" }] },
    voucher: { code: "SAVE10", exclusive: false },
    ...overrides
  };
}
