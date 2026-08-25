# Affiliate-ready purchase links

FindCheap Agent v0.4.0 ships with zero approved affiliate relationships. Every product card therefore
uses its validated canonical merchant URL until approval is recorded and a runtime campaign credential
is available.

## Activation requirements

For one merchant, add exactly one relationship to
`config/shopify/affiliate-registry.ts`. The relationship must include:

- the existing Shopify registry `merchantId`;
- literal status `APPROVED`, added only after human approval;
- the affiliate provider name;
- an exact credential-free HTTPS affiliate origin;
- a fixed template containing both `{campaignId}` and `{merchantUrl}` outside the URL authority;
- the environment-variable name containing the campaign identifier.

Do not commit campaign identifiers, tokens, cookies, commission rates, or account data. The runtime
encodes template values once, enforces the approved origin, and falls back to the canonical merchant
URL when the campaign environment variable is absent, blank, oversized, or the merchant has no
approved relationship.

## Public behavior

- `CANONICAL`: direct merchant URL; no affiliate claim or disclosure.
- `APPROVED_AFFILIATE`: approved deep link plus the required nearby disclosure.
- Commission amount is never inferred or exposed.
- Affiliate configuration is applied after product matching and ranking.
- Checkout, payment, cart mutation, and account access remain unavailable.

## Release checks

Run Node 24:

```text
pnpm test
pnpm typecheck
pnpm lint
pnpm build:mcp
git diff --exit-code -- plugins/findcheap-agent/dist/mcp-server.js plugins/findcheap-agent/dist/mcp-server.meta.json plugins/findcheap-agent/THIRD_PARTY_NOTICES.md
```

Before activating a real relationship, also verify the provider's current terms, disclosure wording,
deep-link format, destination host behavior, and attribution test result. Approval evidence remains a
human review input; technical configuration does not create approval.
