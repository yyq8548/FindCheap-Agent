import { describe, expect, it } from "vitest";
import { evaluateProductRequirements, RequirementAssessmentSchema } from "../src/product-requirements.js";

describe("context-bound requirement assessment", () => {
  const appearance = (title: string, description: string) => evaluateProductRequirements({ title, description }, {
    query: "Honor of Kings Li Bai default wig", productType: "wig", primaryUse: "cosplay",
    requiredFeatures: ["Honor of Kings Li Bai character", "default appearance"], excludedFeatures: [], preferences: []
  });

  it("does not borrow another character's default appearance", () => {
    expect(appearance("Honor of Kings Li Bai wig", "Honor of Kings Daji default appearance wig.")
      .assessment.entries.find(entry => entry.requirement === "default appearance")?.status).toBe("UNKNOWN");
  });

  it("accepts default appearance only with the complete current identity", () => {
    expect(appearance("王者荣耀 李白 原皮 假发", "").assessment.status).toBe("SATISFIED");
  });

  it("does not move character anchors between the title and description", () => {
    expect(appearance("Honor of Kings default wig", "Li Bai costume wig").assessment.status).toBe("NEEDS_VERIFICATION");
  });

  it("keeps unresolved EV decision facts unknown despite product compatibility claims", () => {
    const result = evaluateProductRequirements({ title: "Tesla Wall Connector", description: "United States NACS complete charger." }, {
      query: "Tesla EV charging station", productType: "EV charging station", requiredFeatures: [], excludedFeatures: [], preferences: []
    });
    expect(result.assessment).toMatchObject({ status: "NEEDS_VERIFICATION", entries: [
      { requirement: "EV compatibility: region", status: "UNKNOWN", source: "MISSING" },
      { requirement: "EV compatibility: vehicle/connector", status: "UNKNOWN", source: "MISSING" },
      { requirement: "EV compatibility: complete charger/kit", status: "UNKNOWN", source: "MISSING" }
    ] });
    expect(() => RequirementAssessmentSchema.parse(result.assessment)).not.toThrow();
  });

  it("does not inject EV gaps into other products or an assessment without request identity", () => {
    const product = { title: "Tesla Wall Connector" };
    for (const request of [{}, { query: "shampoo", productType: "shampoo" }]) {
      expect(evaluateProductRequirements(product, { ...request, requiredFeatures: [], excludedFeatures: [], preferences: [] }).assessment.entries).toEqual([]);
    }
  });
});
