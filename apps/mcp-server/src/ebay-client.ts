import { z } from "zod";

const MAX_RESPONSE_BYTES = 256 * 1024;

export type EbayCondition = "NEW" | "USED" | "REFURBISHED" | "OPEN_BOX" | "UNKNOWN";

export type EbayProduct = {
  itemId: string;
  productRef: string;
  title: string;
  category: string;
  attributes: string[];
  sellerName: string;
  sellerFeedbackPercentage?: number | undefined;
  sellerFeedbackScore?: number | undefined;
  matchStatus: "DISCOVERY_MATCH";
  matchEvidence: string[];
  condition: EbayCondition;
  imageUrl?: string | undefined;
  itemPrice: { amountCents: number; currency: "USD" };
  availability: "UNKNOWN";
  merchantUrl: string;
  affiliateUrl?: string | undefined;
  checkedAt: string;
};

export type EbaySearchResult = {
  source: "EBAY_BROWSE";
  coverage: "COMPLETE";
  snapshotAt: string;
  diagnostics: {
    queryMatches: number;
    itemsReturned: number;
    validItems: number;
    rejectedItems: number;
  };
  products: EbayProduct[];
};

export interface EbayBrowsePort {
  search(input: {
    query: string;
    limit: number;
    maxItemPriceCents?: number;
    zipCode?: string;
  }): Promise<EbaySearchResult>;
}

const ProductSchema = z.object({
  itemId: z.string().min(1).max(300),
  productRef: z.string().regex(/^ebay-[a-f0-9]{32}$/u),
  title: z.string().trim().min(1).max(500),
  category: z.string().trim().min(1).max(300),
  attributes: z.array(z.string().trim().min(1).max(500)).max(100),
  sellerName: z.string().trim().min(1).max(128),
  sellerFeedbackPercentage: z.number().min(0).max(100).optional(),
  sellerFeedbackScore: z.number().int().nonnegative().max(2_147_483_647).optional(),
  matchStatus: z.literal("DISCOVERY_MATCH"),
  matchEvidence: z.array(z.string().trim().min(1).max(500)).max(20),
  condition: z.enum(["NEW", "USED", "REFURBISHED", "OPEN_BOX", "UNKNOWN"]),
  imageUrl: z.string().url().max(4_096).optional(),
  itemPrice: z.object({ amountCents: z.number().int().min(1).max(100_000_000), currency: z.literal("USD") }).strict(),
  availability: z.literal("UNKNOWN"),
  merchantUrl: z.string().url().max(4_096),
  affiliateUrl: z.string().url().max(4_096).optional(),
  checkedAt: z.string().datetime({ offset: true })
}).strict().superRefine((product, context) => {
  validateUrl(product.merchantUrl, ["ebay.com", "www.ebay.com"], "merchantUrl", context);
  if (product.affiliateUrl !== undefined) {
    validateUrl(product.affiliateUrl, ["ebay.com", "www.ebay.com"], "affiliateUrl", context);
  }
  if (product.imageUrl !== undefined) validateUrl(product.imageUrl, ["i.ebayimg.com"], "imageUrl", context);
});

const ResultSchema = z.object({
  source: z.literal("EBAY_BROWSE"),
  coverage: z.literal("COMPLETE"),
  snapshotAt: z.string().datetime({ offset: true }),
  diagnostics: z.object({
    queryMatches: z.number().int().nonnegative(),
    itemsReturned: z.number().int().nonnegative(),
    validItems: z.number().int().nonnegative(),
    rejectedItems: z.number().int().nonnegative()
  }).strict(),
  products: z.array(ProductSchema).max(24)
}).strict();

export function createEbayPortFromEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
  dependencies: { fetch?: typeof fetch } = {}
): EbayBrowsePort | undefined {
  const rawUrl = environment.EBAY_PRODUCT_SEARCH_URL?.trim();
  if (rawUrl === undefined || rawUrl === "") return undefined;
  const url = new URL(rawUrl);
  if (
    url.protocol !== "https:" || url.username !== "" || url.password !== "" ||
    url.port !== "" || url.search !== "" || url.hash !== ""
  ) {
    throw new Error("EBAY_PRODUCT_SEARCH_URL must be credential-free HTTPS on the default port");
  }
  const timeoutMs = Number(environment.EBAY_PRODUCT_SEARCH_TIMEOUT_MS ?? "5000");
  if (!Number.isInteger(timeoutMs) || timeoutMs < 500 || timeoutMs > 30_000) {
    throw new Error("EBAY_PRODUCT_SEARCH_TIMEOUT_MS must be an integer from 500 through 30000");
  }
  const fetchRequest = dependencies.fetch ?? fetch;
  return {
    async search(input) {
      const response = await fetchRequest(url.href, {
        method: "POST",
        redirect: "error",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(timeoutMs)
      });
      if (response.status === 404) throw new Error("SOURCE_NOT_CONFIGURED");
      if (!response.ok) throw new Error(`eBay Search service returned HTTP ${response.status}`);
      const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
      if (contentType !== "application/json") throw new Error("eBay Search service returned unsupported content type");
      const declared = response.headers.get("content-length");
      if (declared !== null && (!/^\d+$/u.test(declared) || Number(declared) > MAX_RESPONSE_BYTES)) {
        throw new Error("eBay Search service response is too large");
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength > MAX_RESPONSE_BYTES) throw new Error("eBay Search service response is too large");
      try {
        return ResultSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
      } catch {
        throw new Error("eBay Search service returned an invalid response");
      }
    }
  };
}

function validateUrl(
  value: string,
  hosts: string[],
  path: string,
  context: z.RefinementCtx
): void {
  const url = new URL(value);
  if (
    url.protocol !== "https:" || url.username !== "" || url.password !== "" ||
    url.port !== "" || !hosts.includes(url.hostname)
  ) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: [path], message: `${path} is not an approved eBay URL` });
  }
}
