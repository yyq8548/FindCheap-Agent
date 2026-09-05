# Visual search: publication and remaining remediation

Verified 2026-09-04 America/New_York (2026-09-05 UTC).

Publication update: the user subsequently approved packaging these follow-up
repairs as `0.17.15+codex.20260905031618`. Only release metadata and
version-specific assertions changed during packaging. The local/uncommitted
statements and bundle hashes below describe the original development checkpoint;
they are not the post-publication deployment status. Nataly remains unresolved.

## Delivery boundary

The preceding Zeno/Oren pilot was published first, as requested:

- Version: `0.17.14`; plugin `0.17.14+codex.20260905030000`.
- Commit and verified `origin/main`: `65ceb69e4e3c432a3dcaee0f8ac5affbf0843fe0`.
- Railway **production** deployment `61b6229c-17be-42f4-b0cb-df177af969ff`: `SUCCESS`.
- `/health`: `ok`; `/ready`: HTTP 200; read-only `/v1/search`: two products.
- Release-time feed snapshot: 68,558 products, 40 feeds, 134 offers, no stale
  sources or consecutive failures. These are observations, not future guarantees.
- `plugin-ci` and `windows-installer-ci`: successful at that commit.
- Installed/enabled cache `0.17.14+codex.20260905030000`: 13 plugin files matched
  source after line-ending normalization; installed stdio smoke passed 3/3.
- Published/installed bundle SHA-256:
  `724f74cb717396583e523399b8c4421a69609507d435cf6291ae9ba7b6a9796a`.

The installer reported access denied while backing up the **old** locked cache.
The new registered/enabled cache and all its files were separately verified.
No old cache was forcibly deleted, and no user process was killed. Restart Codex
to ensure already-running plugin processes load the new version. No GitHub
Release/tag or registry publication was performed.

The repairs below are **uncommitted local follow-up changes**, not part of that
production deployment or installed cache. The version metadata remains 0.17.14;
the distinct local bundle SHA-256 is
`5f3dc0598827ecfffd8b6217d51556e8452a04fe74d1ae1084b52c2c3c4d2a19`.

## Repairs and evidence

1. Whole-token English matching replaces substring matching: `inspired` and
   `gathered` cannot prove red, `important` cannot prove tan, and `blueprint`
   cannot prove blue. Explicit neckline/sleeve equivalents and CJK matching remain.
2. Preserve visible bouquet details without dropping the core structural query.
   More specific pattern evidence improves same-style colorway review order;
   it does not grant identity or bypass candidate-image review.
3. Extract narrow, source-verifiable neck/sleeve/length terms from longer visible
   observations. Emitted evidence reports only the actually matched narrow term;
   it does not claim the whole descriptive sentence was verified.
4. Canonical Shopify product sitemap discovery no longer spends its four-map
   budget on locale copies whose product URLs cannot be used by that adapter.
5. Generic JSON-LD discovery supports bounded arrays, `@graph`, `mainEntity`,
   type arrays, nested `item`, URL strings and malformed-entry isolation. Limits:
   32 scripts, 200 visited nodes, depth four, 100 links, six hydrated PDPs.
6. Generic search may follow **one** explicit `rel=next`, only on the same HTTPS
   host/path with unchanged non-cursor query parameters. Failure preserves page
   one. It does not follow arbitrary redirects or recursively crawl a catalog.
7. A visible patterned dress with known length uses a short color/pattern/length
   discovery query; strapless priority and the camisole synonym are retained.
   This recovered the supplied Belden colorway without a product-name hint.

Safety boundaries remain: original immutable IDs, source-owned prices/stock,
merchant trust, image transport limits, shared budgets, occlusion uncertainty,
and no unsupported exact-identity claims. Text matching still cannot replace
the mandatory actual-image review.

## Six-image development replay

All six cases used the previously frozen image-derived observations plus the
merchant brand, with empty isolated catalog state. No expected product names,
style IDs, color codes or answer URLs were supplied to the search tools.
All 29 returned candidate images were inspected before same-session verdicts.

| Case | Correct target/colorway | Final backend state | Result |
| --- | --- | --- | --- |
| Julia | Rose Petit Bouquet de Chamonix | Possible same item; READY | PASS |
| Faye | Alderbrook Plaid | Possible same item; RESEARCH_ONLY, out of stock | PASS |
| Zeno | BLU | Highly similar; READY | PASS |
| Oren | KBE | Highly similar; READY | PASS |
| Nataly | EFG | No target; all four reviewed candidates conflicted | FAIL |
| Belden | PGA | Possible same item; READY | PASS |

Each run reached a terminal result in two calls with no read timeout or budget
exhaustion. Tool durations excluding interactive image inspection ranged from
1.25 to 4.49 seconds; these single runs are not a latency benchmark. The
six-case target acceptance gate is **5/6, not passed**. They are known development
examples, not held-out accuracy measurements. The deferred 40-image acceptance
remains deferred; nothing here establishes a general accuracy percentage.

### Nataly: demonstrated remaining limitation

The expected public PDP returned HTTP 200 and valid Product JSON-LD with
in-stock EFG offers. A diagnostic search using the known name found the style
and EFG colorway. Those answer-aware diagnostics were kept separate from recall.

The frozen image query produced `blue floral mini dress`. The source stated
14 results but returned four on page one. Read-only diagnostic requests for
offsets 4, 8 and 12 enumerated the remaining ten: none was Nataly. The rendered
More results button was disabled and had an empty `data-url`; there was no
explicit `rel=next`. Therefore the new safe next-link support does **not** fix
this case, and missing pagination alone does not explain this target failure.
Several short structure/pattern diagnostics also failed to retrieve it. This
demonstrates a source keyword-recall gap, not absence, lack of stock, or an image
safety rejection. It does not prove that every possible query would fail.

The agent correctly rejected Adeline's neckline, Opaline's crossed halter and
Camila/Maven's long hems; none was mislabeled as Nataly. Resolving this coverage
gap still needs retrieval beyond those keyword result sets (for example a
bounded, reviewed catalog/visual index). No full-catalog service or answer-seeded
lookup was added to turn this known failure into an artificial pass.

## Verification gates

| Gate | Published pilot | Local follow-up |
| --- | --- | --- |
| Full automated suite | 886/886 | 900/900 |
| Typecheck / lint / MCP build | Passed | Passed |
| Focused discovery / sitemap tests | Included | 42/42 |
| Stdio smoke | Installed cache 3/3 | Included in full suite |
| Six-case target recall | Not claimed | 5/6; failed acceptance |
| Capture integrity | Prior pilot verified | Passed for all six |

Local, ignored evidence:

- `artifacts/pdf-six-trial/runs/remaining-final-01` through `remaining-final-06`:
  raw live MCP requests/results, reference/image hashes and session verdicts.
- `artifacts/visual-pilot/verify-remaining.mjs` and `remaining-verification.json`:
  verifies unchanged inputs/photos, empty catalogs, no answer leakage, all image
  hashes, complete session-bound verdict IDs, target colorways and terminal states.
  Integrity PASS is explicitly separate from target acceptance FAIL_5_OF_6.
- `artifacts/visual-pilot/remaining-tests.json`: 900 passed, zero failed.
- Raw public response hashes: Nataly PDP `94b62772...`, first blue-query page
  `65885dc4...`, offsets 4/8/12 `b17f0688...`, `0f0f3595...`, `b56b6e60...`.
- Earlier `remaining-01`, `remaining-05`, `remaining-06` are incomplete diagnostic
  runs stopped before a rebuild and excluded from the completed cohort.

User photos and raw response captures are not committed. The enterprise-agent
evaluation skill informed the publication/local-work separation, frozen-input
replay and explicit failure accounting. Historical reports remain historical;
their Julia and substring-defect status is superseded by this report.
