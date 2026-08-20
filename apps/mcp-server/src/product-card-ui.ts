export const PRODUCT_CARD_UI_URI = "ui://findcheap/product-cards/v14.html";

export const PRODUCT_CARD_RESOURCE_DOMAINS = [
  "https://cdn.shopify.com"
];

export const PRODUCT_CARD_HTML = String.raw`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>
    :root { color-scheme: light dark; font-family: ui-sans-serif, system-ui, sans-serif; }
    body { margin: 0; color: light-dark(#182019, #eef5ef); background: transparent; }
    #app { display: grid; gap: 12px; padding: 4px; }
    .summary { color: light-dark(#526157, #aebbb1); font-size: 13px; }
    .group { display: grid; gap: 8px; }
    .group h2 { margin: 0; font-size: 14px; }
    .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 12px; }
    .card { overflow: hidden; border: 1px solid light-dark(#dbe4dc, #344338); border-radius: 16px; background: light-dark(#fff, #172019); box-shadow: 0 8px 28px rgb(0 0 0 / .07); }
    .image { width: 100%; aspect-ratio: 4 / 3; object-fit: contain; background: light-dark(#f5f7f5, #222d25); }
    .body { display: grid; gap: 9px; padding: 14px; }
    .merchant { color: light-dark(#5c6d61, #a8b7ac); font-size: 12px; font-weight: 650; text-transform: uppercase; letter-spacing: .06em; }
    h3 { margin: 0; font-size: 15px; line-height: 1.35; }
    .row { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; }
    .price { font-size: 21px; font-weight: 750; }
    .badges { display: flex; flex-wrap: wrap; gap: 6px; }
    .badge { border-radius: 999px; padding: 4px 8px; background: light-dark(#edf5ee, #263329); font-size: 11px; font-weight: 650; }
    .exact { color: light-dark(#166534, #86efac); }
    .discovery { color: light-dark(#1d4ed8, #93c5fd); }
    .similar { color: light-dark(#92400e, #fcd34d); }
    .details, .evidence { color: light-dark(#526157, #b7c4ba); font-size: 11px; line-height: 1.4; }
    .limitations { color: light-dark(#66736a, #aab6ad); font-size: 11px; line-height: 1.4; }
    .disclosure { color: light-dark(#526157, #b7c4ba); font-size: 11px; line-height: 1.4; }
    a { display: inline-flex; justify-content: center; border-radius: 10px; padding: 9px 12px; color: #fff; background: #177245; font-size: 13px; font-weight: 700; text-decoration: none; }
    a:focus-visible { outline: 3px solid #6ee7b7; outline-offset: 2px; }
    .empty { border: 1px dashed light-dark(#cbd5cc, #415046); border-radius: 14px; padding: 18px; text-align: center; }
    .error { color: light-dark(#991b1b, #fecaca); }
  </style>
</head>
<body>
  <main id="app" aria-live="polite"><div class="empty">Waiting for verified product results…</div></main>
  <script>
    const app = document.getElementById("app");
    const uiStartedAt = typeof performance === "object" && typeof performance.now === "function"
      ? performance.now()
      : Date.now();
    const cardMetrics = { version: "0.6.7", stages: {} };
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
      if (text !== undefined) node.textContent = String(text);
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
    const groupDefinitions = [
      { status: "EXACT", title: "Exact matches" },
      { status: "DISCOVERY_MATCH", title: "Discovery matches" },
      { status: "SIMILAR", title: "Similar options" }
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
      app.append(make("div", "summary", products.length + " product card" + (products.length === 1 ? "" : "s") + " · identity labels · " + priceSummary));
      for (const definition of groupDefinitions) {
        const grouped = products.filter((product) => product?.matchStatus === definition.status);
        if (grouped.length === 0) continue;
        const group = make("section", "group");
        group.append(make("h2", "", definition.title));
        const cards = make("div", "cards");
        for (const product of grouped) {
          const cardData = product && typeof product.card === "object" ? product.card : {};
          const card = make("article", "card");
          const imageUrl = safeHttps(cardData.imageUrl);
          if (imageUrl) {
            const image = make("img", "image");
            image.alt = "";
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
            .filter(Boolean).join(" · ");
          if (identity) body.append(make("div", "details", identity));
          const variants = Object.entries(product.variantDimensions || {}).map(([name, value]) => name + ": " + value).join(" · ");
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
          badges.append(make("span", "badge", String(cardData.conditionBadge || product.condition || "UNKNOWN")));
          badges.append(make("span", "badge", String(cardData.availability || product.availability || "UNKNOWN")));
          row.append(badges);
          body.append(row);
          if (cardData.itemPrice && product?.pricing?.scope === "SHOPIFY_CART_ESTIMATE") {
            body.append(make("div", "details", "Item price: " + money(cardData.itemPrice)));
          }
          if (cardData.shippingLabel) {
            body.append(make("div", "details", "Shipping: " + String(cardData.shippingLabel)));
          }
          if (cardData.taxPrice && cardData.taxLabel) {
            body.append(make("div", "details", String(cardData.taxLabel) + ": " + money(cardData.taxPrice)));
          }
          if (cardData.estimatedTotal) {
            body.append(make("div", "details", "Estimated total: " + money(cardData.estimatedTotal)));
          }
          if (Array.isArray(product.matchEvidence) && product.matchEvidence.length > 0) {
            body.append(make("div", "evidence", "Identity evidence: " + product.matchEvidence.join("; ")));
          }
          body.append(make("div", "details", observedAt(product.checkedAt)));
          body.append(make("div", "limitations", product?.pricing?.scope === "SHOPIFY_CART_ESTIMATE"
            ? "Shopify Cart estimate for supplied ZIP. Tax is Shopify-reported or clearly labeled as a ZIP state-average estimate. Some merchants require a full address or checkout before calculating tax. Final checkout total may change. Coupons and membership remain unavailable unless separately verified."
            : "Verified public item price. Shipping, tax, fees, coupons, membership and delivered price remain unavailable unless separately verified."));
          const purchaseUrl = safeHttps(product?.purchaseLink?.url || product?.merchantUrl);
          if (purchaseUrl) {
            if (product?.purchaseLink?.kind === "APPROVED_AFFILIATE" && product.purchaseLink.disclosure) {
              body.append(make("div", "disclosure", product.purchaseLink.disclosure));
            }
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
      appInfo: { name: "FindCheap Agent product cards", version: "0.6.7" },
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
