// Minimized structured regressions. No customer images, URLs, or session IDs.
export const BLACK_DRESS_OBSERVATIONS = {
  brand: "DOEN",
  productType: "dress",
  observations: [
    { attribute: "COLOR", value: "black", confidence: 0.99 },
    { attribute: "NECKLINE", value: "wide boat neckline with lace edging", confidence: 0.95 },
    { attribute: "SLEEVE", value: "short cap sleeves", confidence: 0.96 },
    { attribute: "LENGTH", value: "mini, above-knee length", confidence: 0.98 },
    {
      attribute: "DISTINCTIVE_DETAIL",
      value: "multiple horizontal sheer floral lace insertion bands alternating with densely gathered opaque panels",
      confidence: 0.99
    },
    {
      attribute: "SILHOUETTE",
      value: "fitted gathered bodice with defined waist and flared A-line mini skirt",
      confidence: 0.98
    },
    { attribute: "HEM", value: "scalloped lace trim at hem", confidence: 0.93 }
  ],
  occlusions: [
    "Hands obscure the center front of the lower bodice and upper skirt.",
    "Back, closure and garment labels are not visible."
  ]
};

export const PARTLY_OCCLUDED_BLOUSE = {
  brand: "DOEN",
  productType: "blouse",
  colors: ["ivory cream"],
  neckline: "deep rounded V neckline with floral lace edging",
  sleeveType: "short flutter sleeves",
  distinctiveDetails: [
    "broad layered lace-trimmed ruffles across chest and shoulders",
    "long front tie bow at center neckline",
    "scalloped lace hem",
    "lightweight semi-sheer fabric"
  ],
  occlusions: ["Raised arm and phone partly obscure the right shoulder and part of the neckline."]
};
