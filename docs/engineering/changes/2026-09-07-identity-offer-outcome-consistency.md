# Identity, offer and outcome consistency

## Research

Baseline: runtime 0.17.29, HEAD 0f2368ae3dd429a6633328d2232057e3afe9b695. The working tree was clean.

The active path is MCP executor, existing Backend/source ports, candidate assessment,
presentation selection, immutable result snapshot, cards and comparison. The archived
commercial platform is not an active dependency. No database or transport changes are
required. The approved Agent design remains authoritative.

Observed defects:

- `hasStrongProductIdentifier` accepts `155g` as a model. Catalog then promotes a
  discovery match to EXACT without binding the request to the Catalog identifier.
- Local candidate assessment and source card status can disagree. Ranking permits
  an unresolved known-product candidate to become the primary recommendation.
- Catalog and official discovery assign different source references to the same
  medicube merchant URL and selected variant. Source references are appropriate for
  snapshot selection, but not for counting distinct offers.
- Final text and comparison counts reuse provider-level evidence after filtering.
  A missing second comparable merchant produces zero-result wording despite cards.

The original medicube request returns Mild candidates. Its stated 70 pads / 155 g
matches Mild page copy, but does not establish that the user's original item is Mild.
Source labels, merchant trust, and a package weight are not identity proof.

## Propose

A. Patch each provider, ranking function and message independently. Lower initial
cost, but preserves duplicate identity rules and inconsistent result semantics.

B. Add small shared assessment helpers inside the existing pipeline. Separate
request identity, stable same-product evidence, offer equivalence and source
references. Derive final outcome counts from final cards. Moderate cross-module
cost, no Backend rewrite or new service. The user approved B.

## Frozen Plan

1. Add failing identity tests. Separate measurements from model identifiers. Remove
   unbound Catalog EXACT promotion. Assess named requests against primary product
   fields; unrequested edition qualifiers remain unresolved. Explicitly requested
   editions can qualify without claiming a stable cross-merchant identity.
   Run affected assertions and `pnpm build:mcp`.
2. Propagate request identity and assessed match status through candidates, ranking
   and cards. Unresolved exact requests remain research-only. Category discovery
   and reviewed visual similarity retain their existing policies. Add blocker text
   and regression assertions; run local tests and `pnpm build:mcp`.
3. Deduplicate proven equivalent offers before presentation limits. Keep original
   source references and complete source observations; never combine one source's
   price with another source's stock. Exact HTTPS merchant product URL plus bound
   variant is the initial supported equivalence proof. Unknown URL shapes fail
   closed. Distinct merchants, variants, known conditions and quantities do not
   merge. Preserve historical snapshots and selection/quote authorization.
   Run local assertions and `pnpm build:mcp`.
4. Derive final merchant/offer counts and comparison evidence from final products.
   Use a single final outcome helper for result text and fallback explanation.
   Incomplete merchant coverage must not claim that no product was found. Preserve
   public tool inputs and immutable snapshot behavior. Run local assertions and build.
5. Add cross-module regression coverage for the observed medicube case and consumers.
   Run typecheck, lint, MCP build, full default automated suite, stdio smoke and diff
   checks. Attempt bounded read-only live verification separately from fixtures.
   Update this record with actual results and the design implementation status.

## Acceptance and limits

- Measurements alone never establish EXACT identity.
- Unspecified Mild stays unresolved; explicit Mild is not blanket-excluded.
- One proven merchant/variant offer produces one card, with atomic facts retained.
- Different variants and merchants remain separate; old source IDs are not rewritten.
- Primary recommendation, match badges, counts and recovery text agree.
- Selection, comparison, coupons and quote guards pass regression tests.
- No local catalog, persistence policy change, Watch creation, purchase or payment.
- No version bump, commit, push, deployment or installed-cache replacement in this task.
- Mock assertions do not certify original-image identity or general visual accuracy.
- Database integration is not required because database contracts remain unchanged.

## Implementation and verification

### Local implementation

1. Identifier/Catalog module: the initial regression produced seven failures
   (six measurement cases and the shared-UPID edition case). Removed the unbound
   EXACT promotion and excluded measurements from model recognition. The existing
   Sony title-only Catalog test was corrected: title overlap is discovery evidence,
   not a bound UPID. The 44 local assertions and MCP build passed. Five additional
   attached-unit cases subsequently failed first and passed after expanding the
   same bounded measurement vocabulary.
2. Request identity: added `requestIdentityStatus` independently of `matchStatus`.
   Primary-field name confirmation is not stable cross-merchant identity. A bounded
   edition vocabulary prevents unspecified Mild/Pro/etc. from silently qualifying.
   Unknown identity blocks the primary recommendation and travels through cards,
   model context, comparison and selected-variant inspection. The explicit-Mild
   fixture exposed the official storefront's internal vendor name; only the exact
   independently reviewed official host supplies the fallback brand evidence.
   The 79 local assertions, MCP build and typecheck passed at this stage.
3. Offer equivalence: added a pure helper for a validated HTTPS `/products/slug`
   URL with one numeric, source-bound variant. A small tracking-parameter allowlist
   does not affect identity; unknown parameters and unsupported URLs do not merge.
   Distinct images remain reviewable before final presentation grouping. Complete
   source observations stay private; the latest complete observation wins, with
   direct-page evidence breaking a timestamp tie. No price/stock field splicing.
   Eleven new equivalence cases plus reference/ranking tests passed (41 total),
   followed by the MCP build and typecheck.
4. Final outcome: stale upstream merchant/offer counters and READY/zero-result
   wording failed the new MCP assertions. Final cards now own comparison counts,
   primary selection and fallback explanation. Identity-pending results have an
   explicit recovery reason and awaiting-verification count. One source domain
   cannot count as multiple merchants because provider IDs differ. A second
   merchant does not complete same-product comparison without stable identity,
   configuration and condition evidence. Local assertions and MCP build passed.
5. Consumer contracts: selection, comparison, historical rendering and inspection
   retain identity status. A new badge assertion exposed an inspection result
   reusing source EXACT; reclassification now updates both badge and evidence.
   The public entrypoints reject unauthorized quoting as before. Consumer-local
   32 assertions and MCP build passed. Existing coupon/reference and quote suites
   remain included in the final full gate.

### Facts discovered inside the frozen comparison step

The Sony recovery fixture carries `brand + mpn`, while the old value/comparison
helper only recognized `brand + sku`. Keeping that behavior would make recovery
and comparison disagree. Options were (a) keep counting domains and claim success
without stable identity, or (b) retain the already typed MPN across output schemas
and reuse it in the existing same-product predicate. Chose (b), within steps 2/4:
no model-name inference, no SKU-to-MPN conversion, and explicit MPN conflicts fail
closed. Added a failing MPN assertion; all 27 related assertions and MCP build
then passed. No business rule or permission expansion was introduced.

### Final verification, 2026-09-07

Final runtime artifact remains an unpublished change on 0.17.29. Bundle SHA-256:
`3ece2053dca7b4bbf2316594fb49af4d6e087bc8b11fa0e3ba7da1506ac95dd3`.

- `pnpm build:mcp`: passed; bundle and provenance/notices regenerated.
- `pnpm typecheck`: passed.
- `pnpm lint`: passed after correcting type-only imports and the diagnostic script's URL import.
- `pnpm test`: 132 files, 1,912 assertions passed on the final runtime; includes
  stdio smoke, source adapters, selection, comparison, coupons, quote authorization,
  visual policies and network-security regressions.
- `node apps/mcp-server/scripts/qa-identity-offer.mjs --live`: three development
  cases and 26 checks passed against actual source endpoints through the local
  stdio bundle. An empty temporary state directory was used and removed.
- Documentation validation: 47 local links, required protocol sections and the
  recorded bundle hash passed. `git diff --check` passed.

Live observations:

| Frozen request | Observed result | Decision |
| --- | --- | --- |
| Original medicube / 70 pads / 155 g, no edition | Two cards from two domains; duplicate medicube official/Catalog offer merged | RESEARCH_ONLY, IDENTITY_UNVERIFIED, two awaiting verification; no EXACT Mild claim |
| Explicit medicube Mild / 70 pads / 155 g | Official Mild candidate remains usable | READY for the official candidate; same-product merchant comparison remains incomplete |
| Sony WH-1000XM6 | Three distinct cards; official exact model retained | READY for the official model; other variant/bundle research does not complete the comparison |

### Remaining boundaries and release status

This fixes the observed identity, duplicate-offer and result-consistency defects.
It does not establish that the original photograph depicts Mild. Request-name
confirmation does not prove original-image identity. Arbitrary merchant URL
formats, every possible edition alias and complete catalog coverage are not
claimed; unsupported equivalence remains separate rather than guessed.

Native Codex UI, actual approval dialogs, independent image samples and full
lifecycle acceptance were not run. Default tests exclude database integration;
database contracts were unchanged, and no production database test was executed.
No commit, push, version bump, Railway deployment or installed-cache replacement
was performed. No user shopping history or Watch policy was changed.

### Subsequent authorized release

After the implementation report, Chris separately authorized publication and
post-install replay. [v0.17.30 release evidence](../../releases/v0.17.30.md)
records commit/push, Railway production, installed-cache verification and the
three-case / 26-assertion replay. The earlier unpublished status above describes
the completed implementation turn, not the later release state. Original-photo
identity and complete cross-merchant comparison remain unaccepted.
