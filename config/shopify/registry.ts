export const SHOPIFY_MERCHANT_REGISTRY = {
  version: "v3",
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
    merchant("glossier", "Glossier", "www.glossier.com", "lipstick"),
    merchant("adored-vintage", "Adored Vintage", "www.adoredvintage.com", "dress"),
    merchant("kirrin-finch", "Kirrin Finch", "kirrinfinch.com", "shirt"),
    merchant("rothys", "Rothy's", "rothys.com", "shoes"),
    merchant("beefcake-swimwear", "Beefcake Swimwear", "www.beefcakeswimwear.com", "swimsuit"),
    merchant("silk-and-willow", "Silk and Willow", "www.silkandwillow.com", "ribbon"),
    merchant("goodee", "GOODEE", "www.goodeeworld.com", "chair"),
    merchant("bruvi", "Bruvi", "bruvi.com", "coffee"),
    merchant("united-by-blue", "United By Blue", "unitedbyblue.com", "shirt"),
    merchant("manitobah", "Manitobah", "www.manitobah.com", "boots"),
    merchant("velasca", "Velasca", "www.velasca.com", "shoes"),
    merchant("blk-and-bold", "BLK & Bold", "blkandbold.com", "coffee"),
    merchant("fly-by-jing", "Fly by Jing", "flybyjing.com", "sauce"),
    merchant("verve-coffee", "Verve Coffee Roasters", "www.vervecoffee.com", "coffee"),
    merchant("taza-chocolate", "Taza Chocolate", "www.tazachocolate.com", "chocolate"),
    merchant("yeung-man-cooking", "Yeung Man Cooking", "yeungmancooking.com", "cookbook"),
    merchant("healthy-roots-dolls", "Healthy Roots Dolls", "healthyrootsdolls.com", "doll"),
    merchant("package-free", "Package Free", "packagefreeshop.com", "soap"),
    merchant("beauty-bakerie", "Beauty Bakerie", "www.beautybakerie.com", "lipstick"),
    merchant("meow-meow-tweet", "Meow Meow Tweet", "meowmeowtweet.com", "deodorant"),
    merchant("beneath-your-mask", "Beneath Your Mask", "beneathyourmask.com", "oil"),
    merchant("fresh-heritage", "Fresh Heritage", "www.freshheritage.com", "beard oil"),
    merchant("then-i-met-you", "Then I Met You", "thenimetyou.com", "cleanser"),
    merchant("lastobject", "LastObject", "lastobject.com", "swab"),
    merchant("lunchskins", "Lunchskins", "www.lunchskins.com", "bag"),
    merchant("bebemoss", "Bebemoss", "bebemoss.com", "toy")
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
