import { describe, expect, it } from "vitest";
import { missingChargingRequirements } from "../src/decision-constraints.js";

const ALL_MISSING = ["region", "vehicle/connector", "complete charger/kit"];

describe("charging decision constraints", () => {
  it.each(["EV charging station", "Tesla EV charger", "Tesla Wall Connector", "我要买充电桩"])(
    "requires explicit compatibility for %s without inferring a region or connector", query => {
      expect(missingChargingRequirements({ query })).toEqual(ALL_MISSING);
    }
  );

  it("accepts narrow optional inputs and does not infer a region from a ZIP, language, or brand", () => {
    expect(missingChargingRequirements({})).toEqual([]);
    expect(missingChargingRequirements({ query: "Tesla 充电桩", preferences: ["10001", "USD"] })).toEqual(ALL_MISSING);
    expect(missingChargingRequirements({ query: "EV charger for us" })).toEqual(ALL_MISSING);
  });

  it.each([
    { query: "EV charger", primaryUse: "US home charging", requiredFeatures: ["J1772", "complete charger"] },
    { query: "美国充电桩整机", requiredFeatures: ["Model 3"] },
    { query: "EV charging station", primaryUse: "Canada", preferences: ["NACS", "ready-to-install"] },
    { query: "EV charger", requiredSize: "UK", preferredSize: "Type 2", preferences: ["DIY kit"] }
  ])("accepts explicitly supplied values: %j", input => {
    expect(missingChargingRequirements(input)).toEqual([]);
  });

  it.each([
    ["not US", "not NACS", "not a complete charger"],
    ["US unconfirmed", "NACS unknown", "kit undecided"],
    ["不要美国款", "接口不是国标", "不要套件"],
    ["country unknown", "connector unknown", "charger format unknown"]
  ])("does not count negative or unresolved values: %j", (...requiredFeatures) => {
    expect(missingChargingRequirements({ query: "EV charger", requiredFeatures })).toEqual(ALL_MISSING);
  });

  it("keeps explicit alternatives after a negative clause and asks only about the remaining gap", () => {
    expect(missingChargingRequirements({ query: "EV charger", requiredFeatures: ["not US, use in Canada", "NACS", "kit unknown"] }))
      .toEqual(["complete charger/kit"]);
  });

  it("does not transfer unrelated complete information or vehicle-looking words into readiness", () => {
    expect(missingChargingRequirements({ query: "EV charger", requiredFeatures: ["US", "NACS", "complete warranty"] }))
      .toEqual(["complete charger/kit"]);
    expect(missingChargingRequirements({ query: "美国充电桩整机 NACS 接口未知" })).toEqual(["vehicle/connector"]);
  });

  it.each(["phone charger", "shampoo", "Tesla charger cable", "EV charger replacement adapter", "充电桩支架", "EV charger adapter with cable"])(
    "leaves non-chargers and explicit separate accessories alone: %s", query => {
      expect(missingChargingRequirements({ query })).toEqual([]);
    }
  );

  it.each(["EV charger with cable", "EV charger, cable included", "带充电线的充电桩", "充电桩带充电线",
    "EV charger without adapter", "EV charger no cable", "充电桩 不要配件"])(
    "keeps constraints for a whole charger with an included accessory: %s", query => {
      expect(missingChargingRequirements({ query })).toEqual(ALL_MISSING);
    }
  );
});
