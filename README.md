# Shopping Agent

AI shopping comparison entry for US consumers and an initial set of 10–20 US merchants.

The approved product specification and implementation plans live under `docs/superpowers/`.

Current merchant status: **0 merchants are enabled**. Commerce API and Codex MCP results are
served only from fresh, exact, audit-promoted Commerce records. Staging records, similar-item
matches, expired prices, and quotes for another ZIP or membership context are never presented as
exact comparisons. The product does not order, check out, or submit payment.

See `docs/product/commerce-api-runbook.md` for deployment configuration.

