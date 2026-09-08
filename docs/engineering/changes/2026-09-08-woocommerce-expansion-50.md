# WooCommerce merchant expansion: target 50

## Research and scope

User request on 2026-09-08: expand the five enabled WooCommerce merchants toward 50, prioritizing mainstream merchants. Baseline `f170749f82fe74d6ce5ea87b1e7c800272409caf`, clean worktree, runtime v0.18.0. This continues the authorized source integration and release workflow. Existing production has five merchants; neither a discovery list nor a successful homepage request proves additional integration.

Applicable design: sections 5 (trust separate from product/source facts), 10 (bounded public reads), 13 (independent technical and shopping acceptance). Current chain: Backend/MCP Woo client calls the source controller; `woocommerce-registry.ts` supplies reviewed access entries; `woocommerce.ts` selects at most six stores per pass; `woocommerce-store.ts` enforces pinned HTTPS, no redirects, three seconds and one MiB per read. The controller has two bounded MCP passes, not a 50-way fan-out. Registry schema supports up to 2,000 stores; search DTO continuation allows up to 12 attempted stores. USD/US and source-owned product/variant identity remain unchanged.

FACT: existing five-store code and the production delivery evidence are available in the v0.18.0 release record. UNKNOWN: current Store API availability, search semantics, variants, latency, image origins and US market evidence for new merchants. Public official Woo showcase pages are discovery evidence only. ASSUMPTION: within this single-platform request, prioritize well-known brands and established category specialists with public USD storefronts; do not count regional aliases separately or label all qualifying specialists national mass-market retailers.

## Alternatives and decision

| Dimension | A: extend reviewed static registry | B: new database-backed Woo registry |
| --- | --- | --- |
| Scope | Existing typed entries, review evidence, deployment | New storage mapping, migration/import and loading path |
| Merchant reads | Existing source reader and budgets | Same reader and budgets |
| Reviewability | One versioned list plus per-store evidence | Review records plus live database revision |
| Rollback | Previous source artifact/list | Data revision and loader rollback |
| Cost | No dependencies, no schema migration | New operational path and contract coverage |

Choose A. The request is bounded expansion, and the existing registry already supports 50. No change to merchant trust, source ranking, timeouts, authentication, cart, checkout or Watch semantics is required.

## Frozen plan

1. Discover candidates in independent category groups. Reuse current evidence, then perform bounded public GET probes through the production reader. Preserve every candidate and failure in the denominator; stop on merchant 401/403/429 without bypassing it.
2. A new enabled entry requires nonempty supported USD products, positive keyword filtering and an impossible-query empty result, exact product lookup, normalized price/identity, safe product/image origins and a merchant-owned US market/shipping source. If variable products are offered, verify child/parent binding before claiming variation capability. Failed, slow, non-USD or unverified candidates stay outside the enabled list.
3. Integrate accepted entries and update registry version. Immediately build the source package and run registry/search/reader assertions, including 50-entry selection and bounded continuation. If 50 cannot pass the unchanged contract, preserve the shortfall explicitly and continue discovery; never manufacture passing stores or relax a gate to hit the count.
4. Check the final enabled list against saved evidence, run typecheck/lint/full relevant tests/diff checks, and perform bounded real adapter smoke on representative added categories. Update setup and user-test documentation with actual counts and coverage limits.
5. Carry the validated source change through the previously authorized commit/push/production deployment path. Verify the running artifact, health and real source coverage separately. The MCP package only needs replacement if its shipped artifact changes; a server registry expansion alone is consumed by the already-installed client.

Development-only probe scripts/results live under ignored `artifacts/woo-expansion/`; the final review ledger and deterministic accepted samples belong with the versioned evidence. No credentials, cookies, images or user shopping data are collected. Rollback uses the previous source list/artifact; no database or Watch migration is involved.

### Plan revision 2: unspecified parent variation dimensions

Saved responses from Warbonnet, DutchWare, Rockgeist, 3F UL Gear and Equinox contain `variations[].attributes[].value: null`. Rejecting that single unspecified dimension currently rejects the whole product page. Alternative A accepts null only in the parent's variation descriptors and normalizes it to an absent value; existing matching then cannot claim that dimension is selected. Alternative B drops malformed products from an otherwise valid page, changing partial-response semantics and potentially hiding exact items. Choose A. Actual child attributes retain the existing schema, and explicit child/parent conflicts remain rejected. A reader-to-normalizer regression first failed with INVALID_RESPONSE; add malformed-value controls, implement the narrow schema change, build immediately and recheck the affected public searches. Payload, timeout and request limits stay fixed.

## Execution and verification

Local implementation complete; production delivery is recorded separately below when verified. The access registry now contains exactly 50 stores: the original five plus 45 additions selected from 52 qualified new merchants. The API-screened candidate denominator is 183; 131 were not admitted and seven qualified merchants remain reserves. Seventeen additional public-page screening notes are separate from that API denominator. See the [complete list](../../product/woocommerce-merchants-50.md) and [versioned evidence ledger](2026-09-08-woocommerce-expansion-evidence.json).

All 45 additions produced at least one priced, imaged product through a new production controller using the default per_page=20 and eight-second budget. Paul Component and Warbonnet return PARTIAL with useful observations; 43 return COMPLETE, independently of pagination truncation. Fishman's broad Loudbox query exceeded one MiB and CableMod's broad ASUS query failed schema validation; ordinary specific product queries passed without relaxing limits. Cafe Du Monde, Crystal and Caribbean Trading were additionally checked for actual coffee/sauce products after initial merchandise samples. Reader samples and controller samples retain their distinct product/variant IDs and prices; Caribbean's out-of-stock coffee remains recorded.

The saved accepted samples replay through the reader/normalizer, preserve merchant and parent/child identity, and cannot price parent ranges. The 50-store controller regression verifies six stores per pass, twelve distinct stores across two passes, false registryCoverageComplete, and selection of a new brand within the existing budget. These are source-contract tests, separate from card trust/ratings and native host acceptance.

Verification through 18:09 UTC: source and MCP builds, typecheck, lint, full default suite **154 files / 2,378 assertions**, installed-cache stdio **4/4**, and diff checks passed. After the final three food samples were updated, source rebuild and all **48 expansion assertions** passed again. Initial reproduction failures are retained locally: image compatibility 2 failures, null parent dimension 1 failure, and old-five-store expansion contract 48 failures. Those are deliberate regression reproductions, not production passes.

The installed v0.18.0 package remains enabled, and rebuilding MCP leaves its SHA-256 unchanged at `4e9b20544d225e66d1cd878fad1ee198f6569ebe848bcd6b95e18fddf2f7facc`, identical to the existing `0.18.0+codex.20260908165141` cache. No distributed client files changed. Production preflight confirms Woo enabled with no custom registry override, health/readiness of the prior deployment, and 68,871 feed rows / 42 feeds / zero stale feeds.

Independent read-only review found no blocking issue in the two reader changes. Verified hosts, image extensions, DNS, redirect policy, byte/time limits, child attributes, parent-child conflict checks and price rules remain unchanged. No merchant trust, checkout, Watch scheduling or affiliate state was modified.

A second independent review matched all 50 registry entries and 45 fixtures, checked normalized host/alias uniqueness, product ownership, URLs/images, prices and parent-child mapping, and matched every accepted raw SHA-256 to its local record. Twenty-five fixture parents retain only the selected child's variation descriptor; the fixture README explicitly distinguishes those bounded samples from complete raw responses. No blocking findings remained.

### Production delivery

Verified on 2026-09-08 at 18:15–18:16 UTC:

- Runtime commit `3b402b0d86b131e42cca50f67784ef691fa6f247` pushed to main; remote SHA matched. [Plugin CI](https://github.com/yyq8548/FindCheap-Agent/actions/runs/34261460949) and [Windows installer CI](https://github.com/yyq8548/FindCheap-Agent/actions/runs/34261460939) both passed.
- Railway production deployment `48c14221-aaf9-4dcd-9ae1-4a42e085ad8e` reached SUCCESS. SSH `/app/dist/main.cjs` SHA-256 is `188a8d671edd15f856eb1b864debfad61e56c18089936840ca081c549bec2e45`, identical to the local source build. Woo remains enabled and the custom registry override remains absent.
- Production endpoint smoke **8/8 PASS**: health, readiness, 50-store registry with six-store bounded search, No Pong URL search, CableMod URL/variant search, exact 1Zpresso variant lookup, its approved CDN image proxy, and unknown-merchant rejection. The six-store query used eight physical reads / 27,020 bytes / 7,556 ms and correctly returned `registryCoverageComplete=false`. Exact 1Zpresso Purple `52925` remained OUT_OF_STOCK at USD 69; no stock or price was substituted. The image proxy returned JPEG 200 with 37,936 bytes.
- Source health/readiness are 200, with 68,871 feed rows / 42 feeds / 140 offers / zero stale feeds and zero consecutive refresh failures.
- Existing installed-cache SDK smoke **3/3 PASS**: runtime/tool discovery, a new No Pong exact product search, and the existing Root Science exact product regression. Both searches read registry version `2026-09-08-expanded-50`, reported 50 eligible stores, selected only the URL's merchant, and returned one correctly sourced card. No source trust or identity rule was bypassed. The first SDK harness launch failed before connecting because Windows filesystem paths were passed to dynamic import; using file URLs fixed that test harness only. Its failure log is retained. Per-call harness timing was not correctly measured, so only source-owned diagnostic latency is reported.
- Installed cache remains `0.18.0+codex.20260908165141`, enabled, with **13/13 normalized files equal** and unchanged raw MCP SHA-256. No cache replacement is necessary for this server-only expansion. No native UI acceptance or real Watch/Automation was claimed.

The portable [delivery evidence](2026-09-08-woocommerce-expansion-delivery.json) separates source endpoint checks, installed SDK checks and the local harness correction. Rollback target is the previous verified source deployment `ff9d4d7b-6e86-4b84-9f63-c81fc6599ff0` with its five-store registry; no database or client-state migration was introduced.

### Plan revision 1: observed image compatibility

Actual Store API probes for 1Zpresso and Charlie's Soap pass positive/negative search, product lookup and child identity, but normalization drops their images solely because CDN URLs carry `ssl=1` or `strip=all`. Both parameters are documented in the [CDN provider's read-only image API](https://docs.ewww.io/article/115-exactdn-easy-io-api); the saved merchant observations bind the actual image host and path. These are source image options, not cart or arbitrary redirect parameters.

Alternative A retains verified hosts, HTTPS, image-extension checks and recorded image IDs while accepting only those two observed fixed values. Alternative B strips query parameters and substitutes a different URL; it may change returned content or break the CDN's required request semantics. Choose A; no other values or new network destinations are accepted. Before registry integration, add regression assertions that fail on the current normalizer, implement this narrow source-reader change, immediately build the source service and run its image/security assertions. Re-normalize already saved observations without repeating merchant requests. The added behavior requires a source deployment; it does not change the distributed MCP bundle.
