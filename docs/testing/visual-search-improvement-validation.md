# Visual-search improvement: local validation

Date: 2026-09-04. Baseline: v0.17.12, `9a6fc1c39fd1dda5f486c87e8a737e164ecb8049`.
Scope: approved six-package implementation, local builds and regression. No version
bump, commit, push, Railway deployment, GitHub release or Codex installed-cache replacement.

## Implemented

1. Source/merchant/variant-scoped product references throughout cards, selections,
   inspection, quotes, comparisons and deals. Ambiguous legacy references fail closed.
2. Shared visible/confident/non-inferred visual-evidence policy, structural matching
   thresholds and server-owned visual ranking before price. No visual EXACT promotion.
3. Reliable visual anchors across providers, early parallel official retrieval,
   retained partial successes, verified official product links and bounded same-run cache.
4. Original-pool-first recovery, retained first-round matches, cross-round product
   deduplication, fresh review IDs, bounded two-round review and honest truncation status.
5. Approved CDN resize, isolated JPEG/PNG processing, WebP container/dimension checks,
   EXIF orientation, bounded/cancellable worker queue and transport-level byte limits.
6. Safe trace and hashed product/image provenance, recorded-real-image evaluation CLI,
   manifest format and guards against incomplete, synthetic or cross-session evidence.

The plan checklist is in `docs/product/visual-search-improvement-plan.md`.

## Verified locally

- Baseline: 60 files / 667 tests passed before implementation.
- Final full suite: 66 files / **778 tests passed**, zero failures.
- `pnpm typecheck` and `pnpm lint`: passed.
- `pnpm build:mcp` and `pnpm build:awin-feed`: passed.
- `pnpm test:mcp-stdio`: 3/3 passed against the rebuilt plugin bundle.
- Rebuilding MCP preserves all five bundle/worker/metafile/notices SHA-256 hashes.
- Worker tests include operation outside the workspace without node_modules,
  six concurrent real JPEGs, queue cancellation/overflow, eight EXIF orientations,
  image size/pixel/output bounds, unsupported formats and transport cancellation.
- `pnpm install --frozen-lockfile --ignore-scripts`: passed.
- `git diff --check`: passed. GitHub CI itself was not run; nothing was pushed.

Regression fixtures use synthetic source records and verdicts. Existing sanitized
conversation 01a06df9 arguments remain unchanged. Tests now account for stronger
first-pass retrieval, explicit additional reference observations and original-pool
recovery instead of depending on obsolete query wording or unnecessary source calls.
These are workflow tests, not model-vision accuracy measurements.

## Dependency audit

The audit found four existing high-severity `fast-uri` advisories and two existing
moderate `qs` advisories in transitive MCP SDK dependencies. Compatible security
versions are pinned in `pnpm-workspace.yaml`: `fast-uri@3.1.6`, `qs@6.16.0`.
After rebuild and full regression, `pnpm audit --prod --audit-level high` reported
**No known vulnerabilities found**. This is an advisory-database result, not a
guarantee that the application has no vulnerabilities.

New image dependencies are pinned pure-JavaScript `jpeg-js@0.4.4` and `pngjs@7.0.0`.
No native installation or hosted vision service was added.

## Explicitly deferred by the owner

The 40-image real acceptance corpus, frozen held-out labels, paired with/without-brand
baseline/candidate runs, and actual accuracy comparison have **not** been executed.
The example manifest correctly reports `INCOMPLETE`; its zero counts are not accuracy
measurements. See `docs/testing/visual-search-evaluation.md` for the resumption procedure.

Thus the 95% candidate recall, 90% top-three recall and 95% visual precision gates are
**not verified**. No live upstream availability or production deployment health claim
is made by this validation.

## Limits and later release requirements

Retained limits: 12 candidate-image requests, 16 catalog operations and 30 seconds
active I/O per search; at most six first-round plus three second-round images and
400,000 Base64 characters per returned batch. Image processing is bounded to 1.5MB
input, 4MP and 8192 per dimension, with two active workers and twelve bounded waiters.
Interlaced PNG/APNG, animated WebP and oversized WebP requiring unsupported re-encoding
fail explicitly; they do not trigger an unsafe fallback or a product-nonexistence claim.

A later approved release must include both new worker artifacts:

- `plugins/findcheap-agent/dist/visual-image-worker.cjs`
- `plugins/findcheap-agent/dist/visual-image-worker.meta.json`

CI now checks that these are tracked and reproduce. Include the new regression files
and sanitized fixtures when preparing an approved commit so local and CI test discovery
agree. Upgrade the complete plugin directory, not only `mcp-server.js`; verify installed
worker/bundle hashes and stdio after replacement. Production and installed caches are
unchanged by this implementation turn.
