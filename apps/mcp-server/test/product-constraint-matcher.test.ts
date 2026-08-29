import { describe, expect, it } from "vitest";

import { evaluateFeature } from "../src/product-constraint-matcher.js";

const featureMatches = (searchable: string, feature: string): boolean =>
  evaluateFeature(searchable, feature) === "MATCHED";
const matchFeatures = (searchable: string, features: readonly string[]): string[] =>
  features.filter((feature) => featureMatches(searchable, feature));

describe("product constraint matcher", () => {
  it.each([
    ["MacBook Pro 14-inch M4", "14-inch display"],
    ["MacBook Pro 14\" M4", "14 inch display"],
    ["MacBook Pro 14″ M4", "14-inch display"],
    ["Laptop display 35.56 cm", "14-inch display"]
  ])("normalizes display size: %s", (searchable, feature) => {
    expect(featureMatches(searchable, feature)).toBe(true);
  });

  it("does not treat product width as display size", () => {
    expect(featureMatches("Case width 14 inches", "14-inch display")).toBe(false);
  });

  it("separates memory from storage and converts TB to GB", () => {
    const searchable = "Laptop 16GB RAM 1TB SSD";
    expect(featureMatches(searchable, "16GB memory")).toBe(true);
    expect(featureMatches(searchable, "1024GB storage")).toBe(true);
    expect(featureMatches("Portable SSD 16GB storage", "16GB memory")).toBe(false);
  });

  it.each([
    ["Shampoo 355 ml", "12 fl oz"],
    ["Coffee beans 340 g", "12 oz"],
    ["Two bottles 2-pack", "2 count"],
    ["Socks one pair", "2 count"],
    ["Pencils one dozen", "12 count"]
  ])("normalizes quantity: %s", (searchable, feature) => {
    expect(featureMatches(searchable, feature)).toBe(true);
  });

  it("keeps count and physical units separate", () => {
    expect(featureMatches("14-inch laptop", "14 count")).toBe(false);
    expect(featureMatches("12 oz bottle", "12 fl oz")).toBe(false);
  });

  it.each([
    ["3840 × 2160 UHD television", "4K"],
    ["2560x1440 monitor", "QHD"],
    ["1920 x 1080 display", "1080p"]
  ])("normalizes resolution: %s", (searchable, feature) => {
    expect(featureMatches(searchable, feature)).toBe(true);
  });

  it("requires real refresh-rate evidence", () => {
    expect(featureMatches("Native 120 Hz panel", "120Hz")).toBe(true);
    expect(featureMatches("Motion Rate 120 television", "120Hz")).toBe(false);
    expect(featureMatches("144Hz gaming monitor", "at least 120Hz")).toBe(true);
  });

  it("normalizes power and maximum constraints", () => {
    expect(featureMatches("USB-C PD charger 65 W", "at least 60W")).toBe(true);
    expect(featureMatches("Laptop weight 1.3 kg", "under 3 lb")).toBe(true);
  });

  it("preserves shoe-size system and audience", () => {
    expect(featureMatches("Men's running shoe US 9", "men's US 9")).toBe(true);
    expect(featureMatches("Men's running shoe EU 42", "men's US 9")).toBe(false);
    expect(featureMatches("Women's running shoe US 9", "men's US 9")).toBe(false);
  });

  it("normalizes generic apparel sizes", () => {
    expect(featureMatches("Cotton shirt size Small", "size S")).toBe(true);
    expect(featureMatches("Cotton shirt size M", "size S")).toBe(false);
  });

  it("keeps commercial color names distinct", () => {
    expect(featureMatches("Phone color Space Black", "space black")).toBe(true);
    expect(featureMatches("Phone color Space Black", "black")).toBe(false);
    expect(featureMatches("Laptop color gray", "grey")).toBe(true);
  });

  it("normalizes compact model and generation expressions", () => {
    expect(featureMatches("Sony WH1000XM6 headphones", "WH-1000XM6")).toBe(true);
    expect(featureMatches("AirPods Pro 2nd Gen USB-C", "AirPods Pro 2nd generation")).toBe(true);
    expect(featureMatches("MacBook Pro M4 Max", "M4 Pro")).toBe(false);
  });

  it("returns only independently satisfied constraints", () => {
    expect(matchFeatures("14-inch MacBook Pro 16GB RAM 1TB SSD Space Black", [
      "14-inch display", "16GB memory", "1TB storage", "space black", "120Hz"
    ])).toEqual(["14-inch display", "16GB memory", "1TB storage", "space black"]);
  });

  it("normalizes common Chinese constraint wording", () => {
    const searchable = "MacBook Pro 14.2英寸 16GB内存 1TB存储 深空黑色";
    expect(matchFeatures(searchable, ["14寸屏幕", "至少16G内存", "1T存储", "深空黑色"]))
      .toEqual(["14寸屏幕", "至少16G内存", "1T存储", "深空黑色"]);
    expect(featureMatches("洗发水 355毫升 两瓶装", "12液体盎司")).toBe(true);
    expect(featureMatches("男款跑鞋 US 9", "男款 US 9")).toBe(true);
  });

  it("matches Chinese and English material and shoe-style synonyms", () => {
    expect(evaluateFeature("Ballerina flat with genuine leather upper", "平底鞋")).toBe("MATCHED");
    expect(evaluateFeature("Ballerina flat with genuine leather upper", "皮质")).toBe("MATCHED");
    expect(evaluateFeature("Women's high-heel pump", "flat sole")).toBe("CONTRADICTED");
    expect(evaluateFeature("Women's ballet flat", "leather")).toBe("UNKNOWN");
  });

  it("does not treat faux leather as genuine leather", () => {
    expect(evaluateFeature("Women's flat in vegan faux leather", "真皮")).toBe("CONTRADICTED");
  });

  it("distinguishes missing evidence from an explicit numeric conflict", () => {
    expect(evaluateFeature("MacBook Pro laptop", "14-inch display")).toBe("UNKNOWN");
    expect(evaluateFeature("MacBook Pro 13-inch display", "14-inch display")).toBe("CONTRADICTED");
  });
});
