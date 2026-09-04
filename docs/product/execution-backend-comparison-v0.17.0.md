# Unified execution, Backend facade, and comparison view

## Scope

This release keeps FindCheap read-only. It adds no cart, checkout, order, reservation, purchase, or payment capability.

## Shared execution boundary

Every MCP tool is registered through `createExecutedToolRegistrar` and executed by `ToolExecutor`. The boundary:

- preserves each strict input schema for tool discovery while ensuring invalid calls reach the shared executor;
- validates and applies input defaults before invoking the handler;
- checks tool capability before handler execution;
- rejects server startup when a registered tool has no explicit capability mapping;
- maps invalid arguments, unavailable capability, unsafe output, and internal failure to stable public codes;
- assigns a stable execution-layer code to domain rejections returned by handlers;
- returns error codes in protocol-safe text and `_meta`, never in success-only `structuredContent`;
- validates every structured output before it leaves the handler boundary, including error results, and emits the parsed result so undeclared fields cannot escape;
- recursively normalizes and sanitizes external strings in text, structured content, metadata, and embedded text resources, including forged role labels at any line boundary;
- removes invisible and control characters, forged role boundaries, special tokens, and tool-like tags;
- caps individual fields and total output size;
- never returns raw internal exceptions.

Transport security stays in `packages/network-safety`. Product identity, merchant trust, price-basis, and recommendation rules stay in their domain modules.

## Backend facade

`FindCheapBackend` groups existing ports into catalog, product, deal, Watch, and visual capabilities. `createFindCheapBackend` adapts the existing source clients; it does not replace them. Session snapshots, clocks, resource policy, and telemetry remain runtime concerns outside the Backend.

Tool availability comes from Backend capabilities. Product inspection and quote capabilities exist only when their corresponding ports exist. A missing verified Deals provider removes `find_coupons`; selected-product deal research remains available with an explicit unavailable-deal result.

## Product comparison

`compare_selected_products` accepts 2–4 unique selections from one live immutable search snapshot. Cross-snapshot input and expired or unknown selections fail closed. Expired delivered-total quotes are excluded, and the comparison snapshot expires no later than any quote it displays.

Modes:

- `SAME_PRODUCT_OFFERS`: requires one shared GTIN or normalized brand plus SKU, identical explicit variant dimensions, and the same known condition.
- `PRODUCT_CHOICES`: compares different products without a like-for-like claim.
- `AUTO`: selects the safe mode from server evidence.

The server generates all comparison entries, evidence, unknowns, limitations, common price basis, price delta, and recommendation. Unexpired delivered totals are compared only when every entry has one; otherwise all entries use item price. If neither basis is complete, price comparison is unavailable and partial prices cannot affect the recommendation or create a `LOWER_PRICE` reason.

Recommendation reuses `choosePrimaryRecommendation`. Unverified, best-value-only, unavailable, or similar products cannot become a purchase recommendation. Affiliate economics never enter the comparison engine. Equal prices never produce a `LOWER_PRICE` reason; at least one otherwise comparable peer must be strictly more expensive.

The comparison UI uses a semantic 2–4 column table, sticky dimension labels, horizontal mobile scrolling, safe HTTPS links, `textContent`, and an immutable app-only render snapshot. It renders mode, evaluation and expiry times, common price basis and named price range, seller, identity, SKU/GTIN, variants, full verified-deal details, unknowns, limitations, and server recommendation reasons. Explicit `focus` values move the requested dimensions before the remaining stable rows.
