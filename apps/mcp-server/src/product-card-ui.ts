import { FINDCHEAP_VERSION } from "../../../config/version.js";
import { MAX_PRODUCT_CARDS } from "./product-candidate-ranking.js";

export const PRODUCT_CARD_UI_URI = "ui://findcheap/product-cards/v32.html";

export const PRODUCT_CARD_RESOURCE_DOMAINS = [
  "https://cdn.shopify.com",
  "https://i.ebayimg.com"
];

export function productCardResourceDomains(productSearchUrl?: string): string[] {
  if (productSearchUrl === undefined || productSearchUrl.trim() === "") {
    return [...PRODUCT_CARD_RESOURCE_DOMAINS];
  }
  try {
    const url = new URL(productSearchUrl);
    if (url.protocol !== "https:" || url.username !== "" || url.password !== "" || url.port !== "") {
      return [...PRODUCT_CARD_RESOURCE_DOMAINS];
    }
    return [...new Set([...PRODUCT_CARD_RESOURCE_DOMAINS, url.origin])];
  } catch {
    return [...PRODUCT_CARD_RESOURCE_DOMAINS];
  }
}

export const PRODUCT_CARD_HTML = String.raw`<!doctype html>
<html>
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
      --fc-positive: light-dark(#176b45, #85d9ae);
      --fc-positive-soft: light-dark(#eef8f2, #18372a);
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
      gap: 10px;
      border-top: 1px solid var(--fc-border);
      padding: 14px 0 2px;
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
    .card.featured {
      border-color: var(--fc-positive);
      background: light-dark(#fbfefc, #1d2822);
    }
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
    .merchant-row { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 7px; }
    .merchant { color: var(--fc-muted); font-size: 12px; font-weight: 600; line-height: 1.35; letter-spacing: .01em; }
    .rank-label {
      border: 1px solid light-dark(#b9dcc8, #35694c);
      border-radius: 999px;
      padding: 3px 7px;
      color: var(--fc-positive);
      background: var(--fc-positive-soft);
      font-size: 10px;
      font-weight: 680;
      line-height: 1.2;
    }
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
    .details, .evidence, .limitations, .observed {
      color: var(--fc-muted);
      font-size: 11px;
      line-height: 1.45;
    }
    .disclosure {
      color: var(--fc-text);
      font-size: 12px;
      font-weight: 650;
      line-height: 1.45;
    }
    .evidence { color: var(--fc-text); }
    .observed { color: var(--fc-faint); }
    .more {
      border-top: 1px solid var(--fc-border);
      padding-top: 8px;
      color: var(--fc-muted);
      font-size: 11px;
    }
    .more summary { cursor: pointer; font-weight: 600; }
    .more-content { display: grid; gap: 6px; padding-top: 8px; }
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
    .compare-panel {
      position: sticky;
      top: 8px;
      z-index: 5;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 9px;
      border: 1px solid var(--fc-border);
      border-radius: 12px;
      padding: 10px 12px;
      background: var(--fc-surface-muted);
    }
    .compare-status { color: var(--fc-muted); font-size: 12px; }
    .quote-action { display: flex; flex-wrap: wrap; align-items: end; gap: 8px; border: 1px solid var(--fc-border); border-radius: 12px; padding: 10px 12px; background: var(--fc-surface-muted); }
    .quote-field { display: grid; gap: 4px; color: var(--fc-muted); font-size: 11px; }
    .quote-field input { width: 150px; border: 1px solid var(--fc-border-strong); border-radius: 9px; padding: 8px 9px; color: var(--fc-text); background: var(--fc-surface); font: inherit; }
    .quote-field input:focus-visible { outline: 2px solid var(--fc-focus); outline-offset: 2px; }
    button {
      border: 1px solid var(--fc-action);
      border-radius: 9px;
      padding: 8px 11px;
      color: var(--fc-action-text);
      background: var(--fc-action);
      font: inherit;
      font-size: 12px;
      font-weight: 650;
      cursor: pointer;
    }
    button:disabled { cursor: not-allowed; opacity: .48; }
    button:focus-visible { outline: 2px solid var(--fc-focus); outline-offset: 2px; }
    .compare-toggle { justify-self: start; color: var(--fc-text); background: transparent; }
    .compare-toggle.selected { color: var(--fc-action-text); background: var(--fc-action); }
    .inline-comparison { overflow-x: auto; border: 1px solid var(--fc-border); border-radius: 14px; background: var(--fc-surface); }
    .inline-comparison table { width: 100%; min-width: 660px; border-collapse: separate; border-spacing: 0; table-layout: fixed; }
    .inline-comparison th, .inline-comparison td { min-width: 190px; border-left: 1px solid var(--fc-border); border-top: 1px solid var(--fc-border); padding: 11px; vertical-align: top; text-align: left; line-height: 1.4; }
    .inline-comparison tr:first-child th { border-top: 0; }
    .inline-comparison th:first-child, .inline-comparison td:first-child { position: sticky; left: 0; z-index: 1; min-width: 132px; width: 132px; border-left: 0; background: var(--fc-surface-muted); color: var(--fc-muted); font-weight: 650; }
    .comparison-head { display: grid; gap: 7px; }
    .comparison-head.recommended { color: var(--fc-positive); }
    .comparison-title { color: var(--fc-text); font-size: 14px; font-weight: 680; }
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
      .group { padding-top: 12px; }
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
  <main id="app" aria-live="polite"><div class="empty">Loading…</div></main>
  <script>
    const app = document.getElementById("app");
    const uiStartedAt = typeof performance === "object" && typeof performance.now === "function"
      ? performance.now()
      : Date.now();
    const cardMetrics = { version: "${FINDCHEAP_VERSION}", stages: {} };
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
    let lastProductOutput;
    let currentLocale = document.documentElement.lang?.toLocaleLowerCase().startsWith("zh") ? "zh-CN" : "en-US";
    const text = (english, chinese) => currentLocale === "zh-CN" ? chinese : english;
    const badgeText = (value) => currentLocale !== "zh-CN" ? ({
      TRUSTED_MERCHANT: "Trusted merchant",
      SHOPIFY_HIGH_RATED: "Shopify high-rated merchant"
    })[value] || value : ({
      EXACT: "精确匹配",
      DISCOVERY_MATCH: "发现匹配",
      SIMILAR: "相似商品",
      MERCHANT_UNVERIFIED: "商家未验证",
      OFFICIAL: "品牌官网",
      AUTHORIZED_RETAILER: "授权零售商",
      ESTABLISHED_RETAILER: "成熟零售商",
      TRUSTED_MERCHANT: "可信商家",
      SHOPIFY_HIGH_RATED: "Shopify 高评分商家",
      NEW: "全新",
      USED: "二手",
      REFURBISHED: "翻新",
      OPEN_BOX: "开箱品",
      UNKNOWN: "未知",
      IN_STOCK: "有货",
      OUT_OF_STOCK: "缺货"
    }[value] || value);
    const cardLabelText = (value) => {
      const label = String(value);
      if (currentLocale !== "zh-CN") return label === "免费配送 $0.00" ? "Free shipping $0.00" : label;
      const exact = {
        "Verified item price": "已验证商品价",
        "Live item price": "实时商品价",
        "Item price unavailable": "商品价暂不可用",
        "Estimated total": "预估总价",
        "Shopify estimated tax": "Shopify 预估税费",
        "Shopify-reported tax": "Shopify 返回税费"
      }[label];
      if (exact) return exact;
      if (label.endsWith(" shipping")) return label.slice(0, -9) + " 运费";
      if (label.startsWith("Estimated tax (")) return "预估税费（" + label.slice(15, -1) + "）";
      return label;
    };
    const couponBadgeText = (product, cardData) => {
      const first = Array.isArray(product?.coupons?.verified) ? product.coupons.verified[0] : undefined;
      if (first?.code) return text("Coupon: ", "优惠码：") + String(first.code);
      if (Number.isFinite(Number(first?.discountPercent))) {
        return currentLocale === "zh-CN" ? "优惠 " + Number(first.discountPercent) + "%" : Number(first.discountPercent) + "% off";
      }
      if (first?.discountAmount) {
        return text("Coupon: ", "优惠：") + money(first.discountAmount) + text(" off", " 减免");
      }
      if (first?.title) return String(first.title);
      const raw = String(cardData?.couponLabel || "").replace(/^Coupon:\s*/iu, "");
      return raw ? text("Coupon: ", "优惠：") + raw : "";
    };
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
      ? new Intl.NumberFormat(currentLocale, { style: "currency", currency: "USD" }).format(value.amountCents / 100)
      : text("Price unavailable", "价格暂不可用");
    const safeHttps = (value) => {
      try { const url = new URL(value); return url.protocol === "https:" ? url.href : null; }
      catch { return null; }
    };
    const extractStructuredContent = (value, depth = 0) => {
      if (!value || typeof value !== "object" || depth > 4) return undefined;
      if (Array.isArray(value.products) || Array.isArray(value.entries)) return value;
      for (const key of ["structuredContent", "toolOutput", "result", "output", "toolResult", "mcp_tool_result", "call_tool_result"]) {
        const nested = extractStructuredContent(value[key], depth + 1);
        if (nested) return nested;
      }
      return undefined;
    };
    const observedAt = (value) => {
      const date = new Date(value);
      return Number.isNaN(date.getTime())
        ? text("Observation time unavailable", "观察时间暂不可用")
        : text("Observed ", "观察时间：") + new Intl.DateTimeFormat(currentLocale, { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(date);
    };
    const appendPriceLine = (container, label, value, emphasis = false) => {
      const line = make("div", "price-line" + (emphasis ? " total" : ""));
      line.append(make("span", "price-label", label));
      line.append(make("span", "price-value", value));
      container.append(line);
    };
    const trustGroupDefinitions = () => [
      { tier: "TRUSTED_OR_AFFILIATE", title: text("Trusted merchants", "可信商家") },
      {
        tier: "HIGH_RATED_UNVERIFIED",
        title: text("Highly rated Shopify merchants", "Shopify 高评分商家"),
        notice: text("Shopify rating is above 3.8 with at least 2 reviews.", "Shopify 评分高于 3.8 且至少有 2 条评价。")
      },
      {
        tier: "GENERAL_UNVERIFIED",
        title: text("Other relevant products - review merchant carefully", "其他相关商品 - 请仔细核验商家"),
        notice: text("Merchant trust evidence is limited. Verify seller identity, returns, and payment protection before purchasing.", "商家可信证据有限。购买前请核验卖家身份、退货政策和付款保障。")
      }
    ];
    const resultGroupDefinitions = () => [
      { group: "REQUESTED_PRODUCT", title: text("Requested product candidates", "目标商品候选") },
      { group: "DISCOVERY", title: text("Discovery results", "发现结果") },
      {
        group: "ALTERNATIVE",
        title: text("Alternative products", "替代商品"),
        notice: text("Alternatives are shown only when explicitly requested; they are not the same product.", "仅在明确要求时展示替代商品；它们不是同一款商品。")
      }
    ];
    const presentationGroupDefinitions = () => [
      {
        group: "OFFICIAL_STORE",
        title: text("Official website matches", "品牌官网匹配"),
        notice: text("Only products hosted on independently verified official brand websites.", "仅展示位于已独立验证品牌官网的商品。")
      },
      {
        group: "TRUSTED_MATCH",
        title: text("Trusted exact and similar matches", "可信的精确与相似匹配"),
        notice: text("High-match products from reviewed merchants, approved Awin merchants, or Shopify merchants rated above 3.8 with at least 2 reviews. Commission never changes relevance scoring.", "来自已审核商家、已批准的 Awin 商家，或评分高于 3.8 且至少有 2 条评价的 Shopify 高匹配商品。佣金不影响相关性评分。")
      },
      {
        group: "BEST_VALUE",
        title: text("Best-value high-match options", "高性价比匹配"),
        notice: text("High-match products ordered by verified Coupon evidence, then item price.", "高匹配商品按已验证优惠券证据排序，其次按商品价格排序。")
      }
    ];
    const visualGroupDefinitions = () => [
      {
        group: "POSSIBLE_SAME_ITEM",
        title: text("Possible same item", "可能是同一商品"),
        notice: text("Visual evidence suggests the same item, but exact identity is not confirmed without a stable product identifier.", "视觉证据表明可能是同一商品，但缺少稳定商品标识，无法确认精确身份。")
      },
      { group: "HIGHLY_SIMILAR", title: text("Highly similar", "高度相似") },
      { group: "SAME_STYLE", title: text("Same style", "同风格") }
    ];
    const combinedGroupDefinitions = (results) => results.flatMap((result) =>
      trustGroupDefinitions().map((trust) => ({
        group: result.group,
        tier: trust.tier,
        title: result.title + " / " + trust.title,
        notice: [result.notice, trust.notice].filter(Boolean).join(" ")
      }))
    );
    const recommendationTier = (product) => {
      if (typeof product?.recommendationTier === "string") return product.recommendationTier;
      if (product?.merchantTrust?.verification === "INDEPENDENT") {
        return "TRUSTED_OR_AFFILIATE";
      }
      const rating = product?.productRating;
      return rating && Number(rating.value) > 3.8 && Number(rating.count) >= 2
        ? "HIGH_RATED_UNVERIFIED"
        : "GENERAL_UNVERIFIED";
    };
    const comparisonList = (values) => {
      if (!Array.isArray(values) || values.length === 0) return make("span", "details", text("Not verified", "未验证"));
      const list = make("ul", "details");
      values.forEach((value) => list.append(make("li", "", value)));
      return list;
    };
    const comparisonLabel = (value) => currentLocale !== "zh-CN" ? String(value || "") : ({
      IN_STOCK: "有货", OUT_OF_STOCK: "缺货", UNKNOWN: "未知",
      NEW: "全新", USED: "二手", REFURBISHED: "翻新", OPEN_BOX: "开箱品",
      OFFICIAL: "官方", AUTHORIZED_RETAILER: "授权零售商", ESTABLISHED_RETAILER: "成熟零售商", RISKY: "风险商家",
      INDEPENDENT: "独立验证", UNVERIFIED: "未验证"
    })[value] || String(value || "");
    const renderComparison = (output) => {
      app.replaceChildren();
      const back = make("button", "compare-toggle", text("Back to results", "返回商品卡"));
      back.type = "button";
      back.addEventListener("click", () => { if (lastProductOutput) render(lastProductOutput); });
      app.append(back);
      if (output.status !== "OK" || !Array.isArray(output.entries) || output.entries.length < 2) {
        app.append(make("div", "empty error", output.message || text("Comparison unavailable.", "对比不可用。")));
        requestSizeReport("COMPARISON_RENDERED");
        return;
      }
      app.append(make("div", "summary", output.message));
      const canQuote = output.entries.length <= 4 &&
        output.entries.some((entry) => entry.deliveredTotalStatus === "NOT_QUOTED") &&
        output.entries.every((entry) => entry.deliveredTotalStatus !== "MERCHANT_CHECKOUT_ONLY" && typeof entry.selectionId === "string");
      if (canQuote) {
        const quoteAction = make("section", "quote-action");
        const field = make("label", "quote-field", text("US delivery ZIP", "美国配送 ZIP"));
        const zipInput = make("input");
        zipInput.type = "text";
        zipInput.inputMode = "numeric";
        zipInput.maxLength = 10;
        zipInput.placeholder = "12345";
        field.append(zipInput);
        const quoteButton = make("button", "", text("Quote delivered totals", "查询到手价"));
        quoteButton.type = "button";
        const quoteStatus = make("span", "compare-status", text("Uses these same compared products.", "使用当前对比中的同一批商品。"));
        quoteButton.addEventListener("click", () => {
          const zipCode = String(zipInput.value || "").trim();
          if (!/^\d{5}(?:-\d{4})?$/u.test(zipCode)) {
            quoteStatus.textContent = text("Enter a valid US ZIP.", "请输入有效的美国 ZIP。");
            return;
          }
          quoteButton.disabled = true;
          quoteStatus.textContent = text("Quoting delivered totals…", "正在查询到手价…");
          void request("tools/call", {
            name: "quote_and_compare_selected_products",
            arguments: {
              selectionIds: output.entries.map((entry) => entry.selectionId),
              zipCode,
              mode: "AUTO",
              focus: ["DELIVERED_TOTAL"],
              responseLocale: currentLocale
            }
          }, 8000).then((result) => {
            const comparison = extractStructuredContent(result);
            if (!comparison || !Array.isArray(comparison.entries)) throw new Error("quote result unavailable");
            renderComparison(comparison);
          }).catch(() => {
            quoteButton.disabled = false;
            quoteStatus.textContent = text("Quote failed. Try once more.", "报价加载失败，请重试一次。");
          });
        });
        quoteAction.append(field, quoteButton, quoteStatus);
        app.append(quoteAction);
      }
      const scroller = make("section", "inline-comparison");
      const table = make("table");
      const header = make("tr");
      header.append(make("th", "", text("Product", "商品")));
      output.entries.forEach((entry) => {
        const cell = make("th");
        const head = make("div", "comparison-head" + (output.recommendation?.recommendedSelectionId === entry.selectionId ? " recommended" : ""));
        if (output.recommendation?.recommendedSelectionId === entry.selectionId) head.append(make("span", "rank-label", text("Recommended", "推荐")));
        head.append(make("div", "merchant", entry.sellerName ? entry.merchant + " · " + entry.sellerName : entry.merchant));
        head.append(make("div", "comparison-title", entry.title));
        const url = safeHttps(entry.purchaseUrl);
        if (url) { const link = make("a", "", text("View at merchant", "前往商家页面")); link.href = url; link.target = "_blank"; link.rel = "noopener noreferrer"; head.append(link); }
        cell.append(head);
        header.append(cell);
      });
      table.append(header);
      const delivered = (entry) => entry.deliveredTotal
        ? make("span", "price", money(entry.deliveredTotal))
        : make("span", "details", entry.deliveredTotalStatus === "MERCHANT_CHECKOUT_ONLY"
          ? text("Quote unsupported: merchant checkout only", "不支持报价：仅商家结账页提供")
          : text("Not quoted: provide ZIP", "未报价：请提供 ZIP"));
      const rows = [
        [text("Compared price", "对比价格"), (entry) => make("span", entry.comparedPrice ? "price" : "details", entry.comparedPrice ? money(entry.comparedPrice) : text("Unavailable", "不可用"))],
        [text("Item price", "商品价"), (entry) => make("span", entry.itemPrice ? "" : "details", entry.itemPrice ? money(entry.itemPrice) : text("Unknown", "未知"))],
        [text("Delivered total", "到手价"), delivered],
        [text("Condition", "商品状态"), (entry) => make("span", "", comparisonLabel(entry.condition))],
        [text("Availability", "库存"), (entry) => make("span", "", comparisonLabel(entry.availability))],
        [text("Merchant trust", "商家信任"), (entry) => make("span", "", comparisonLabel(entry.merchantTrust?.level) + " · " + comparisonLabel(entry.merchantTrust?.verification))],
        [text("Required features", "必需功能"), (entry) => comparisonList(entry.requirementEvidence)],
        [text("Limitations", "限制"), (entry) => comparisonList(entry.limitations)],
        [text("Unknowns", "未知项"), (entry) => comparisonList(entry.unknowns?.map(comparisonLabel))]
      ];
      rows.forEach(([label, value]) => {
        const row = make("tr");
        row.append(make("th", "", label));
        output.entries.forEach((entry) => { const cell = make("td"); cell.append(value(entry)); row.append(cell); });
        table.append(row);
      });
      scroller.append(table);
      app.append(scroller);
      markStage("COMPARISON_RENDERED");
      requestSizeReport("COMPARISON_RENDERED");
    };
    const resultGroup = (product) => {
      if (["POSSIBLE_SAME_ITEM", "HIGHLY_SIMILAR", "SAME_STYLE"].includes(product?.visualMatchGroup)) {
        return product.visualMatchGroup;
      }
      if (["REQUESTED_PRODUCT", "DISCOVERY", "ALTERNATIVE"].includes(product?.resultGroup)) {
        return product.resultGroup;
      }
      return product?.matchStatus === "SIMILAR"
        ? "ALTERNATIVE"
        : product?.matchStatus === "EXACT" ? "REQUESTED_PRODUCT" : "DISCOVERY";
    };
    function render(output) {
      currentLocale = output?.locale === "zh-CN"
        ? "zh-CN"
        : output?.locale === "en-US"
          ? "en-US"
          : document.documentElement.lang?.toLocaleLowerCase().startsWith("zh") ? "zh-CN" : "en-US";
      document.documentElement.lang = currentLocale;
      if (Array.isArray(output?.entries)) {
        renderComparison(output);
        return;
      }
      lastProductOutput = output;
      hasResult = true;
      if (typeof output?.renderId === "string") currentRenderId = output.renderId;
      markStage("RENDER_STARTED");
      app.replaceChildren();
      const products = Array.isArray(output?.products) ? output.products.slice(0, ${MAX_PRODUCT_CARDS}) : [];
      const primarySelectionId = output?.recommendation?.state === "READY"
        ? output.recommendation.primarySelectionId
        : undefined;
      if (products.length === 0) {
        app.append(make("div", "empty", output?.message || text("No verified products returned.", "没有返回已验证商品。")));
        markStage("DOM_RENDERED");
        requestSizeReport("DOM_RENDERED");
        reportMetrics("DOM_RENDERED");
        return;
      }
      const usesPresentationGroups = products.some((product) =>
        ["OFFICIAL_STORE", "TRUSTED_MATCH", "BEST_VALUE"].includes(product?.presentationGroup)
      );
      const groupDefinitions = usesPresentationGroups
        ? presentationGroupDefinitions()
        : combinedGroupDefinitions(
            products.some((product) => typeof product?.visualMatchGroup === "string")
              ? visualGroupDefinitions()
              : resultGroupDefinitions()
          );
      const quoteCount = products.filter((product) => product?.pricing?.scope === "SHOPIFY_CART_ESTIMATE").length;
      const priceSummary = quoteCount === 0
        ? text("public item prices only", "仅公开商品价")
        : quoteCount === products.length
          ? text("Shopify Cart estimates for supplied ZIP", "基于所提供 ZIP 的 Shopify Cart 预估")
          : text(quoteCount + " Shopify Cart estimate" + (quoteCount === 1 ? "" : "s") + "; remaining item-price-only", quoteCount + " 个 Shopify Cart 预估；其余仅含商品价");
      app.append(make("div", "summary", currentLocale === "zh-CN"
        ? products.length + " 张商品卡 / 身份标签 / " + priceSummary
        : products.length + " product card" + (products.length === 1 ? "" : "s") + " / identity labels / " + priceSummary));
      const comparable = products.filter((product) => typeof product?.selectionId === "string");
      const selected = new Set();
      const selectionButtons = new Map();
      let compareButton;
      let compareStatus;
      const updateCompareControls = () => {
        for (const [selectionId, button] of selectionButtons) {
          const active = selected.has(selectionId);
          button.className = "compare-toggle" + (active ? " selected" : "");
          button.textContent = active ? text("Selected", "已选择") : text("Select for comparison", "选择对比");
          button.disabled = !active && selected.size >= 4;
          button.ariaPressed = String(active);
        }
        if (compareButton) {
          compareButton.disabled = selected.size < 2 || selected.size > 4;
          compareButton.textContent = text("Compare selected", "对比已选商品") + " (" + selected.size + ")";
        }
        if (compareStatus) compareStatus.textContent = selected.size === 0
          ? text("Select 2-4 cards.", "请选择 2–4 张商品卡。")
          : selected.size === 1
            ? text("Select one more card.", "再选择一张商品卡。")
            : text(selected.size + " selected. Compare now.", "已选 " + selected.size + " 张，现在可以对比。");
      };
      if (comparable.length >= 2) {
        const panel = make("section", "compare-panel");
        compareStatus = make("span", "compare-status", text("Select 2-4 cards.", "请选择 2–4 张商品卡。"));
        compareButton = make("button", "", text("Compare selected", "对比已选商品") + " (0)");
        compareButton.type = "button";
        compareButton.disabled = true;
        compareButton.addEventListener("click", () => {
          if (selected.size < 2 || selected.size > 4) return;
          compareButton.disabled = true;
          compareButton.textContent = text("Comparing…", "正在对比…");
          compareStatus.textContent = text("Building server-verified comparison.", "正在生成服务器验证的对比。" );
          void request("tools/call", {
            name: "compare_selected_products",
            arguments: {
              selectionIds: [...selected],
              mode: "AUTO",
              responseLocale: currentLocale
            }
          }, 8000).then((result) => {
            const comparison = extractStructuredContent(result);
            if (!comparison || !Array.isArray(comparison.entries)) throw new Error("comparison result unavailable");
            renderComparison(comparison);
          }).catch(() => {
            compareButton.disabled = false;
            compareButton.textContent = text("Compare selected", "对比已选商品") + " (" + selected.size + ")";
            compareStatus.textContent = text("Comparison failed. Try once more or run a new search if cards expired.", "对比失败。请重试一次；若商品卡已过期，请重新搜索。" );
          });
        });
        panel.append(compareStatus, compareButton);
        app.append(panel);
      }
      const quotedProducts = products.filter((product) => product?.pricing?.scope === "SHOPIFY_CART_ESTIMATE" && product?.card?.estimatedTotal);
      if (quotedProducts.length > 0) {
        const quoteSummary = make("section", "quote-summary");
        quoteSummary.append(make("h2", "", text("Estimated total summary", "预估总价汇总")));
        for (const product of quotedProducts) {
          const item = make("div", "quote-summary-item");
          item.append(
            make("span", "", String(product.card.title || product.title || text("Product", "商品"))),
            make("span", "quote-summary-value", money(product.card.estimatedTotal))
          );
          quoteSummary.append(item);
        }
        app.append(quoteSummary);
      }
      for (const definition of groupDefinitions) {
        const grouped = products.filter((product) => usesPresentationGroups
          ? product?.presentationGroup === definition.group
          : resultGroup(product) === definition.group && recommendationTier(product) === definition.tier
        );
        if (grouped.length === 0) continue;
        const group = make("section", "group");
        group.append(make("h2", "", definition.title));
        if (definition.notice) group.append(make("div", "limitations notice", definition.notice));
        const cards = make("div", "cards");
        for (const product of grouped) {
          const cardData = product && typeof product.card === "object" ? product.card : {};
          const card = make("article", "card");
          const isFirstSupported = primarySelectionId !== undefined
            ? product?.selectionId === primarySelectionId
            : output?.recommendation === undefined &&
              product === products[0] &&
              ["OFFICIAL_STORE", "TRUSTED_MATCH"].includes(product?.presentationGroup) &&
              recommendationTier(product) !== "GENERAL_UNVERIFIED";
          if (isFirstSupported) card.className = "card featured";
          const imageUrl = safeHttps(cardData.imageUrl);
          if (!imageUrl) card.className += " no-image";
          if (imageUrl) {
            const image = make("img", "image");
            image.alt = cardData.title || product.title || text("Product image", "商品图片");
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
          const merchantRow = make("div", "merchant-row");
          merchantRow.append(make("div", "merchant", cardData.merchant || product.merchant || text("Merchant", "商家")));
          if (isFirstSupported) merchantRow.append(make("span", "rank-label", text("First to consider", "值得先看")));
          body.append(merchantRow);
          if (cardData.sellerName || product.sellerName) {
            body.append(make("div", "details", text("Seller: ", "卖家：") + String(cardData.sellerName || product.sellerName)));
          }
          body.append(make("h3", "", cardData.title || product.title || text("Product", "商品")));
          const identity = [product.brand, product.sku ? text("Model/SKU: ", "型号/SKU：") + product.sku : undefined, product.gtins?.[0] ? "GTIN: " + product.gtins[0] : undefined]
            .filter(Boolean).join(" / ");
          if (identity) body.append(make("div", "details", identity));
          const variants = Object.entries(product.variantDimensions || {}).map(([name, value]) => name + ": " + value).join(" / ");
          if (variants) body.append(make("div", "details", variants));
          if (product?.productRating && Number.isFinite(Number(product.productRating.value)) && Number.isInteger(Number(product.productRating.count))) {
            body.append(make("div", "details", currentLocale === "zh-CN"
              ? "商品评分：" + Number(product.productRating.value).toFixed(1) + "/5（" + Number(product.productRating.count) + " 条评价）"
              : "Product rating: " + Number(product.productRating.value).toFixed(1) + "/5 (" + Number(product.productRating.count) + " reviews)"));
          }
          const row = make("div", "row");
          const priceBlock = make("div", "");
          priceBlock.append(make("div", "price", money(cardData.primaryPrice)));
          if (cardData.priceLabel) priceBlock.append(make("div", "details", cardLabelText(cardData.priceLabel)));
          row.append(priceBlock);
          const badges = make("div", "badges");
          const match = String(cardData.matchBadge || product.matchStatus || "UNCONFIRMED");
          const matchClass = match === "EXACT" ? "exact" : match === "DISCOVERY_MATCH" ? "discovery" : "similar";
          badges.append(make("span", "badge " + matchClass, badgeText(match)));
          const trustBadge = String(cardData.merchantTrustBadge || "MERCHANT_UNVERIFIED");
          badges.append(make("span", "badge " + (trustBadge === "MERCHANT_UNVERIFIED" ? "unverified" : "trusted"), badgeText(trustBadge)));
          const conditionBadge = String(cardData.conditionBadge || product.condition || "UNKNOWN");
          if (conditionBadge !== "UNKNOWN") badges.append(make("span", "badge", badgeText(conditionBadge)));
          badges.append(make("span", "badge", badgeText(String(cardData.availability || product.availability || "UNKNOWN"))));
          const couponBadge = couponBadgeText(product, cardData);
          if (couponBadge) badges.append(make("span", "badge", couponBadge));
          row.append(badges);
          body.append(row);
          if (conditionBadge === "UNKNOWN") {
            body.append(make("div", "limitations notice", text("Condition not verified.", "商品状态未核实。")));
          }
          const breakdown = make("div", "price-breakdown");
          if (cardData.itemPrice && product?.pricing?.scope === "SHOPIFY_CART_ESTIMATE") {
            appendPriceLine(breakdown, text("Item price", "商品价"), money(cardData.itemPrice));
          }
          if (cardData.shippingLabel) {
            appendPriceLine(breakdown, text("Shipping", "运费"), cardLabelText(cardData.shippingLabel));
          }
          if (cardData.taxPrice && cardData.taxLabel) {
            appendPriceLine(breakdown, cardLabelText(cardData.taxLabel), money(cardData.taxPrice));
          }
          if (cardData.estimatedTotal) {
            appendPriceLine(breakdown, text("Estimated total", "预估总价"), money(cardData.estimatedTotal), true);
          }
          if (breakdown.children.length > 0) body.append(breakdown);
          const quoteCapability = String(cardData.quoteCapability || product.quoteCapability || "MERCHANT_CHECKOUT_ONLY");
          body.append(make("div", "details", quoteCapability === "DELIVERED_TOTAL_SUPPORTED"
            ? text("ZIP delivered-total estimate available.", "可按 ZIP 查询预估到手价。")
            : quoteCapability === "ZIP_ESTIMATE_ONLY"
              ? text("ZIP estimate available; some merchants may require checkout for the final total.", "可按 ZIP 估价；部分商家仍需在结账页确认最终总价。")
              : text("Quote unsupported: shipping, tax, and final total require merchant checkout.", "不支持报价：运费、税费和最终总价需在商家结账页确认。")));
          const more = make("details", "more");
          more.append(make("summary", "", text("Why this matches", "为什么匹配")));
          const moreContent = make("div", "more-content");
          if (Array.isArray(product.matchEvidence) && product.matchEvidence.length > 0) {
            moreContent.append(make("div", "evidence", text("Identity evidence: ", "身份依据：") + product.matchEvidence.join("; ")));
          }
          if (Array.isArray(product.visualMatchEvidence) && product.visualMatchEvidence.length > 0) {
            const visualEvidence = product.visualMatchEvidence
              .filter((entry) => !String(entry).startsWith("candidate-image similarity:"));
            if (visualEvidence.length > 0) {
              moreContent.append(make("div", "evidence", text("Visual evidence: ", "视觉依据：") + visualEvidence.join("; ")));
            }
          }
          if (Array.isArray(product.requiredFeatureLimitations) && product.requiredFeatureLimitations.length > 0) {
            body.append(make("div", "limitations notice", text("Not verified: ", "尚未验证：") + product.requiredFeatureLimitations.join(", ") + text(". Confirm on the merchant page before purchase.", "。购买前请在商家页面确认。")));
          }
          if (Array.isArray(product.preferenceEvidence) && product.preferenceEvidence.length > 0) {
            moreContent.append(make("div", "evidence", text("Preference match: ", "偏好匹配：") + product.preferenceEvidence.join(", ")));
          }
          const hidesRawMerchantEvidence = recommendationTier(product) === "HIGH_RATED_UNVERIFIED" ||
            (product?.sourceKind === "AWIN_PRODUCT_FEED" && recommendationTier(product) === "TRUSTED_OR_AFFILIATE");
          if (!hidesRawMerchantEvidence && Array.isArray(product?.merchantTrust?.evidence) && product.merchantTrust.evidence.length > 0) {
            moreContent.append(make("div", "evidence", text("Merchant evidence: ", "商家依据：") + product.merchantTrust.evidence.join("; ")));
          }
          moreContent.append(make("div", "observed", observedAt(product.checkedAt)));
          more.append(moreContent);
          body.append(more);
          const couponNotice = product?.coupons?.status === "VERIFIED"
            ? text(" Coupon scope and stacking are confirmed at checkout.", "优惠适用范围和叠加以结账页为准。")
            : "";
          body.append(make("div", "limitations notice", (product?.pricing?.scope === "SHOPIFY_CART_ESTIMATE"
            ? text("Estimated for the supplied ZIP; checkout confirms the final total. ", "基于所提供 ZIP 估算；最终金额以结账页为准。")
            : text("Current item price verified; shipping and tax are confirmed at checkout. ", "当前仅核实商品价；运费和税费以结账页为准。")) + couponNotice));
          if (product?.sourceEnvironment === "SANDBOX") {
            body.append(make("div", "disclosure", text("eBay Sandbox review only. This test link does not earn a commission.", "仅供 eBay Sandbox 测试；此测试链接不会产生佣金。")));
          } else if (product?.purchaseLink?.kind === "APPROVED_AFFILIATE" && typeof product.purchaseLink.disclosure === "string") {
            const disclosure = product.purchaseLink.disclosure.trim();
            if (disclosure) body.append(make("div", "disclosure", currentLocale === "zh-CN" ? "联盟链接：FindCheap 可能获得佣金；佣金不影响入选或排序。" : disclosure));
          }
          if (typeof product?.selectionId === "string" && comparable.length >= 2) {
            const toggle = make("button", "compare-toggle", text("Select for comparison", "选择对比"));
            toggle.type = "button";
            toggle.ariaPressed = "false";
            toggle.addEventListener("click", () => {
              if (selected.has(product.selectionId)) selected.delete(product.selectionId);
              else if (selected.size < 4) selected.add(product.selectionId);
              updateCompareControls();
            });
            selectionButtons.set(product.selectionId, toggle);
            body.append(toggle);
          }
          const purchaseUrl = safeHttps(product?.purchaseLink?.url || product?.merchantUrl);
          if (purchaseUrl) {
            const link = make("a", "", text("View at merchant", "前往商家页面"));
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
      updateCompareControls();
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
        const output = extractStructuredContent(result);
        if (!output) throw new Error("snapshot missing");
        markStage("TOOL_OUTPUT_RECEIVED");
        render(output);
      } catch (error) {
        const terminalStage = error instanceof Error && error.message === "tools/call timed out"
          ? "TOOL_OUTPUT_TIMEOUT"
          : "TOOL_OUTPUT_FAILED";
        markStage(terminalStage);
        reportMetrics(terminalStage);
        if (!hasResult) {
          app.replaceChildren(make("div", "empty error", text("Product-card snapshot could not be loaded. Text results remain available.", "商品卡快照无法加载，文字结果仍可使用。")));
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
        const output = extractStructuredContent(message.params);
        if (output) {
          markStage("TOOL_OUTPUT_RECEIVED");
          render(output);
        }
        else void hydrateFromInput(latestToolInput);
      }
    }, { passive: true });
    window.addEventListener("openai:set_globals", (event) => {
      const output = extractStructuredContent(event.detail?.globals);
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
      const output = extractStructuredContent(bridge)
        || extractStructuredContent(bridge.toolResponseMetadata);
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
      appInfo: { name: "FindCheap Agent product cards", version: "${FINDCHEAP_VERSION}" },
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
          app.replaceChildren(make("div", "empty error", text(
            "Product-card UI could not connect. Text results remain available.",
            "商品卡片暂时无法连接，文字结果仍可使用。"
          )));
        }
      });
    };
    attemptInitialization();
    window.setTimeout(() => {
      if (!initialized && !hasResult) {
        markStage("INITIALIZE_SLOW");
        reportMetrics("INITIALIZE_SLOW");
        app.replaceChildren(make("div", "empty error", text(
          "Product-card UI is still connecting. Text results remain available.",
          "商品卡片仍在连接，文字结果可先使用。"
        )));
      }
    }, 2500);
    window.setTimeout(() => {
      if (!hasResult) {
        app.replaceChildren(make("div", "empty error", text(
          "Product-card data did not arrive. Text results remain available.",
          "商品卡片数据未到达，文字结果仍可使用。"
        )));
      }
    }, 5000);
  </script>
</body>
</html>`;
