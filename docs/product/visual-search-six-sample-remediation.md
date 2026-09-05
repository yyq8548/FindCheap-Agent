# Six-sample visual-search remediation

User approved implementation and local verification on 2026-09-04. No commit, push,
deployment, registry publication, or installed-plugin replacement is authorized.
Preserve the previous dirty worktree and immutable selection/executor safeguards.

## Baseline and scope

The local six-image development trial returned the target product/colorway for 0/6
unbranded and 1/6 branded searches, with 67 image presentations. Direct official URL
reads succeeded for 2/6; four unsupported source records were not requested. These
are development cases, not unseen or human-calibrated acceptance evidence. Reference
images, raw captures and ground truth remain gitignored and are not committed.

Baseline bundle SHA256: cbff03002241f430f66dcaf764a193d3b7e711fcaa02713a49f94d13260e9526.
Local backup: artifacts/pdf-six-fix/baseline/.

## Work packages

1. Add failing regressions and bounded stage fingerprints: normalized provider records,
   eligible records, review pool, per-round image loads/dedup/reviews, final cards.
2. Preserve decisive visible patterns/palette/structure in both queries. Resolve local
   occlusion without accepting hidden, inferred or low-confidence attributes as proof.
3. Rank the relevant colorway before diversity. Deduplicate identical product/image
   content across rounds, retain accepted results and separate generic lookalikes
   from possible same items. Keep different merchants' facts independent.
4. Use existing official adapters with audited source capabilities. Add a bounded,
   persistent reviewed-official catalog adapter for unbranded searches, not a URL-only
   interface or an answer-seeded six-product index. Explicitly report unsupported or
   unpopulated coverage; source trust approval remains a separate human decision.
5. Select a sellable same-colorway variant only when size/variant is not explicitly
   constrained. Preserve explicit selections. Report real recommendation blockers,
   cumulative review counts and mixed failure reasons in the request language.
6. Run component, workflow, security, bundle and real-image development regressions.
   Preserve the original independent acceptance thresholds and release boundary.

## Invariants and gates

- At most two review rounds, six plus three displayed images, twelve image requests,
  sixteen catalog operations, thirty seconds active I/O, and 400,000 Base64 characters
  per returned batch. Duplicate downloads still consume their actual network budget.
- No arbitrary host/redirect expansion, hosted vision model, vector database, paid
  service, unrestricted crawler, unattended visual model loop, or Awin ingestion rewrite.
- No visual-generated EXACT, merchant trust, prices, coupon entitlement or cross-snapshot
  IDs; no source facts merged solely because two merchant images look identical.
- Typecheck, lint, full tests, MCP/Awin builds and bundled stdio checks must pass.
- Six-image tests retain frozen unbranded/branded observations, with target names/URLs
  available to the scorer only. Known-URL diagnostics remain separate.
- Independent acceptance still requires at least forty human-confirmed images with
  style-family separation and fixed pre-run support denominator: pool recall >=95%,
  final top-three recall >=90%, displayed precision >=95%, and zero identity/safety
  invariant failures. Also report whole-sample end-to-end coverage. Do not move failed
  sources out of the denominator after a run or claim these gates from six tuned cases.

If the larger corpus or reviewed source approval is absent, finish independently
testable code and explicitly report the remaining acceptance/coverage limitation.
Publication requires separate authorization and a validated previous-bundle rollback.

## Local implementation checkpoint

The six code packages have been implemented and automatically checked. Subsequent
independent review also repaired stale size evidence, bare-PDP variant locking,
cross-color ProductGroup size summaries, and official-cache queue starvation.
Final suite: 869 tests passed; typecheck, lint, both builds, stdio and diff checks passed.

Actual finding acceptance is **not achieved**: the final 12 development runs completed
72 image reviews without timeout, exhausted budget or duplicate product images, but
only 0/6 unbranded and 1/6 branded targets were returned. Reviewed-source approval,
broader independent catalog population, unresolved target/colorway recall and the
deferred larger held-out corpus remain explicit limitations, not passing items.
See `docs/testing/visual-search-six-sample-remediation-results.md` for evidence.
