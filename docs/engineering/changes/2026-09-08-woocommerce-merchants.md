# WooCommerce 商家公开接口实测：P0

日期：2026-09-08。产品 GET 观察窗口：15:32:07–15:34:19 UTC。基线：FindCheap 0.17.34。本记录属于[独立来源接入计划](../../product/woocommerce-independent-source-plan-2026-09-08.md)的 P0；只报告真实公开接口及商家自己的说明，不代表商家信任审批、生产启用或实际 Codex 购物验收。

## 范围、方法与分母

检查 8 家真实候选商家，执行 27 次逻辑商品 GET，单次 `per_page` 为 3、5 或 10；没有全量翻页、登录、密钥、Cookie、购物车、订单或支付请求。初次 Scrub Daddy 旧子域请求发生自动重定向，因此实际 HTTP 次数至少为 28，初始跳转状态和完整跳数未留存。后续请求全部禁用自动重定向，并直接使用新主域。Landyachtz 返回 403 后停止，不尝试绕过。

探测使用 Python 标准库 `urllib.request`，最多 3 个并发，15 秒探测超时、1 MiB 单响应读取上限，User-Agent 为 `FindCheap/0.17.34 (+public-product-api-research)`。15 秒用于诊断，不是生产允许的延迟；是否满足计划的 3 秒请求预算另行判断。未记录响应 Cookie、个人信息或完整商家 HTML；未下载图片二进制。

复测入口是[完整探测索引](../../../apps/awin-feed-service/test/fixtures/woocommerce-live/probe-index.json)：每项包含原始 GET URL、UTC 观察时间、状态、响应大小、耗时及返回 ID。采样 JSON 只保留公开商品字段，删除描述、扩展和响应 Cookie，图片每商品最多保留 3 条引用。Nalgene 搜索样本保留返回的前 2/3 个商品，明确省略大量瓶盖变体；未修改保留字段的事实值。固定样本用于确定性回归，不能作为未来实时价格证明。

总设计适用范围是第 5 节信任与商品事实分开、第 8 节受限执行、第 10 节可靠来源与授权后的 Watch，以及第 13 节独立真实验收。选择方案和实施权限由主任务的已批准计划承接；本步骤只收集证据，不新增商家信任记录或生产配置。

## 实测结论

| 商家 | 商品列表/API 币种 | 搜索合同 | 单品/变体证据 | P0 状态 |
| --- | --- | --- | --- | --- |
| Offerman Woodshop | 200 / USD，minor unit 2 | `trivet` 返回 1 个，列表总量 56 | 父 43848、6 个子变体及单独子商品 GET 通过 | 技术样本通过，约 0.4–0.9 秒 |
| Root Science | 200 / USD，minor unit 2 | `firm` 返回 1 个；`serum` 返回 0，标题检索存在召回限制 | simple 69439 单品 GET 通过 | 技术样本通过，约 0.8–1.6 秒 |
| La Marzocco Home USA | 200 / USD，minor unit 2 | `portafilter` 返回 3/6，列表总量 101 | 父 355289 和 3 个子变体通过，变体价格不同 | 技术样本通过，约 1.2–1.5 秒 |
| Burrow Press | 200 / USD，minor unit 2 | `mother` 返回 1 个，列表总量 79 | simple 23939 单品通过；链接为相对路径 | API 通过；适配器必须通过相对链接和预售状态检查 |
| Scrub Daddy | 200 / USD，minor unit 2 | `original` 返回 3/4，列表总量 162 | 搜索返回 ordinary simple、多件装及缺货样本；本轮未做单品 GET | 搜索样本通过，详情能力本轮未验证 |
| Nalgene | 200 / USD，minor unit 2 | `wide mouth` 返回 3/27，列表总量 100 | 父 877583 和 3 个子变体通过 | 合同通过，但 3 秒生产预算未达标，约 3.9–4.0 秒 |
| Nutribullet | 200 / USD，minor unit 2 | 正常词和不可能词均返回相同 3/179 个商品 | 未继续验证单品；列表夹有延保服务 | 搜索合同失败；保持停用 |
| Landyachtz | 403 / 未获得产品 JSON | 未继续 | 未继续 | 访问被拒；保持停用 |

**分母不变：8 家候选，7 家初始 JSON 可达，6 家有实际搜索过滤证据，3 家完整满足本轮已测核心合同和 3 秒预算（Offerman、Root Science、La Marzocco）。** 这 3 家覆盖木制家居、护肤、咖啡器具，满足计划“至少 3 家、至少 2 类”的 P0 技术样本下限。它们仍需通过适配器、服务预算、身份与用户需求核验后才能计入上线覆盖；没有把搜索可达直接记为最终购物验收。

首批候选以品牌直营为主。La Marzocco 的同一搜索还返回 Acaia 商品 `273042`，提供第三方品牌器具零售样本，但未在本轮审核授权经销身份。不把任何候选自动加入现有可信商家或官网表。

## 逐店事实与市场证据

### Offerman Woodshop

- 注册 origin 候选：`https://offermanwoodshop.com`。API 基路径：`/wp-json/wc/store/v1`。已见图片域名：`offermanwoodshop.com`。
- 搜索：`GET /products?search=trivet&per_page=3`；父商品 `43848`，SKU `WD-KITCHENTRIVET`，标题 `Dovetail &#038; Amorphous Kitchen Trivets`。标题需要 HTML entity 解码。
- 父商品页面：[Kitchen Trivets](https://offermanwoodshop.com/store/kindlin/hearth-home/kitchen-trivets)。价格 `7500`、USD、minor unit `2`，即商品价 $75.00。父级 `is_in_stock=true`。
- 变体查询：`GET /products?type=variation&parent=43848&per_page=10`，响应 `X-WP-Total=6`、`X-WP-TotalPages=1`。每个子对象带 `parent=43848` 和 `_links.up`；子 `attributes=[]`，结构化规格在父对象的 `variations[].attributes`。
- 子 `43860` 是 `Type=Amorphous Trivet`、`Species=Eucalyptus`，价格 $75.00，`is_in_stock=false`。单独 `GET /products/43860` 再次确认缺货。父商品有货不能覆盖子变体缺货。
- 变体页面使用 `attribute_type` 和 `attribute_species` 参数，不使用 Shopify `variant`。参数值保留精确大小写及语义。
- [商家 FAQ](https://offermanwoodshop.com/faq/)明确美国国内 USPS 发货，并说明木制品可能手工制作或另有交期。因此美国配送有商家公开证据；本次没有验证具体地址、运费或送达日期。
- [父商品固定样本](../../../apps/awin-feed-service/test/fixtures/woocommerce-live/offerman-parent.json)、[全部 6 个变体](../../../apps/awin-feed-service/test/fixtures/woocommerce-live/offerman-variants.json)、[缺货子商品单独读取](../../../apps/awin-feed-service/test/fixtures/woocommerce-live/offerman-out-of-stock-variant.json)。

### Root Science

- origin 候选：`https://www.shoprootscience.com`；图片同域；不能擅自去掉 `www`。
- `GET /products?search=firm&per_page=3` 和 `GET /products/69439` 返回同一 simple 商品 `Firm`，SKU `FS-FIRM-10`，商品价 `4800` USD，即 $48.00；API 报告有货、商品评分 `5.00`、9 条评价。
- 商品页面：[Firm peptide serum](https://www.shoprootscience.com/shop/firm-peptide-serum)。评分属于该商品，不属于商家；不能据此授予商家信任。
- `GET /products?search=serum&per_page=3` 返回 HTTP 200、空数组、总量 0。已知标题 Firm 的存在不表示 `serum` 能召回；零响应不能外推为该店没有精华产品。不得通过无界全目录抓取补救。
- 初次列表包含 `Gift Card (Digital)`（父 62540）。礼品卡不能混入普通护肤实物候选。
- [商家配送说明](https://www.shoprootscience.com/shipping)明确提供美国配送。该页面和 FAQ 的国际国家列表存在差异，本接入只记录美国配送证据，不据此扩张国际覆盖或推断税费。
- [真实命中](../../../apps/awin-feed-service/test/fixtures/woocommerce-live/root-science-firm-search.json)、[真实品类零召回](../../../apps/awin-feed-service/test/fixtures/woocommerce-live/root-science-category-zero.json)。

### La Marzocco Home USA

- origin 候选：`https://home.lamarzoccousa.com`；图片同域。
- `GET /products?search=portafilter&per_page=3` 返回包括 `Convertible Portafilter` 父 `355289`。父范围为 `25000–28500` USD minor unit 2，即 $250.00–$285.00。
- `GET /products/355289` 和 `GET /products?type=variation&parent=355289&per_page=5` 均成功。响应总量 3、一页；Standard `355291` 是 $250.00，Walnut `355292` 和 Maple `355293` 均为 $285.00，均报告有货。
- 变体页面：[Walnut](https://home.lamarzoccousa.com/product/convertible-portafilter/?attribute_option=Walnut)。用户指定 Walnut 时必须使用 $285.00，不能使用父商品起价 $250.00。
- 同查询的 simple `356873` 是 Grind-by-Weight Portafilter Stand，$110.00；`273042` 是 Acaia Lunar Portafilter Plate，$30.00。两者不是 Convertible Portafilter 的同款，不能因共享关键词自动比较成同款最低价。
- 初次列表中的 Frescobol Carioca 杯具明确缺货；不能只用 `is_purchasable=true` 推断现货。
- [商家 FAQ](https://home.lamarzoccousa.com/faq/)明确美国大陆、阿拉斯加、夏威夷和波多黎各配送，并限制转运商。具体商品地址资格仍需另行核验；本次不执行购物车验证。
- [父商品范围](../../../apps/awin-feed-service/test/fixtures/woocommerce-live/lamarzocco-parent.json)、[不同价格子变体](../../../apps/awin-feed-service/test/fixtures/woocommerce-live/lamarzocco-price-variants.json)。

### Burrow Press

- origin 候选：`https://burrowpress.com`；图片同域。`search=mother` 和 `/products/23939` 返回 `The Mother Game`、$20.00、simple。
- API `permalink` 原值为 `/mother`，不是绝对 URL。只能相对于已批准 origin 解析为 [The Mother Game](https://burrowpress.com/mother)，并重新核验最终域名。不能将任意 scheme-relative URL 当作可信同域。
- [商家书店说明](https://burrowpress.com/books/)描述 USPS Media Mail 发货，并引导美国以外订单通过分销商购买，为美国销售提供公开证据。
- 同页对部分 2026 新书标记预售，初始 API 样本却普遍 `is_in_stock=true`。因此本轮不认证该店所有商品的“立即发货”语义；库存字段必须保留 API 归因，预售/页面冲突不可被库存布尔值覆盖。订阅和捐赠不属于首版普通实物支持范围。
- [相对链接单品样本](../../../apps/awin-feed-service/test/fixtures/woocommerce-live/burrowpress-relative-link.json)。

### Scrub Daddy

- 原尝试 `https://smileshop.scrubdaddy.com` 最终重定向到 `https://scrubdaddy.com`。推荐 origin 是 `https://scrubdaddy.com`；图片同域。后续直接请求主域且禁止重定向，均 200。
- `GET /products?search=original&per_page=3` 返回 3/4。`769455` 是 6 件装 Original Scrubber and Sponge，$19.99；`275529` 是 4 件装，$14.99。包装数量不同，不能作为等量同款直接按整包价排序。
- `16677` 是 Screen Daddy Original 2 件装，$1.99、缺货，商品评分 4.83/6。不能作为普通 Scrub Daddy 海绵同款填充结果。
- 初始列表也包含清洁组合套装。标准简单多件装与可配置 bundle 要区分；不能因 API `type=simple` 就断言任何组合满足当前任务。
- [商家客服配送说明](https://support.scrubdaddy.com/support/solutions/articles/156000158436-how-do-orders-ship-)明确美国国内 USPS/UPS 发货。该说明是市场证据，不是运费报价。
- 本轮未执行单品 GET 或变体 GET；只确认实际搜索过滤与返回事实。[搜索样本](../../../apps/awin-feed-service/test/fixtures/woocommerce-live/scrubdaddy-original-search.json)。

### Nalgene：合同可用，延迟未通过

- origin 与图片域名：`https://nalgene.com`。
- `search=wide%20mouth` 返回 3/27，父 `877583` 为 `32oz Wide Mouth Mythical Creatures Bottles`，$18.99。父/子商品读取均 200。
- 子 `877590/877591/877592` 分别绑定三种 Graphic。父商品共享的 Bottle Color 多选值不是每个变体的独立颜色；需要父 variations 的 ID 对应和已选图案证据，不能把“共有 Purple”应用到所有变体。
- [商家 FAQ](https://nalgene.com/faq/)描述 Rochester, NY 发货及美国本土配送，提供美国配送证据。
- 四个已测 GET 耗时约 3.93–4.01 秒。不能在 3 秒生产预算下报告此商家已通过性能门槛。优先保留为诊断/候选，使用实际服务环境复测后再决定是否按计划内配置调整，不擅自提高全源超时。
- [搜索样本](../../../apps/awin-feed-service/test/fixtures/woocommerce-live/nalgene-search.json)、[3 个图案变体](../../../apps/awin-feed-service/test/fixtures/woocommerce-live/nalgene-variants.json)。

### Nutribullet：可达不等于搜索可用

- origin：`https://www.nutribullet.com`；已见图片域名 `nbmedia.imgix.net`。美元及[商家美国配送说明](https://www.nutribullet.com/shipping/)有证据。
- 无查询、`search=personal%20blender`、`search=findcheapnonexistentxyz987` 三次均返回同样的前 3 个商品和总量 179，响应均 27,538 字节。
- 不可能词的固定样本仍包含 `1032067/1032066/1031146`。其中 `1032067/1031146` 是延保服务，不能因为 `type=simple` 就归为普通实物。
- 结论限于本次行为：Store API 的 `search` 参数没有表现出必要过滤，原因可能在站点定制/缓存，尚未定位。没有足够证据启用此商家搜索；不请求管理 API、不增加绕过参数。[失败样本](../../../apps/awin-feed-service/test/fixtures/woocommerce-live/nutribullet-ignored-search.json)。

### Landyachtz：访问拒绝

- `https://landyachtz.com/wp-json/wc/store/v1/products?per_page=3` 在 15:32:08 UTC 返回 HTTP 403，约 200 毫秒。
- 没有读取商品或币种，没有后续请求，没有换域、代理、Cookie 或浏览器绕过。保留不可用原因，不计入有效商家覆盖。

## 冻结的回归事实

这些是事实预期，不能因实现当前输出不同而调整：

1. La Marzocco 355292 的金额是 28,500 cents，不是父商品的 25,000 cents。
2. Offerman 43860 为缺货，父 43848 有货不能替代。
3. 变体结构必须通过父 `variations[].id/attributes`、子 `parent` 和安全的 `_links.up` 或已验证映射相互绑定；子 `attributes=[]` 是真实响应，不能一律当异常。
4. Offerman、Nalgene、La Marzocco 使用 `attribute_*` 变体 URL；原有 Shopify `?variant=` 处理不能直接套用。
5. Burrow `/mother` 只能相对 `https://burrowpress.com` 安全解析；必须保留实际产品 ID 23939。
6. Root Science `serum` 返回 0 是某次检索结果，不能作为“该店不卖 serum”的全面覆盖证明。
7. Nutribullet 不可能查询的 3 个商品不能计为查询命中。
8. Nalgene 超过 3 秒的样本不能记为当前生产默认超时下通过。
9. Scrub Daddy 4 件装与 6 件装不等量；Screen Daddy 不能冒充 Scrub Daddy 同款。
10. 商品评分、美国配送说明、接口可达和商家独立信任是不同事实；不相互替代。

## 验证与剩余事项

本步骤为纯证据文档/固定 JSON，不修改运行代码或 registry，无运行产物构建。提交前执行：JSON 全量解析、每条 GET 请求方法与 schema 检查、父子身份和价格/库存固定值断言、Markdown 本地链接存在性、`git diff --check`。这些检查的结果由同一工作记录末尾填写，不等于实现测试。

待实施模块验证：安全 JSON 读取、预算取消、缓存时间、结构化价格和变体映射、相对链接、图片代理、业务身份与评分准入。实际图片二进制可用性、地区/地址库存、运费税费、稳定性压测、商家信任审核和真实 Codex 卡片/监控验收均未在本步骤执行。没有创建 Watch、发送商家消息、提交、推送、部署或替换插件缓存。

公开协议依据：[Woo Products API](https://developer.woocommerce.com/docs/apis/store-api/resources-endpoints/products/)、[Woo Store API](https://developer.woocommerce.com/docs/apis/store-api/)。候选发现参考 [Woo 官方展示](https://woocommerce.com/showcase/)，该页面仅用于发现，当前能力结论取自上述逐店实测。

### 本步骤验证结果

- Python 标准库结构与固定值断言：退出码 0。13 个 JSON 文件全部解析；27 条观察分母、8 家候选数量、只读产品 GET、USD 最小单位、La Marzocco 三个变体金额、Offerman 父子库存差异与父子 ID、Burrow 相对链接、Root Science 空数组、Nutribullet 不可能词返回 ID 均通过。
- 28 个 Markdown 链接完成分类；所有本地目标存在，文档无替代字符。外部链接不作为本地存在性断言通过项。
- `git diff --check`：退出码 0。并行工作区其他文件有 Git 换行提示；没有将这些提示记作本证据步骤修改。
- 本步骤没有运行或声称通过服务构建、适配器测试、真实宿主验收、发布检查。
