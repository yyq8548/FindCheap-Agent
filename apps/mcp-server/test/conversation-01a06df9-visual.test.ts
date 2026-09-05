import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CodexVisualVerdict } from "../src/search-products.js";
import type { ShopifyPort } from "../src/server.js";
import { CONVERSATION_REPLAY_CASES } from "./fixtures/conversation-01a06df9.js";
import { connectReplay, product, searchResult } from "./fixtures/conversation-replay-support.js";

// Original arguments exercise the real MCP handlers. Provider records, images and
// review verdicts are synthetic; this does not evaluate model vision or prompt parsing.
const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  try { await Promise.all(closers.splice(0).map((close) => close())); }
  finally { vi.unstubAllGlobals(); vi.restoreAllMocks(); }
});

function recordedCall(id: string) {
  const item = CONVERSATION_REPLAY_CASES.find((entry) => entry.id === id);
  if (item?.toolCall === undefined) throw new Error(`Missing recorded visual call: ${id}`);
  return item.toolCall;
}

async function connect(search: ShopifyPort["search"]) {
  const replay = await connectReplay(search);
  closers.push(replay.close);
  return replay.client;
}

function visualProduct(brand: "DOEN" | "SKIMS", family: "dress" | "blouse", handle: string, color: string) {
  const host = brand === "DOEN" ? "shopdoen.com" : "skims.com";
  return product({
    merchantId: brand.toLowerCase(), merchant: brand, sourceHost: host, brand,
    merchantTrust: { level: "OFFICIAL", verification: "INDEPENDENT", evidence: ["synthetic official merchant"] },
    handle, title: `${brand} ${handle} ${family}`, productType: family,
    variantDimensions: { Color: color }, imageUrl: `https://cdn.shopify.com/${handle}.jpg`,
    merchantUrl: `https://${host}/products/${handle}`
  });
}

type VisualSession = { visualSessionId: string; candidates: Array<{ candidateId: string; title: string }> };

function finalize(client: Client, session: VisualSession, verdict: CodexVisualVerdict) {
  return client.callTool({ name: "finalize_visual_search", arguments: {
    visualSessionId: session.visualSessionId,
    verdicts: session.candidates.map(({ candidateId }) => ({ candidateId, verdict }))
  } });
}

function skimsVerdict(sameColor: boolean): CodexVisualVerdict {
  return {
    classification: "POSSIBLE_SAME_ITEM",
    matches: [
      { attribute: "PRODUCT_TYPE", referenceEvidence: "dress", candidateEvidence: "dress" },
      { attribute: "NECKLINE", referenceEvidence: "wide softly squared scoop neckline", candidateEvidence: "wide softly squared scoop neckline" },
      { attribute: "SILHOUETTE", referenceEvidence: "fitted bodycon torso and hips", candidateEvidence: "fitted bodycon torso and hips" },
      // Additional synthetic second-look observation, not a modification of recorded arguments.
      { attribute: "WAIST", referenceEvidence: "close-fitting waist and hips", candidateEvidence: "close-fitting waist and hips",
        referenceObservation: { confidence: 0.95, visibility: "VISIBLE" } },
      ...(sameColor ? [{ attribute: "COLOR" as const, referenceEvidence: "heather gray", candidateEvidence: "heather gray" }] : [])
    ],
    conflicts: sameColor ? [] : [{ attribute: "COLOR", referenceEvidence: "heather gray", candidateEvidence: "blue" }]
  };
}

describe("conversation 01a06df9 visual MCP replay", () => {
  it("accepts all seven original black-dress observations, including the formerly rejected 101-character detail", async () => {
    const call = recordedCall("doen-black-dress");
    const before = structuredClone(call);
    const visual = call.arguments.visualInput as { observations: Array<{ attribute: string; value: string }> };
    expect(visual.observations).toHaveLength(7);
    expect(visual.observations.find(({ attribute }) => attribute === "DISTINCTIVE_DETAIL")?.value).toHaveLength(101);
    const search = vi.fn<ShopifyPort["search"]>(async () => searchResult([visualProduct("DOEN", "dress", "synthetic-black-lace-mini", "Black")]));
    const client = await connect(search);

    const response = await client.callTool(call);

    expect(response.isError).not.toBe(true);
    expect((response.structuredContent as VisualSession).candidates).toHaveLength(1);
    expect(search).toHaveBeenCalled();
    expect(call).toEqual(before);
  });

  it.each([
    // Original calls/verdicts are unchanged. Generic cut/color evidence alone
    // now supports similarity, not possible same-item identity.
    { color: "Heather Gray", expectedGroup: "HIGHLY_SIMILAR", sameColor: true },
    { color: "Blue", expectedGroup: "HIGHLY_SIMILAR", sameColor: false }
  ])("keeps the SKIMS $color variant at $expectedGroup without manufacturing exact identity", async ({ color, expectedGroup, sameColor }) => {
    const call = recordedCall("skims-grey-dress");
    const before = structuredClone(call);
    const candidate = visualProduct("SKIMS", "dress", "synthetic-soft-lounge-slip", color);
    candidate.merchantUrl += `?variant=${sameColor ? "111" : "222"}`;
    const client = await connect(async () => searchResult([candidate]));
    const initial = await client.callTool(call);
    expect(initial.isError).not.toBe(true);
    const session = initial.structuredContent as VisualSession;
    expect(session.candidates).toHaveLength(1);

    const response = await finalize(client, session, skimsVerdict(sameColor));

    expect(response.isError).not.toBe(true);
    expect(response.structuredContent).toMatchObject({ products: [{
      merchantUrl: candidate.merchantUrl, variantDimensions: { Color: color },
      visualMatchGroup: expectedGroup, matchStatus: "DISCOVERY_MATCH"
    }] });
    const products = (response.structuredContent as { products: Array<{ visualMatchEvidence: string[] }> }).products;
    expect(products).toHaveLength(1);
    if (!sameColor) expect(products[0]?.visualMatchEvidence).toContain("Codex visual difference COLOR: heather gray | blue");
    expect(call).toEqual(before);
  });

  it("starts a new DOEN blouse after SKIMS and rejects official candidates after one bounded tail review", async () => {
    const search = vi.fn<ShopifyPort["search"]>(async (input) => searchResult((input.query ?? "").includes("SKIMS")
      ? [visualProduct("SKIMS", "dress", "synthetic-previous-slip", "Heather Gray")]
      : [...Array.from({ length: 6 }, (_, index) => visualProduct("DOEN", "blouse", `synthetic-first-plain-blouse-${index}`, "Ivory")),
          visualProduct("DOEN", "blouse", "synthetic-second-plain-blouse", "Ivory")]));
    const client = await connect(search);
    const previous = await client.callTool(recordedCall("skims-grey-dress"));
    expect(previous.isError).not.toBe(true);
    const previousFinal = await finalize(client, previous.structuredContent as VisualSession, skimsVerdict(true));
    expect(previousFinal.isError).not.toBe(true);
    expect(previousFinal.structuredContent).toMatchObject({ products: [{ brand: "SKIMS" }] });
    const callsBeforeBlouse = search.mock.calls.length;
    const call = recordedCall("doen-ivory-blouse");
    const before = structuredClone(call);
    expect(call.arguments).toMatchObject({ contextMode: "NEW_PRODUCT", brand: "DOEN", productType: "blouse" });
    const first = await client.callTool(call);
    expect(first.isError).not.toBe(true);
    expect((first.structuredContent as VisualSession).candidates).toHaveLength(6);
    const conflict: CodexVisualVerdict = {
      classification: "CONFLICT",
      matches: [{ attribute: "PRODUCT_TYPE", referenceEvidence: "blouse", candidateEvidence: "blouse" }],
      conflicts: [{ attribute: "DISTINCTIVE_DETAIL", referenceEvidence: "layered cascading ruffles and center-front tie bow", candidateEvidence: "plain buttoned front without ruffles or a tie bow" }]
    };

    const retry = await finalize(client, first.structuredContent as VisualSession, conflict);

    expect(retry.isError).not.toBe(true);
    expect(retry.structuredContent).toMatchObject({ products: [], visualReview: {
      stage: "RELAXED_REVIEW", finalAnswerAllowed: false, requiredNextTool: "finalize_visual_search",
      candidates: [{ title: "DOEN synthetic-second-plain-blouse blouse" }]
    } });
    const second = (retry.structuredContent as { visualReview: VisualSession }).visualReview;
    const callsBeforeFinal = search.mock.calls.length;
    const response = await finalize(client, second, conflict);
    expect(response.isError).not.toBe(true);
    expect(response.structuredContent).toMatchObject({ products: [], visualSearchFailure: { code: "CANDIDATES_CONFLICTED" } });
    expect(response.structuredContent).not.toHaveProperty("visualReview");
    expect(search).toHaveBeenCalledTimes(callsBeforeFinal);
    expect(callsBeforeFinal - callsBeforeBlouse).toBeLessThanOrEqual(9);
    const blouseQueries = search.mock.calls.slice(callsBeforeBlouse).map(([input]) => input.query ?? "");
    expect(blouseQueries.every((query) => /D[OÔ]EN (?:blouse|shirt)/u.test(query)), JSON.stringify(blouseQueries)).toBe(true);
    expect(blouseQueries.join(" ")).not.toMatch(/SKIMS|Soft Lounge|heather gray/u);
    expect(blouseQueries).toEqual(expect.arrayContaining([
      expect.stringMatching(/ruffle/u)
    ]));
    const consumed = await finalize(client, second, conflict);
    expect(consumed.isError).toBe(true);
    expect(search).toHaveBeenCalledTimes(callsBeforeFinal);
    expect(call).toEqual(before);
  });
});
