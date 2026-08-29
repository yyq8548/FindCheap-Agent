import { createHash } from "node:crypto";

import {
  EMBEDDED_MERCHANT_TRUST_REGISTRY,
  ManagedMerchantTrustRegistrySchema,
  type ManagedMerchantTrustRegistry
} from "../../../packages/contracts/src/index.js";

export type ServedMerchantTrustRegistry = {
  body: string;
  etag: string;
  registry: ManagedMerchantTrustRegistry;
};

export function merchantTrustRegistryFromEnvironment(
  environment: Readonly<Record<string, string | undefined>>
): ServedMerchantTrustRegistry {
  const configured = environment.FINDCHEAP_MERCHANT_TRUST_JSON?.trim();
  const registry = configured === undefined || configured === ""
    ? EMBEDDED_MERCHANT_TRUST_REGISTRY
    : ManagedMerchantTrustRegistrySchema.parse(JSON.parse(configured));
  const body = JSON.stringify(registry);
  return {
    body,
    etag: `"${createHash("sha256").update(body).digest("base64url")}"`,
    registry
  };
}
