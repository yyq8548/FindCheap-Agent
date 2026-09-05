# Reviewed fashion registry expansion

User requested expansion after v0.17.13 deployment and installed-cache verification.
Baseline: 100 official storefronts / 200 trusted merchants,
`registry-2026-09-03-02`. This batch adds ten distinct brand domains to each list;
the ten new merchant records are OFFICIAL, not ten additional third-party retailers.

| Brand | Domain | Primary identity evidence |
| --- | --- | --- |
| Reformation | thereformation.com | [LYMI Inc. / Reformation terms](https://www.thereformation.com/terms-and-conditions.html) |
| Christy Dawn | christydawn.com | [Founder and garment production](https://christydawn.com/blogs/our-story/a-note-from-christy) |
| LoveShackFancy | loveshackfancy.com | [Founder and brand stores](https://www.loveshackfancy.com/pages/about) |
| RIXO | rixolondon.com | [Founders and brand story](https://rixolondon.com/pages/world-of-rixo) |
| FAITHFULL | faithfullthebrand.com | [Founders and operations](https://faithfullthebrand.com/pages/about-1) |
| DISSH | dissh.com | [Brand ownership and story](https://dissh.com/blogs/dissh/our-story) |
| STAUD | staud.clothing | [STAUD Inc. and site operator](https://staud.clothing/pages/terms-conditions) |
| With Jéan | withjean.com | [Founders and brand story](https://withjean.com/pages/about-us) |
| Paloma Wool | palomawool.com | [Company controller and contact](https://palomawool.com/pages/privacy-policy) |
| Damson Madder | damsonmadder.com | [Company and site operator](https://damsonmadder.com/pages/terms-and-conditions) |

The direct approval payload records source evidence, review date, canonical host,
platform, product paths and exact additional image hosts. No wildcard hosts,
inferred reseller authorization or commission-based ranking changes.

## Technical checks

All ten canonical identity pages were retrieved successfully. Nine Shopify sources
returned a real dress search result, its public product JSON, and root sitemap
links to product sitemaps. Reformation's canonical www search and an independently
discovered Product JSON-LD page were verified with `media.thereformation.com`.
Its root sitemap returned 404; the standard apex probe failed NETWORK_OR_POLICY.
That failure remains recorded, not converted to PASS. The canonical host's
identity/search/product evidence supports the explicit reviewed approval.

Registry Builder imports 20 candidates, probes only this batch and applies an
atomic approval before publishing an immutable snapshot. The previous snapshot
is retained. Schema validation against the live baseline gives 110 official
storefronts / 210 trusted merchants with no duplicate hosts or normalized aliases.

## Limits

### Actual adapter checks and bounded configuration correction

First live `dress / limit=1` adapter pass: 8 sources returned products,
Reformation returned zero, LoveShackFancy timed out at 15 seconds. These original
failures remain in local evidence; successful HTTP probes were not substituted.

Reformation's search HTML was 1,279,971 bytes: the outer official fetch's
unchanged 1 MiB limit rejected it before the generic parser's 2 MiB limit.
An independently discovered direct PDP returned correctly. The search page
exposed a real page-size control (`start=0&sz=16`); configuring
`/search?q={query}&sz=4` reduced HTML to 696,186 bytes. The actual adapter
returned a verified Reformation product in two requests / 1.84 seconds, preserving
color, stock and trust gates. No code or size-limit change was necessary.

Publish the corrected configuration as immutable `registry-2026-09-05-02`;
the prior `-01` release is retained and counts remain 110 / 210.
LoveShackFancy's one bounded retry returned a verified product in 639 ms.
This demonstrates recovery, not a first-pass success or reliability guarantee.

Database execution completed: 20 candidates imported; 18 standard probes passed,
the two Reformation apex records failed as described above; 20 explicit approvals
applied atomically. Published `registry-2026-09-05-01` contains 110 / 210 records.
Final local validation: typecheck, lint and all 876 tests passed.

Registry approval is not complete catalog coverage or visual accuracy acceptance.
No six-image answer URLs were seeded. No recurring crawl was scheduled.
Some Shopify vendor fields are collection/department labels (for example U26C,
Cadaqués and Woman), not brand evidence; current hydration may still reduce
brand-locked recall. These strings were not added as global brand aliases.
The six-image and held-out accuracy limitations in v0.17.13 remain.

The runtime fetches these registries remotely; no second plugin code version is
needed. Existing MCP processes can retain a registry for 24 hours, so restart Codex
and open a new task after publication. Verify production counts, every added host,
exact Reformation platform/CDN fields, and ETag 304 responses before handoff.
