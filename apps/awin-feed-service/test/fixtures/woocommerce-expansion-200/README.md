# WooCommerce 200-store expansion evidence

`oversized-description.json` is a projection of ULA product 502512, observed in the bounded public `search=Circuit&per_page=5` response on 2026-09-08 at 18:58:32 UTC. It preserves the actual 339,253-character page-builder description and original ID, name, URL, type and prices. Other raw fields are omitted because this fixture reproduces only the optional-description failure. Complete original response and validation issues remain in ignored `artifacts/woo-200/beauty-outdoor/ula-diagnostic.json`.

The reader omits only an oversized optional string description. It still rejects non-string descriptions, invalid identity fields and responses exceeding one MiB. The fixture alone does not establish merchant admission, selected variation price, delivery, trust or current purchasability.

Expansion admission samples are added only after their independent reader, default-controller and official market gates pass. Historical observed prices are not live offers.

Reassessment under the required-dimension guard identifies eight historical child samples with unresolved purchase choices: Gap Antenna, Kristin Dunn Books, Maple City Roasters, MAX200, Richardson's Candy Kitchen, Rising Star Coffee, Sutton's Shoes and Uzzi. Current replay preserves their recorded identity but withholds price and availability (`UNKNOWN`); it does not rewrite the old DTOs or infer default choices. These merchants retain search eligibility, while each returned product must satisfy the current configuration guard.

`accepted-samples.json` holds one exact reader sample for each of the 150 additions. IDs, price minor units, selected attributes, ownership and approved image hosts are replayed through the real reader/normalizer. A parent's variation descriptors retain only the checked child; this projection is not proof of full-catalog variation coverage. The independent default-controller and landing observations remain in the versioned admission ledger and can concern another product matching the same query. They are never merged into one price observation.
