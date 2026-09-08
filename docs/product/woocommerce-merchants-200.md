# WooCommerce 已接入商家：200 家

原有 50 家＋新增 150 家。表版本 `2026-09-08-expanded-200`，客户端仍为 v0.18.0。计数代表独立商家店面及主营目录；不同品牌可能同属一家公司，域名别名、区域镜像和重复目录只算一家。名单包含品牌直营与成熟品类专营店，不代表 200 家全国综合零售巨头。

本轮筛查 **1244 个去重候选**，其中 150 家达到本轮准入标准，最终新增启用 150 家。筛查分母包含接口实测、旧储备复核和仅公开页面发现；不能全部算作 API 测试。每次未执行、失败、排除及复验均留在[完整证据账本](../engineering/changes/2026-09-08-woocommerce-expansion-200-evidence.json)，原有 50 家历史证据另行保留。

新增每家均通过公开商品正向搜索、随机不存在词搜索、精确商品读取、USD 价格与图片校验；有变体声明的店须验证父子身份。另用生产默认 `per_page=20`／8 秒适配器确认主营实物结果，并复核实际商品页仍在同一店铺售卖。历史样例价格不是实时报价，美国市场证据不保证所有地址配送，BACKORDER 不冒充现货。

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
| 51 | [Abednego Coffee Roasters](https://abednegocoffee.com) | coffee | Chambersburg | 是 | [官网](https://abednegocoffee.com/product/chambersburg-coffee-2oz-whole-bean/)（推断） |
| 52 | [Alaska Honey Collective](https://alaskahoneycollective.com) | food | Creamed Honey | 未声明 | [官网](https://alaskahoneycollective.com/sell-your-honey/) |
| 53 | [Alpha Antenna](https://www.alphaantenna.com) | radio, antenna accessories, tripod | Tripod | 未声明 | [官网](https://www.alphaantenna.com/official-home/policy-compliance/shipping-policy/) |
| 54 | [Amaryllis Man](https://amaryllisman.com) | garden | Grandise Fantasy | 未声明 | [官网](https://amaryllisman.com/shipping-charges/)（推断） |
| 55 | [Analog Alien](https://analogalien.com) | guitar, pedal, effects | New-Look | 未声明 | [官网](https://analogalien.com/)（推断） |
| 56 | [Anderson Powerlifting](https://andersonpowerlifting.com) | fitness, sport | Gauntlet | 是 | [官网](https://www.andersonpowerlifting.com/shipping/)（推断） |
| 57 | [Archipelago Books](https://archipelagobooks.org) | books, literature | Bob | 是 | [官网](https://archipelagobooks.org/book/bob-and-hilbert/)（推断） |
| 58 | [Ashay By The Bay](https://ashaybythebay.com) | books | Growth | 未声明 | [官网](https://ashaybythebay.com/home_page/about-us/)（推断） |
| 59 | [Asian Garden 2 Table](https://asiangarden2table.com) | garden | Eggplant Black Dragon | 未声明 | [官网](https://asiangarden2table.com/shipping/) |
| 60 | [Audio Envy](https://audioenvy.com) | audio, cables | Prestige | 是 | [官网](https://audioenvy.com/store/technology/)（推断） |
| 61 | [Barnyard Bees](https://barnyardbees.com) | beekeeping, honey bottles, packaging | Honey Bears Bottles | 是 | [官网](https://barnyardbees.com/shipping-returns-2/) |
| 62 | [Bartlettyarns](https://bartlettyarns.com) | yarn, wool, knitting | Fisherman 2-Ply | 是 | [官网](https://bartlettyarns.com/)（推断） |
| 63 | [BC Rich](https://bcrich.com) | guitar, bass | Rich | 是 | [官网](https://bcrich.com/returns-refund-policy/)（推断） |
| 64 | [Best Shot Pet Products](https://www.bestshotpet.com) | pet, shampoo, grooming | shampoo | 是 | [官网](https://bestshotpet.com/shipping-policy/) |
| 65 | [Big Game USA](https://biggameusa.com) | sport, football | Tulane | 未声明 | [官网](https://biggameusa.com//customer-care/orders-products) |
| 66 | [Bitterleaf Teas](https://www.bitterleafteas.com) | tea | Orchid | 未声明 | [官网](https://www.bitterleafteas.com/shipping-etc) |
| 67 | [Black Cat Bakery](https://blackcatbakery.net) | bakery, cookies, candy | Dark Chocolate Chip Cookies | 未声明 | [官网](https://blackcatbakery.net/)（推断） |
| 68 | [Black Lawrence Press](https://blacklawrencepress.com) | books, poetry, literature | California | 未声明 | [官网](https://blacklawrencepress.com/about/)（推断） |
| 69 | [Blue Mountain Coffee](https://bluemountaincoffee.com) | coffee | Ethiopia Yirgacheffe | 是 | [官网](https://bluemountaincoffee.com/refund_returns/) |
| 70 | [Blue Ridge Oil Colors](https://blueridgeoilpaint.com) | oil paint, artist paint, art supplies | Nickel Yellow Dp | 是 | [官网](https://blueridgeoilpaint.com/returns/) |
| 71 | [Blue Sole Shoes](https://bluesoleshoes.com) | footwear, apparel | HARRIS | 是 | [官网](https://bluesoleshoes.com/terms-of-service/) |
| 72 | [Blues Creek Guitars](https://bluescreekguitars.com) | guitar, ukulele, luthier tools | Uke Tenor cutaway pattern | 未声明 | [官网](https://bluescreekguitars.com/)（推断） |
| 73 | [Brightvision Wheels](https://brightvisionwheels.com) | model car, diecast, toy | Hong Kong Bearing Wheels Medium | 未声明 | [官网](https://brightvisionwheels.com/) |
| 74 | [Cafe Typica](https://cafetypica.com) | coffee | Ethiopia Guji | 是 | [官网](https://cafetypica.com/) |
| 75 | [Chelsea Green](https://www.chelseagreen.com) | books, farming, gardening | Green | 未声明 | [官网](https://www.chelseagreen.com/about/shipping-returns/) |
| 76 | [Cips Coffee Roasters](https://cipscoffeeroasters.com) | coffee | 1 x 12oz Coffee Bag | 是 | [官网](https://cipscoffeeroasters.com/coffee-club-policy/)（推断） |
| 77 | [Clay King](https://www.clay-king.com) | ceramics, pottery, clay | Xiem Glaze Jug | 未声明 | [官网](https://www.clay-king.com/shipping-information/) |
| 78 | [CNY Maple](https://cnymaple.com) | maple | Bourbon Barrel | 未声明 | [官网](https://cnymaple.com/2026/04/28/more-syrup-ready-to-ship-3/) |
| 79 | [Cool Pool Products](https://coolpoolproducts.com) | pool, swimming, volleyball | Umbrella Sleeve | 未声明 | [官网](https://www.coolpoolproducts.com/warranty-and-return-policies/)（推断） |
| 80 | [CulMar Outdoors](https://culmaroutdoors.com) | fishing, outdoor | Lamiglas | 未声明 | [官网](https://culmaroutdoors.com/shipping-policy/)（推断） |
| 81 | [DH Labs Silver Sonic](https://silversonic.com) | audio, cables | REL | 未声明 | [官网](https://silversonic.com/contact/) |
| 82 | [Digirig](https://digirig.net) | radio, audio, electronics | BTech | 未声明 | [官网](https://digirig.net/contact/)（推断） |
| 83 | [Douglas Connection](https://douglasconnection.com) | audio, cables | Furutech | 未声明 | [官网](https://douglasconnection.com/about-us-2/) |
| 84 | [Duranglers](https://duranglers.com) | fishing, outdoor | Oros | 是 | [官网](https://duranglers.com/terms-and-conditions/shipping-policy/)（推断） |
| 85 | [Dyeable Shoe Store](https://dyeableshoestore.com) | footwear, apparel | Tyler | 是 | [官网](https://www.dyeableshoestore.com/store-policies/) |
| 86 | [Dynakit Parts](https://dynakitparts.com) | audio, amplifier, parts | PAS | 未声明 | [官网](https://www.dynakitparts.com/shipping/) |
| 87 | [Ephraim Pottery](https://ephraimpottery.com) | art pottery, ceramics, home decor | Little Meadow Pumpkin | 未声明 | [官网](https://ephraimpottery.com/frequently-asked-questions/)（推断） |
| 88 | [Equinox Ltd.](https://www.equinoxltd.com) | backpack, bag, outdoor | pouch | 是 | [官网](https://www.equinoxltd.com/shipping-information/)（推断） |
| 89 | [Evil Hat](https://evilhat.com) | tabletop games, roleplaying games, books | Designers | 是 | [官网](https://evilhat.com/shipping-returns/) |
| 90 | [Evolve Golf](https://evolvegolf.com) | golf, tee, sock | Golf Tees | 未声明 | [官网](https://evolvegolf.com/evolve-golf-faq/) |
| 91 | [Factory Reproductions](https://factoryreproductions.com) | wheels, auto parts | SUPER-DUTY | 是 | [官网](https://factoryreproductions.com/refund_returns/) |
| 92 | [Firebox Stove](https://fireboxstove.com) | camping, stove | FREESTYLE Modular Stove | 是 | [官网](https://fireboxstove.com/all-products/) |
| 93 | [Flyvines](https://flyvines.com) | fishing, outdoor | Lanyard | 是 | [官网](https://flyvines.com/faq-tips/)（推断） |
| 94 | [Fonograf Editions](https://fonografeditions.com) | books, poetry | FONO50 | 未声明 | [官网](https://fonografeditions.com/about/)（推断） |
| 95 | [Friedman Amplification](https://friedmanamplification.com) | guitar, amplifier | Jose-20 | 未声明 | [官网](https://friedmanamplification.com/refund_returns/) |
| 96 | [Gamakatsu USA](https://gamakatsu.com) | fishing, hook | hook | 是 | [官网](https://gamakatsu.com/shipping-delivery/) |
| 97 | [GAP Antenna](https://gapantenna.com) | radio, antenna, electronics | TITAN | 是 | [官网](https://gapantenna.com/contact/)（推断） |
| 98 | [General Pencil Company](https://generalpencil.com) | pencil, charcoal, art supplies | Charcoal Pencil Sketching | 未声明 | [官网](https://generalpencil.com/store-policies/) |
| 99 | [Gilman Gear](https://gilmangear.com) | football, sport, pylon | Premium Pylon | 未声明 | [官网](https://gilmangear.com/faq/) |
| 100 | [The Golf Target](https://thegolftarget.com) | golf, target, sport | Golf Target | 是 | [官网](https://thegolftarget.com/faqs/)（推断） |
| 101 | [Golf USA](https://golfusa.com) | golf, ball, club | Titleist 2025 Pro V1 Golf Balls | 是 | [官网](https://golfusa.com/help-center/)（推断） |
| 102 | [Goodrich Maple Farm](https://goodrichmaplefarm.com) | maple | Maple Syrup | 未声明 | [官网](https://goodrichmaplefarm.com/customer-service/) |
| 103 | [GooseFeet Gear](https://goosefeetgear.com) | backpacking, pants, jacket | I/S | 是 | [官网](https://goosefeetgear.com/about/) |
| 104 | [GR Research](https://gr-research.com) | audio, speakers | Polk | 是 | [官网](https://gr-research.com/contact/) |
| 105 | [HiFiBerry](https://hifiberry.com) | audio, electronics | DB25 | 未声明 | [官网](https://www.hifiberry.com/blog/temporary-suspension-of-us-postal-shipments/) |
| 106 | [Hilltop Boilers](https://hilltopboilersmaplesyrup.com) | maple | Cinnamon Maple Sugar | 未声明 | [官网](https://hilltopboilersmaplesyrup.com/customer-service/) |
| 107 | [HYDRO-FIT](https://hydrofit.com) | swimming, fitness, buoy | Hand Buoys | 是 | [官网](https://www.hydrofit.com/product/hand-buoy-cartons/) |
| 108 | [IC3D](https://www.ic3dprinters.com) | 3d printer, filament, electronics | PolyHex | 是 | [官网](https://www.ic3dprinters.com/support/)（推断） |
| 109 | [Ice Flame Outdoor Gears](https://iceflamegear.com) | sleeping bag, camping quilt, outdoor | quilt | 是 | [官网](https://iceflamegear.com/product/extra-quilt-32f/) |
| 110 | [Insurrection Industries](https://insurrectionindustries.com) | gaming, cables, electronics | Carby | 是 | [官网](https://insurrectionindustries.com/shop/) |
| 111 | [International Publishers](https://intpubnyc.com) | books | Iron | 未声明 | [官网](https://www.intpubnyc.com/browse/salute-to-spring/)（推断） |
| 112 | [J Rockett Audio Designs](https://rockettpedals.com) | guitar, pedal, effects | Aqueous | 未声明 | [官网](https://rockettpedals.com/about-us/)（推断） |
| 113 | [Jeremiahs Pick Coffee](https://jeremiahspick.com) | coffee | Organic Sumatra | 是 | [官网](https://jeremiahspick.com/shipping/) |
| 114 | [Juke Gyms](https://jukegyms.com) | fitness, sport | Functional Trainer | 未声明 | [官网](https://jukegyms.com/contact-us/)（推断） |
| 115 | [Keller Fishing Supply](https://kellerfishingsupply.com) | fishing, outdoor | Xtratuf | 是 | [官网](https://kellerfishingsupply.com/terms-and-conditions/) |
| 116 | [KilnShelf](https://kilnshelf.com) | pottery, kiln, grinding disc | SiC Grinding Disc | 未声明 | [官网](https://kilnshelf.com/shipping-policy/) |
| 117 | [Kinesis Gaming](https://gaming.kinesis-ergo.com) | keyboard, gaming, ergonomic | Freestyle | 是 | [官网](https://gaming.kinesis-ergo.com/customer-service/) |
| 118 | [Kivi Organics](https://kiviorganics.com) | beauty, personal care | Hydration | 未声明 | [官网](https://kiviorganics.com/) |
| 119 | [Kristin Dunn Books](https://www.kdbooks.com) | stationery, menu cover, folio | Linen Menu Cover Folio | 是 | [官网](https://www.kdbooks.com/shipping-information/) |
| 120 | [Lafeber](https://lafeber.com) | pet, food, bird | Nutri-Berries | 未声明 | [官网](https://lafeber.com/refund_returns/) |
| 121 | [Lamson Cutlery](https://lamsonproducts.com) | kitchen | Vintage | 是 | [官网](https://lamsonproducts.com/faq/how-can-i-get-free-shipping/) |
| 122 | [Laurie's Shoes](https://lauriesshoes.com) | footwear, apparel | Cloud X 5 | 是 | [官网](https://www.lauriesshoes.com/shipping/) |
| 123 | [LithiumHub](https://lithiumhub.com) | battery, lithium battery, deep cycle battery | Ionic | 未声明 | [官网](https://lithiumhub.com/shipping-policy/) |
| 124 | [Mansion House Maple](https://mansionhousemaple.com) | maple | Maple Syrup | 是 | [官网](https://mansionhousemaple.com/shipping-information/) |
| 125 | [Maple City Roasters](https://maplecityroasters.com) | coffee | Frosted Gingerbread | 是 | [官网](https://maplecityroasters.com/delivery-information/) |
| 126 | [Maples N More](https://maplesnmore.com) | garden | Ruby De Sofia | 是 | [官网](https://maplesnmore.com/returns-shipping/) |
| 127 | [Mariposa Coffee Company](https://mariposacoffeecompany.com) | coffee, coffee beans | Basecamp | 是 | [官网](https://www.mariposacoffeecompany.com/click-it-and-ship-it/) |
| 128 | [Marshall Street Disc Golf](https://www.marshallstreetdiscgolf.com) | disc golf, disc, sport | Destroyer | 是 | [官网](https://www.marshallstreetdiscgolf.com/policies) |
| 129 | [Matrix Shad](https://matrixshad.com) | fishing, outdoor | Matrix Shrimp | 未声明 | [官网](https://matrixshad.com/) |
| 130 | [MAX 200](https://max200.com) | dog, agility, pet | jump | 是 | [官网](https://max200.com/shipping-returns/) |
| 131 | [Mid South Ceramics](https://midsouthceramics.com) | ceramics, pottery, clay | Clay Essential Tool Kit | 未声明 | [官网](https://midsouthceramics.com/shipping-returns/) |
| 132 | [Millers Purely Maple](https://www.millersmaple.com) | food | Bourbon Barrel | 是 | [官网](https://www.millersmaple.com/new/faqs/)（推断） |
| 133 | [Model F Keyboards](https://modelfkeyboards.com) | keyboard, computer | Beam | 是 | [官网](https://modelfkeyboards.com/?tab=options) |
| 134 | [Monimoto](https://monimoto.com) | motorcycle, gps tracker, electronics | Tracker | 未声明 | [官网](https://monimoto.com/shipping-and-returns/) |
| 135 | [Morgan Amps](https://morganamps.com) | guitar, amplifier | AC20 | 是 | [官网](https://www.morganamps.com/contact/)（推断） |
| 136 | [Morgan's Shoes](https://morganshoes.com) | footwear, apparel | Adrenaline | 是 | [官网](https://morganshoes.com/returns/) |
| 137 | [Morse Farm](https://morsefarm.com) | maple | Amber Rich | 是 | [官网](https://www.morsefarm.com/wp-content/uploads/2025/10/Catalog_Winter26_Morse_NOCROPS-1.pdf) |
| 138 | [Motodemic](https://motodemic.com) | motorcycle, headlight, auto parts | Triumph Bonneville | 是 | [官网](https://motodemic.com/policies/) |
| 139 | [New Society Publishers](https://newsociety.com) | books, farming, gardening | Profitable | 是 | [官网](https://newsociety.com/shipping-returns-refunds/) |
| 140 | [NewSoil Vermiculture](https://newsoil.org) | garden | OurCompost | 未声明 | [官网](https://newsoil.org/) |
| 141 | [Nigel Beauty Emporium](https://nigelbeauty.com) | beauty, personal care | Glow Fixation | 是 | [官网](https://www.nigelbeauty.com/shipping-policy/) |
| 142 | [Ojai Jelly](https://ojaijalapenojelly.com) | food | Pomegranate Syrup | 是 | [官网](https://ojaijalapenojelly.com/product/ojai-pepper-jelly-assorted-trio/)（推断） |
| 143 | [Old Chicago Coffee](https://oldchicagocoffee.com) | coffee | Single Serve Coffee House Blend | 未声明 | [官网](https://oldchicagocoffee.com/faq/)（推断） |
| 144 | [Organic Bunny](https://theorganicbunny.com) | beauty, personal care | Shampoo | 未声明 | [官网](https://www.theorganicbunny.com/?taxonomy=product_shipping_class&term=free-shipping) |
| 145 | [Origins Coffee Roastery](https://originscoffee.xyz) | coffee | Ethiopia Guji | 是 | [官网](https://originscoffee.xyz/) |
| 146 | [Orleans Coffee](https://www.orleanscoffee.com) | coffee, beans, chicory | Chantilly | 是 | [官网](https://orleanscoffee.com/faqs/) |
| 147 | [Osceola Cheese](https://osceolacheese.com) | food | Dill Pickle Hot Sauce | 未声明 | [官网](https://osceolacheese.com/shipping-return-policy/) |
| 148 | [Peavey](https://peavey.com) | audio, guitar, amplifier | One | 未声明 | [官网](https://peavey.com/product/15-low-rider-subwoofer/) |
| 149 | [PedalPCB](https://pedalpcb.com) | guitar, pedal, electronics | PedalPCB | 未声明 | [官网](https://www.pedalpcb.com/contact/) |
| 150 | [Prime Green Coffee](https://primegreencoffee.org) | coffee | Maragogipe | 未声明 | [官网](https://primegreencoffee.org/faqs/)（推断） |
| 151 | [Purity Woods](https://store.puritywoods.com) | beauty, personal care | Pur-Radiance | 未声明 | [官网](https://store.puritywoods.com/returnsandshipping/) |
| 152 | [Rambler Scrambler Coffee](https://ramblerscramblercoffee.com) | coffee | Smooth Drive | 是 | [官网](https://ramblerscramblercoffee.com/return-refund/)（推断） |
| 153 | [Raven Audio](https://ravenaudio.com) | audio, amplifier | Nighthawk | 是 | [官网](https://ravenaudio.com/company/)（推断） |
| 154 | [RECON Fishing Systems](https://reconfishingsystems.com) | fishing, outdoor | Cradle | 是 | [官网](https://reconfishingsystems.com/technical-pages/refund_returns/)（推断） |
| 155 | [Renaissance Farms](https://renaissancefarms.org) | garden | Indiana Paw Paw | 是 | [官网](https://renaissancefarms.org/contact/)（推断） |
| 156 | [Resistance Band Training](https://shop.resistancebandtraining.com) | fitness, sport | Band | 是 | [官网](https://resistancebandtraining.com/faqs/) |
| 157 | [Restoration Games](https://restorationgames.com) | board game, tabletop game, unmatched | Thunder Road: Ignition | 未声明 | [官网](https://restorationgames.com/store-policy/) |
| 158 | [Rhododendrons Direct](https://www.rhododendronsdirect.com) | garden | Triple Crown | 未声明 | [官网](https://www.rhododendronsdirect.com/) |
| 159 | [Richardsons Candy Kitchen](https://richardsonscandy.com) | candy | Autumn Deerfield | 是 | [官网](https://richardsonscandy.com/candy/information/customer-service/)（推断） |
| 160 | [Ride1Up](https://ride1up.com) | electric bicycle, bicycle, ebike | Revv1 | 未声明 | [官网](https://ride1up.com/shipping/) |
| 161 | [Ripe and Roasted](https://ripeandroasted.com) | stationery, greeting cards, art prints | California Poppy Cards | 是 | [官网](https://ripeandroasted.com/faq/) |
| 162 | [Rising Star Coffee](https://risingstarcoffee.com) | coffee | Baroida | 是 | [官网](https://risingstarcoffee.com/faq/)（推断） |
| 163 | [Rose Metal Press](https://rosemetalpress.com) | books, poetry, literature | Rose | 未声明 | [官网](https://rosemetalpress.com/)（推断） |
| 164 | [RTL SDR Blog](https://www.rtl-sdr.com) | radio, electronics, antenna | RTL-SDR | 未声明 | [官网](https://www.rtl-sdr.com/buy-rtl-sdr-dvb-t-dongles/) |
| 165 | [Rubins Hot Sauce](https://store.rubinshotsauce.com) | food | Grilling Barbecue | 未声明 | [官网](https://store.rubinshotsauce.com/)（推断） |
| 166 | [San Diego Pepper Company](https://sdpeppercompany.com) | food | San Diego Sauce | 未声明 | [官网](https://sdpeppercompany.com/)（推断） |
| 167 | [Scented Expressions Supplies](https://scentedexpressions.com) | fragrance oil, craft supplies | Fluff Of Sweetness | 是 | [官网](https://scentedexpressions.com/terms-shipping-returns/) |
| 168 | [Seven Cups](https://sevencups.com) | tea | Youle Gaoshu | 未声明 | [官网](https://sevencups.com/seven-cups-faq/)（推断） |
| 169 | [Shop Carolina](https://shopcarolina.org) | apparel, shirt, vintage clothing | Lady Dragon Slayer | 未声明 | [官网](https://shopcarolina.org/product/genuine-bull-durham-mug/) |
| 170 | [Smoky Lake Maple](https://www.smokylakemaple.com) | maple sugaring, sap tubing, maple equipment | End Line Tee | 是 | [官网](https://www.smokylakemaple.com/) |
| 171 | [Snyder Shoes](https://snydershoes.com) | footwear, apparel | Kerri | 是 | [官网](https://snydershoes.com/shipping-policy)（推断） |
| 172 | [Soccer Unlimited](https://soccerunlimitedusa.com) | soccer, footwear, cleats | Predator | 是 | [官网](https://www.soccerunlimitedusa.com/returns-replacments/) |
| 173 | [Soldano](https://soldano.com) | guitar, amplifier | SLO-100 | 是 | [官网](https://www.soldano.com/returns/) |
| 174 | [Spice Dazzle](https://spice-dazzle.com) | food | Vietnamese Cinnamon | 是 | [官网](https://spice-dazzle.com/)（推断） |
| 175 | [Sponge Bar](https://spongebar.com) | knitting, knitting machine, replacement parts | WHEEL AND BRUSH KIT | 未声明 | [官网](https://spongebar.com/faq/) |
| 176 | [Stone Leaf Teahouse](https://stoneleaftea.com) | tea | Yi Wu Gu Shu | 是 | [官网](https://www.stoneleaftea.com/terms-conditions/)（推断） |
| 177 | [Strictly Medicinal Seeds](https://strictlymedicinalseeds.com) | garden | Black Diamond | 未声明 | [官网](https://strictlymedicinalseeds.com/shipping-info/) |
| 178 | [Suluk 46](https://suluk46.com) | camping, cookware, stove | miksa | 是 | [官网](https://suluk46.com/faq/) |
| 179 | [Sutton's Shoes](https://suttonsshoes.com) | footwear, apparel | Mega Comfort | 是 | [官网](https://suttonsshoes.com/our-policies)（推断） |
| 180 | [Tanbark City Roasters](https://www.tanbarkcityroasters.com) | coffee | Espresso Blend | 未声明 | [官网](https://www.tanbarkcityroasters.com/store/)（推断） |
| 181 | [TeBella Tea](https://tebellatea.com) | tea | Campfire Smores | 是 | [官网](https://tebellatea.com/shipping-handling/) |
| 182 | [Tekton Design](https://tektondesign.com) | audio, speakers | Double | 未声明 | [官网](https://tektondesign.com/faq/) |
| 183 | [TerraTrike](https://terratrike.com) | bicycle, recumbent, tricycle | Spyder | 是 | [官网](https://www.terratrike.com/resources/orders-returns/) |
| 184 | [Tether Tools](https://tethertools.com) | photography, tablet mount, phone mount | AeroTrac | 未声明 | [官网](https://tethertools.com/about/frequently-asked-questions-faq/?Display_FAQ=2744590) |
| 185 | [Tone King](https://toneking.com) | guitar, amplifier | Imperial | 是 | [官网](https://www.toneking.com/contact/) |
| 186 | [Triode Wire Labs](https://triodewirelabs.com) | audio, cables | Eleven | 是 | [官网](https://triodewirelabs.com/about-triode-wire-labs/)（推断） |
| 187 | [Trogotronic](https://trogotronic.com) | synthesizer, electronics | Constellation | 是 | [官网](https://trogotronic.com/product/m286/) |
| 188 | [Truly Ergonomic](https://trulyergonomic.com) | keyboard, computer, ergonomic | CLEAVE | 是 | [官网](https://trulyergonomic.com/guarantee-terms-conditions/) |
| 189 | [TRVE KVLT Coffee](https://trvekvltcoffee.com) | coffee | KAFFE STORM | 是 | [官网](https://trvekvltcoffee.com/terms-conditions/)（推断） |
| 190 | [Turn of the Century Editions](https://turnofthecenturyeditions.com) | books, architecture, photography | Julius Shulman | 未声明 | [官网](https://turnofthecenturyeditions.com/contact-and-ordering/) |
| 191 | [Two Men and a Garden](https://twomenandagarden.com) | food | Italian Style Pink | 未声明 | [官网](https://twomenandagarden.com/) |
| 192 | [Ultimate Green Lights](https://ultimategreenlights.com) | fishing, outdoor | Green Underwater | 未声明 | [官网](https://ultimategreenlights.com/) |
| 193 | [Unusual Seeds](https://unusualseeds.net) | garden | Lithops terricolor | 未声明 | [官网](https://unusualseeds.net/how-to-order/) |
| 194 | [Uzzi](https://uzzi.com) | apparel, swimwear | Swim Shorts | 是 | [官网](https://uzzi.com/shipping-policy/) |
| 195 | [VTV Amplifier](https://vtvamplifier.com) | audio, amplifier | SINGLE | 未声明 | [官网](https://vtvamplifier.com/frequently-asked-questions/) |
| 196 | [Wade's Mill](https://www.wadesmill.com) | flour, baking, grains | Rockin | 未声明 | [官网](https://www.wadesmill.com/terms-conditions/) |
| 197 | [War Eagle Mill](https://wareaglemill.com) | food | Cornmeal | 未声明 | [官网](https://wareaglemill.com/shipping-and-returns/) |
| 198 | [Whiskey Tit](https://whiskeytit.com) | books, literature | Ordinary | 未声明 | [官网](https://whiskeytit.com/the-tit-alt-weeklied/)（推断） |
| 199 | [R.L. Winston Rod Company](https://winstonrods.com) | fishing, fly rod | AIR | 是 | [官网](https://winstonrods.com/company/warranty-repair/refund_returns/)（推断） |
| 200 | [Wockenfuss Candies](https://wockenfusscandies.com) | candy | Gummi Bats | 未声明 | [官网](https://wockenfusscandies.com/faq/) |

## 搜索及运维边界

- 一次 Woo 聚合最多选择 6 家，Backend 每次目标检索最多两次聚合，合计最多 12 家；200 是访问名单，不能写成每次搜索覆盖200家。
- 品牌优先，其次匹配品类；同分商家按查询稳定分散。已冷却或隔离商家不占用可用的六个位置。商品 URL 只访问对应注册商家。
- 格式错误只冷却该店相同搜索请求五分钟，其他词和精确读取仍可用；429 遵守 Retry-After，访问拒绝和安全失败仍隔离。并发旧请求不能清除新隔离，后续页发送前重新检查。
- 每来源仍是 8 秒、18 次读取、8 MiB；每读取仍是 3 秒／1 MiB。没有后台全站爬取或新数据库。
- 选中规格价必须来自对应子变体；必填自定义选项缺失、订阅、押金或起价不能冒充完整商品报价。访问表不授予信任、品牌授权或联盟资格。
- 部分书店商品页为预售，API 却标 IN_STOCK（包括 New Society、Rose Metal、Whiskey Tit）；这只保留 API 观察，不能承诺立即发货。Motodemic 的 reader 样本是 outlet 退货品，独立 controller 样本是另一常规款；并未把两者身份、货况或价格合并。部分商家验证的是主营配件，不能扩大声称已验证整机。各项差异见证据账本。

## 可直接测试

1. `用 FindCheap 找 Restoration Games Thunder Road: Ignition，确认实际来源和商品价。`
2. `查 https://generalpencil.com/product/54r/ ，说明价格和是否现货，不把预订写成可立即发货。`
3. `查 https://blueridgeoilpaint.com/product/nickel-yellow-dp/?attribute_size=40ml ，锁定40ml规格，不用父商品价格范围。`
4. `用 FindCheap 找 Peavey 吉他音箱，保留真实型号并说明本次查了哪些商家。`
5. `找手摇磨豆机，不限定品牌；让所有已配置来源参与，并说明 Woo 本轮覆盖限制。`

以上提示词供真实宿主验收；来源接口、安装 SDK 与原生图片／选中商品／Watch 生命周期的结果分别记录于[交付记录](../engineering/changes/2026-09-08-woocommerce-expansion-200.md)。本次没有创建真实 Watch 或 Automation。
