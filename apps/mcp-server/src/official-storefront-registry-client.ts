import { OfficialStorefrontRegistrySchema } from "../../../packages/contracts/src/index.js";
import { replaceManagedOfficialStorefronts } from "./merchant-trust.js";

const MAX_REGISTRY_BYTES = 512 * 1024;
const DEFAULT_CACHE_MS = 24 * 60 * 60 * 1_000;

export type OfficialStorefrontRegistryPort = {
  refresh(): Promise<void>;
  imageProxyOrigin: string;
};

type Dependencies = {
  fetch?: typeof fetch;
  now?: () => number;
  cacheMs?: number;
};

export function createOfficialStorefrontRegistryPortFromEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
  dependencies: Dependencies = {}
): OfficialStorefrontRegistryPort | undefined {
  const configured = environment.FINDCHEAP_OFFICIAL_STOREFRONTS_URL?.trim();
  const awinSearch = environment.AWIN_PRODUCT_SEARCH_URL?.trim();
  let registryUrl: URL;
  try {
    registryUrl = configured === undefined || configured === ""
      ? new URL("/v1/official-storefronts", new URL(awinSearch ?? ""))
      : new URL(configured);
  } catch {
    return undefined;
  }
  if (
    registryUrl.protocol !== "https:" ||
    registryUrl.username !== "" ||
    registryUrl.password !== "" ||
    registryUrl.port !== "" ||
    registryUrl.search !== "" ||
    registryUrl.hash !== "" ||
    registryUrl.pathname !== "/v1/official-storefronts"
  ) {
    throw new Error("FINDCHEAP_OFFICIAL_STOREFRONTS_URL must be credential-free HTTPS ending in /v1/official-storefronts");
  }
  const fetchRequest = dependencies.fetch ?? fetch;
  const now = dependencies.now ?? Date.now;
  const cacheMs = dependencies.cacheMs ?? DEFAULT_CACHE_MS;
  let expiresAt = 0;
  let etag: string | undefined;
  let active: Promise<void> | undefined;

  const refresh = async (): Promise<void> => {
    if (now() < expiresAt) return;
    active ??= (async () => {
      try {
        const response = await fetchRequest(registryUrl.href, {
          method: "GET",
          redirect: "error",
          headers: {
            accept: "application/json",
            ...(etag === undefined ? {} : { "if-none-match": etag })
          },
          signal: AbortSignal.timeout(5_000)
        });
        if (response.status === 304) {
          expiresAt = now() + cacheMs;
          return;
        }
        if (!response.ok || response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
          return;
        }
        const contentLength = response.headers.get("content-length");
        if (contentLength !== null && (!/^\d+$/u.test(contentLength) || Number(contentLength) > MAX_REGISTRY_BYTES)) return;
        const body = new Uint8Array(await response.arrayBuffer());
        if (body.byteLength === 0 || body.byteLength > MAX_REGISTRY_BYTES) return;
        const registry = OfficialStorefrontRegistrySchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body)));
        replaceManagedOfficialStorefronts(registry.stores);
        const nextEtag = response.headers.get("etag");
        etag = nextEtag !== null && nextEtag.length <= 200 ? nextEtag : undefined;
        expiresAt = now() + cacheMs;
      } catch {
        // Embedded reviewed storefronts remain available when managed configuration is unreachable.
      }
    })().finally(() => {
      active = undefined;
    });
    await active;
  };

  return { refresh, imageProxyOrigin: registryUrl.origin };
}
