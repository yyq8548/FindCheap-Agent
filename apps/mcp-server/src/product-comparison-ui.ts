import { FINDCHEAP_VERSION } from "../../../config/version.js";

export const PRODUCT_COMPARISON_UI_URI = "ui://findcheap/product-comparison/v3.html";

export const PRODUCT_COMPARISON_HTML = String.raw`<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>
    :root {
      color-scheme: light dark;
      font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      --text: light-dark(#1f1f1f, #f2f2f2);
      --muted: light-dark(#666, #aaa);
      --surface: light-dark(#fff, #1f1f1f);
      --subtle: light-dark(#f6f6f6, #292929);
      --border: light-dark(#d9d9d9, #4b4b4b);
      --positive: light-dark(#176b45, #85d9ae);
      --positive-soft: light-dark(#eef8f2, #18372a);
      --danger: light-dark(#a12424, #ffb4b4);
    }
    * { box-sizing: border-box; }
    body { margin: 0; color: var(--text); background: transparent; font-size: 13px; }
    #app { display: grid; gap: 10px; }
    .summary { color: var(--muted); font-size: 12px; line-height: 1.45; }
    .quote-action { display: flex; flex-wrap: wrap; align-items: end; gap: 8px; border: 1px solid var(--border); border-radius: 12px; padding: 10px 12px; background: var(--subtle); }
    .quote-field { display: grid; gap: 4px; color: var(--muted); font-size: 11px; }
    .quote-field input { width: 150px; border: 1px solid var(--border); border-radius: 9px; padding: 8px 9px; color: var(--text); background: var(--surface); font: inherit; }
    button { border: 1px solid var(--text); border-radius: 9px; padding: 8px 10px; color: light-dark(#fff, #171717); background: var(--text); font: inherit; font-weight: 650; cursor: pointer; }
    button:disabled { cursor: not-allowed; opacity: .48; }
    .quote-status { color: var(--muted); font-size: 11px; }
    .scroller { overflow-x: auto; border: 1px solid var(--border); border-radius: 14px; background: var(--surface); }
    table { width: 100%; min-width: 660px; border-collapse: separate; border-spacing: 0; table-layout: fixed; }
    th, td { min-width: 190px; border-left: 1px solid var(--border); border-top: 1px solid var(--border); padding: 11px; vertical-align: top; text-align: left; line-height: 1.4; }
    tr:first-child th { border-top: 0; }
    th:first-child, td:first-child { position: sticky; left: 0; z-index: 1; min-width: 132px; width: 132px; border-left: 0; background: var(--subtle); color: var(--muted); font-weight: 650; }
    tr:first-child th:first-child { z-index: 3; }
    .product-head { display: grid; gap: 7px; min-height: 100%; background: var(--surface); }
    .product-head.recommended { background: var(--positive-soft); }
    .image { width: 100%; aspect-ratio: 16 / 10; object-fit: contain; border: 1px solid var(--border); border-radius: 9px; background: var(--subtle); }
    .merchant { color: var(--muted); font-size: 11px; }
    .title { font-size: 14px; font-weight: 680; }
    .badge { justify-self: start; border: 1px solid var(--positive); border-radius: 999px; padding: 2px 7px; color: var(--positive); font-size: 10px; font-weight: 680; }
    .price { font-size: 18px; font-weight: 700; }
    .unknown { color: var(--muted); font-style: italic; }
    .warning { color: var(--danger); }
    ul { margin: 0; padding-left: 17px; }
    a { display: inline-flex; justify-content: center; border: 1px solid var(--text); border-radius: 9px; padding: 7px 10px; color: light-dark(#fff, #171717); background: var(--text); text-decoration: none; font-weight: 650; }
    a:focus-visible { outline: 2px solid var(--positive); outline-offset: 2px; }
    .empty { border: 1px solid var(--border); border-radius: 12px; padding: 18px; color: var(--muted); background: var(--surface); }
    @media (max-width: 640px) {
      th, td { min-width: 172px; }
      th:first-child, td:first-child { min-width: 112px; width: 112px; }
    }
  </style>
</head>
<body>
  <main id="app" aria-live="polite"><div class="empty">Loading…</div></main>
  <script>
    const app = document.getElementById("app");
    const pending = new Map();
    let requestId = 0;
    let lastComparisonId;
    const notify = (method, params = {}) => window.parent.postMessage({ jsonrpc: "2.0", method, params }, "*");
    const request = (method, params, timeoutMs = 4000) => new Promise((resolve, reject) => {
      const id = ++requestId;
      const timer = window.setTimeout(() => { pending.delete(id); reject(new Error("timeout")); }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      window.parent.postMessage({ jsonrpc: "2.0", id, method, params }, "*");
    });
    const make = (tag, className, value) => {
      const node = document.createElement(tag);
      if (className) node.className = className;
      if (value !== undefined) node.textContent = String(value);
      return node;
    };
    const structured = (value, depth = 0) => {
      if (!value || typeof value !== "object" || depth > 4) return undefined;
      if (typeof value.status === "string" && Array.isArray(value.entries)) return value;
      for (const key of ["structuredContent", "structured_content", "toolOutput", "toolResult", "toolResponse", "result", "output", "call_tool_result"]) {
        const nested = structured(value[key], depth + 1);
        if (nested) return nested;
      }
      return undefined;
    };
    const comparisonIdFrom = (value, depth = 0) => {
      if (!value || typeof value !== "object" || depth > 4) return undefined;
      if (typeof value.comparisonId === "string") return value.comparisonId;
      for (const key of ["toolInput", "input", "arguments", "globals"]) {
        const nested = comparisonIdFrom(value[key], depth + 1);
        if (nested) return nested;
      }
      return undefined;
    };
    const safeHttps = (value) => {
      try { const url = new URL(String(value)); return url.protocol === "https:" ? url.href : undefined; }
      catch { return undefined; }
    };
    const money = (value, locale) => value && Number.isInteger(value.amountCents) && value.currency === "USD"
      ? new Intl.NumberFormat(locale, { style: "currency", currency: "USD" }).format(value.amountCents / 100)
      : undefined;
    const text = (locale, english, chinese) => locale === "zh-CN" ? chinese : english;
    const displayValue = (value, locale) => {
      if (locale !== "zh-CN") return String(value || "");
      const labels = {
        EXACT: "精确匹配", DISCOVERY_MATCH: "发现匹配", SIMILAR: "相似商品",
        IN_STOCK: "有货", OUT_OF_STOCK: "缺货", UNKNOWN: "未知",
        NEW: "全新", USED: "二手", REFURBISHED: "翻新", OPEN_BOX: "开箱品",
        OFFICIAL: "官方", AUTHORIZED_RETAILER: "授权零售商", ESTABLISHED_RETAILER: "成熟零售商", RISKY: "风险商家",
        INDEPENDENT: "独立验证", UNVERIFIED: "未验证",
        EXACT_MATCH: "精确匹配", BEST_FIT: "最佳匹配", TRUSTED_MERCHANT: "可信商家", LOWER_PRICE: "价格更低", VERIFIED_COUPON: "已验证优惠",
        READY: "已生成", RESEARCH_ONLY: "仅供研究", NO_MATCH: "无匹配", NEEDS_CLARIFICATION: "需要补充信息",
        COUPON: "优惠券", PROMO_CODE: "促销码", BRAND_PROMOTION: "品牌促销",
        ITEM_PRICE: "商品价", DELIVERED_TOTAL: "到手价", CONDITION: "商品状态", AVAILABILITY: "库存", MERCHANT_TRUST: "商家信任"
      };
      return labels[value] || String(value || "");
    };
    const dateTime = (value, locale) => {
      const parsed = typeof value === "string" ? new Date(value) : undefined;
      return parsed && Number.isFinite(parsed.getTime()) ? new Intl.DateTimeFormat(locale, {
        dateStyle: "medium",
        timeStyle: "short"
      }).format(parsed) : undefined;
    };
    const list = (values, locale, emptyEnglish = "Not verified", emptyChinese = "未验证") => {
      if (!Array.isArray(values) || values.length === 0) return make("span", "unknown", text(locale, emptyEnglish, emptyChinese));
      const ul = make("ul");
      values.forEach((value) => ul.append(make("li", "", value)));
      return ul;
    };
    const render = (output) => {
      if (!output || typeof output !== "object") return;
      const locale = output.locale === "zh-CN" ? "zh-CN" : "en-US";
      app.replaceChildren();
      if (output.status !== "OK" || !Array.isArray(output.entries) || output.entries.length < 2) {
        app.append(make("div", "empty warning", output.message || text(locale, "Comparison unavailable.", "对比不可用。")));
        return;
      }
      lastComparisonId = output.comparisonId;
      const basis = output.priceBasis === "DELIVERED_TOTAL"
        ? text(locale, "delivered-total basis", "到手价口径")
        : output.priceBasis === "ITEM_PRICE" ? text(locale, "item-price basis", "商品价口径") : text(locale, "price unavailable", "价格不可用");
      const mode = output.mode === "SAME_PRODUCT_OFFERS"
        ? text(locale, "same-product offers", "同款报价")
        : text(locale, "different product choices", "不同商品选择");
      const summary = [output.message, mode, basis];
      const evaluatedAt = dateTime(output.evaluatedAt, locale);
      const expiresAt = dateTime(output.expiresAt, locale);
      if (evaluatedAt) summary.push(text(locale, "Checked: " + evaluatedAt, "检查时间：" + evaluatedAt));
      if (expiresAt) summary.push(text(locale, "Expires: " + expiresAt, "失效时间：" + expiresAt));
      const spread = money(output.priceDelta && {
        amountCents: output.priceDelta.amountCents,
        currency: output.priceDelta.currency
      }, locale);
      if (spread) {
        const lowest = output.entries.find((entry) => entry.selectionId === output.priceDelta.lowestSelectionId)?.title;
        const highest = output.entries.find((entry) => entry.selectionId === output.priceDelta.highestSelectionId)?.title;
        const range = lowest && highest ? " (" + lowest + " / " + highest + ")" : "";
        summary.push(text(locale, "Price spread: " + spread + range, "价差：" + spread + range));
      }
      app.append(make("div", "summary", summary.join(" · ")));
      const canQuote = output.entries.length <= 4 &&
        output.entries.some((entry) => entry.deliveredTotalStatus === "NOT_QUOTED") &&
        output.entries.every((entry) => entry.deliveredTotalStatus !== "MERCHANT_CHECKOUT_ONLY" && typeof entry.selectionId === "string");
      if (canQuote) {
        const quoteAction = make("section", "quote-action");
        const field = make("label", "quote-field", text(locale, "US delivery ZIP", "美国配送 ZIP"));
        const zipInput = make("input");
        zipInput.type = "text";
        zipInput.inputMode = "numeric";
        zipInput.maxLength = 10;
        zipInput.placeholder = "12345";
        field.append(zipInput);
        const quoteButton = make("button", "", text(locale, "Quote delivered totals", "查询到手价"));
        quoteButton.type = "button";
        const quoteStatus = make("span", "quote-status", text(locale, "Uses these same compared products.", "使用当前对比中的同一批商品。"));
        quoteButton.addEventListener("click", () => {
          const zipCode = String(zipInput.value || "").trim();
          if (!/^\d{5}(?:-\d{4})?$/u.test(zipCode)) {
            quoteStatus.textContent = text(locale, "Enter a valid US ZIP.", "请输入有效的美国 ZIP。");
            return;
          }
          quoteButton.disabled = true;
          quoteStatus.textContent = text(locale, "Quoting delivered totals…", "正在查询到手价…");
          request("tools/call", {
            name: "quote_and_compare_selected_products",
            arguments: {
              renderId: output.renderId,
              selectionIds: output.entries.map((entry) => entry.selectionId),
              zipCode,
              mode: "AUTO",
              focus: ["DELIVERED_TOTAL"],
              responseLocale: locale
            }
          }, 8000).then((result) => {
            const comparison = structured(result);
            if (!comparison) throw new Error("quote result unavailable");
            render(comparison);
          }).catch(() => {
            quoteButton.disabled = false;
            quoteStatus.textContent = text(locale, "Quote failed. Try once more.", "报价加载失败，请重试一次。");
          });
        });
        quoteAction.append(field, quoteButton, quoteStatus);
        app.append(quoteAction);
      }
      const scroller = make("div", "scroller");
      const table = make("table");
      table.setAttribute("aria-label", text(locale, "Product comparison", "商品对比"));
      const header = make("tr");
      header.append(make("th", "", text(locale, "Product", "商品")));
      output.entries.forEach((entry) => {
        const cell = make("th");
        const head = make("div", "product-head" + (output.recommendation?.recommendedSelectionId === entry.selectionId ? " recommended" : ""));
        if (output.recommendation?.recommendedSelectionId === entry.selectionId) head.append(make("span", "badge", text(locale, "Recommended", "推荐")));
        const imageUrl = safeHttps(entry.imageUrl);
        if (imageUrl) { const image = make("img", "image"); image.src = imageUrl; image.alt = entry.title; image.loading = "lazy"; head.append(image); }
        const merchant = entry.sellerName ? entry.merchant + " · " + entry.sellerName : entry.merchant;
        head.append(make("div", "merchant", merchant), make("div", "title", entry.title));
        const url = safeHttps(entry.purchaseUrl);
        if (url) { const link = make("a", "", text(locale, "View at merchant", "前往商家页面")); link.href = url; link.target = "_blank"; link.rel = "noopener noreferrer"; head.append(link); }
        cell.append(head);
        header.append(cell);
      });
      table.append(header);
      const deal = (entry) => list(entry.verifiedDeals?.map((offer) => {
        const details = [displayValue(offer.kind, locale), offer.title].filter(Boolean);
        if (offer.code) details.push(text(locale, "code " + offer.code, "优惠码 " + offer.code));
        if (Number.isFinite(offer.discountPercent)) details.push(String(offer.discountPercent) + "%");
        const amount = money(offer.discountAmount, locale);
        if (amount) details.push(text(locale, amount + " off", "减免 " + amount));
        details.push(offer.productApplicability === "PRODUCT_CONFIRMED"
          ? text(locale, "confirmed for this product", "已确认适用于此商品")
          : offer.productApplicability === "MERCHANT_WIDE"
            ? text(locale, "merchant offer; product eligibility requires confirmation", "商家优惠；商品适用性待确认")
            : text(locale, "product eligibility unconfirmed", "商品适用性未确认"));
        const validTo = dateTime(offer.validTo, locale) || offer.validTo;
        if (validTo) details.push(text(locale, "valid to " + validTo, "有效期至 " + validTo));
        return details.join(" · ");
      }), locale, "No verified deal", "暂无已验证优惠");
      const recommendation = (entry) => {
        const decision = output.recommendation;
        if (!decision) return make("span", "unknown", text(locale, "Unavailable", "不可用"));
        if (decision.recommendedSelectionId !== entry.selectionId) {
          return make("span", "unknown", decision.state === "READY" ? text(locale, "Not selected", "未选中") : displayValue(decision.state, locale));
        }
        const reasons = Array.isArray(decision.reasonCodes) ? decision.reasonCodes.map((reason) => displayValue(reason, locale)).join(", ") : "";
        return make("span", "", text(locale, "Recommended", "推荐") + (reasons ? " · " + reasons : ""));
      };
      const rows = [
        { focus: undefined, label: text(locale, "Recommendation", "推荐结论"), renderValue: recommendation },
        { focus: "PRICE", label: text(locale, "Compared price", "对比价格"), renderValue: (entry) => make("span", entry.comparedPrice ? "price" : "unknown", money(entry.comparedPrice, locale) || text(locale, "Unavailable", "不可用")) },
        { focus: "PRICE", label: text(locale, "Item price", "商品价"), renderValue: (entry) => make("span", entry.itemPrice ? "" : "unknown", money(entry.itemPrice, locale) || text(locale, "Unknown", "未知")) },
        { focus: "DELIVERED_TOTAL", label: text(locale, "Delivered total", "到手价"), renderValue: (entry) => {
          const value = money(entry.deliveredTotal, locale);
          const expiry = dateTime(entry.deliveredTotalExpiresAt, locale);
          return make("span", value ? "" : "unknown", value
            ? value + (expiry ? text(locale, " · valid until " + expiry, " · 有效期至 " + expiry) : "")
            : entry.deliveredTotalStatus === "MERCHANT_CHECKOUT_ONLY"
              ? text(locale, "Quote unsupported: merchant checkout only", "不支持报价：仅商家结账页提供")
              : text(locale, "Not quoted: provide ZIP", "未报价：请提供 ZIP"));
        } },
        { focus: "DEALS", label: text(locale, "Verified deals", "已验证优惠"), renderValue: deal },
        { focus: "AVAILABILITY", label: text(locale, "Availability", "库存"), renderValue: (entry) => make("span", entry.availability === "UNKNOWN" ? "unknown" : "", displayValue(entry.availability, locale)) },
        { focus: "CONDITION", label: text(locale, "Condition", "商品状态"), renderValue: (entry) => make("span", entry.condition === "UNKNOWN" ? "unknown" : "", displayValue(entry.condition, locale)) },
        { focus: "MERCHANT_TRUST", label: text(locale, "Merchant trust", "商家信任"), renderValue: (entry) => make("span", entry.merchantTrust?.verification === "UNVERIFIED" ? "unknown" : "", displayValue(entry.merchantTrust?.level || "UNKNOWN", locale) + " · " + displayValue(entry.merchantTrust?.verification || "UNVERIFIED", locale)) },
        { focus: "IDENTITY", label: text(locale, "Match status", "匹配状态"), renderValue: (entry) => make("span", "", displayValue(entry.matchStatus, locale)) },
        { focus: "IDENTITY", label: text(locale, "Product identity", "商品身份"), renderValue: (entry) => list([
          entry.brand && text(locale, "Brand: ", "品牌：") + entry.brand,
          entry.sku && "SKU: " + entry.sku,
          ...(Array.isArray(entry.gtins) ? entry.gtins.map((gtin) => "GTIN: " + gtin) : [])
        ].filter(Boolean), locale) },
        { focus: "IDENTITY", label: text(locale, "Variant", "规格"), renderValue: (entry) => list(Object.entries(entry.variantDimensions || {}).map(([key, value]) => key + ": " + value), locale, "Not specified", "未提供") },
        { focus: "IDENTITY", label: text(locale, "Identity evidence", "身份依据"), renderValue: (entry) => list(entry.identityEvidence, locale) },
        { focus: "REQUIREMENTS", label: text(locale, "Required features", "必需功能"), renderValue: (entry) => list(entry.requirementEvidence, locale, "None recorded", "无记录") },
        { focus: "PREFERENCES", label: text(locale, "Preference fit", "偏好匹配"), renderValue: (entry) => list(entry.preferenceEvidence, locale, "None recorded", "无记录") },
        { focus: "REQUIREMENTS", label: text(locale, "Limitations", "限制"), renderValue: (entry) => list(entry.limitations, locale, "None known", "暂无已知限制") },
        { focus: undefined, label: text(locale, "Unknowns", "未知项"), renderValue: (entry) => list(Array.isArray(entry.unknowns) ? entry.unknowns.map((value) => displayValue(value, locale)) : [], locale, "None", "无") },
        { focus: undefined, label: text(locale, "Checked", "检查时间"), renderValue: (entry) => make("time", "", entry.checkedAt) }
      ];
      const focusOrder = new Map((Array.isArray(output.focus) ? output.focus : []).map((value, index) => [value, index]));
      rows.forEach((row, index) => { row.order = index; });
      rows.sort((left, right) =>
        (focusOrder.get(left.focus) ?? focusOrder.size) - (focusOrder.get(right.focus) ?? focusOrder.size) || left.order - right.order
      );
      rows.forEach(({ label, renderValue }) => {
        const row = make("tr");
        row.append(make("th", "", label));
        output.entries.forEach((entry) => { const cell = make("td"); cell.append(renderValue(entry)); row.append(cell); });
        table.append(row);
      });
      scroller.append(table);
      app.append(scroller);
      notify("ui/notifications/size-changed", { height: document.documentElement.scrollHeight });
    };
    const receive = (value) => {
      const output = structured(value);
      if (output) render(output);
      const comparisonId = comparisonIdFrom(value);
      if (!output && comparisonId && comparisonId !== lastComparisonId) {
        request("tools/call", { name: "render_product_comparison", arguments: { comparisonId } })
          .then((result) => render(structured(result))).catch(() => undefined);
      }
    };
    window.addEventListener("message", (event) => {
      if (event.source !== window.parent) return;
      const message = event.data;
      if (!message || message.jsonrpc !== "2.0") return;
      if (message.id !== undefined && pending.has(message.id)) {
        const state = pending.get(message.id); pending.delete(message.id); window.clearTimeout(state.timer);
        if (message.error) state.reject(message.error); else state.resolve(message.result);
        return;
      }
      if (message.method === "ui/notifications/tool-result" || message.method === "ui/notifications/tool-input") receive(message.params);
    }, { passive: true });
    window.addEventListener("openai:set_globals", (event) => receive(event.detail?.globals));
    if (window.openai) receive(window.openai);
    request("ui/initialize", {
      protocolVersion: "2026-01-26",
      appInfo: { name: "FindCheap product comparison", version: "${FINDCHEAP_VERSION}" },
      appCapabilities: { availableDisplayModes: ["inline"] }
    }).then(() => notify("ui/notifications/initialized")).catch(() => undefined);
  </script>
</body>
</html>`;
