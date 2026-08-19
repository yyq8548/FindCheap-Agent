export const PRODUCT_CARD_UI_URI = "ui://findcheap/product-cards/v7.html";

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
    .similar { color: light-dark(#92400e, #fcd34d); }
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
    let hasResult = false;
    let initialized = false;
    let latestToolInput;
    let hydrationRenderId;
    let nextRequestId = 1;
    const pendingRequests = new Map();
    const notify = (method, params = {}) => {
      window.parent.postMessage({ jsonrpc: "2.0", method, params }, "*");
    };
    const request = (method, params) => {
      const id = nextRequestId++;
      window.parent.postMessage({ jsonrpc: "2.0", id, method, params }, "*");
      return new Promise((resolve, reject) => pendingRequests.set(id, { resolve, reject }));
    };
    const reportSize = () => {
      const root = document.documentElement;
      const body = document.body;
      const width = Math.ceil(Math.max(root?.scrollWidth || 0, body?.scrollWidth || 0));
      const height = Math.ceil(Math.max(root?.scrollHeight || 0, body?.scrollHeight || 0));
      if (width > 0 && height > 0) notify("ui/notifications/size-changed", { width, height });
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
    function render(output) {
      hasResult = true;
      app.replaceChildren();
      const products = Array.isArray(output?.products) ? output.products.slice(0, 3) : [];
      if (products.length === 0) {
        app.append(make("div", "empty", output?.message || "No verified products returned."));
        return;
      }
      const summary = make("div", "summary", products.length + " verified product card" + (products.length === 1 ? "" : "s") + " · item price only");
      const cards = make("section", "cards");
      for (const product of products) {
        const cardData = product && typeof product.card === "object" ? product.card : {};
        const card = make("article", "card");
        const imageUrl = safeHttps(cardData.imageUrl);
        if (imageUrl) {
          const image = make("img", "image");
          image.src = imageUrl;
          image.alt = "";
          image.loading = "lazy";
          image.addEventListener("error", () => image.remove(), { once: true });
          card.append(image);
        }
        const body = make("div", "body");
        body.append(make("div", "merchant", cardData.merchant || product.merchant || "Merchant"));
        body.append(make("h3", "", cardData.title || product.title || "Product"));
        const row = make("div", "row");
        row.append(make("div", "price", money(cardData.primaryPrice)));
        const badges = make("div", "badges");
        const match = String(cardData.matchBadge || product.matchStatus || "UNCONFIRMED");
        badges.append(make("span", "badge " + (match === "EXACT" ? "exact" : "similar"), match));
        badges.append(make("span", "badge", String(cardData.conditionBadge || product.condition || "UNKNOWN")));
        badges.append(make("span", "badge", String(cardData.availability || product.availability || "UNKNOWN")));
        row.append(badges);
        body.append(row);
        body.append(make("div", "limitations", "Verified public item price. Shipping, tax, fees, coupons, membership and delivered price remain unavailable unless separately verified."));
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
      app.append(summary, cards);
      window.setTimeout(reportSize, 0);
    }
    const hydrateFromInput = async (input) => {
      const renderId = typeof input?.renderId === "string" ? input.renderId : undefined;
      if (hasResult || !initialized || !renderId || hydrationRenderId === renderId) return;
      hydrationRenderId = renderId;
      try {
        const result = await request("tools/call", {
          name: "render_product_cards",
          arguments: { renderId }
        });
        if (!result?.structuredContent) throw new Error("snapshot missing");
        render(result.structuredContent);
      } catch {
        if (!hasResult) {
          app.replaceChildren(make("div", "empty error", "Product-card snapshot could not be loaded. Text results remain available."));
        }
      }
    };
    const receiveInput = (input) => {
      latestToolInput = input;
      void hydrateFromInput(input);
    };
    window.addEventListener("message", (event) => {
      if (event.source !== window.parent) return;
      const message = event.data;
      if (!message || message.jsonrpc !== "2.0") return;
      if (message.id !== undefined && pendingRequests.has(message.id)) {
        const pending = pendingRequests.get(message.id);
        pendingRequests.delete(message.id);
        if (message.error) pending.reject(message.error);
        else pending.resolve(message.result);
        return;
      }
      if (message.method === "ui/notifications/tool-input") receiveInput(message.params);
      if (message.method === "ui/notifications/tool-result") {
        const output = message.params?.structuredContent;
        if (output) render(output);
        else void hydrateFromInput(latestToolInput);
      }
    }, { passive: true });
    window.addEventListener("openai:set_globals", (event) => {
      const output = event.detail?.globals?.toolOutput;
      if (output) render(output);
      receiveInput(event.detail?.globals?.toolInput);
    });
    const responseMetadata = window.openai?.toolResponseMetadata;
    const initialOutput = window.openai?.toolOutput
      || responseMetadata?.mcp_tool_result?.structuredContent
      || responseMetadata?.call_tool_result?.structuredContent;
    if (initialOutput) render(initialOutput);
    receiveInput(window.openai?.toolInput);
    request("ui/initialize", {
      protocolVersion: "2026-01-26",
      appInfo: { name: "FindCheap product cards", version: "0.4.1" },
      appCapabilities: { availableDisplayModes: ["inline"] }
    }).then(() => {
      initialized = true;
      notify("ui/notifications/initialized");
      void hydrateFromInput(latestToolInput);
      reportSize();
      if (typeof window.ResizeObserver === "function") {
        new window.ResizeObserver(reportSize).observe(document.documentElement);
      }
    }).catch(() => {
      app.replaceChildren(make("div", "empty error", "Product-card UI could not connect. Text results remain available."));
    });
    window.setTimeout(() => {
      if (!hasResult) {
        app.replaceChildren(make("div", "empty error", "Product-card data did not arrive. Text results remain available."));
      }
    }, 4000);
  </script>
</body>
</html>`;
