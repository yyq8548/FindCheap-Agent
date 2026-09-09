import { describe, expect, it } from "vitest";
import { assessCoffeeCategory, isCoffeeCategoryRefinement, parseCoffeeCategory, type CoffeeCategory } from "../src/coffee-category.js";

describe("observed merchant coffee form dimensions", () => {
  it.each(["Coffee product form", "Ground or whole bean", "coffee-product-form"])("uses selected %s before the parent title", key => {
    expect(assessCoffeeCategory("WHOLE_BEAN", { title: "Whole Bean Coffee", variantDimensions: { [key]: "Ground" } }).status).toBe("CONTRADICTED");
    expect(assessCoffeeCategory("GROUND", { title: "Whole Bean Coffee", variantDimensions: { [key]: "Ground" } }).status).toBe("MATCHED");
    expect(assessCoffeeCategory("WHOLE_BEAN", { title: "House Blend Coffee", variantDimensions: { [key]: "Whole Bean" } }).status).toBe("MATCHED");
  });
  it("keeps conflicting and unselected forms unresolved", () => {
    expect(assessCoffeeCategory("WHOLE_BEAN", { title: "Whole Bean Coffee", variantDimensions: {
      "Coffee product form": "Whole Bean", "Ground or whole bean": "Ground"
    } }).status).toBe("UNKNOWN");
    expect(assessCoffeeCategory("WHOLE_BEAN", { title: "Whole Bean Coffee", variantDimensions: {
      "Coffee product form": "Whole Bean or Ground"
    } }).status).toBe("UNKNOWN");
  });
  it("does not let a coffee option establish a merchandise identity", () => {
    expect(assessCoffeeCategory("WHOLE_BEAN", { title: "Coffee Candle", variantDimensions: {
      "Coffee product form": "Whole Bean"
    } }).status).toBe("CONTRADICTED");
  });
});

describe("controlled coffee category phrases", () => {
  it.each<[string, CoffeeCategory]>([
    ["coffee", "COFFEE"], [" 咖啡 ", "COFFEE"], ["COFFEE", "COFFEE"],
    ["coffee beans", "WHOLE_BEAN"], ["whole bean coffee", "WHOLE_BEAN"], ["Whole-Bean Coffee", "WHOLE_BEAN"],
    ["whole coffee beans", "WHOLE_BEAN"], ["咖啡豆", "WHOLE_BEAN"], ["整豆咖啡", "WHOLE_BEAN"],
    ["ground coffee", "GROUND"], ["coffee grounds", "GROUND"], ["咖啡粉", "GROUND"], ["研磨咖啡粉", "GROUND"],
    ["coffee pods", "PODS"], ["coffee capsules", "PODS"], ["胶囊咖啡", "PODS"], ["咖啡膠囊", "PODS"],
    ["instant coffee", "INSTANT"], ["soluble coffee", "INSTANT"], ["速溶咖啡", "INSTANT"], ["即溶咖啡", "INSTANT"]
  ])("parses the complete category %s", (value, expected) => expect(parseCoffeeCategory(value)).toBe(expected));
  it.each([undefined, "", "beans", "ground", "pods", "tea", "coffee and tea", "coffee beans and ground coffee",
    "whole bean or pods", "咖啡豆/咖啡粉", "coffee grinder", "coffee socks", "whole bean coffee machine",
    "JBC coffee", "coffee BB1234", "K-Cup Classic Roast 24", "Chambersburg Coffee Whole Bean", "green coffee beans"])(
    "does not reinterpret the named, mixed or unrelated request %s", value => expect(parseCoffeeCategory(value)).toBeUndefined());
  it.each(["coffee beans", "ground coffee", "coffee pods", "instant coffee", "咖啡豆", "咖啡粉", "胶囊咖啡", "速溶咖啡"])(
    "allows generic coffee to refine into %s", current => expect(isCoffeeCategoryRefinement("coffee", current)).toBe(true));
  it.each([["whole bean coffee", "咖啡豆"], ["coffee beans", "whole bean coffee"], ["coffee", "咖啡"], ["coffee pods", "咖啡膠囊"]])(
    "allows controlled equivalent categories %s to %s", (previous, current) => expect(isCoffeeCategoryRefinement(previous, current)).toBe(true));
  it.each([["coffee beans", "coffee"], ["coffee beans", "ground coffee"], ["coffee pods", "instant coffee"],
    ["tea", "coffee"], ["coffee", "coffee and tea"], ["JBC coffee", "coffee beans"], ["coffee", "JBC whole bean coffee"]])(
    "does not broaden or replace %s with %s", (previous, current) => expect(isCoffeeCategoryRefinement(previous, current)).toBe(false));
});

describe("coffee product and selected-form evidence", () => {
  // Frozen public titles from source/coffee_with_type.json, 2026-09-08.
  it.each([
    "Coffee Blossom Honey – 12oz. jar", "Coffee & Beignets Toddler Socks", "Coffee & Beignets Baby Socks",
    "Grey COFFEE Comfort Colors Sweatshirt", "21st Century Coffee: A Guide"
  ])("rejects the real non-coffee result %s", title => {
    expect(assessCoffeeCategory("COFFEE", { title }).status).toBe("CONTRADICTED");
    expect(assessCoffeeCategory("WHOLE_BEAN", { title }).status).toBe("CONTRADICTED");
  });
  it.each(["Chambersburg Coffee – 2oz. – Whole Bean", "Cross Blend Coffee – 2oz. – Whole Bean"])(
    "accepts the real whole-bean result %s", title => expect(assessCoffeeCategory("WHOLE_BEAN", { title }).status).toBe("MATCHED"));
  it.each([
    "Q Air Manual Coffee Grinder", "Espresso Coffee Machine", "Coffee Mug", "Coffee Filter Papers", "Coffee Gift Card",
    "Coffee-Flavored Chocolate", "咖啡杯", "咖啡磨豆机", "咖啡机", "咖啡主题袜子", "咖啡书籍", "咖啡风味蜂蜜"
  ])("does not let coffee mentions make %s a coffee product", title => {
    expect(assessCoffeeCategory("COFFEE", { title, description: "Compatible with whole bean coffee and ground coffee." }).status).toBe("CONTRADICTED");
  });
  it.each<[CoffeeCategory, string]>([
    ["COFFEE", "Roasted Coffee"], ["WHOLE_BEAN", "Roasted Coffee Beans"], ["GROUND", "Medium Roast Ground Coffee"],
    ["PODS", "Coffee Capsules 10 Pack"], ["PODS", "Coffee K-Cups 24 Pack"], ["INSTANT", "Instant Coffee"],
    ["WHOLE_BEAN", "烘焙咖啡豆"], ["GROUND", "研磨咖啡粉"], ["PODS", "咖啡胶囊"], ["INSTANT", "即溶咖啡"]
  ])("matches %s with explicit title %s", (category, title) => expect(assessCoffeeCategory(category, { title }).status).toBe("MATCHED"));
  it.each<[CoffeeCategory, string]>([
    ["WHOLE_BEAN", "Ground Coffee"], ["WHOLE_BEAN", "Coffee Pods"], ["WHOLE_BEAN", "Instant Coffee"],
    ["WHOLE_BEAN", "Green Coffee Beans"], ["WHOLE_BEAN", "Unroasted Coffee Beans"], ["WHOLE_BEAN", "未烘焙咖啡豆"],
    ["GROUND", "Whole Bean Coffee"], ["PODS", "Ground Coffee"], ["INSTANT", "Whole Bean Coffee"]
  ])("rejects %s when the primary form is %s", (category, title) => expect(assessCoffeeCategory(category, { title }).status).toBe("CONTRADICTED"));
  it("accepts a coffee-specific product type as primary form evidence", () => {
    expect(assessCoffeeCategory("WHOLE_BEAN", { title: "House Blend", productType: "Whole Bean Coffee" }).status).toBe("MATCHED");
  });
  it("does not treat honey processing or chocolate tasting notes as a different primary product", () => {
    expect(assessCoffeeCategory("WHOLE_BEAN", { title: "Honey Process Whole Bean Coffee", description: "Notes of milk chocolate." }).status).toBe("MATCHED");
  });
  it("gives selected Ground precedence over parent Whole Bean options", () => {
    const candidate = { title: "House Blend Coffee", description: "Whole bean or ground options available.", variantDimensions: { Grind: "Ground" } };
    expect(assessCoffeeCategory("WHOLE_BEAN", candidate).status).toBe("CONTRADICTED");
    expect(assessCoffeeCategory("GROUND", candidate).status).toBe("MATCHED");
  });
  it("uses only the selected grind when the parent title describes whole bean coffee", () => {
    const candidate = { title: "Whole Bean Coffee", variantDimensions: { Grind: "Ground" } };
    expect(assessCoffeeCategory("WHOLE_BEAN", candidate).status).toBe("CONTRADICTED");
    expect(assessCoffeeCategory("GROUND", candidate).status).toBe("MATCHED");
  });
  it("recognizes a selected grind setting as ground only on a grind dimension", () => {
    expect(assessCoffeeCategory("GROUND", { title: "House Blend Coffee", variantDimensions: { Grind: "Drip" } }).status).toBe("MATCHED");
    expect(assessCoffeeCategory("GROUND", { title: "House Blend Coffee", variantDimensions: { Size: "Drip" } }).status).toBe("UNKNOWN");
  });
  it("retains a selected whole-bean form without adopting parent ground options", () => {
    expect(assessCoffeeCategory("WHOLE_BEAN", { title: "House Blend Coffee", description: "Choose whole bean or ground.",
      variantDimensions: { Grind: "Whole Bean" } }).status).toBe("MATCHED");
  });
  it.each([
    { title: "House Blend Coffee", description: "Available whole bean or ground." },
    { title: "House Blend Coffee", description: "Compatible with whole bean coffee brewing equipment." },
    { title: "House Blend Coffee", description: "Whole bean coffee is also available in our catalog." },
    { title: "House Blend Coffee", variantDimensions: { Grind: "Whole Bean / Ground" } },
    { title: "Whole Bean Coffee", variantDimensions: { Grind: "Select a grind" } },
    { title: "Coffee Beans or Ground Coffee" },
    { title: "House Blend Coffee", variantDimensions: { Grind: "Whole Bean", Form: "Ground" } },
    { title: "Roasted Coffee" }, { title: "House Blend", description: "We also sell whole bean coffee." }
  ])("does not manufacture a selected whole-bean form from %j", candidate => {
    const result = assessCoffeeCategory("WHOLE_BEAN", candidate);
    expect(result.status).toBe("UNKNOWN");
    expect(result.evidence.length).toBeGreaterThan(0);
  });
  it("does not let a grind selection override an explicit non-coffee main product", () => {
    expect(assessCoffeeCategory("WHOLE_BEAN", { title: "Coffee Grinder", variantDimensions: { Grind: "Whole Bean" } }).status).toBe("CONTRADICTED");
  });
  it("does not accept an explicit mixed coffee-and-honey bundle as a pure coffee offer", () => {
    expect(assessCoffeeCategory("WHOLE_BEAN", { title: "Whole Bean Coffee and Honey Gift Bundle" }).status).toBe("CONTRADICTED");
  });
  it("does not treat ground coffee beans as a selected whole-bean form", () => {
    expect(assessCoffeeCategory("WHOLE_BEAN", { title: "Ground Coffee Beans" }).status).toBe("CONTRADICTED");
    expect(assessCoffeeCategory("GROUND", { title: "Ground Coffee Beans" }).status).toBe("MATCHED");
  });
  it("recognizes the terminal Ground form on the real Guatemala product 979", () => {
    // supplementaryProducts in fixtures/coffee-category/woo-coffee-sample.json.
    const candidate = { title: "Guatemala Coffee – 2oz. – Ground", productType: "simple" };
    expect(assessCoffeeCategory("WHOLE_BEAN", candidate).status).toBe("CONTRADICTED");
    expect(assessCoffeeCategory("GROUND", candidate).status).toBe("MATCHED");
  });
  it("does not use an also-available Ground description as the selected form", () => {
    const candidate = { title: "Guatemala Coffee – 2oz. – Whole Bean", description: "Whole Bean coffee is also available Ground" };
    expect(assessCoffeeCategory("WHOLE_BEAN", candidate).status).toBe("MATCHED");
    expect(assessCoffeeCategory("GROUND", candidate).status).toBe("CONTRADICTED");
  });
  it("rejects a selected green form even for the broad coffee category", () => {
    expect(assessCoffeeCategory("COFFEE", { title: "House Blend Coffee",
      variantDimensions: { Format: "Green Coffee Beans" } }).status).toBe("CONTRADICTED");
  });
  it.each<[string, CoffeeCategory]>([["Pods", "PODS"], ["Instant", "INSTANT"]])("recognizes selected Format=%s", (format, category) => {
    const candidate = { title: "House Blend Coffee", variantDimensions: { Format: format } };
    expect(assessCoffeeCategory(category, candidate).status).toBe("MATCHED");
    expect(assessCoffeeCategory("WHOLE_BEAN", candidate).status).toBe("CONTRADICTED");
  });
  it("keeps a coffee item with unspecified form in the broad category", () => {
    expect(assessCoffeeCategory("COFFEE", { title: "Roasted Coffee", description: "Whole bean or ground options available." }).status).toBe("MATCHED");
  });
  it.each([
    "iPhone 15 Pro Max Case: Strong Magnetic Translucent Matte Slim Shockproof Protective Drop Full Protection Phone Cover - Coffee",
    "Hario V60 Ceramic Coffee Dripper 02-White"
  ])("rejects the newly observed non-coffee primary product %s without merchant or color metadata", title => {
    expect(assessCoffeeCategory("COFFEE", { title }).status).toBe("CONTRADICTED");
    expect(assessCoffeeCategory("WHOLE_BEAN", { title }).status).toBe("CONTRADICTED");
  });
  it("accepts the real Wilton Benitez plural Coffees title without inferring a selected form", () => {
    const candidate = { title: "Wilton Benitez Cooler Coffees" };
    expect(assessCoffeeCategory("COFFEE", candidate).status).toBe("MATCHED");
    expect(assessCoffeeCategory("WHOLE_BEAN", candidate).status).toBe("UNKNOWN");
    expect(assessCoffeeCategory("COFFEE", { title: "Coffeemaker" }).status).not.toBe("MATCHED");
  });
});
