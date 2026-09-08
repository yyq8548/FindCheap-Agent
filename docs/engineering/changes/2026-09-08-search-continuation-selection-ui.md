# Sony / merchant requirements / selected deals / compact search UI

## Authority and outcome

Chris approved fixing the failures in the 2026-09-08 interactive test and reducing the illustrated search header to the host's Search products label and the current requirements. Chris also confirmed that the approval popup was actually visible. Baseline: `dcbe5aa`, v0.17.33; working tree clean before this work. The implementation request did not authorize commit, push, deployment, installed-cache replacement, permission-mode change or database migration.

Later on 2026-09-08, Chris authorized release and installed-cache synchronization. The separate [v0.17.34 release record](../../releases/v0.17.34.md) tracks packaging, delivery and verification; the implementation-only status below records the earlier gate, not the later release state.

Applicable design: sections 2, 4.1, 5, 6, 7, 8.1, 10, 11 and 13. The architecture remains one shopping agent, deterministic MCP execution, existing backend/source adapters and immutable snapshots. No new catalog, trust-policy expansion, checkout, Cart authorization or Watch behavior.

Success: normal Sony clarification retains its goal; merchant requirements use merchant evidence; a selected-deal request reads the actual same-snapshot choice; search headers stop repeating diagnostics; failed browser discovery is distinguishable from a completed empty search. Native browser performance and live source compatibility remain evidence-dependent, not inferred from unit tests.

## Research — facts and boundaries

| Boundary | FACT / evidence | Consequence |
| --- | --- | --- |
| Native permission | All six recorded turns use on-request/user/workspace-write. Two begin_web_search receipts are READY/ACCEPT_TRUE (2756/3823 ms). User now confirms visible popup. | The tested interactive approval path passes; Full Access compatibility, cancellation and Cart approval are not thereby proven. |
| Identity merge | search-requirements-context.ts compares productType strings and identity tokens before merging. A read-only four-case probe reproduces PRODUCT_CONTEXT_CONFLICT for the exact Sony clarification, category narrowing alone and model expansion alone; budget-only continuation merges. | Add controlled narrowing, not arbitrary model replacement or NEW_PRODUCT resets. |
| Merchant requirements | search_products receives merchant prose in requiredFeatures. product-requirements.ts evaluates it against product descriptions without merchantTrust. Awin exact-domain trust enrichment occurs after an earlier assessment. | Route evidence by requirement domain and recompute after trust enrichment. Preserve original constraints. |
| Selected deals | DealConciergeInputSchema requires selectionId/position; handler uses resolveSelectionReference. Inspect/quote already use resolveSingleSelectionReference and same-render UI revisions. | Reuse the resolver, never select the first card to repair missing arguments. |
| Search UI | product-card-ui.ts render appends bounded-coverage, recommendation, research-summary and count/price-scope banners in addition to requirements. The host owns Search products and Worked for labels. | Remove plugin-owned repeated banners. Keep per-card limitations and a concise empty/error state. |
| Browser discovery | Sony createBrowserTab("chrome") failed; later Chrome id 2 worked. Wig tab initialization returned after 62.7803 s, 12.905 s past expiry; no corresponding completion call. | Inventory before lease; use actual Chrome id; reserve verification time; explicit failure closure without new permission or reads. Cannot patch the host connector from this repository. |
| Sony source | First search recorded OFFICIAL/SCHEMA_INVALID with one official HTTP request (2045 bytes). The first request is the search envelope, before FULL detail reads. No field-level reason was retained. | Reproduce the bounded public search once; fix only demonstrated compatibility errors. Otherwise preserve UNKNOWN exact field and add safe stage diagnostics. |

Call topology: search/visual tool -> explicit parent resolution -> mergeSearchRequirements -> existing backend/searchProducts -> source adapters -> requirement/identity/trust assessment -> final ranking/summary -> immutable snapshot/model receipt -> cards. Selected deal: schema -> same-snapshot resolver -> existing deal port -> applicability assessment -> structured/text receipt. Chrome: eligible snapshot -> host form -> single expiring session -> discovery -> server-owned product URL verification or explicit stopped outcome.

Consumers checked: initial Awin/Shopify/eBay/official candidates, exact-domain trust enrichment, selected variant filtering, inspection-derived snapshots, comparison RequirementAssessmentSchema, model-context projection, shipped shopping skills and native card HTML.

Dependencies: Node >=24 <25, pnpm 10.34.5; MCP SDK 1.30.0, Zod 3.25.76, esbuild 0.28.2, Vitest 3.2.7 in lockfile. No dependency changes. `pnpm build:mcp` builds the real stdio bundle and worker/notices; default tests exclude database integration files. Baselines already run: selection-related 5 files/35 assertions and requirements 2 files/28 assertions passed. These suites did not cover the newly reported failures.

UNKNOWN: exact historic Sony failing field until independent evidence; why Chrome's alias was unavailable at that earlier instant; post-fix native timing/selection acceptance. Neither merchant location nor US delivery has trustworthy structured evidence in the current source products. USD, query market, merchant prose and product ratings cannot supply those facts.

## Propose — two feasible incremental approaches

| Dimension | A: reuse existing boundaries (selected) | B: add explicit orchestration interfaces |
| --- | --- | --- |
| Requirements | Central bounded domain classifier; preserve existing requiredFeatures/ledger, route merchant evidence separately | Add merchantRequirements object and migrate old prose through schema, ledger, adapters and projections |
| Identity | Controlled category narrowing and model-family refinement in current merge | Separate resolve-identity tool returning a refinement receipt before continuation |
| Selection | Existing deal tool accepts render-only unique UI choice | New resolve-selected tool before existing explicit-ID deal tool |
| Browser | Inventory guidance and explicit stopped completion on existing single session | Separate prepare/start/finish tools and a larger host-discovery handshake |
| UI | Delete duplicate plugin-owned global banners; keep facts on cards | Move all diagnostics to a separate collapsible diagnostic panel |
| Benefit | One-call follow-ups, backwards-compatible inputs, fewer failure surfaces | More explicit new schema and orchestration vocabulary |
| Risk | Bounded classifier must preserve unknown/negated conditions; all shared evaluators need coverage | Extra calls and between-call races; broader schema/default/withdrawal compatibility work |
| Cost | Local module changes, no data migration or new dependencies | More tools/consumers and a larger host acceptance matrix, though still no backend rewrite |
| Rollback | Restore changed source/bundle; no persistent state migration | Remove new tools/fields and compatibility layer |

A is selected under the user's implementation approval. It meets the current task with less interface churn. B is feasible but not required. The implementation must not treat free-text merchant claims as verification or weaken product identity/security/lease checks.

## Plan — frozen v1

Tests use existing public MCP tools, exported search/merge/source boundaries and the rendered PRODUCT_CARD_HTML DOM. Source replacements are confined to external API/time boundaries. Expected outputs come from the approved requirements and the recorded task, not from recomputing implementation logic.

| Step / dependency | Module / contract and smallest change | Required assertions | Immediate build |
| --- | --- | --- | --- |
| I1 / none | requirements-context: allow reviewed headphone category narrowing and same-family model qualification; retain brand/other constraints, goal identity and consent history | Sony clarification passes; different generation/family, sibling category and extra model stay rejected; old snapshot unchanged; budget preserved | pnpm build:mcp |
| M1 / none | merchant-requirements + evaluator/source query/candidate enrichment: classify whole requirements and use server-owned trust; location/delivery stay separate and UNKNOWN without evidence | Verified Awin trusted matches; self-claims/rating do not; US-based remains unverified; late exact-host join recomputes; exclusions/legacy fields and inspection retain constraints | pnpm build:mcp |
| D1 / none | deal schema/handler: render-only resolves exactly one same-snapshot UI choice, locks request-start identity, preserves explicit references | Select second card; unsynced/empty/multiple/expired/foreign errors make zero source calls; UI changes do not switch in-flight target; no Cart/Watch | pnpm build:mcp |
| D2 / D1 | model-context: add bounded selection source/revision receipt | Text and structured identity/selection provenance agree; invalid reference never becomes current selection | pnpm build:mcp |
| S1 / research evidence | Sony source: bounded search-envelope compatibility fix only if reproduced; otherwise safe phase/field diagnostics with unchanged rejection boundary | Realistic independent fixture, selected identity/price safety, malformed search vs detail classification; fixed public URL/byte limits unchanged | pnpm build:mcp |
| W1 / D2, S1 | existing browser recovery/skill: actual Chrome inventory before authorization; stopped outcome closes one session without merchant reads or reopening permissions; keep deadline enforcement | Unavailable/late browser is incomplete, not empty successful search; wrong session, expired, denied/cancelled and repeat attempts cannot authorize reads | pnpm build:mcp |
| U1 / none | product-card-ui: requirements-only preamble for nonempty cards; no coverage/count/research banners; keep research group/per-card caveats and concise empty/error state | EN/ZH DOM header has only requirements; choice controls/price/trust/unknowns remain; empty/error informative; comparison unaffected | pnpm build:mcp |
| G1 / I1,M1,D2,S1,W1,U1 | Update shipped guidance, DESIGN and total design/acceptance record | No optional progress narration/local paths in ordinary shopping guidance; preserve required host instructions; source/selection/security truth remains | pnpm build:mcp |
| T1 / all | Final source and packaged integration verification, independent review | Typecheck, lint, full default tests, stdio smoke, diff check; repeat original minimized failures and record native/source residuals separately | pnpm build:mcp |

Write ownership: main owns identity/UI/guidance/docs; requirements worker owns merchant evaluator/source-query changes; selection worker owns only deal schema/handler and model-context; source worker owns Sony/source-failure diagnostics. Shared server.ts edits and generated dist builds are serialized with the main agent. Each worker writes one coherent atomic patch, runs the red-to-green loop and requests the build slot before progressing. No simultaneous bundle generation. New facts that change interfaces or authority return to Plan before implementation.

## Implement / Test

Plan v1.1 clarification before U1: M1 preserves the existing requirementsSummary/products UI contract, so header rendering has no implementation dependency on M1 and may proceed independently. S1a is now narrowed to the reproduced numeric-model discovery filter gap: recognize bare 1000XM generation in Sony search hits, without guessing WH versus WF or weakening URL checks. Historic SCHEMA_INVALID is not proven to have the same cause; S1b adds safe typed diagnostics rather than claiming that historic field fixed.

### Executed module gates

| Step | Red evidence and resulting boundary | Local verification |
| --- | --- | --- |
| I1 | Sony clarification/category narrowing raised PRODUCT_CONTEXT_CONFLICT; new positive tests failed before change. Independent review then reproduced 5 negative cases where category-only/query-only-brand references could conflict with the retained WH/WF identity; those failed before the final-query guard. | requirements-context 53 assertions pass, including a public MCP clarification → budget trajectory and zero source reads on rejected refinement. Real MCP bundle built after each implementation batch. |
| M1 | Merchant trust was evaluated as product prose; late exact-domain trust enrichment left stale requirements. Initial red cases, late-join regression and two seller-refurbished condition regressions were preserved. Only a complete supported merchant-trust requirement uses server-owned trust; unsupported location/delivery/compound/negated conditions remain UNKNOWN. | merchant-requirements 25 assertions pass; related 8-file suite 252 pass. Full build includes late fixes. |
| D1/D2 | Render-only deal input was rejected instead of resolving the UI selection; model receipts omitted selection provenance. Reused existing one-selection resolver and locked the selected identity before awaiting sources. | 11 deal contract assertions pass; extended 11-file suite 178 pass and package/stdio checks pass. Unsynced/empty/multiple/expired/foreign failures make zero deal-source calls. |
| S1a | Bare numeric Sony family accepted unrelated search hits; their URLs caused whole-source failure. New numeric-family/explicit-model-priority fixtures failed before filtering. | Final Sony test file 54 assertions; related 6-file suite 119 pass. Preserves exact identity, domain/URL/byte bounds and existing failure/retry classes. |
| S1b | Missing typed source phase/category diagnostics reproduced locally. Public MCP red case rejected validation as an unsupported output field; schema and safe diagnostic projection were then integrated. | Search/detail/JSON/URL reasons, fixed field categories, no raw payload/URL/error content; MCP text/structured/meta assertions pass. Real MCP build passed. |
| W1 | Four new public MCP cases rejected the explicit failed-discovery outcome before implementation. Expired failure closure now only consumes its own approved token, reads nothing and leaves immutable snapshots unchanged. | Web recovery 51 assertions pass, including all three failure reasons, forged/nonempty/repeated/forgotten leases, original snapshot rendering/selection, expired lease plus exhausted service budget, and existing successful recovery. |
| U1 | New EN/ZH DOM assertions initially found 5 global headers instead of requirements alone; empty/unavailable examples also failed before concise messaging. Removed stale banner expectations, not per-card safety assertions. | UI 63 assertions pass; requirements, selection, price, research caveats, 9-row comparison and visual-result evidence remain. Resource URI advanced v39 → v40 for content invalidation, without a plugin release/version change. |
| G1 | Chrome guidance contract failed before inventory/deadline/failure-close instructions. Earlier full suite found obsolete prose assertions still requiring the removed progress sentence. | Shipped skills/tool descriptions/default prompt/DESIGN synchronized. Existing instruction size caps and safety assertions retained; exact phrasing assertions updated to the approved behavior. |

Module commands: `pnpm exec vitest run <named test files> --silent`, `pnpm build:mcp`; source workers additionally ran targeted ESLint. At 10:06 local, final source build/typecheck passed and the six primary changed-module files passed **257/257** assertions. Prior full run: **2,094 pass / 11 fail**, failures confined to old guidance/title-description expectations; that is a failed integration gate, not a claim of completion. Final gates are recorded below after rerunning.

Independent review found and drove fixes for retained Sony model/category conflicts and seller-refurbished domain misclassification. Separate W1 review found no reproducible authorization or visual-review bypass. Local source fixtures, in-memory MCP and DOM verification are not native host acceptance.

### Bounded live diagnosis / residuals

Exactly two public Sony search requests were made in the source diagnosis. Both returned HTTP 200/application-json (1,972 bytes) and failed in the search stage with PRODUCT_URL_INVALID before any FULL detail read. The reproduced discovery filtering defect was fixed with independent fixtures. The historic 2,045-byte SCHEMA_INVALID response's exact field was not recovered; no response body was retained, no third request or general live-source acceptance was performed.

Native retest after installation remains required: original Sony clarification/budget sequence; wig merchant trust versus explicitly requested US location; select the second card then request Coupon with no ordinal; Chrome inventory/authorized discovery/completion within the original budget; failure closure and compact cards. Chrome connector startup latency remains host-owned. Merchant location/delivery evidence remains unsupported when absent; this is not silently treated as satisfied.

Release state: source and generated package changed locally only. No commit, push, Railway deployment, registry publication, installed-cache replacement or permission-mode changes in this task.

### Final integration gate — 2026-09-08 10:09 local

| Check | Result |
| --- | --- |
| `pnpm test -- --silent` | PASS: **139 files / 2,107 assertions**, 0 failed. This replaces the failed first integration gate above, without removing its history. |
| `pnpm typecheck` | PASS, exit 0 |
| `pnpm lint` | PASS, exit 0 |
| `pnpm build:mcp` | PASS, real stdio bundle + image worker + notices |
| `pnpm test:mcp-stdio -- --silent` | PASS: 4 assertions against the local packaged bundle/.mcp.json, not proof of installed Codex cache or native UI behavior |
| `git diff --check` | PASS |
| Guidance limits | compare skill 7,178 bytes; deals/watch 3,699 bytes; unchanged original size caps. Manifest, tool descriptions, default prompt and skills no longer require an extra progress sentence. |
| Database integration | NOT RUN: default suite excludes the database integration configuration; no database implementation/migration in scope |
| Post-fix native host / real catalog acceptance | NOT RUN; separate checklist and historical Sony uncertainty remain above |
| Publication / installation | NOT REQUESTED / NOT PERFORMED |

The local implementation and automated gate are complete for this scoped change. This is not a claim that the total Agent design, the host connector or general visual-search accuracy has passed business acceptance.

## Native acceptance record

2026-09-08: Chris explicitly confirms popup visibility in the linked v0.17.33 interactive-mode task. Combined with its two ACCEPT_TRUE receipts, this verifies visible accepted web-search approval for that tested mode. It does not verify rejection/cancellation, Full Access mode, actual web recovery completion, quotes or Watch.
