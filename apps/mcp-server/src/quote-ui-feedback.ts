// Host consent: 20s; parallel provider quotes: at most 5s; bounded bridge slack.
// A UI deadline does not certify cancellation of an authorized external write.
export const QUOTE_UI_FEEDBACK_SCRIPT = String.raw`
    const QUOTE_UI_TIMEOUT_MS = 35000;
    const quoteErrorCode = (value, depth = 0) => {
      if (!value || typeof value !== "object" || depth > 4) return undefined;
      if (value.isError === true) {
        const text = Array.isArray(value.content) ? value.content.filter(item => item.type === "text")
          .slice(0, 3).map(item => String(item.text || "").slice(0, 2000)).join(" ") : "";
        return text.match(/\[(QUOTE_[A-Z_]+|PERMISSION_DENIED|MISSING_REFERENCE_CONTEXT|REFERENCE_EXPIRED|REFERENCE_STATE_UNAVAILABLE)\]/u)?.[1]
          || "UNKNOWN";
      }
      for (const key of ["toolResult", "toolResponse", "result", "output", "call_tool_result"]) {
        const code = quoteErrorCode(value[key], depth + 1);
        if (code) return code;
      }
      return undefined;
    };
    const quoteFailureText = (failure, locale) => {
      const code = quoteErrorCode(failure) || "UNKNOWN";
      const zh = locale === "zh-CN";
      const preserved = zh ? " 原有商品与选择保持不变。" : " Original products and selections are unchanged.";
      if (["QUOTE_AUTHORIZATION_DECLINED", "PERMISSION_DENIED"].includes(code)) return (zh
        ? "宿主未授予本次报价权限；无法确认弹窗是否显示。本次报价未完成，请先确认宿主授权状态，不要重复点击。"
        : "The host did not grant quote permission; whether a prompt appeared is unknown. Check host authorization before another request.") + preserved;
      if (code === "QUOTE_AUTHORIZATION_UNAVAILABLE") return (zh
        ? "报价授权不可用或未完成；未创建报价购物车。请先确认宿主是否支持授权。"
        : "Quote authorization is unavailable or incomplete; no quote Cart was created. Check host authorization support.") + preserved;
      if (code === "QUOTE_AUTHORIZATION_CANCELLED") return (zh
        ? "本次报价授权已取消；未创建报价购物车。"
        : "Quote authorization was cancelled; no quote Cart was created.") + preserved;
      if (["MISSING_REFERENCE_CONTEXT", "REFERENCE_EXPIRED", "REFERENCE_STATE_UNAVAILABLE", "QUOTE_REFERENCE_CHANGED",
        "QUOTE_REFERENCE_EXPIRED", "QUOTE_REFERENCE_UNAVAILABLE", "QUOTE_SELECTION_NOT_SYNCED", "QUOTE_SELECTION_EMPTY"].includes(code)) return (zh
        ? "原商品引用或选择记录已失效／未同步；未请求报价。请在对话中恢复原比较并核对选择。"
        : "The original product reference or selection is unavailable, expired or unsynced; no quote was requested. Restore the original comparison and verify its selection in chat.") + preserved;
      if (code === "QUOTE_MERCHANT_UNVERIFIED") return (zh
        ? "所选商家尚未通过独立可信审核；未请求授权或创建报价购物车。"
        : "The selected merchant has not passed independent trust review; no approval was requested and no quote Cart was created.") + preserved;
      if (code === "QUOTE_CAPABILITY_NOT_CHECKED") return (zh
        ? "所选商品的报价能力尚未核验；未请求授权或创建报价购物车。"
        : "The selected product's quote capability is not yet verified; no approval was requested and no quote Cart was created.") + preserved;
      if (["QUOTE_TARGET_UNVERIFIED", "QUOTE_UNSUPPORTED"].includes(code)) return (zh
        ? "所选商品尚未通过报价资格核验，不支持本次报价；未创建报价购物车。请在商家页面确认总价。"
        : "The selected products have not passed quote eligibility checks; this quote is unsupported and no quote Cart was created. Confirm totals at the merchant.") + preserved;
      return (zh ? "报价结果尚不确定。先前授权的临时匿名购物车可能已创建；请在对话中核对结果，不要重复点击。"
        : "Quote outcome is unknown. A previously authorized temporary anonymous Cart may have been created; check the outcome in chat before another request.") + preserved;
    };
    const quoteMatchesSelection = (comparison, original) => comparison?.status === "OK" &&
      comparison.renderId === original.renderId && Array.isArray(comparison.entries) &&
      comparison.entries.length === original.entries.length && comparison.entries.every((entry, index) =>
        entry.selectionId === original.entries[index].selectionId);
`;
