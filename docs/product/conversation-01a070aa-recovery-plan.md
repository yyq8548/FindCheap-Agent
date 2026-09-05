# Conversation 01a070aa recovery plan

Original scope: local implementation and verification, requested September 5, 2026.
Baseline: 6c9818f / v0.17.19. Chris subsequently requested commit, push, deployment
and cache replacement after the local report. See the [v0.17.20 release scope](../releases/v0.17.20.md).
No product directory or new merchant approvals are included.

## Evidence and uncertainty

The recorded conversation returned three dandruff-qualified candidates. Later,
three inherited requirements produced zero qualified results and correctly
requested web recovery. The first begin_web_search returned NOT_AUTHORIZED;
Chrome never started. Comparison successfully resolved both UI selections.
The swallowed authorization error prevents attributing the incident to a user
refusal or a particular host defect. Simulated consent success is not real host
acceptance.

## Implementation order and acceptance

1. Preserve the executor and SDK consent interface. Bind consent to the active
   request and cancellation signal. Separate refusal, cancellation, unavailable
   capability, timeout, error, pending, used, and expired states. Only classified
   transient failures allow one further attempt; never retry refusal or grant
   permission from model text. Log safe reason/attempt/capability, not raw errors.
2. Keep two API passes. For ordinary category searches use a short discriminating
   requirement query, not all requirements plus repeated primaryUse prose.
   Preserve full final validation; leave exact-product and visual paths intact.
   Web discovery uses at most two distinct short queries within its existing lease.
3. Permit explicit removal of individual required features, without clearing
   unrelated requirements, budget, or size. Ambiguous goal changes request a
   localized clarification without network access. Symptoms or a negative answer
   to a question are not automatically a new shopping goal.
4. Collapse requirements-unverified cards by default. Explain missing evidence
   above them; retain native cards, IDs, comparison controls, and old snapshots.
5. Complete API searches with qualified-but-unverified merchants can request one
   bounded web recovery for trusted sources. Recovered unverified merchants end
   with an explicit report-only state, not an unimplemented verification action
   or a second recovery. Ratings/website claims never confer merchant trust.
6. Add a synthetic, network-forbidden replay of the shopping workflow, consent
   transport/error cases, selective withdrawal, short queries, and UI collapse.
   Run targeted and full tests, typecheck, lint, builds, stdio, and diff checks.

## Non-negotiable boundaries

- No shopping/navigation without required host approval; refusal remains terminal.
- No ingredient-to-efficacy inference, silent hard-requirement removal, arbitrary
  redirect permission, price invention, checkout, or automatic trust promotion.
- Source failures/budget exhaustion remain incomplete, not product absence.
- Old snapshot IDs stay valid; different snapshots never mix in comparison.
- Deterministic replay does not test a model's natural-language interpretation.

## Host acceptance / release gate

After a separately authorized installation: exercise actual Codex consent
accept/refuse, Chrome discovery, URL submission, verified native cards and selected
comparison. Capture safe status and timing. Do not call this gate passed from
InMemoryTransport or stdio fixtures. Do not publish until this gate is resolved
or explicitly accepted as an outstanding limitation. Rollback is the prior
installed bundle; no persistent user-data migrations are introduced.

## Local verification result

Implemented all six local work items. September 5, 2026 checks:

- Full suite: 1,022 / 1,022 passed, 76 files, no failures or pending tests.
  Report: `artifacts/text-recovery/conversation-01a070aa-tests.json` (local only).
- Conversation replay: 2 / 2; built stdio smoke: 3 / 3.
- Typecheck, lint, MCP bundle build, Awin service build, and `git diff --check`
  passed. The shopping fast-path skill remains within existing byte limits.
- Local browser check with synthetic cards: research group closed initially;
  expansion shows missing-evidence warnings and the existing comparison controls.
  Document scroll width does not exceed viewport width. This is not an installed
  Codex widget/bridge acceptance test.
- Consent tests cover typed errors, safe output, a single transient retry,
  terminal refusal/cancellation, concurrent calls, request association, and parent
  tool cancellation. Safe logs contain status, attempt, form capability, and
  duration; no raw host error or authorization token.

Still pending: actual Codex consent and Chrome recovery acceptance after an
authorized installation. The original host failure is not retrospectively
attributable from its generic NOT_AUTHORIZED result. Fixtures do not establish
real provider recall, natural-language interpretation, or image accuracy.
No commit, push, version bump, deployment, or installed cache replacement occurred
at that local verification checkpoint. Subsequent delivery is separately scoped
in the v0.17.20 release record; the actual host-acceptance limitation remains.
