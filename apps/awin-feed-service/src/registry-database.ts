import type { SqlExecutor } from "../../../packages/db/src/client.js";
import { loadLatestPublishedRegistrySnapshot } from "../../../packages/db/src/repositories/registry-repository.js";
import {
  serveOfficialStorefrontRegistry,
  type ServedOfficialStorefrontRegistry
} from "./official-storefront-registry.js";
import {
  serveMerchantTrustRegistry,
  type ServedMerchantTrustRegistry
} from "./merchant-trust-registry.js";

export async function refreshServedRegistriesFromDatabase(
  executor: SqlExecutor,
  served: {
    officialStorefronts: ServedOfficialStorefrontRegistry;
    merchantTrust: ServedMerchantTrustRegistry;
  }
): Promise<boolean> {
  const snapshot = await loadLatestPublishedRegistrySnapshot(executor);
  if (snapshot === undefined) return false;
  const official = serveOfficialStorefrontRegistry(snapshot.officialStorefronts);
  const trust = serveMerchantTrustRegistry(snapshot.merchantTrust);
  Object.assign(served.officialStorefronts, official);
  Object.assign(served.merchantTrust, trust);
  return true;
}
