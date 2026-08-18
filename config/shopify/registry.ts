export const SHOPIFY_MERCHANT_REGISTRY = {
  version: "v1",
  merchants: [
    merchant("death-wish-coffee", "Death Wish Coffee", "deathwishcoffee.com", "coffee"),
    merchant("kith", "Kith", "kith.com", "shirt"),
    merchant("allbirds", "Allbirds", "www.allbirds.com", "shoes"),
    merchant("brooklinen", "Brooklinen", "www.brooklinen.com", "sheets"),
    merchant("fashion-nova", "Fashion Nova", "www.fashionnova.com", "shirt"),
    merchant("tentree", "Tentree", "tentree.com", "shirt"),
    merchant("colourpop", "ColourPop", "colourpop.com", "lipstick"),
    merchant("liquid-death", "Liquid Death", "liquiddeath.com", "water"),
    merchant("pura-vida", "Pura Vida", "www.puravidabracelets.com", "bracelet"),
    merchant("steve-madden", "Steve Madden", "www.stevemadden.com", "shoes")
  ]
} as const;

function merchant(merchantId: string, name: string, apiHost: string, probeQuery: string) {
  const bareHost = apiHost.startsWith("www.") ? apiHost.slice(4) : apiHost;
  return {
    merchantId,
    merchant: name,
    apiHost,
    allowedHosts: [bareHost, `www.${bareHost}`],
    apiVersion: "2026-07" as const,
    probeQuery,
    searchEnabled: true
  };
}
