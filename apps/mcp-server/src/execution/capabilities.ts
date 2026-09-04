export const BACKEND_CAPABILITIES = [
  "CATALOG",
  "PRODUCT_INSPECTION",
  "PRODUCT_QUOTE",
  "VERIFIED_DEALS",
  "VISUAL_SEARCH",
  "WATCHES"
] as const;

export type BackendCapability = (typeof BACKEND_CAPABILITIES)[number];

const TOOL_CAPABILITIES: Readonly<Record<string, BackendCapability>> = {
  search_products: "CATALOG",
  search_visual_candidates: "VISUAL_SEARCH",
  finalize_visual_search: "VISUAL_SEARCH",
  search_shopify_products: "CATALOG",
  search_awin_products: "CATALOG",
  inspect_selected_shopify_product: "PRODUCT_INSPECTION",
  quote_selected_shopify_product: "PRODUCT_QUOTE",
  quote_and_compare_selected_products: "PRODUCT_QUOTE",
  research_selected_product_deal: "CATALOG",
  find_coupons: "VERIFIED_DEALS",
  create_watch: "WATCHES",
  bind_watch_automation: "WATCHES",
  check_watch: "WATCHES",
  list_watches: "WATCHES",
  pause_watch: "WATCHES",
  delete_watch: "WATCHES",
  render_product_cards: "CATALOG",
  report_product_card_metrics: "CATALOG",
  compare_selected_products: "CATALOG",
  render_product_comparison: "CATALOG"
};

export function requiredCapabilityForTool(name: string): BackendCapability {
  const capability = TOOL_CAPABILITIES[name];
  if (capability === undefined) {
    throw new Error(`missing capability mapping for tool: ${name}`);
  }
  return capability;
}

export function capabilityMappedTools(): readonly string[] {
  return Object.keys(TOOL_CAPABILITIES);
}
