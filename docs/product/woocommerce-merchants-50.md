# WooCommerce 已接入商家：50 家

2026-09-08 扩展：原有 5 家＋新增 45 家。版本 `2026-09-08-expanded-50`。优先品牌直营与成熟品类专营店；并非 50 家全国综合零售巨头。接入资格不自动授予商家信任、联盟关系或卡片展示资格。

新增候选实测分母 **183 家**，其中 **52 家通过技术与市场审核，45 家启用、7 家储备，131 家未纳入**。另有 17 条仅公开页面筛查的候选记录，未混入 API 实测分母。全部旧失败、解析修复后复验、具体型号重验均保留在[证据账本](../engineering/changes/2026-09-08-woocommerce-expansion-evidence.json)。

新增每家均完成公开 GET 的正向搜索、随机不存在词搜索、精确商品读取、USD 价格与图片校验，以及生产适配器默认 `per_page=20`／8 秒预算搜索。变体能力只在父子身份通过后开启。历史样例价格不是实时报价；美国市场推断不等于保证所有美国地址可配送。

## 当前名单

| # | 商家 | 品类 | 查询样例 | 变体已验证 | 美国市场依据 |
|---|---|---|---|---|---|
| 1 | [Offerman Woodshop](https://offermanwoodshop.com) | trivet, wood, kitchen | trivet | 是 | [官网](https://offermanwoodshop.com/faq/) |
| 2 | [Root Science](https://www.shoprootscience.com) | skin, serum, firm | firm | 未声明 | [官网](https://www.shoprootscience.com/shipping) |
| 3 | [La Marzocco Home USA](https://home.lamarzoccousa.com) | coffee, espresso, portafilter | portafilter | 是 | [官网](https://home.lamarzoccousa.com/faq/) |
| 4 | [Burrow Press](https://burrowpress.com) | book, poetry, fiction | mother | 未声明 | [官网](https://burrowpress.com/books/) |
| 5 | [Scrub Daddy](https://scrubdaddy.com) | sponge, scrubber, cleaning | original | 未声明 | [官网](https://support.scrubdaddy.com/support/solutions/articles/156000158436-how-do-orders-ship-) |
| 6 | [1Zpresso](https://1zpresso.coffee) | coffee, grinder, espresso | Q Air | 是 | [官网](https://1zpresso.coffee/product/carryingcase/) |
| 7 | [3F UL Gear](https://3fulgear.com) | tent, backpack, camping | lanshan | 是 | [官网](https://3fulgear.com/shipping/) |
| 8 | [Akko](https://en.akkogear.com) | keyboard, computer, electronics | Melody | 是 | [官网](https://en.akkogear.com/faq/how-many-days-will-the-delivery-take-if-i-order-today/) |
| 9 | [AntiGravityGear](https://antigravitygear.com) | rain, camping, backpacking | rain | 是 | [官网](https://antigravitygear.com/free-shipping-details/) |
| 10 | [Aunt Fannie's](https://auntfannies.com) | cleaning, laundry, detergent | Laundry | 是 | [官网](https://auntfannies.com/frequently-asked-questions/)（推断） |
| 11 | [Barrington Coffee Roasting Company](https://barringtoncoffee.com) | coffee, beans, roasted coffee | Lychee | 是 | [官网](https://barringtoncoffee.com/welcome-coffee-review/) |
| 12 | [Bison Designs](https://bisondesigns.com) | belt, outdoor, accessories | belt | 是 | [官网](https://bisondesigns.com/) |
| 13 | [BowlersMart](https://www.bowlersmart.com) | bowling, bowling ball, bowling shoes | hammer | 是 | [官网](https://www.bowlersmart.com/product/motiv-response-wipes/) |
| 14 | [Brodo](https://www.brodo.com) | broth, bone broth, food | Chicken | 未声明 | [官网](https://www.brodo.com/) |
| 15 | [Burman Coffee Traders](https://burmancoffee.com) | coffee, green coffee, roaster | Half | 未声明 | [官网](https://burmancoffee.com/customer-service/shipping-information/) |
| 16 | [CableMod](https://store.cablemod.com) | computer, cable, electronics | ASUS ROG Equalizer | 是 | [官网](https://store.cablemod.com/store-policies/) |
| 17 | [Cafe Du Monde](https://shop.cafedumonde.com) | coffee, beignet, chicory | Coffee and Chicory | 未声明 | [官网](https://shop.cafedumonde.com/customer-service/) |
| 18 | [Caribbean Trading](https://caribbeantrading.com) | coffee, food, sauce | Tomatillo Garlicky | 未声明 | [官网](https://caribbeantrading.com/faq/) |
| 19 | [Charlie's Soap](https://www.charliesoap.com) | laundry, detergent, cleaning | Powder | 是 | [官网](https://www.charliesoap.com/reliable-sustainable-cleaning-solutions-for-wholesale-needs/)（推断） |
| 20 | [Crystal Hot Sauce](https://crystalhotsauce.com) | hot sauce, food | Crystal Hot Sauce | 是 | [官网](https://crystalhotsauce.com/policies/)（推断） |
| 21 | [DutchWare](https://dutchwaregear.com) | hammock, tarp, camping | chameleon | 是 | [官网](https://dutchwaregear.com/faq/) |
| 22 | [Espresso Vivace](https://espressovivace.com) | coffee, beans, espresso | Roasted | 是 | [官网](https://espressovivace.com/web-policies/) |
| 23 | [Feral House](https://feralhouse.com) | book, nonfiction | Rose | 未声明 | [官网](https://processmediainc.com/about-us/)（推断） |
| 24 | [Fishman](https://fishman.com) | guitar, pickup, amplifier | Loudbox Micro Replacement Power Supply | 未声明 | [官网](https://fishman.com/shipping/) |
| 25 | [Force of Nature](https://www.forceofnatureclean.com) | cleaner, cleaning, disinfectant | Activator | 未声明 | [官网](https://www.forceofnatureclean.com/faqs/) |
| 26 | [Geshelli Labs](https://geshelli.com) | audio, amplifier, dac | JNOG3 | 未声明 | [官网](https://geshelli.com/shipping-returns/) |
| 27 | [Gokey USA](https://www.gokeyusa.com) | boots, shoes, footwear | boat | 是 | [官网](https://www.gokeyusa.com/home/gokey-shoes/gokey-boat-shoe/) |
| 28 | [GrillGrate](https://www.grillgrate.com) | grill, grate, cooking | GrillGrates | 是 | [官网](https://www.grillgrate.com/shipping-and-returns/) |
| 29 | [JBC Coffee Roasters](https://jbccoffeeroasters.com) | coffee, beans, roasted coffee | Kathakwa | 是 | [官网](https://jbccoffeeroasters.com/frequently-asked-questions/) |
| 30 | [Jim Green USA](https://jimgreenfootwear.com) | boots, shoes, footwear | ranger | 是 | [官网](https://jimgreenfootwear.com/jim-green-usa-shipping-and-returns/) |
| 31 | [Keeley Electronics](https://robertkeeley.com) | guitar, pedal, audio | Tube | 未声明 | [官网](https://robertkeeley.com/product/supro-keeley-custom-amplifier/) |
| 32 | [LiteAF](https://liteaf.com) | backpack, fanny pack, hiking | fanny | 是 | [官网](https://liteaf.com/about-liteaf/faqs/) |
| 33 | [Mountain Laurel Designs](https://mountainlaureldesigns.com) | backpack, tarp, camping | repair | 是 | [官网](https://mountainlaureldesigns.com/shipping/) |
| 34 | [My Pet Peed](https://www.mypetpeed.com) | cleaner, stain, odor | Triple | 未声明 | [官网](https://www.mypetpeed.com/products/triple-pack-32oz-spray-bottles/) |
| 35 | [No Pong USA](https://www.nopongdeodorant.com) | deodorant, body care | Original | 未声明 | [官网](https://www.nopongdeodorant.com/help/shipping/) |
| 36 | [Paul Component Engineering](https://www.paulcomp.com) | bicycle, cycling, component | Pure | 是 | [官网](https://www.paulcomp.com/policies/)（推断） |
| 37 | [PINE STORE](https://pine64.com) | computer, electronics, board | PineVoice | 未声明 | [官网](https://pine64.org/documentation/Pinecil/_full/) |
| 38 | [Reily Products](https://reilyproducts.com) | coffee, food, sauce | Try | 未声明 | [官网](https://reilyproducts.com/frequently-asked-questions/) |
| 39 | [René Herse Cycles](https://www.renehersecycles.com) | bicycle, cycling, tire | Barlow | 是 | [官网](https://www.renehersecycles.com/where-is-my-order/) |
| 40 | [Rockgeist Bikepack USA](https://rockgeist.com) | bikepacking, bicycle bag, backpack | gondola | 是 | [官网](https://rockgeist.com/terms-and-conditions/) |
| 41 | [Rug Doctor](https://www.rugdoctor.com) | cleaner, carpet, cleaning | TruDeep | 未声明 | [官网](https://www.rugdoctor.com/)（推断） |
| 42 | [Seymour Duncan](https://www.seymourduncan.com) | guitar, pickup, audio | Joe | 是 | [官网](https://www.seymourduncan.com/affiliate-program) |
| 43 | [Sparkos Labs](https://sparkoslabs.com) | audio, amplifier, electronics | Tube | 是 | [官网](https://sparkoslabs.com/distributors/)（推断） |
| 44 | [Tarptent](https://www.tarptent.com) | tent, shelter, camping | rainbow | 是 | [官网](https://www.tarptent.com/shipping-and-duties/) |
| 45 | [Tony Chachere's](https://www.tonychachere.com) | seasoning, food, sauce | Tony | 未声明 | [官网](https://www.tonychachere.com/shipping-handling/) |
| 46 | [UGQ Outdoor](https://ugqoutdoor.com) | quilt, tarp, camping | skully | 是 | [官网](https://ugqoutdoor.com/shipping/) |
| 47 | [Wampler Pedals](https://www.wamplerpedals.com) | guitar, pedal, audio | Tumnus | 未声明 | [官网](https://www.wamplerpedals.com/refund_returns/) |
| 48 | [Warbonnet Outdoors](https://www.warbonnetoutdoors.com) | hammock, tarp, quilt | blackbird | 是 | [官网](https://www.warbonnetoutdoors.com/shipping-returns/) |
| 49 | [Weck Jars](https://weckjars.com) | jar, kitchen, canning | Medium | 未声明 | [官网](https://weckjars.com/shippingpolicy/) |
| 50 | [White Industries](https://www.whiteind.com) | bicycle, cycling, component | Headset | 是 | [官网](https://www.whiteind.com/lead-time-updates/)（推断） |

## 使用边界

- 一次聚合最多选 6 家；Backend 每次检索最多两次 Woo 聚合，合计最多 12 家。50 是可接入名单，不是每次搜索遍历 50 家。`registryCoverageComplete=false` 必须保留。品牌、品类和已注册商品 URL 帮助选店。
- 新增 45 家的冷适配器测试全部返回有价有图商品；Paul Component、Warbonnet 返回 PARTIAL，其余 43 家 COMPLETE。COMPLETE 仍可能有 `diagnostics.truncated=true`，不代表翻完目录。
- Fishman 的宽词 `Loudbox` 超过 1 MiB；CableMod 的宽词 `ASUS` 解析失败。表中具体查询通过；其他查询仍按原预算失败关闭，没有扩大限制。
- 父商品价格范围不作为选中规格价格；没有完整规格时不能认定精确款式。接口 keyword 命中本身也不证明跨商家同型号。
- 7 家合格储备：Mariposa Coffee、Orleans Coffee、Wade’s Mill、VTV Amplifier、Suluk 46、Equinox、Ice Flame。本轮按知名度与品类平衡选择 45 家新增，储备不计入生产启用数。

## 可直接测试

1. `用 FindCheap 找 1Zpresso Q Air 手摇磨豆机，确认实际规格和商品价。`
2. `用 FindCheap 找 Wampler Tumnus，告诉我实际搜索到哪些来源。`
3. `用 FindCheap 找 Tarptent Rainbow DW，不把父商品起价当成所选规格价。`
4. `用 FindCheap 找 No Pong Original，只保留原品牌。`
5. `用 FindCheap 找 CableMod ASUS ROG Equalizer，先确认具体变体再比较。`

提示词是待执行的真实宿主验收；已完成的来源接口测试与 SDK 测试另见交付记录。没有合格卡片时说明具体限制，不编造结果。
