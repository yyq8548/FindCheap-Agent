import { lookup } from "node:dns/promises";
import { request as httpsRequest, type RequestOptions } from "node:https";
import { isIP } from "node:net";
import { domainToASCII } from "node:url";
import { z } from "zod";

import { isForbiddenIp } from "../../ingestion-worker/src/network/safe-fetch.js";
import type { ShopifyProduct } from "./shopify-client.js";

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
  totalAmountEstimated: z.boolean()
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
  deliveredPrice: { amountCents: number; currency: "USD" };
  totalEstimated: boolean;
  checkedAt: string;
  expiresAt: string;
};

export interface ShopifyCartQuotePort {
  quote(product: ShopifyProduct, zipCode: string): Promise<ShopifyCartEstimate>;
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
    async quote(product, zipCode) {
      const target = quoteTarget(product);
      const zip = parseZip(zipCode);
      const variantId = parseVariantId(product.handle);
      const create = parseCreate(await request({
        url: target,
        query: CREATE_CART,
        variables: {
          input: {
            lines: [{ merchandiseId: `gid://shopify/ProductVariant/${variantId}`, quantity: 1 }],
            buyerIdentity: {
              countryCode: "US",
              deliveryAddressPreferences: [{
                deliveryAddress: { country: "US", zip },
                oneTimeUse: true
              }]
            }
          }
        },
        timeoutMs
      }));
      if (create.deliveryGroups.nodes.length === 0) {
        throw new Error("Shopify Cart returned no delivery option");
      }
      const selections = create.deliveryGroups.nodes.map((group) => {
        const selected = [...group.deliveryOptions].sort((left, right) =>
          cents(left.estimatedCost) - cents(right.estimatedCost) || compareText(left.title, right.title)
        )[0];
        if (selected === undefined) throw new Error("Shopify Cart returned no delivery option");
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
      return {
        status: "ESTIMATED",
        subtotal: money(updated.cost.subtotalAmount),
        shipping: {
          amountCents: shippingCents,
          currency: "USD",
          label: selectedOptions.map((option) => option.title).join(" + ")
        },
        deliveredPrice: money(updated.cost.totalAmount),
        totalEstimated: updated.cost.totalAmountEstimated,
        checkedAt: checkedAt.toISOString(),
        expiresAt: new Date(checkedAt.getTime() + QUOTE_TTL_MS).toISOString()
      };
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
    if ((parsed.errors?.length ?? 0) > 0 || parsed.data.cartCreate.userErrors.length > 0) throw new Error();
    if (parsed.data.cartCreate.cart === null) throw new Error();
    return parsed.data.cartCreate.cart;
  } catch (error) {
    throw new Error("Shopify Cart create response is invalid", { cause: error });
  }
}

function parseUpdate(input: unknown): z.infer<typeof CartSchema> {
  try {
    const parsed = UpdateResponseSchema.parse(input);
    if (
      (parsed.errors?.length ?? 0) > 0 ||
      parsed.data.cartSelectedDeliveryOptionsUpdate.userErrors.length > 0 ||
      parsed.data.cartSelectedDeliveryOptionsUpdate.cart === null
    ) throw new Error();
    return parsed.data.cartSelectedDeliveryOptionsUpdate.cart;
  } catch (error) {
    throw new Error("Shopify Cart update response is invalid", { cause: error });
  }
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
