# Merchant Audit Runbook

No merchant can be selected for build until an auditor records the evidence below and updates the catalog. A high score does not override access controls, merchant terms, or missing legal approval.

## Required audit record

For each candidate, record:

- Official or affiliate data-path proof URL and the permitted source type.
- Legal review decision and the affiliate/deep-link state.
- A 100-SKU sample for identity-field completeness.
- ZIP quote capability, shipping, tax, coupon, and membership-price semantics.
- Login, CAPTCHA, robots, and other access-control constraints.
- Expected maintenance hours per month and known failure modes.

Reject any merchant that requires bypassing a login, CAPTCHA, robots rule, access control, or merchant terms, regardless of score. Do not enter an allowed host, source, approval, or evidence that has not been verified.

## Scoring

Score every dimension from 0 to 1. The weighted score is data × 25 + identity × 20 + price and ZIP × 15 + legal × 15 + stability × 10 + coverage × 10 + maintenance × 5.

## Selection gate

`pnpm merchants:score -- --catalog config/merchants/catalog.yaml` selects a merchant only when all of the following are true:

- `auditState` is `approved`.
- `legalReview` is `approved`.
- A proven source is recorded.
- At least one allowed HTTPS host is recorded.
- Identity completeness is at least 0.90.
- Weighted score is at least 70.

The seed catalog deliberately selects zero merchants. It is a candidate universe, not a claim of approval or data authorization.

## Enabled merchant gate

`pnpm merchants:gate -- --minimum 10` remains intentionally blocked until external audit inputs are complete. For each real merchant, add only verified configuration in `config/merchants/enabled/<merchant-id>.yaml` and a corresponding decision record in `docs/product/merchant-decisions/<merchant-id>.md`.

Each decision record must contain these exact headings, then end with nonblank `Reviewer:` and ISO `Date:` fields under `## Approval signatures and date`:

- `## Data authorization and terms evidence`
- `## Affiliate/deep-link status`
- `## Source PoC and allowed hosts`
- `## 100-SKU identity completeness sample`
- `## ZIP, shipping, tax, Coupon, and membership behavior`
- `## Maintenance and failure risks`
- `## Approval signatures and date`

The gate rejects inline secrets, unknown configuration fields, path escapes, symlinked files, duplicate merchant configurations, unaudited catalog entries, and missing decision records. It performs no merchant network proof-of-concept; authorization, terms, affiliate status, source evidence, and 100-SKU sampling remain external human audit inputs.
