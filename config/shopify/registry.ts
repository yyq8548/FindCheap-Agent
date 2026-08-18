export const SHOPIFY_MERCHANT_REGISTRY = {
  version: "v2",
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
    merchant("steve-madden", "Steve Madden", "www.stevemadden.com", "shoes"),
    merchant("taylor-stitch", "Taylor Stitch", "www.taylorstitch.com", "shirt"),
    merchant("beardbrand", "Beardbrand", "www.beardbrand.com", "beard oil"),
    merchant("blenders-eyewear", "Blenders Eyewear", "www.blenderseyewear.com", "sunglasses"),
    merchant("untuckit", "UNTUCKit", "www.untuckit.com", "shirt"),
    merchant("outerknown", "Outerknown", "www.outerknown.com", "shirt"),
    merchant("rebecca-minkoff", "Rebecca Minkoff", "www.rebeccaminkoff.com", "bag"),
    merchant("gorjana", "Gorjana", "www.gorjana.com", "necklace"),
    merchant("parachute", "Parachute", "www.parachutehome.com", "sheets"),
    merchant("our-place", "Our Place", "fromourplace.com", "pan"),
    merchant("glossier", "Glossier", "www.glossier.com", "lipstick")
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
