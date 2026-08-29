import { safeFetchWithProvenance } from "../../network-safety/src/safe-fetch.js";
import type { AwinFeedIndex } from "../../awin-feed/src/index.js";

export type AwinMerchantCandidate = {
  host: string;
  merchantNames: string[];
  merchantIds: string[];
  sampleProductUrls: string[];
};

export type TechnicalStorefrontProbe = {
  evidenceUrl: string;
  result: "PASS" | "FAIL" | "UNKNOWN";
  details: {
    status?: number;
    finalUrl?: string;
    contentType?: string;
    shopifySignal?: boolean;
    productJsonLdSignal?: boolean;
    reason?: string;
  };
};

export function collectAwinMerchantCandidates(index: AwinFeedIndex): AwinMerchantCandidate[] {
  const observed = new Map<string, {
    merchantNames: Set<string>;
    merchantIds: Set<string>;
    sampleProductUrls: Set<string>;
  }>();
  for (const product of index.products) {
    const host = normalizedPublicHost(product.merchantUrl);
    if (host === undefined) continue;
    const current = observed.get(host) ?? {
      merchantNames: new Set<string>(),
      merchantIds: new Set<string>(),
      sampleProductUrls: new Set<string>()
    };
    current.merchantNames.add(product.merchant);
    current.merchantIds.add(product.merchantId);
    if (current.sampleProductUrls.size < 3) current.sampleProductUrls.add(product.merchantUrl);
    observed.set(host, current);
  }
  return [...observed.entries()]
    .sort(([left], [right]) => left.localeCompare(right, "en-US"))
    .map(([host, value]) => ({
      host,
      merchantNames: [...value.merchantNames].sort((left, right) => left.localeCompare(right, "en-US")),
      merchantIds: [...value.merchantIds].sort(numericStringCompare),
      sampleProductUrls: [...value.sampleProductUrls]
    }));
}

export async function probeTechnicalStorefront(
  host: string,
  fetchPage: typeof safeFetchWithProvenance = safeFetchWithProvenance
): Promise<TechnicalStorefrontProbe> {
  const normalized = normalizedPublicHost(`https://${host}/`);
  if (normalized === undefined || normalized !== host) throw new Error("registry probe host is invalid");
  const evidenceUrl = `https://${host}/`;
  try {
    const fetched = await fetchPage(
      { url: evidenceUrl },
      { allowedHosts: [host, `www.${host}`] }
    );
    const contentType = fetched.response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
    if (!fetched.response.ok) {
      return {
        evidenceUrl,
        result: "FAIL",
        details: {
          status: fetched.response.status,
          finalUrl: fetched.finalUrl,
          ...(contentType === undefined ? {} : { contentType }),
          reason: "HTTP_STATUS"
        }
      };
    }
    if (contentType !== "text/html" && contentType !== "application/xhtml+xml") {
      return {
        evidenceUrl,
        result: "UNKNOWN",
        details: {
          status: fetched.response.status,
          finalUrl: fetched.finalUrl,
          ...(contentType === undefined ? {} : { contentType }),
          reason: "NON_HTML"
        }
      };
    }
    const document = await fetched.response.text();
    return {
      evidenceUrl,
      result: "PASS",
      details: {
        status: fetched.response.status,
        finalUrl: fetched.finalUrl,
        contentType,
        shopifySignal: /cdn\.shopify\.com|Shopify\.theme|shopify-section/iu.test(document),
        productJsonLdSignal: /"@type"\s*:\s*"Product"/iu.test(document)
      }
    };
  } catch {
    return { evidenceUrl, result: "FAIL", details: { reason: "NETWORK_OR_POLICY" } };
  }
}

function normalizedPublicHost(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username !== "" || url.password !== "" || url.port !== "") return undefined;
    const host = url.hostname.toLowerCase().replace(/^www\./u, "");
    return /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/u.test(host) ? host : undefined;
  } catch {
    return undefined;
  }
}

function numericStringCompare(left: string, right: string): number {
  return left.length - right.length || left.localeCompare(right, "en-US");
}
