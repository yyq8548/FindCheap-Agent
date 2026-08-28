import type { VisualProductInput } from "../../src/visual-product-discovery.js";

export type DoenVisualGoldenCase = {
  sourceImage: string;
  sourceImageSha256: string;
  visualInput: VisualProductInput;
  expectedTitle: string;
  expectedHandle: string;
  expectedOfficialUrl: string;
  requiredQueryTerms: string[];
};

// The structured evidence is the deterministic output expected from Codex for
// the two customer-supplied reference images. The image hashes keep each case
// tied to the exact regression artifact without committing customer images.
export const DOEN_VISUAL_GOLDEN_CASES: DoenVisualGoldenCase[] = [
  {
    sourceImage: "codex-clipboard-1dbafb32-b251-4e9d-b1cc-37b59045485a.png",
    sourceImageSha256: "5DAA6BF84021DCEE60B881AE48F4991A76AAC0810C66B5C003512144C01C634C",
    visualInput: {
      brand: "DÔEN",
      productType: "women's dress",
      colors: ["ivory cream"],
      materials: ["silk", "lace"],
      patterns: ["small pale blue floral print"],
      styleClues: [],
      silhouette: "slip dress",
      length: "ankle length maxi",
      neckline: "square neckline with lace trim",
      sleeveType: "spaghetti straps",
      hardClues: [
        "spaghetti straps",
        "fitted column slip silhouette",
        "scattered floral print",
        "wide lace hem"
      ]
    },
    expectedTitle: "Bethilde Dress — Camellia Bloom",
    expectedHandle: "bethilde-dress-camellia-bloom",
    expectedOfficialUrl: "https://www.shopdoen.com/products/bethilde-dress-camellia-bloom",
    requiredQueryTerms: ["dress", "ivory cream", "floral", "lace"]
  },
  {
    sourceImage: "codex-clipboard-7428d693-af0d-4c63-9904-01eee19fd5b5.png",
    sourceImageSha256: "2F750E8BCD351E38D5B4C0F3AB6CB53F8C44150B1E5E375B1481222A971B3B07",
    visualInput: {
      brand: "DÔEN",
      productType: "women's mini dress",
      colors: ["black"],
      materials: ["ramie", "lace"],
      patterns: ["horizontal lace and sheer bands"],
      styleClues: [],
      silhouette: "fitted waist with flared skirt",
      length: "mini length",
      neckline: "high bateau neckline",
      sleeveType: "cap sleeves",
      hardClues: [
        "cap sleeves",
        "horizontal lace and sheer bands",
        "fitted waist with flared skirt"
      ]
    },
    expectedTitle: "Cornella Dress — Black",
    expectedHandle: "cornella-dress-black",
    expectedOfficialUrl: "https://www.shopdoen.com/products/cornella-dress-black",
    requiredQueryTerms: ["dress", "black", "lace", "mini"]
  }
];
