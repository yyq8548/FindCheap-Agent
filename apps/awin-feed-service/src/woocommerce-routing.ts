import { createHash } from "node:crypto";
import type { WooSearchInput } from "../../../packages/contracts/src/woocommerce.js";
import type { WooMerchant } from "./woocommerce-registry.js";

// Routing vocabulary only: these aliases never establish product identity or merchant trust.
const CATEGORY_TERMS = [
  ["coffee", "coffee bean", "咖啡", "咖啡豆"],
  ["grinder", "coffee grinder", "磨豆机", "手摇磨豆机"],
  ["espresso", "espresso machine", "咖啡机", "意式咖啡机"],
  ["backpack", "backpacking", "背包", "双肩包"],
  ["tent", "shelter", "帐篷"], ["hammock", "吊床"], ["quilt", "sleeping bag", "睡袋"],
  ["keyboard", "键盘", "机械键盘"], ["mouse", "鼠标"],
  ["headphone", "earphone", "earbud", "耳机"], ["wig", "hair extension", "假发", "接发"],
  ["amplifier", "amp", "功放", "放大器"],
  ["guitar", "吉他"], ["pedal", "effect pedal", "效果器"],
  ["bicycle", "cycling", "bike", "自行车", "骑行"], ["tire", "tyre", "轮胎"],
  ["shoe", "footwear", "鞋"], ["boot", "靴", "靴子"],
  ["shirt", "t shirt", "tshirt", "衬衫", "t恤"],
  ["dress", "连衣裙"], ["legging", "瑜伽裤", "打底裤"], ["jacket", "外套", "夹克"],
  ["skin", "skincare", "skin care", "护肤"], ["deodorant", "除臭", "止汗"],
  ["sunscreen", "sun protection", "防晒霜", "防晒"], ["shampoo", "洗发水", "洗发露"],
  ["serum", "精华液", "精华"], ["makeup", "cosmetics", "化妆品", "彩妆"],
  ["cleaner", "cleaning", "清洁剂", "清洁"], ["laundry", "detergent", "洗衣"],
  ["cookware", "pan", "锅", "厨具"], ["bedding", "床上用品"],
  ["insulated bottle", "insulated cup", "tumbler", "保温杯"],
  ["charger", "充电器"], ["phone case", "手机壳"], ["speaker", "音箱"],
  ["yoga mat", "瑜伽垫"], ["toy", "玩具"], ["board game", "桌游"],
  ["book", "书", "图书"], ["jar", "canning", "罐", "密封罐"],
  ["grill", "barbecue", "bbq", "烧烤"], ["sauce", "hot sauce", "酱", "辣酱"],
  ["pet", "宠物"], ["dog", "狗"], ["cat", "猫"],
  ["pen", "writing instrument", "笔"], ["notebook", "journal", "纸质笔记本"]
].map(group => group.map(normalize));

// Only reviewed compound coffee tags count as form evidence for routing. A bare
// "capsules" tag can describe cleaning products or supplements in a mixed store.
const COFFEE_FORM_TERMS = [
  ["coffee pods", "coffee capsules", "capsule coffee", "single serve coffee", "k cup coffee", "胶囊咖啡", "咖啡胶囊"],
  ["whole bean coffee", "coffee beans", "咖啡豆", "整豆咖啡"],
  ["ground coffee", "咖啡粉", "研磨咖啡"],
  ["instant coffee", "速溶咖啡"]
].map(group => group.map(normalize));

function rankEntries(stores: WooMerchant[], input: WooSearchInput) {
  const query = normalize(input.query);
  const categoryText = normalize(`${input.query} ${input.productType ?? ""}`);
  const explicitBrand = normalize(input.brand ?? "");
  const matchedGroups = CATEGORY_TERMS.filter(group => group.some(term => phraseMatches(categoryText, term, true)));
  const requestedForms = COFFEE_FORM_TERMS.filter(group => group.some(term => phraseMatches(categoryText, term, true)));
  const equipment = /\b(?:grinder|machine|maker|brewer|filter|dripper|kettle|accessor(?:y|ies)|equipment)\b|咖啡机|磨豆机|滤纸|配件/u;
  const beverage = matchedGroups.some(group => group.includes("coffee")) && !equipment.test(categoryText);
  const ranked = stores.map(store => {
    const brands = [...store.brands, store.name].map(normalize);
    const categories = [...new Set(store.categories.map(normalize))].filter(label => !beverage || !equipment.test(label));
    const brand = explicitBrand !== "" && brands.some(label => label.replaceAll(" ", "") === explicitBrand.replaceAll(" ", "")) ? 2
      : brands.some(label => phraseMatches(query, label)) ? 1 : 0;
    const directCategories = categories.filter(label => phraseMatches(categoryText, label, true)).length;
    const synonymCategories = matchedGroups.filter(group => categories.some(label => group.some(term => phraseMatches(label, term, true)))).length;
    const form = requestedForms.some(group => categories.some(label => group.some(term => phraseMatches(label, term, true)))) ? 1 : 0;
    // A hint only reorders already eligible access records; it never adds a host.
    const preferred = input.preferredMerchantHost !== undefined && [new URL(store.origin).hostname, ...store.aliases]
      .some(host => host.replace(/^www\./u, "") === input.preferredMerchantHost!.replace(/^www\./u, "")) ? 1 : 0;
    return { store, preferred, brand, form, category: directCategories + synonymCategories,
      tie: createHash("sha256").update(`${query}\n${explicitBrand}\n${normalize(input.productType ?? "")}\n${store.merchantId}`).digest("hex") };
  });
  return ranked.sort((a, b) => b.preferred - a.preferred || b.brand - a.brand || b.form - a.form || b.category - a.category || a.tie.localeCompare(b.tie) || a.store.merchantId.localeCompare(b.store.merchantId));
}

export function rankWooMerchants(stores: WooMerchant[], input: WooSearchInput): WooMerchant[] {
  return rankEntries(stores, input).map(item => item.store);
}

export function planWooMerchants(stores: WooMerchant[], input: WooSearchInput) {
  const entries = rankEntries(stores, input);
  const relevant = entries.filter(item => input.productUrl !== undefined || item.preferred + item.brand + item.form + item.category > 0);
  const selected = relevant.slice(0, 6);
  const exploration = entries.filter(item => !relevant.includes(item)).slice(0, Math.min(2, 6 - selected.length));
  return { stores: [...selected, ...exploration].map(item => item.store), routing: {
    scope: "CURRENT_PASS" as const, matchedStores: relevant.length, relevantPlanned: selected.length, explorationPlanned: exploration.length
  } };
}

function normalize(value: string): string {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/gu, " ");
}
function phraseMatches(text: string, label: string, plurals = false): boolean {
  if (label === "") return false;
  if (/[\u3400-\u9fff]/u.test(label)) return text.includes(label);
  const words = text.split(" ");
  const expected = label.split(" ");
  return words.some((_, start) => expected.every((word, offset) => {
    const actual = words[start + offset];
    return actual === word || plurals && (actual === `${word}s` || actual === `${word}es` || word.endsWith("y") && actual === `${word.slice(0, -1)}ies`);
  }));
}
