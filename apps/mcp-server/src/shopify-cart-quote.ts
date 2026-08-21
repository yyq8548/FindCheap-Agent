import { lookup } from "node:dns/promises";
import { request as httpsRequest, type RequestOptions } from "node:https";
import { isIP } from "node:net";
import { domainToASCII } from "node:url";
import { z } from "zod";

import { isForbiddenIp } from "../../ingestion-worker/src/network/safe-fetch.js";
import type { ShopifyProduct } from "./shopify-client.js";
import { estimateSalesTax } from "./sales-tax-estimator.js";

const API_VERSION = "2026-07";
const MAX_RESPONSE_BYTES = 512 * 1024;
const QUOTE_TTL_MS = 10 * 60_000;

const MoneySchema = z.object({
  amount: z.string().regex(/^\d+(?:\.\d{1,2})?$/u).max(20),
  currencyCode: z.literal("USD")
}).strict();
const CostSchema = z.object({
  subtotalAmount: MoneySchema,
  totalAmount: MoneySchema,
  totalAmountEstimated: z.boolean(),
  totalTaxAmount: MoneySchema.nullable(),
  totalTaxAmountEstimated: z.boolean()
}).strict();
const DeliveryOptionSchema = z.object({
  handle: z.string().trim().min(1).max(500),
  title: z.string().trim().min(1).max(300),
  estimatedCost: MoneySchema
}).strict();
const DeliveryGroupSchema = z.object({
  id: z.string().startsWith("gid://shopify/CartDeliveryGroup/").max(1_000),
  deliveryOptions: z.array(DeliveryOptionSchema).max(50),
  selectedDeliveryOption: DeliveryOptionSchema.nullable()
}).strict();
const CartSchema = z.object({
  id: z.string().startsWith("gid://shopify/Cart/").max(2_048),
  cost: CostSchema,
  deliveryGroups: z.object({ nodes: z.array(DeliveryGroupSchema).max(20) }).strict()
}).strict();
const ErrorSchema = z.object({
  field: z.array(z.string()).nullable().optional(),
  message: z.string().max(2_000)
}).passthrough();
const CreateResponseSchema = z.object({
  data: z.object({
    cartCreate: z.object({
      cart: CartSchema.nullable(),
      userErrors: z.array(ErrorSchema).max(20),
      warnings: z.array(z.unknown()).max(20)
    }).strict()
  }).strict(),
  errors: z.array(z.unknown()).max(20).optional()
}).passthrough();
const UpdateResponseSchema = z.object({
  data: z.object({
    cartSelectedDeliveryOptionsUpdate: z.object({
      cart: CartSchema.nullable(),
      userErrors: z.array(ErrorSchema).max(20),
      warnings: z.array(z.unknown()).max(20)
    }).strict()
  }).strict(),
  errors: z.array(z.unknown()).max(20).optional()
}).passthrough();

const CART_FIELDS = `
  id
  cost {
    subtotalAmount { amount currencyCode }
    totalAmount { amount currencyCode }
    totalAmountEstimated
    totalTaxAmount { amount currencyCode }
    totalTaxAmountEstimated
  }
  deliveryGroups(first: 20) {
    nodes {
      id
      deliveryOptions {
        handle
        title
        estimatedCost { amount currencyCode }
      }
      selectedDeliveryOption {
        handle
        title
        estimatedCost { amount currencyCode }
      }
    }
  }
`;
const CREATE_CART = `mutation CreateCart($input: CartInput!) {
  cartCreate(input: $input) {
    cart { ${CART_FIELDS} }
    userErrors { field message }
    warnings { code message }
  }
}`;
const SELECT_DELIVERY = `mutation SelectDelivery(
  $cartId: ID!,
  $selectedDeliveryOptions: [CartSelectedDeliveryOptionInput!]!
) {
  cartSelectedDeliveryOptionsUpdate(
    cartId: $cartId,
    selectedDeliveryOptions: $selectedDeliveryOptions
  ) {
    cart { ${CART_FIELDS} }
    userErrors { field message }
    warnings { code message }
  }
}`;

export type ShopifyCartRequest = {
  url: string;
  query: string;
  variables: Record<string, unknown>;
  timeoutMs: number;
};

export type ShopifyCartEstimate = {
  status: "ESTIMATED";
  subtotal: { amountCents: number; currency: "USD" };
  shipping: { amountCents: number; currency: "USD"; label: string };
  tax: {
    status: "SHOPIFY_REPORTED";
    amount: { amountCents: number; currency: "USD" };
    shopifyEstimated: boolean;
    source: "SHOPIFY_CART";
  } | {
    status: "ZIP_ESTIMATED";
    amount: { amountCents: number; currency: "USD" };
    jurisdiction: string;
    rateBasisPoints: number;
    source: "TAX_FOUNDATION_STATE_AVERAGE_2026";
  };
  deliveredPrice: { amountCents: number; currency: "USD" };
  totalEstimated: boolean;
  checkedAt: string;
  expiresAt: string;
};

export const ShopifyQuoteFailureCodes = [
  "FULL_ADDRESS_REQUIRED",
  "NO_DELIVERY_OPTIONS",
  "MERCHANT_CART_UNAVAILABLE",
  "VARIANT_REJECTED",
  "QUOTE_TIMEOUT"
] as const;

export type ShopifyQuoteFailureCode = typeof ShopifyQuoteFailureCodes[number];

export type ShopifyDeliveryAddress = {
  address1: string;
  city: string;
  provinceCode: string;
};

export class ShopifyCartQuoteError extends Error {
  readonly code: ShopifyQuoteFailureCode;

  constructor(code: ShopifyQuoteFailureCode, options?: ErrorOptions) {
    super(code, options);
    this.name = "ShopifyCartQuoteError";
    this.code = code;
  }
}

export interface ShopifyCartQuotePort {
  quote(
    product: ShopifyProduct,
    zipCode: string,
    deliveryAddress?: ShopifyDeliveryAddress
  ): Promise<ShopifyCartEstimate>;
}

type Dependencies = {
  request?: (input: ShopifyCartRequest) => Promise<unknown>;
  resolve?: typeof lookup;
  requestImpl?: typeof httpsRequest;
  clock?: { now(): Date };
};

export function createShopifyCartQuotePort(
  environment: Readonly<Record<string, string | undefined>>,
  dependencies: Dependencies = {}
): ShopifyCartQuotePort {
  if (environment.SHOPIFY_CART_QUOTE_MODE !== "tokenless") return unavailablePort();
  const timeoutMs = parseTimeout(environment.SHOPIFY_CART_QUOTE_TIMEOUT_MS);
  const request = dependencies.request ?? createPinnedShopifyCartRequest(dependencies);
  const clock = dependencies.clock ?? { now: () => new Date() };

  return {
    async quote(product, zipCode, deliveryAddress) {
      const target = quoteTarget(product);
      const zip = parseZip(zipCode);
      const address = deliveryAddress === undefined ? undefined : parseDeliveryAddress(deliveryAddress);
      const variantId = parseVariantId(product.handle);
      try {
      const create = parseCreate(await request({
        url: target,
        query: CREATE_CART,
        variables: {
          input: {
            lines: [{ merchandiseId: `gid://shopify/ProductVariant/${variantId}`, quantity: 1 }],
            buyerIdentity: {
              countryCode: "US",
              deliveryAddressPreferences: [{
                deliveryAddress: {
                  country: "US",
                  zip,
                  ...(address === undefined
                    ? {}
                    : { address1: address.address1, city: address.city, province: address.provinceCode })
                },
                oneTimeUse: true
              }]
            }
          }
        },
        timeoutMs
      }));
      if (create.deliveryGroups.nodes.length === 0) {
        throw new ShopifyCartQuoteError("NO_DELIVERY_OPTIONS");
      }
      const selections = create.deliveryGroups.nodes.map((group) => {
        const selected = [...group.deliveryOptions].sort((left, right) =>
          cents(left.estimatedCost) - cents(right.estimatedCost) || compareText(left.title, right.title)
        )[0];
        if (selected === undefined) throw new ShopifyCartQuoteError("NO_DELIVERY_OPTIONS");
        return {
          deliveryGroupId: group.id,
          deliveryOptionHandle: selected.handle,
          option: selected
        };
      });
      const updated = parseUpdate(await request({
        url: target,
        query: SELECT_DELIVERY,
        variables: {
          cartId: create.id,
          selectedDeliveryOptions: selections.map(({ deliveryGroupId, deliveryOptionHandle }) => ({
            deliveryGroupId,
            deliveryOptionHandle
          }))
        },
        timeoutMs
      }));
      if (updated.id !== create.id) throw new Error("Shopify Cart response identity changed");
      const selectedOptions = selections.map((selection) => {
        const updatedGroup = updated.deliveryGroups.nodes.find((group) => group.id === selection.deliveryGroupId);
        if (
          updatedGroup?.selectedDeliveryOption === null ||
          updatedGroup?.selectedDeliveryOption === undefined ||
          updatedGroup.selectedDeliveryOption.handle !== selection.deliveryOptionHandle
        ) throw new Error("Shopify Cart selected delivery option changed");
        return updatedGroup.selectedDeliveryOption;
      });
      if (updated.deliveryGroups.nodes.length !== selections.length) {
        throw new Error("Shopify Cart delivery groups changed");
      }
      const checkedAt = clock.now();
      const shippingCents = selectedOptions.reduce((sum, option) => sum + cents(option.estimatedCost), 0);
      if (!Number.isSafeInteger(shippingCents)) throw new Error("Shopify Cart shipping is outside supported range");
      const subtotal = money(updated.cost.subtotalAmount);
      const shopifyTax = updated.cost.totalTaxAmount === null ? undefined : money(updated.cost.totalTaxAmount);
      const zipTax = shopifyTax === undefined ? estimateSalesTax(zip, subtotal.amountCents) : undefined;
      if (shopifyTax === undefined && zipTax === undefined) {
        throw new Error("ZIP tax estimate is unavailable");
      }
      const tax = shopifyTax === undefined
        ? {
            status: "ZIP_ESTIMATED" as const,
            amount: { amountCents: zipTax!.amountCents, currency: zipTax!.currency },
            jurisdiction: zipTax!.jurisdiction,
            rateBasisPoints: zipTax!.rateBasisPoints,
            source: zipTax!.source
          }
        : {
            status: "SHOPIFY_REPORTED" as const,
            amount: shopifyTax,
            shopifyEstimated: updated.cost.totalTaxAmountEstimated,
            source: "SHOPIFY_CART" as const
          };
      const estimatedTotalCents = shopifyTax === undefined
        ? subtotal.amountCents + shippingCents + tax.amount.amountCents
        : cents(updated.cost.totalAmount);
      if (!Number.isSafeInteger(estimatedTotalCents)) {
        throw new Error("Shopify Cart total is outside supported range");
      }
      return {
        status: "ESTIMATED",
        subtotal,
        shipping: {
          amountCents: shippingCents,
          currency: "USD",
          label: selectedOptions.map((option) => option.title).join(" + ")
        },
        tax,
        deliveredPrice: { amountCents: estimatedTotalCents, currency: "USD" },
        totalEstimated: updated.cost.totalAmountEstimated,
        checkedAt: checkedAt.toISOString(),
        expiresAt: new Date(checkedAt.getTime() + QUOTE_TTL_MS).toISOString()
      };
      } catch (error) {
        throw normalizeQuoteError(error);
      }
    }
  };
}

function unavailablePort(): ShopifyCartQuotePort {
  return { async quote() { throw new Error("DATA_SOURCE_UNAVAILABLE"); } };
}

function quoteTarget(product: ShopifyProduct): string {
  const sourceHost = normalizeHost(product.sourceHost);
  let merchant: URL;
  try {
    merchant = new URL(product.merchantUrl);
  } catch (error) {
    throw new Error("Shopify merchant URL is invalid", { cause: error });
  }
  if (
    merchant.protocol !== "https:" || merchant.username !== "" || merchant.password !== "" ||
    merchant.port !== "" || normalizeHost(merchant.hostname) !== sourceHost ||
    !merchant.pathname.startsWith("/products/")
  ) {
    throw new Error("Shopify merchant host does not match Catalog evidence");
  }
  return `https://${sourceHost}/api/${API_VERSION}/graphql.json`;
}

function parseVariantId(value: string): string {
  if (!/^\d{1,30}$/u.test(value)) throw new Error("Shopify variant identity is invalid");
  return value;
}

function parseZip(value: string): string {
  if (!/^\d{5}(?:-\d{4})?$/u.test(value)) throw new Error("Shopify Cart ZIP is invalid");
  return value;
}

function parseDeliveryAddress(value: ShopifyDeliveryAddress): ShopifyDeliveryAddress {
  const address1 = boundedAddressText(value.address1, "address1", 200);
  const city = boundedAddressText(value.city, "city", 100);
  const provinceCode = value.provinceCode.trim().toUpperCase();
  if (!/^[A-Z]{2}$/u.test(provinceCode)) throw new Error("Shopify delivery province is invalid");
  return { address1, city, provinceCode };
}

function boundedAddressText(value: string, field: string, maximumLength: number): string {
  const normalized = value.trim();
  if (normalized.length < 1 || normalized.length > maximumLength || [...normalized].some(isControlCharacter)) {
    throw new Error(`Shopify delivery ${field} is invalid`);
  }
  return normalized;
}

function isControlCharacter(character: string): boolean {
  const code = character.codePointAt(0) ?? 0;
  return code <= 31 || code === 127;
}

function parseTimeout(value: string | undefined): number {
  if (value === undefined) return 2_500;
  if (!/^\d+$/u.test(value)) throw new Error("SHOPIFY_CART_QUOTE_TIMEOUT_MS is invalid");
  const timeout = Number(value);
  if (timeout < 500 || timeout > 5_000) throw new Error("SHOPIFY_CART_QUOTE_TIMEOUT_MS is invalid");
  return timeout;
}

function parseCreate(input: unknown): z.infer<typeof CartSchema> {
  try {
    const parsed = CreateResponseSchema.parse(input);
    const failures = [...(parsed.errors ?? []), ...parsed.data.cartCreate.userErrors];
    if (failures.length > 0) throw classifyMerchantFailures(failures);
    if (parsed.data.cartCreate.cart === null) throw new ShopifyCartQuoteError("MERCHANT_CART_UNAVAILABLE");
    return parsed.data.cartCreate.cart;
  } catch (error) {
    if (error instanceof ShopifyCartQuoteError) throw error;
    throw new ShopifyCartQuoteError("MERCHANT_CART_UNAVAILABLE", { cause: error });
  }
}

function parseUpdate(input: unknown): z.infer<typeof CartSchema> {
  try {
    const parsed = UpdateResponseSchema.parse(input);
    const failures = [...(parsed.errors ?? []), ...parsed.data.cartSelectedDeliveryOptionsUpdate.userErrors];
    if (failures.length > 0) throw classifyMerchantFailures(failures);
    if (parsed.data.cartSelectedDeliveryOptionsUpdate.cart === null) {
      throw new ShopifyCartQuoteError("MERCHANT_CART_UNAVAILABLE");
    }
    return parsed.data.cartSelectedDeliveryOptionsUpdate.cart;
  } catch (error) {
    if (error instanceof ShopifyCartQuoteError) throw error;
    throw new ShopifyCartQuoteError("MERCHANT_CART_UNAVAILABLE", { cause: error });
  }
}

function classifyMerchantFailures(failures: unknown[]): ShopifyCartQuoteError {
  const evidence = failures.map((failure) => {
    if (typeof failure !== "object" || failure === null) return "";
    const record = failure as Record<string, unknown>;
    const field = Array.isArray(record.field) ? record.field.filter((part) => typeof part === "string").join(" ") : "";
    const message = typeof record.message === "string" ? record.message : "";
    return `${field} ${message}`.toLowerCase();
  }).join(" ");
  if (/\b(address|city|province|state|postal|zip)\b/u.test(evidence)) {
    return new ShopifyCartQuoteError("FULL_ADDRESS_REQUIRED");
  }
  if (/\b(delivery|shipping|ship)\b/u.test(evidence)) {
    return new ShopifyCartQuoteError("NO_DELIVERY_OPTIONS");
  }
  if (/\b(line|lines|merchandise|variant|inventory|stock|sold|quantity|available|availability)\b/u.test(evidence)) {
    return new ShopifyCartQuoteError("VARIANT_REJECTED");
  }
  return new ShopifyCartQuoteError("MERCHANT_CART_UNAVAILABLE");
}

function normalizeQuoteError(error: unknown): ShopifyCartQuoteError {
  if (error instanceof ShopifyCartQuoteError) return error;
  if (
    error instanceof Error &&
    (error.name === "AbortError" || error.name === "TimeoutError" || /\b(?:timed out|timeout|aborted)\b/iu.test(error.message))
  ) {
    return new ShopifyCartQuoteError("QUOTE_TIMEOUT", { cause: error });
  }
  if (error instanceof Error && /delivery option/iu.test(error.message)) {
    return new ShopifyCartQuoteError("NO_DELIVERY_OPTIONS", { cause: error });
  }
  return new ShopifyCartQuoteError("MERCHANT_CART_UNAVAILABLE", { cause: error });
}

function money(value: z.infer<typeof MoneySchema>): { amountCents: number; currency: "USD" } {
  return { amountCents: cents(value), currency: "USD" };
}

function cents(value: z.infer<typeof MoneySchema>): number {
  const [whole, fraction = ""] = value.amount.split(".");
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(result)) throw new Error("Shopify Cart amount is outside supported range");
  return result;
}

function normalizeHost(value: string): string {
  const host = domainToASCII(value.trim().replace(/\.$/u, "")).toLowerCase();
  if (
    host.length < 1 || host.length > 253 || host.includes("..") ||
    !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])$/u.test(host)
  ) throw new Error("Shopify merchant host is invalid");
  return host;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function createPinnedShopifyCartRequest(
  dependencies: Pick<Dependencies, "resolve" | "requestImpl"> = {}
): (input: ShopifyCartRequest) => Promise<unknown> {
  const resolve = dependencies.resolve ?? lookup;
  const requestImpl = dependencies.requestImpl ?? httpsRequest;
  return async (input) => requestJson(input, resolve, requestImpl);
}

async function requestJson(
  input: ShopifyCartRequest,
  resolve: typeof lookup,
  requestImpl: typeof httpsRequest
): Promise<unknown> {
  const url = new URL(input.url);
  const deadline = Date.now() + input.timeoutMs;
  const addresses = await withDeadline(
    resolve(url.hostname, { all: true, verbatim: true }),
    input.timeoutMs,
    "Shopify Cart DNS timed out"
  );
  if (
    addresses.length === 0 ||
    addresses.some(({ address, family }) =>
      (family !== 4 && family !== 6) || isIP(address) !== family || isForbiddenIp(address)
    )
  ) throw new Error("Shopify Cart DNS is unsafe");
  const body = JSON.stringify({ query: input.query, variables: input.variables });
  if (Buffer.byteLength(body, "utf8") > 32 * 1024) throw new Error("Shopify Cart request is too large");
  const remainingMs = deadline - Date.now();
  if (remainingMs <= 0) throw new Error("Shopify Cart request timed out");
  const signal = AbortSignal.timeout(remainingMs);

  return new Promise<unknown>((resolve, reject) => {
    const options: RequestOptions = {
      protocol: "https:",
      hostname: url.hostname,
      port: 443,
      path: url.pathname,
      method: "POST",
      servername: url.hostname,
      agent: false,
      signal,
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "content-length": String(Buffer.byteLength(body, "utf8")),
        connection: "close"
      },
      lookup: (_hostname, lookupOptions, callback) => {
        const requestedFamily = typeof lookupOptions === "number" ? lookupOptions : lookupOptions.family;
        const selected = addresses.find(({ family }) =>
          requestedFamily === undefined || requestedFamily === 0 || requestedFamily === family
        );
        if (selected === undefined) {
          callback(new Error("Shopify Cart has no approved address"), "", 4);
          return;
        }
        if (typeof lookupOptions !== "number" && lookupOptions.all === true) {
          callback(null, addresses);
          return;
        }
        callback(null, selected.address, selected.family);
      }
    };
    const request = requestImpl(options, (response) => {
      const contentType = response.headers["content-type"];
      if (
        response.statusCode !== 200 ||
        typeof contentType !== "string" ||
        !/^application\/json(?:\s*;|$)/iu.test(contentType)
      ) {
        response.destroy();
        reject(new Error("Shopify Cart request failed"));
        return;
      }
      const declared = response.headers["content-length"];
      if (
        (typeof declared === "string" && (!/^\d+$/u.test(declared) || Number(declared) > MAX_RESPONSE_BYTES)) ||
        Array.isArray(declared)
      ) {
        response.destroy();
        reject(new Error("Shopify Cart response is too large"));
        return;
      }
      const chunks: Buffer[] = [];
      let total = 0;
      response.on("data", (chunk: Buffer | string) => {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        total += bytes.byteLength;
        if (total > MAX_RESPONSE_BYTES) {
          response.destroy(new Error("Shopify Cart response is too large"));
          return;
        }
        chunks.push(bytes);
      });
      response.once("error", reject);
      response.once("end", () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
        } catch (error) {
          reject(new Error("Shopify Cart response is invalid JSON", { cause: error }));
        }
      });
    });
    request.once("error", reject);
    request.end(body);
  });
}

async function withDeadline<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      })
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
