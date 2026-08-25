export const PRODUCT_CARD_UI_URI = "ui://findcheap/product-cards/v20.html";

export const PRODUCT_CARD_RESOURCE_DOMAINS = [
  "https://cdn.shopify.com"
];

export const PRODUCT_CARD_HTML = String.raw`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>
    :root {
      color-scheme: light dark;
      font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      --fc-text: light-dark(#1f1f1f, #f2f2f2);
      --fc-muted: light-dark(#6f6f6f, #a8a8a8);
      --fc-faint: light-dark(#8b8b8b, #8e8e8e);
      --fc-surface: light-dark(#ffffff, #1f1f1f);
      --fc-surface-muted: light-dark(#f7f7f7, #292929);
      --fc-border: light-dark(#dedede, #454545);
      --fc-border-strong: light-dark(#bdbdbd, #666666);
      --fc-action: light-dark(#1f1f1f, #f2f2f2);
      --fc-action-text: light-dark(#ffffff, #171717);
      --fc-focus: light-dark(#6b6b6b, #bdbdbd);
      --fc-danger: light-dark(#a12424, #ffb4b4);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      color: var(--fc-text);
      background: transparent;
      font-size: 14px;
      -webkit-font-smoothing: antialiased;
      text-rendering: optimizeLegibility;
    }
    #app { display: grid; gap: 10px; padding: 0; }
    .summary { padding: 0 1px; color: var(--fc-muted); font-size: 12px; line-height: 1.45; }
    .quote-summary {
      display: grid;
      gap: 7px;
      border: 1px solid var(--fc-border-strong);
      border-radius: 14px;
      padding: 14px 16px;
      background: var(--fc-surface);
    }
    .quote-summary h2 { margin: 0; font-size: 13px; font-weight: 650; }
    .quote-summary-item { display: flex; justify-content: space-between; gap: 12px; font-size: 12px; }
    .quote-summary-value { font-weight: 680; white-space: nowrap; }
    .group {
      display: grid;
      gap: 14px;
      border: 1px solid var(--fc-border-strong);
      border-radius: 16px;
      padding: 16px;
      background: var(--fc-surface);
    }
    .group h2 { margin: 0; color: var(--fc-text); font-size: 14px; font-weight: 650; line-height: 1.4; }
    .cards { display: grid; grid-template-columns: 1fr; gap: 12px; }
    .card {
      display: grid;
      grid-template-columns: minmax(150px, 24%) 1fr;
      min-width: 0;
      overflow: hidden;
      border: 1px solid var(--fc-border-strong);
      border-radius: 14px;
      background: var(--fc-surface);
      box-shadow: none;
      transition: border-color 120ms ease, background-color 120ms ease;
    }
    .card:hover { border-color: var(--fc-text); }
    .card.no-image { grid-template-columns: 1fr; }
    .image {
      display: block;
      width: calc(100% - 24px);
      height: auto;
      aspect-ratio: 1;
      margin: 12px;
      object-fit: contain;
      border: 1px solid var(--fc-border);
      border-radius: 10px;
      background: var(--fc-surface-muted);
    }
    .body { display: grid; min-width: 0; gap: 10px; padding: 17px 18px; }
    .merchant { color: var(--fc-muted); font-size: 12px; font-weight: 600; line-height: 1.35; letter-spacing: .01em; }
    h3 { margin: -2px 0 0; font-size: 16px; font-weight: 650; line-height: 1.35; }
    .row { display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: 9px; }
    .price { font-size: 23px; font-weight: 680; letter-spacing: -.025em; line-height: 1.1; }
    .badges { display: flex; flex-wrap: wrap; gap: 5px; }
    .badge {
      border: 1px solid var(--fc-border);
      border-radius: 7px;
      padding: 3px 6px;
      color: var(--fc-muted);
      background: var(--fc-surface-muted);
      font-size: 10px;
      font-weight: 600;
      line-height: 1.3;
    }
    .exact, .discovery, .similar, .trusted, .unverified { color: var(--fc-muted); }
    .details, .evidence, .limitations, .disclosure, .observed {
      color: var(--fc-muted);
      font-size: 11px;
      line-height: 1.45;
    }
    .evidence { color: var(--fc-text); }
    .observed { color: var(--fc-faint); }
    .price-breakdown {
      display: grid;
      gap: 5px;
      border-top: 1px solid var(--fc-border);
      padding: 9px 0 0;
    }
    .price-line { display: flex; justify-content: space-between; gap: 12px; }
    .price-label { color: var(--fc-muted); font-size: 11px; }
    .price-value { color: var(--fc-text); font-size: 11px; font-weight: 550; text-align: right; }
    .price-line.total .price-label, .price-line.total .price-value { color: var(--fc-text); font-weight: 650; }
    .notice { padding-top: 1px; }
    a {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      justify-self: end;
      min-width: 142px;
      margin-top: 2px;
      border: 1px solid var(--fc-action);
      border-radius: 10px;
      padding: 9px 12px;
      color: var(--fc-action-text);
      background: var(--fc-action);
      font-size: 12px;
      font-weight: 650;
      line-height: 1.2;
      text-decoration: none;
      transition: opacity 120ms ease, transform 80ms ease;
    }
    a:hover { opacity: .86; }
    a:active { transform: translateY(1px); }
    a:focus-visible { outline: 2px solid var(--fc-focus); outline-offset: 2px; }
    .empty {
      border: 1px solid var(--fc-border);
      border-radius: 12px;
      padding: 18px;
      color: var(--fc-muted);
      background: var(--fc-surface);
      text-align: center;
    }
    .error { color: var(--fc-danger); }
    @media (max-width: 640px) {
      #app { gap: 10px; }
      .group { border-radius: 14px; padding: 12px; }
      .card { grid-template-columns: minmax(116px, 34%) 1fr; }
      .body { padding: 13px; }
      a { justify-self: stretch; }
    }
    @media (max-width: 420px) {
      .card { display: flex; flex-direction: column; }
      .image { width: 100%; margin: 0; aspect-ratio: 16 / 10; border: 0; border-bottom: 1px solid var(--fc-border); border-radius: 0; }
    }
    @media (prefers-reduced-motion: reduce) {
      .card, a { transition: none; }
    }
  </style>
</head>
<body>
  <main id="app" aria-live="polite"><div class="empty">Waiting for verified product results…</div></main>
  <script>
    const app = document.getElementById("app");
    const uiStartedAt = typeof performance === "object" && typeof performance.now === "function"
      ? performance.now()
      : Date.now();
    const cardMetrics = { version: "0.8.3", stages: {} };
    window.__findcheapCardMetrics = cardMetrics;
    const notify = (method, params = {}) => {
      window.parent.postMessage({ jsonrpc: "2.0", method, params }, "*");
    };
    const markStage = (name) => {
      if (cardMetrics.stages[name] !== undefined) return;
      const now = typeof performance === "object" && typeof performance.now === "function"
        ? performance.now()
        : Date.now();
      cardMetrics.stages[name] = Math.max(0, Math.round((now - uiStartedAt) * 10) / 10);
      if (document.documentElement?.dataset) {
        document.documentElement.dataset.findcheapCardStage = name;
      }
      if (typeof performance === "object" && typeof performance.mark === "function") {
        performance.mark("findcheap-card:" + name);
      }
    };
    markStage("IFRAME_LOADED");
    markStage("RESOURCE_EVALUATED");
    let hasResult = false;
    let initialized = false;
    let latestToolInput;
    let hydrationRenderId;
    let currentRenderId;
    let initializeAttempts = 0;
    let nextRequestId = 1;
    const pendingRequests = new Map();
    const request = (method, params, timeoutMs) => {
      const id = nextRequestId++;
      window.parent.postMessage({ jsonrpc: "2.0", id, method, params }, "*");
      return new Promise((resolve, reject) => {
        const timeoutId = Number.isFinite(timeoutMs) && timeoutMs > 0
          ? window.setTimeout(() => {
              pendingRequests.delete(id);
              reject(new Error(method + " timed out"));
            }, timeoutMs)
          : undefined;
        pendingRequests.set(id, { resolve, reject, timeoutId });
      });
    };
    const pendingSizePhases = new Set();
    const reportedSizePhases = new Set();
    let lastReportedSize;
    const reportSize = () => {
      if (!initialized) return;
      const root = document.documentElement;
      const body = document.body;
      const width = Math.ceil(Math.max(root?.scrollWidth || 0, body?.scrollWidth || 0));
      const height = Math.ceil(Math.max(root?.scrollHeight || 0, body?.scrollHeight || 0));
      const size = width + "x" + height;
      if (width <= 0 || height <= 0 || size === lastReportedSize) return;
      lastReportedSize = size;
      notify("ui/notifications/size-changed", { width, height });
    };
    const flushSizeReports = () => {
      if (!initialized) return;
      const phase = pendingSizePhases.values().next().value;
      if (!phase) return;
      pendingSizePhases.delete(phase);
      reportedSizePhases.add(phase);
      const run = () => {
        reportSize();
        flushSizeReports();
      };
      if (typeof window.requestAnimationFrame === "function") window.requestAnimationFrame(run);
      else window.setTimeout(run, 0);
    };
    const requestSizeReport = (phase) => {
      if (reportedSizePhases.has(phase) || pendingSizePhases.has(phase)) return;
      pendingSizePhases.add(phase);
      flushSizeReports();
    };
    const pendingMetricStages = new Set();
    const reportedMetricStages = new Set();
    const flushMetrics = () => {
      if (!initialized || !currentRenderId) return;
      for (const terminalStage of pendingMetricStages) {
        pendingMetricStages.delete(terminalStage);
        if (reportedMetricStages.has(terminalStage)) continue;
        reportedMetricStages.add(terminalStage);
        void request("tools/call", {
          name: "report_product_card_metrics",
          arguments: {
            renderId: currentRenderId,
            version: cardMetrics.version,
            terminalStage,
            stages: { ...cardMetrics.stages }
          }
        }, 2000).catch(() => undefined);
      }
    };
    const reportMetrics = (terminalStage) => {
      if (reportedMetricStages.has(terminalStage)) return;
      pendingMetricStages.add(terminalStage);
      flushMetrics();
    };
    const make = (tag, className, text) => {
      const node = document.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined) node.textContent = String(text).replace(/[—–]/gu, "-");
      return node;
    };
    const money = (value) => value && Number.isInteger(value.amountCents) && value.currency === "USD"
      ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value.amountCents / 100)
      : "Price unavailable";
    const safeHttps = (value) => {
      try { const url = new URL(value); return url.protocol === "https:" ? url.href : null; }
      catch { return null; }
    };
    const observedAt = (value) => {
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? "Observation time unavailable" : "Observed " + new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(date);
    };
    const appendPriceLine = (container, label, value, emphasis = false) => {
      const line = make("div", "price-line" + (emphasis ? " total" : ""));
      line.append(make("span", "price-label", label));
      line.append(make("span", "price-value", value));
      container.append(line);
    };
    const groupDefinitions = [
      { status: "EXACT", trusted: true, title: "Trusted exact matches" },
      { status: "DISCOVERY_MATCH", trusted: true, title: "Trusted discovery matches" },
      { status: "SIMILAR", trusted: true, title: "Trusted similar options" },
      { trusted: false, title: "Unverified merchant candidates" }
    ];
    function render(output) {
      hasResult = true;
      if (typeof output?.renderId === "string") currentRenderId = output.renderId;
      markStage("RENDER_STARTED");
      app.replaceChildren();
      const products = Array.isArray(output?.products) ? output.products.slice(0, 3) : [];
      if (products.length === 0) {
        app.append(make("div", "empty", output?.message || "No verified products returned."));
        markStage("DOM_RENDERED");
        requestSizeReport("DOM_RENDERED");
        reportMetrics("DOM_RENDERED");
        return;
      }
      const quoteCount = products.filter((product) => product?.pricing?.scope === "SHOPIFY_CART_ESTIMATE").length;
      const priceSummary = quoteCount === 0
        ? "public item prices only"
        : quoteCount === products.length
          ? "Shopify Cart estimates for supplied ZIP"
          : quoteCount + " Shopify Cart estimate" + (quoteCount === 1 ? "" : "s") + "; remaining item-price-only";
      app.append(make("div", "summary", products.length + " product card" + (products.length === 1 ? "" : "s") + " / identity labels / " + priceSummary));
      const quotedProducts = products.filter((product) => product?.pricing?.scope === "SHOPIFY_CART_ESTIMATE" && product?.card?.estimatedTotal);
      if (quotedProducts.length > 0) {
        const quoteSummary = make("section", "quote-summary");
        quoteSummary.append(make("h2", "", "Estimated total summary"));
        for (const product of quotedProducts) {
          const item = make("div", "quote-summary-item");
          item.append(
            make("span", "", String(product.card.title || product.title || "Product")),
            make("span", "quote-summary-value", money(product.card.estimatedTotal))
          );
          quoteSummary.append(item);
        }
        app.append(quoteSummary);
      }
      for (const definition of groupDefinitions) {
        const grouped = products.filter((product) => {
          const verified = product?.merchantTrust?.verification === "INDEPENDENT";
          return definition.trusted ? verified && product?.matchStatus === definition.status : !verified;
        });
        if (grouped.length === 0) continue;
        const group = make("section", "group");
        group.append(make("h2", "", definition.title));
        const cards = make("div", "cards");
        for (const product of grouped) {
          const cardData = product && typeof product.card === "object" ? product.card : {};
          const card = make("article", "card");
          const imageUrl = safeHttps(cardData.imageUrl);
          if (!imageUrl) card.className = "card no-image";
          if (imageUrl) {
            const image = make("img", "image");
            image.alt = cardData.title || product.title || "Product image";
            image.loading = "lazy";
            image.decoding = "async";
            image.fetchPriority = "low";
            image.addEventListener("load", () => {
              const markPainted = () => {
                markStage("FIRST_IMAGE_PAINTED");
                markStage("FIRST_IMAGE_SETTLED");
                requestSizeReport("FIRST_IMAGE_SETTLED");
                reportMetrics("FIRST_IMAGE_SETTLED");
              };
              if (typeof window.requestAnimationFrame === "function") window.requestAnimationFrame(markPainted);
              else window.setTimeout(markPainted, 0);
            }, { once: true });
            image.addEventListener("error", () => {
              markStage("FIRST_IMAGE_SETTLED");
              image.remove();
              requestSizeReport("FIRST_IMAGE_SETTLED");
              reportMetrics("FIRST_IMAGE_SETTLED");
            }, { once: true });
            image.src = imageUrl;
            card.append(image);
          }
          const body = make("div", "body");
          body.append(make("div", "merchant", cardData.merchant || product.merchant || "Merchant"));
          body.append(make("h3", "", cardData.title || product.title || "Product"));
          const identity = [product.brand, product.sku ? "Model/SKU: " + product.sku : undefined, product.gtins?.[0] ? "GTIN: " + product.gtins[0] : undefined]
            .filter(Boolean).join(" / ");
          if (identity) body.append(make("div", "details", identity));
          const variants = Object.entries(product.variantDimensions || {}).map(([name, value]) => name + ": " + value).join(" / ");
          if (variants) body.append(make("div", "details", variants));
          const row = make("div", "row");
          const priceBlock = make("div", "");
          priceBlock.append(make("div", "price", money(cardData.primaryPrice)));
          if (cardData.priceLabel) priceBlock.append(make("div", "details", String(cardData.priceLabel)));
          row.append(priceBlock);
          const badges = make("div", "badges");
          const match = String(cardData.matchBadge || product.matchStatus || "UNCONFIRMED");
          const matchClass = match === "EXACT" ? "exact" : match === "DISCOVERY_MATCH" ? "discovery" : "similar";
          badges.append(make("span", "badge " + matchClass, match));
          const trustBadge = String(cardData.merchantTrustBadge || "MERCHANT_UNVERIFIED");
          badges.append(make("span", "badge " + (trustBadge === "MERCHANT_UNVERIFIED" ? "unverified" : "trusted"), trustBadge));
          badges.append(make("span", "badge", String(cardData.conditionBadge || product.condition || "UNKNOWN")));
          badges.append(make("span", "badge", String(cardData.availability || product.availability || "UNKNOWN")));
          row.append(badges);
          body.append(row);
          const breakdown = make("div", "price-breakdown");
          if (cardData.itemPrice && product?.pricing?.scope === "SHOPIFY_CART_ESTIMATE") {
            appendPriceLine(breakdown, "Item price", money(cardData.itemPrice));
          }
          if (cardData.shippingLabel) {
            appendPriceLine(breakdown, "Shipping", String(cardData.shippingLabel));
          }
          if (cardData.taxPrice && cardData.taxLabel) {
            appendPriceLine(breakdown, String(cardData.taxLabel), money(cardData.taxPrice));
          }
          if (cardData.estimatedTotal) {
            appendPriceLine(breakdown, "Estimated total", money(cardData.estimatedTotal), true);
          }
          if (breakdown.children.length > 0) body.append(breakdown);
          const quoteCapability = String(cardData.quoteCapability || product.quoteCapability || "MERCHANT_CHECKOUT_ONLY");
          body.append(make("div", "details", quoteCapability === "DELIVERED_TOTAL_SUPPORTED"
            ? "ZIP delivered-total estimate available."
            : quoteCapability === "ZIP_ESTIMATE_ONLY"
              ? "ZIP estimate available; some merchants may require checkout for the final total."
              : "Shipping, tax, and final total are available at merchant checkout."));
          if (Array.isArray(product.matchEvidence) && product.matchEvidence.length > 0) {
            body.append(make("div", "evidence", "Identity evidence: " + product.matchEvidence.join("; ")));
          }
          if (Array.isArray(product?.merchantTrust?.evidence) && product.merchantTrust.evidence.length > 0) {
            body.append(make("div", "evidence", "Merchant evidence: " + product.merchantTrust.evidence.join("; ")));
          }
          body.append(make("div", "observed", observedAt(product.checkedAt)));
          body.append(make("div", "limitations notice", product?.pricing?.scope === "SHOPIFY_CART_ESTIMATE"
            ? "Shopify Cart estimate for supplied ZIP. Tax is Shopify-reported or clearly labeled as a ZIP state-average estimate. Some merchants require a full address or checkout before calculating tax. Final checkout total may change. Coupons and membership remain unavailable unless separately verified."
            : "Verified public item price. Shipping, tax, fees, coupons, membership and delivered price remain unavailable unless separately verified."));
          const purchaseUrl = safeHttps(product?.purchaseLink?.url || product?.merchantUrl);
          if (purchaseUrl) {
            const link = make("a", "", cardData.actionLabel || "View at merchant");
            link.href = purchaseUrl;
            link.target = "_blank";
            link.rel = "noopener noreferrer";
            body.append(link);
          }
          card.append(body);
          cards.append(card);
        }
        group.append(cards);
        app.append(group);
      }
      markStage("DOM_RENDERED");
      requestSizeReport("DOM_RENDERED");
      reportMetrics("DOM_RENDERED");
    }
    const hydrateFromInput = async (input) => {
      const renderId = typeof input?.renderId === "string" ? input.renderId : undefined;
      if (renderId) currentRenderId = renderId;
      if (hasResult || !initialized || !renderId || hydrationRenderId === renderId) return;
      hydrationRenderId = renderId;
      try {
        const result = await request("tools/call", {
          name: "render_product_cards",
          arguments: { renderId }
        }, 4000);
        if (!result?.structuredContent) throw new Error("snapshot missing");
        markStage("TOOL_OUTPUT_RECEIVED");
        render(result.structuredContent);
      } catch (error) {
        const terminalStage = error instanceof Error && error.message === "tools/call timed out"
          ? "TOOL_OUTPUT_TIMEOUT"
          : "TOOL_OUTPUT_FAILED";
        markStage(terminalStage);
        reportMetrics(terminalStage);
        if (!hasResult) {
          app.replaceChildren(make("div", "empty error", "Product-card snapshot could not be loaded. Text results remain available."));
        }
      }
    };
    const receiveInput = (input) => {
      if (!input || typeof input !== "object") return;
      latestToolInput = input;
      markStage("TOOL_INPUT_RECEIVED");
      void hydrateFromInput(input);
    };
    window.addEventListener("message", (event) => {
      if (event.source !== window.parent) return;
      const message = event.data;
      if (!message || message.jsonrpc !== "2.0") return;
      if (message.id !== undefined && pendingRequests.has(message.id)) {
        const pending = pendingRequests.get(message.id);
        pendingRequests.delete(message.id);
        if (pending.timeoutId !== undefined && typeof window.clearTimeout === "function") {
          window.clearTimeout(pending.timeoutId);
        }
        if (message.error) pending.reject(message.error);
        else pending.resolve(message.result);
        return;
      }
      if (message.method === "ui/notifications/tool-input") receiveInput(message.params);
      if (message.method === "ui/notifications/tool-result") {
        const output = message.params?.structuredContent;
        if (output) {
          markStage("TOOL_OUTPUT_RECEIVED");
          render(output);
        }
        else void hydrateFromInput(latestToolInput);
      }
    }, { passive: true });
    window.addEventListener("openai:set_globals", (event) => {
      const output = event.detail?.globals?.toolOutput;
      if (output) {
        markStage("TOOL_OUTPUT_RECEIVED");
        render(output);
      }
      receiveInput(event.detail?.globals?.toolInput);
    });
    const receiveCompatibilityBridge = () => {
      const bridge = window.openai;
      if (!bridge) return false;
      markStage("COMPAT_BRIDGE_READY");
      receiveInput(bridge.toolInput);
      const responseMetadata = bridge.toolResponseMetadata;
      const output = bridge.toolOutput
        || responseMetadata?.mcp_tool_result?.structuredContent
        || responseMetadata?.call_tool_result?.structuredContent;
      if (!hasResult && output) {
        markStage("COMPAT_OUTPUT_RECEIVED");
        markStage("TOOL_OUTPUT_RECEIVED");
        render(output);
      }
      return hasResult;
    };
    const compatibilityWarmupDelays = [16, 50, 100, 250, 500, 1000, 2000, 4000, 8000];
    let compatibilityWarmupIndex = 0;
    const warmCompatibilityBridge = () => {
      if (receiveCompatibilityBridge()) return;
      const delay = compatibilityWarmupDelays[compatibilityWarmupIndex++];
      if (delay !== undefined) window.setTimeout(warmCompatibilityBridge, delay);
    };
    warmCompatibilityBridge();
    const initializeParams = {
      protocolVersion: "2026-01-26",
      appInfo: { name: "FindCheap Agent product cards", version: "0.8.3" },
      appCapabilities: { availableDisplayModes: ["inline"] }
    };
    const finishInitialization = () => {
      if (initialized) return;
      initialized = true;
      markStage("INITIALIZE_ACK");
      notify("ui/notifications/initialized");
      void hydrateFromInput(latestToolInput);
      flushSizeReports();
      flushMetrics();
    };
    const initializeRetryDelays = [50, 150];
    const attemptInitialization = () => {
      if (initialized) return;
      const attemptIndex = initializeAttempts++;
      if (attemptIndex === 0) markStage("INITIALIZE_SENT");
      else markStage("INITIALIZE_RETRY");
      request("ui/initialize", initializeParams, 750).then(finishInitialization).catch(() => {
        if (initialized) return;
        const retryDelay = initializeRetryDelays[attemptIndex];
        if (retryDelay !== undefined) {
          window.setTimeout(attemptInitialization, retryDelay);
          return;
        }
        markStage("INITIALIZE_FAILED");
        if (!hasResult) {
          app.replaceChildren(make("div", "empty error", "Product-card UI could not connect. Text results remain available."));
        }
      });
    };
    attemptInitialization();
    window.setTimeout(() => {
      if (!initialized && !hasResult) {
        markStage("INITIALIZE_SLOW");
        reportMetrics("INITIALIZE_SLOW");
        app.replaceChildren(make("div", "empty error", "Product-card UI is still connecting. Text results remain available."));
      }
    }, 2500);
    window.setTimeout(() => {
      if (!hasResult) {
        app.replaceChildren(make("div", "empty error", "Product-card data did not arrive. Text results remain available."));
      }
    }, 5000);
  </script>
</body>
</html>`;
