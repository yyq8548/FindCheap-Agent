import { z } from "zod";
import { parse, type Expression } from "acorn";
import { parse as parseHtml, type DefaultTreeAdapterTypes } from "parse5";
import type { ShopifyProductJsonVariant } from "./shopify-product-json.js";

const IdSchema = z.string().regex(/^[1-9]\d{0,29}$/u);
const InitDataSchema = z.object({ productVariants: z.array(z.object({
  id: IdSchema,
  sku: z.string().min(1).max(300),
  price: z.object({ amount: z.union([z.number(), z.string().max(30)]), currencyCode: z.string().max(3) }),
  product: z.object({ id: IdSchema, url: z.string().min(1).max(4096) })
})).max(100) });

export type VariantPriceEvidence = { prices: Map<string, number>; ambiguous: boolean };

// Web Pixels initData is current-page product data, not a currency default.
// Only its direct variant records can corroborate the independently read .js.
export function shopifyPageVariantPrices(html: string, canonicalProductUrl: string,
  product: { id?: unknown; variants: readonly ShopifyProductJsonVariant[] }): VariantPriceEvidence {
  const prices = new Map<string, number>();
  const blocks = pageInitializationScripts(html);
  if (blocks === undefined) return { prices, ambiguous: true };
  if (!blocks.length) return { prices, ambiguous: false };
  if (blocks.length !== 1) return { prices, ambiguous: true };
  const block = blocks[0]!;
  const mime = block.attrs.find(attribute => attribute.name === "type")?.value.trim();
  if (block.attrs.some(attribute => attribute.name === "src" || attribute.name === "nomodule")
    || (mime !== undefined && !/^(?:text|application)\/javascript$/iu.test(mime))) {
    return { prices, ambiguous: true };
  }
  const script = block.source;
  const json = initializationJson(script);
  if (json === undefined) return { prices, ambiguous: true };
  let data: z.infer<typeof InitDataSchema>;
  try { data = InitDataSchema.parse(JSON.parse(json)); }
  catch { return { prices, ambiguous: true }; }
  const productId = typeof product.id === "number" && Number.isSafeInteger(product.id)
    ? String(product.id) : typeof product.id === "string" ? product.id : "";
  if (!IdSchema.safeParse(productId).success) return { prices, ambiguous: true };
  const current = new URL(canonicalProductUrl);
  const seen = new Set<string>();
  for (const entry of data.productVariants) {
    if (seen.has(entry.id)) return { prices: new Map(), ambiguous: true };
    seen.add(entry.id);
    const variant = product.variants.find(value => value.id === entry.id);
    if (variant === undefined) continue;
    const amount = usdCents(entry.price.amount);
    let sameProductUrl = false;
    try {
      const url = new URL(entry.product.url, current);
      sameProductUrl = url.href === current.href;
    } catch { /* Invalid product URL cannot establish variant identity. */ }
    if (entry.product.id !== productId || !sameProductUrl || !variant.sku || entry.sku !== variant.sku
      || entry.price.currencyCode !== "USD" || amount === undefined || amount !== variant.price) {
      return { prices: new Map(), ambiguous: true };
    }
    prices.set(entry.id, amount);
  }
  return { prices, ambiguous: false };
}

function pageInitializationScripts(html: string) {
  if (html.length > 4_000_000) return undefined;
  try {
    const pending: DefaultTreeAdapterTypes.Node[] = [parseHtml(html, { scriptingEnabled: true })];
    const scripts: Array<{ attrs: DefaultTreeAdapterTypes.Element["attrs"]; source: string }> = [];
    while (pending.length) {
      const node = pending.pop()!;
      if ("tagName" in node) {
        if (node.namespaceURI !== "http://www.w3.org/1999/xhtml" || node.tagName === "template" || node.tagName === "noscript") continue;
        if (node.tagName === "script") {
          const source = node.childNodes.map(child => "value" in child ? child.value : "").join("");
          if (/\binitData\s*:/u.test(source)) scripts.push({ attrs: node.attrs, source });
          continue;
        }
      }
      if ("childNodes" in node) pending.push(...node.childNodes);
    }
    return scripts;
  } catch { return undefined; }
}

// Accept only the observed loader declaration followed by its direct call,
// optionally wrapped in an immediately invoked function. No AST traversal of
// arbitrary callbacks or control flow, and no execution of the loader itself.
function initializationJson(script: string): string | undefined {
  if (script.length > 262_144) return undefined;
  try {
    let body = parse(script, { ecmaVersion: "latest", sourceType: "script" }).body;
    const outer = body.length === 1 && body[0]?.type === "ExpressionStatement" ? body[0].expression : undefined;
    if (outer?.type === "CallExpression" && outer.arguments.length === 0 && outer.callee.type === "FunctionExpression"
      && !outer.callee.async && !outer.callee.generator && outer.callee.params.length === 0) body = outer.callee.body.body;
    if (body.length !== 2 || body[0]?.type !== "VariableDeclaration" || body[1]?.type !== "ExpressionStatement") return undefined;
    const declarations = body[0].declarations;
    const declaration = declarations.length === 1 ? declarations[0] : undefined;
    if (declaration?.id.type !== "Identifier" || declaration.id.name !== "wpmLoader") return undefined;
    const initializer = declaration.init;
    const loader = initializer?.type === "CallExpression" && initializer.arguments.length === 0 ? initializer.callee : initializer;
    if (loader?.type !== "FunctionExpression" || loader.async || loader.generator) return undefined;
    const call = body[1].expression;
    if (call.type !== "CallExpression" || call.optional || call.callee.type !== "Identifier" || call.callee.name !== "wpmLoader"
      || (call.arguments.length !== 1 && call.arguments.length !== 5) || call.arguments[0]?.type !== "ObjectExpression"
      || !call.arguments.every(argument => argument.type !== "SpreadElement" && literalData(argument))) return undefined;
    const properties = call.arguments[0].properties;
    if (properties.some(property => property.type !== "Property" || property.computed || property.method || property.kind !== "init")) return undefined;
    const initializations = properties.filter(property => property.type === "Property" &&
      (property.key.type === "Identifier" ? property.key.name === "initData" : property.key.type === "Literal" && property.key.value === "initData"));
    const property = initializations.length === 1 ? initializations[0] : undefined;
    if (property?.type !== "Property" || property.value.type !== "ObjectExpression" || property.value.end - property.value.start > 131_072
      || !literalData(property.value, true)) return undefined;
    return script.slice(property.value.start, property.value.end);
  } catch { return undefined; }
}

function literalData(node: Expression, quotedKeys = false): boolean {
  if (node.type === "ArrayExpression") return node.elements.every(value => value !== null && value.type !== "SpreadElement" && literalData(value, quotedKeys));
  if (node.type !== "ObjectExpression") return node.type === "Literal" &&
    (node.value === null || ["string", "number", "boolean"].includes(typeof node.value))
    || node.type === "UnaryExpression" && node.operator === "-" && node.argument.type === "Literal" && typeof node.argument.value === "number";
  const keys = new Set<string>();
  return node.properties.every(property => {
    if (property.type !== "Property" || property.computed || property.method || property.kind !== "init") return false;
    const key = property.key.type === "Literal" && typeof property.key.value === "string" ? property.key.value
      : !quotedKeys && property.key.type === "Identifier" ? property.key.name : undefined;
    if (key === undefined || keys.has(key)) return false;
    keys.add(key);
    return literalData(property.value as Expression, quotedKeys);
  });
}

function usdCents(amount: number | string): number | undefined {
  const match = String(amount).match(/^(0|[1-9]\d{0,6})(?:\.(\d{1,2}))?$/u);
  if (match === null) return undefined;
  const cents = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  return Number.isSafeInteger(cents) && cents <= 100_000_000 ? cents : undefined;
}
