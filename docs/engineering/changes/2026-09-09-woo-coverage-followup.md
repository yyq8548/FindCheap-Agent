# F10/F11：有界 Woo 热门品类覆盖和来源故障复核

## Research

- 基线：v0.18.5、main起点7401b6d；当前工作树已有并行NF01/NF02/NF04及安装器修复，不覆盖其他人的文件。用户授权继续完成可控修复；主任务批准本步已有商家元数据和定向测试。原图/40+40继续暂缓。
- 适用总设计4.1、5.1/5.2、7、10、13：身份和所选规格先于价格；缺价不生成卡；接入不等于可信；保留6家/12次有界请求、安全重定向拒绝和失败分母。依照研发协议先研究、两案、冻结后实现。
- 拓扑：DEFAULT_WOO_REGISTRY → planWooMerchants → createWooCommerceController → createWooStoreReader → pinned safe fetch/原始schema → normalizeWooProduct → Backend/MCP资格。元数据只决定候选商家排序，raw.brands和商品title/所选属性决定商品证据，不能由新增品牌tag证明商品品牌或信任。
- FACT：登记1002家。对audio/headphone/wig标签和历史故障相关商家进行3并发、每商家最多现有controller预算的只读请求；未改生产、无新HTTP权限、不跟随API重定向。初始merchantId筛选包含maple也带入11家糖浆/工业类记录，保留完整分母而不作为耳机/假发覆盖。脚本及逐店原回执在 `artifacts/woo-coverage-followup/`。
- FACT：既有GR-Research只标audio/speakers、GR Research品牌；真实headphone查询返回Verum 2八个有价所选变体，USD425/499，所选Color+Package及库存明确。官网[耳机类目](https://gr-research.com/product-category/headphones/)及[Verum 2](https://gr-research.com/product/verum-2-headphones-copy/)证实品类；[Meze 109 Pro](https://gr-research.com/product/meze-109-pro/)明确只向美国市场销售。Meze纳入本步品牌tag以真实API同样命中为前提。
- FACT：Recool和Silent仍为requiresOptionSelection，API返回的父级自定义选项不能作为所选规格价，当前结果无有效商品价；保留缺口。其他audio商家中的耳放、线材和转接头不能计作消费耳机。
- FACT：Orleans旧origin为www域，真实API首跳301到无www同一路径；reader显式拒绝全部API重定向，所以SECURITY_REJECTED正确。无www已是该商家审核alias/imageHost及marketEvidence，官方[首页](https://orleanscoffee.com/)和[About](https://orleanscoffee.com/about/)一致。根因是canonical元数据落后，不需放宽redirect。主任务已批准只交换origin/alias，主机集合不变。
- FACT：MapleCity和Blue Mountain本轮正常200/application-json，旧JSON/Content-Type错误未复现；原历史失败保留，不能猜测旧HTML内容或放宽schema。Sony历史CODE缺原值，已有日志不足以定位，且本步不扩展Sony跨店研究。
- UNKNOWN：全部1002家当前可售覆盖、本轮外的商品/规格、最终原生卡与热门品牌规模。研究重放和API层有价不等于最终信任/预算/系统匹配或原生验收。

## Propose

| 方案 | 收益 | 风险/成本/回滚 |
| --- | --- | --- |
| A（选择）：修正既有GR品类/品牌与Orleans canonical元数据 | 恢复可验证已有覆盖，减少无关探索；不增数量/信任/网络host | 两条商家记录和定向合同断言；失败只回退记录 |
| B：维持当前元数据，禁用Orleans并仅通过商品URL定向访问GR | 能避免Orleans每次失败；URL用户仍可找到GR | 普通耳机查询继续漏相关来源，已审核裸域接口无法利用；不解决元数据缺陷，可在无安全canonical证据时使用 |

选择A。主任务分别批准GR公开API/页面证明的品类/品牌与Orleans既有alias的canonical交换。新增商家、信任、价格逻辑、安全规则均不在本步骤。

## Plan v1（实现前冻结）

| 步骤 | 原子范围与不变量 | 构建/断言与退出条件 |
| --- | --- | --- |
| W1/无 | 在研究目录核对GR Meze有价API和Orleans裸域直连；拒绝后的其它任意域/代理不试 | 受控现有controller，原始schema/预算/redirect规则不变；未成功的品牌/host不新增 |
| W2/W1及source构建锁 | 仅woocommerce-merchants.ts两条记录：GR headphone类目及证实品牌；Orleans origin/alias交换和对应evidence更新 | 先红：完整默认registry路由GR、品牌仍只路由、6店/12请求预算，canonical host与旧www URL归属相同merchantId，host集合不扩大，reader任何redirect仍拒绝；原子修改后立即pnpm build:awin-feed及定向测试 |
| W3/W2 | 形成按真耳机/配件/假发/咖啡形态分离的有价覆盖矩阵，保留各故障历史/当前分母；交主任务验收 | 源服务相关回归、lint/diff；本步不部署、不提交、不改主版本、不占MCP构建。运行产物由主任务集成 |

## Implement / Test

W1完成：Meze 109 Pro真实Store API返回简单商品232155，USD799、IN_STOCK；Orleans裸域直连2次200 JSON，返回8个有明确grind/weight的所选变体，USD14.25/36.50、IN_STOCK。此处与原www失败分别留存，未改写原失败回执。全部请求通过原有controller及网络守卫。

W2完成：仅修两条现有登记。GR新增headphone/headphones和Verum/Meze路由tag及公开证据；Orleans交换origin/alias，host集合仍严格为orleanscoffee.com与www.orleanscoffee.com。旧www商品URL仍归属于同一merchantId；任何API 301仍拒绝。总商家数1002、信任门槛、来源并发/预算、价格归一化未改。

新增`woocommerce-coverage-followup.test.ts` 10项断言，红7/10→原子修改→立即`pnpm build:awin-feed`通过→绿10/10。第一次扩大回归保留2/1157失败：旧测试把Silent固定为首选相关商家、把200家历史记录逐项固定；已把前者改为仍在有界相关商家集合内，把后者限定为这两条明确批准的元数据差异，历史台账及其他198条和800条增量未改。最终17文件1157项通过，lint和diff检查通过。

| 局部验收记录 | 结果 | 日志（仓库内artifacts目录） |
| --- | --- | --- |
| W2新回归首次红 | 7 FAIL / 3 PASS | `woo-coverage-followup/metadata-red.log` |
| source即时构建 | PASS | `woo-coverage-followup/metadata-build.log` |
| W2新回归绿 | 10 PASS | `woo-coverage-followup/metadata-green.log` |
| 扩大Woo回归首次 | 2 FAIL / 1155 PASS；上述两项元数据约束 | `woo-coverage-followup/source-regression-initial-failed.log` |
| 扩大Woo最终 | 17文件 / 1157 PASS | `woo-coverage-followup/source-regression.log` |
| 相关文件eslint | PASS | `woo-coverage-followup/lint.log` |
| NF01已有测试类型修正 | 2文件 / 34 PASS；补brandMode和可空query检查，不改断言目标 | `native-followup-remediation/nf01-test-types-green.log` |

## W3：实际覆盖矩阵与剩余边界

初轮完整分母为35商家、47次请求：32 COMPLETE、1 PARTIAL、2 UNAVAILABLE。包括20家audio、1家wig、3家指定咖啡故障商家、11家筛选额外带入的maple记录。第二轮定向Meze/Orleans为2商家、3次请求，均COMPLETE；这是后续验证，不覆盖初轮失败。`COMPLETE`仅表示本次有界请求完成。

| 范围 | 本轮真实证据 | 能计入的覆盖 / 限制 |
| --- | --- | --- |
| GR-Research：Verum 2 | 商品241330的8个已选Color/Package变体，VARIANT价USD425/499，IN_STOCK；API与官方商品页一致 | 1真耳机型号、8个有价规格；不符合≤USD350预算 |
| GR-Research：Meze 109 Pro | 定向API简单商品232155，PRODUCT价USD799，IN_STOCK；官网明确美国经销范围 | 再增加1真耳机型号；不符合≤USD350预算；不是由商家tag推断商品品牌 |
| Silent Sound System | 8个结果混有耳机和替换耳垫，requiresOptionSelection，价格/库存UNKNOWN，来源PARTIAL/UNSUPPORTED | 0个已验证可比较价；父项及附加选项价不升级为所选规格价 |
| Sparkos、Audio Envy、DH Labs、Douglas、Peavey（5家） | 命中有价耳放、线材、插头、转接头 | 配件/耳放覆盖，不能计作消费耳机 |
| Raven Audio | 2次请求后TIMEOUT、0结果 | 本轮不可用；不能推断全店无货 |
| 其余12家audio | 此次headphone查询0结果 | 仅本查询未命中，不宣称没有耳机库存 |
| Recool Hair | 8个假发父项，requiresOptionSelection，价格/库存UNKNOWN；[运输页](https://www.recoolhair.com/payment-shipment)有美国运输证据 | 0个已选规格有价假发；美国可送证据无法替代选项价 |
| Blue Mountain Coffee | 200 JSON、4次请求，返回8个有价已选豆种/烘焙/研磨/重量变体 | 有界咖啡规格覆盖；不是Original胶囊证明；旧Content-Type故障仍保留历史未知 |
| Maple City Roasters | 200 JSON；1个USD1的Buy Scott A Coffee条目及4个无价咖啡变体 | USD1条目是捐赠，不算实物咖啡；本轮0个有价实物咖啡规格；旧JSON/schema故障未复现 |
| Orleans Coffee | 旧www首跳301被拒；批准裸域直连返回Chantilly Cake咖啡8个有价grind/weight变体 | canonical修复有真实证据；仍需身份/类别/预算/信任审核，不是Original胶囊覆盖 |
| 11家额外maple记录 | 全部分母及原回执保留，部分命中咖啡或咖啡杯 | 不计作本轮耳机/假发热门覆盖 |

官网耳机类目还列出Verum 1 MKII（页面USD359）和更高价Meze型号；未对这些逐项取得本轮Store API所选规格证明，因此不纳入上表API有价计数。公开发现未找到同时具备Woo Store API、USD/美国市场及可核验规格价的新热门耳机/假发商家，本步不添加未经证实的商家。经验证的真实耳机覆盖为1家、2型号；本轮≤USD350真耳机和有价假发覆盖都为0。不能用1002家注册数量替代这些缺口。

Orleans的故障根因已定位并修复元数据；Maple/Blue历史响应体和Sony历史SCHEMA_INVALID/CODE原值不在现有证据中，保留UNKNOWN，不为消除故障统计而放宽schema。Raven当前TIMEOUT保留为来源现状。缺失的热门预算覆盖需要后续真实来源准入证据，无法通过安全放宽或父价填充完成。

Windows安装器只读评审发现installed/source额外文件集合未核验，已告知主任务；主任务已先红后修并验收，本文件不修改安装器。另对NF04只读复核发现注释/模板字符串中的未执行wpmLoader配置可被错误接受为USD证明，已向模块负责人和主任务交付最小反例`artifacts/woo-coverage-followup/nf04-readonly-counterexample.ts`及输出；该模块修复/验证由其负责人记录。

本步完成本地实现、受控真实来源读取和有意义局部回归；尚未由本步骤执行部署、安装缓存替换或原生宿主最终卡验收，交由主任务统一集成，不能把上述API矩阵当作原生验收通过。

## W4 Research：追加标准有价假发候选（尚未准入）

主任务随后授权追加最多15个新商家、每家一次安全GET探针，优先标准simple/variation；不开发Recool自定义加价系统，不把技术接入升级为信任。沿原有reader执行，无重试、无登录、无重定向或网络边界变化。已检索既有候选/不合格清单，无下列域名的既有准入记录。

2026-09-09 20:15–20:18 UTC共8家API探针，3家200 JSON，5家未通过；预算记录共7次HTTP请求，Keltic失败在计入请求前。每店原始回执保存在`artifacts/woo-coverage-followup/*-candidate-probe.json`，全部失败保留：

| 商家 | 单次探针结果 | 结论 |
| --- | --- | --- |
| www.tatihair.com | 403 ACCESS_DENIED | 停止；虽然官网有美国市场及商品页，不能绕过拒绝 |
| mollybeautysupply.com | TIMEOUT | 本轮未取得API证据，停止 |
| www.kelticbee.com | UPSTREAM_UNAVAILABLE，计数0 HTTP | 本轮未取得API证据，停止 |
| www.hiddensecretswigs.com | 200标准variation，3个Nouli Wigliner配件，USD18.40 | API可用；不能把wigliner当wig。官网有[Fascination真假发](https://www.hiddensecretswigs.com/product/fascination/)、[美国全国配送说明](https://www.hiddensecretswigs.com/wigs-for-sale/page/2/)，可作为下一步精确商品验证候选 |
| legacylacewigs.com | 200标准variation，Ashia父8298、子8314/8313/8312，USD1185/1335/1285 | 技术价格存在，但[首页](https://legacylacewigs.com/)有明显无关博彩SEO段落，本步不建议准入或信任 |
| www.adorawig.com | 404 NOT_FOUND | 标准API路径不可用，停止 |
| 2xhair.com | UPSTREAM_UNAVAILABLE | 本轮未取得API证据，停止 |
| store.ladybsalon.com | 200标准variation，Bob父519/子535为14英寸USD310、子534为12英寸USD280；Water Wave父197/子537为20英寸USD360，全部IN_STOCK | 真实标准价格候选；仍需父项属性与所选variant绑定核验。主域官网导航直接链接该商店，商店[首页](https://store.ladybsalon.com/)明确全国美国配送；[Bob商品页](https://store.ladybsalon.com/product/bob-wigs/)仅显示长度选项。商店存在USD1 test商品、旧Hostinger页脚链接，不作为信任证据，也不跟随额外域 |

额外公开网页预筛的Vellura是BRL巴西店、未发API请求；其余明显Shopify或配件来源不计入Woo成功数量。此轮未修改registry。

方案A：优先对已有200的Hidden Secrets精确Fascination补核父项和所选颜色，成功后只新增一条技术搜索记录；优点是公开零售与标准商品结构更明确，仍不升级信任。方案B：对Lady B既有Bob标准variation补父项核验后技术准入；已有价且美国页明确，但网站模板残留降低成熟度信心，应保留搜索资格边界。第三方声誉、品牌授权和主流覆盖都未在此步确认。两案和有界补核范围已提交主任务，待冻结后才继续API补核或名单写入。

NF06独立只读审查：condition一致性修复先验证canonical condition已知相等及重复选项全部一致，再去除冗余condition维度；GTIN/MPN冲突、其他规格及packaging限制保留。本次重跑新增12项全通过，未发现直接回归。NF04的两个注释/模板字符串反例在AST修复后复跑均为`ambiguous:true, prices:[]`，原错误证明已消除。

### W4 Plan v1（2026-09-09追加授权，实现前冻结）

主任务批准A：Hidden Secrets优先，Lady B只作后备，本轮最多新增1家；公开证据充分即可授予技术搜索资格，不进入可信或官网库。方案A/B及上述首轮8家分母保留。

1. W4.1只读补核：只在已成功的www.hiddensecretswigs.com追加最多6次API GET，取得Fascination父项、最多3个所选variation以及既有controller有界搜索；公开商品/美国运输页补核不访问购物车、登录、付款、表单。遇拒绝立即停，不尝试新域或绕过。原始reader的schema、网络/响应/超时规则不变。验证父ID、variationId、Color、USD、price scope、purchasable/stock及页面无额外付费必选项；不足则不准入。
2. W4.2依赖W4.1和source构建锁：只新增一条商家registry记录和可移植准入证据/定向测试。只包含实际观察过的origin、商品路径、图片host、品类/品牌；无trust字段。先红：真实夹具经controller取得所选假发价、完整registry路由该店、未知品牌不被商家tag提升、网络host和6家/12请求预算保留；最小修改后立即build:awin-feed并跑新断言。
3. W4.3回归：更新仅因新商家追加而受影响的数量/增量夹具，历史1000+2原始台账不改；运行全部Woo相关测试、lint/diff，向主任务交接。未执行原生宿主/部署不写通过；由主任务统一发布。发现不符合标准变体或市场证据即返回Research，不开发新适配器。

### W4.1新事实与退回Research

父商品19030/Fascination有27个Color变体，父项只有Color为has_variations；定向include的子20910/20911/20912经现有normalizer正确得到rl10-12/rl11-25/rl119、VARIANT价USD232、IN_STOCK。实际API价与网页搜索缓存的USD203–213不同，以有时间的API观察记录，不把旧缓存当当前报价。商品图片使用页面与API都观察到的cdn.shortpixel.ai。公开销售页有美国全国配送说明，原有页面与API准入边界不变。

但完整controller搜索Fascination首轮0结果，第二请求为PRODUCT_SCHEMA。追加一次受控读取后用原reader逐条离线验证：20条中19条通过，1条失败；子20928的`sku:false`违反可选字符串schema，父ID/子ID/URL/价格/所选颜色字段存在。完整原始回执与离线失败条目保存在`hidden-secrets-schema-raw.json`、`hidden-secrets-schema-failed.json`；失败分母不能被前三个成功变体覆盖。补核API已用5/6请求，未改生产、未准入。PDP直读因超过1MiB限额被拒，未放宽体积或重试。

修正方案A：仅把可选SKU的显式false解释为缺失undefined，其余已有字符串限制保留，true/null/number/object仍拒绝；不构造SKU，不改变父子ID/商品URL/选定规格价绑定。方案B：保持当前SKU schema，不准入该店。A是低影响可选字段兼容，但超出原纯元数据步骤，已向主任务申请冻结该字段及定向合同范围，批准前不写实现。

### W4 Plan v2（主任务批准A，实现前冻结）

作用链为Woo reader RawProduct.sku→normalizeWooProduct→controller所选规格→Backend/MCP；SKU仅在真实字符串存在时作为身份辅助，false只删除可选证据，不能代替父子ID/URL或证明品牌。其余RawProduct schema保持。

- W4.S1：用原始20中1条false-SKU夹具先写红断言，覆盖false→undefined及true/null/number/object/过长字符串拒绝；增加ID/父绑定/币种/URL守卫断言。只改woocommerce-store.ts的sku一处定义，立即build:awin-feed与定向测试。
- W4.S2/S1：使用剩余1次API补核取得父19030的第2页子项，保存全部27条可移植真实fixture（包括原false-SKU），回放原controller 0→有价选中颜色。仅随后新增Hidden Secrets单条metadata及registry修订号，保持新增host精确为www.hiddensecretswigs.com和已观察cdn.shortpixel.ai图片域。先红准入/路由/数量断言，原子metadata修改后立即source构建和定向测试。
- W4.S3/S2：全部Woo相关回归、lint/diff及共享消费者契约；MCP最后集成由主任务持锁构建。API总预算6次补核不扩大，修复后本步骤用已冻结原始回执重放而非额外真实请求；最终原生验收由主任务执行。保留初轮source失败及页面体积拒绝，不提升可信或官网，不加入第二商家。

### W4 Implement / Test / 交接

W4.S1完成：新增8项可选SKU合同，原实现1 FAIL/7 PASS；只把`sku:false`转换为undefined，立即source构建通过，8项全绿。未改变其他SKU类型拒绝、长度上限、价格币种、父子/URL/选定属性规则。

W4.S2完成：剩余第6次API补核200，获得第2页7个子项，形成父19030和全部27个子项的固定真实夹具`apps/awin-feed-service/test/fixtures/woocommerce-hidden-secrets.json`。夹具包含第一页面20中1个false-SKU失败事实；只裁剪非合同的展示字段/图片srcset，未替换价格、SKU、ID或属性值。新增4项准入/路由/实际controller回放断言先4 FAIL，追加Hidden Secrets记录及registry版本`2026-09-09-priority-1003`后立即source构建通过、4项全绿。

回放Fascination指定rl10-12：3次源请求、1个结果，父19030/子20910、VARIANT价USD232、IN_STOCK、选中Color明确、可用图片仍来自已观察cdn.shortpixel.ai。该结果的condition仍UNKNOWN、子项品牌仍缺失，不用商家路由tag补商品事实，也不写“全新／品牌已确认／可信首选”。这是标准可选假发技术价格覆盖，不能冒充已经满足任意品牌/全新/预算要求或原生最终卡验收。

仅把两个受影响旧测试的最终registry数量1002改为1003；历史1000台账和Recool/Silent原记录均保留。最终19文件1169项Woo回归全通过、相关eslint和diff检查通过。source构建锁已交给Awin模块负责人，本步骤不再写运行源码。最终项目typecheck/MCP集成、发布、安装缓存和原生验收由主任务执行。

| 本轮验证 | 结果 | `artifacts/woo-coverage-followup/`日志 |
| --- | --- | --- |
| false-SKU红→绿 | 1 FAIL/7 PASS→8 PASS | `missing-sku-red.log` / `missing-sku-green.log` |
| false-SKU即时构建 | PASS | `missing-sku-build.log` |
| 单店准入红→绿 | 4 FAIL→4 PASS；联合12 PASS | `hidden-secrets-admission-red.log` / `hidden-secrets-admission-green.log` |
| 单店准入即时构建 | PASS | `hidden-secrets-admission-build.log` |
| 全Woo回归 | 19文件1169 PASS | `hidden-secrets-regression.log` |
| eslint | PASS | `hidden-secrets-lint.log` |

最终集成首轮另发现两项新测试的NodeNext JSON import缺少type属性，补显式`with { type: "json" }`后新增12项再通过、`pnpm exec tsc --noEmit`通过（`hidden-secrets-import-green.log`、`hidden-secrets-typecheck.log`）。历史信任smoke仅对Orleans已批准canonical变更添加单记录例外，仍断言旧www来源及新旧两host集合相等；其余199条身份不放宽。后来搜索商家断言802更新为803，新增店不得自动信任断言完整保留。该smoke与新增两文件共19项通过（`hidden-secrets-smoke-green.log`）；主任务保留集成首次失败分母。

更新后的有限覆盖结论：登记1003家；原W3记录的假发有价0是追加研究前结果，本轮以1家标准可选有价假发来源补齐技术来源缺口。没有声称主流假发全覆盖或可信推荐完成；≤USD350真耳机缺口仍保留。追加候选首轮8家API探针、5家未通过，Hidden Secrets完整controller首次schema失败和PDP体积拒绝均保留；补核6次API为后续新证据，不能重写首次失败。研究脚本首次正则语法错误发生在网络请求前，修正后执行，原日志保存在`hidden-secrets-controller-script-error.log`，不计作来源失败或真实成功。

### W5 生产独立核验与一次有界恢复（2026-09-09）

主任务另授权本分工独立核验发布。首次部署`1a6a750c-aeb7-40dd-bc7d-7f71f652064c`经官方CLI确认SUCCESS，SSH读取`/app/dist/main.cjs`的SHA与本地均为`9981ab1dc9c751c55e8092ea0eb4b3fd5b9d26888793847707f62fe087131ff0`。恰好5个公开GET全200：health、ready、official旧表示、official v2、merchant-trust。三个registry的版本、数量及递归规范化全部字段与不可变v0.18.4基线完全相同；数量111/248/393，未新增信任。完整报告`production-v0186-2026-09-09T20-44-48-425Z.json`。

首次生产Feed验收仍FAIL：旧15:58:37Z快照69,409行，连续失败15，新productCoverage不存在。真实新容器终态日志20:43:11Z为`SOURCE_REQUEST_FAILED/SOURCE_RATE_LIMITED`、`quickRetryScheduled=false`。代码和只读账本确认是每Feed固定5次/小时本地预算耗尽，并非HTTP429；29 cache_hit、13 cache_recovered共42可用源，另11无缓存源被预算拒绝，按既有规则不发布不完整新聚合。旧快照staleSourceFeeds=0不能描述本轮13个旧缓存已发布。

独立运维两案冻结于`production-v0186-budget-ops-plan.json`：A等待额度自然恢复后一次同SHA重部署，促使正常启动刷新；B等待约下一常规周期（360分钟，nextAt未持久化，按启动估计次日02:43Z）再观察。主任务基于用户已有部署授权选择A，未清账本、未调配额/360分钟、未设置额外刷新接口。只读取白名单配置得重试次数未设置，代码默认2，所需初始+2重试共3槽；24个受限源最晚3槽自然恢复21:09:05.902Z，冻结not-before为21:09:11Z。账本审计只输出匿名序号、时间、次数和是否已有缓存，不输出URL、完整key、token或商品。

唯一恢复部署`58ce1060-5b38-4876-840e-a08df5f57d20`已在合法窗口后执行，实际HEAD和时刻保存于`production-v0186-recovery-up-once-intent.json`。前置时间、同SHA、source编译输入基线和CreateNew独占意图文件防止提前或重复up；与MCP/文档无关工作树改动不阻止此同source恢复。官方CLI轮询间隔超过60秒确认SUCCESS；再次SSH匹配同SHA。随后仅2个health/ready GET，不重复registry：21:09:58.718Z新快照ready、50有效源、3正常排除（未批准商品URL/币种不支持/无合格商品各1）、stale0、连续失败0；input71,206=published70,146+isolated1,060+deduplicated0，冲突530组。21:10:18.622Z真实`awin_feed_refresh_settled`确认ready、无快速重试。最终报告`production-v0186-final-verification.json`及`production-v0186-recovery-health-2026-09-09T21-11-30-677Z.json`。

本步骤合计7个服务公开GET；只有1次经授权恢复up，由服务正常启动完成来源刷新，审计未直接请求Feed/商家。首次失败、辅助命令的PATH缺失/首次远端表达式引号无输出及本地时间格式转换问题均保留并澄清，不覆盖历史分母。最终生产刷新验收通过，不代替主任务仍在进行的原生业务矩阵或暂缓的人工图片验收。
