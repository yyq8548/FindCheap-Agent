import { shoppingRequirementLedger } from "./search-requirements-context.js";
import type { SearchProductsInput } from "./search-products.js";
import type { ProductCardContent, ProductCardProduct } from "./server.js";

type SnapshotReference = {
  selectionId: string;
  variantId: string;
  productKey: string;
};

/** Apply task/goal identity and opaque selection references after the final
 * product projection. Storage, expiry and task isolation remain server-owned. */
export function applyProductSnapshotState(
  content: ProductCardContent,
  options: {
    renderId: string;
    goalId?: string | undefined;
    goalRevision?: number | undefined;
    requirementsVersion?: number | undefined;
    request?: SearchProductsInput | undefined;
    primaryProductIndex?: number | undefined;
    createSelectionId: () => string;
    productKey: (product: ProductCardProduct) => string;
    quoteCapability: (product: ProductCardProduct) => ProductCardProduct["quoteCapability"];
  },
): { snapshot: ProductCardContent & { renderId: string }; references: SnapshotReference[] } {
  let primarySelectionId: string | undefined;
  const references: SnapshotReference[] = [];
  const products = content.products.map((product, index) => {
    const quoteCapability = options.quoteCapability(product);
    const selectionId = options.createSelectionId();
    if (options.primaryProductIndex === index) primarySelectionId = selectionId;
    references.push({ selectionId, variantId: product.handle, productKey: options.productKey(product) });
    return {
      ...product,
      quoteCapability,
      card: { ...product.card, quoteCapability },
      selectionId,
      quoteReference: { selectionId, renderId: options.renderId, variantId: product.handle },
    };
  });
  const snapshot = {
    ...content,
    ...(options.request === undefined ? {} : {
      goalId: options.goalId,
      goalRevision: options.goalRevision,
      requirementLedger: shoppingRequirementLedger(options.request),
      requirementsVersion: options.requirementsVersion,
      requirementsSummary: {
        productType: options.request.productType,
        brand: options.request.brand,
        maxItemPriceCents: options.request.maxItemPriceCents,
        requiredSize: options.request.requiredSize,
        requiredFeatures: options.request.requiredFeatures,
        excludedFeatures: options.request.excludedFeatures,
        primaryUse: options.request.primaryUse,
        preferences: options.request.preferences,
      },
    }),
    renderId: options.renderId,
    products,
    ...(content.recommendation === undefined ? {} : {
      recommendation: primarySelectionId === undefined
        ? content.recommendation
        : { ...content.recommendation, primarySelectionId },
    }),
  };
  return { snapshot, references };
}
