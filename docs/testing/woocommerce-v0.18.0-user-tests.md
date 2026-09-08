# WooCommerce v0.18.0 用户测试

先在 Codex **新建一个任务**，让任务加载更新后的 FindCheap 插件；旧任务可能仍持有旧 MCP 进程。确认插件已启用，安装版本为 `0.18.0` 或对应的 `0.18.0+codex.…` 安装包。下面是发布后的测试步骤，不是已经完成的真实宿主验收。

当前默认访问表包含 Offerman Woodshop、Root Science、La Marzocco Home USA、Burrow Press、Scrub Daddy。实际生产可用范围还取决于发布配置和各店当时的响应。WooCommerce 是独立搜索来源，但底层为这些商家的单店 API；不是全部 Woo 商家的全球目录。不要预设每次必须出现 Woo 卡片，也不要预设有几家商家或几件商品。

接口技术通过、商品满足搜索要求、商家信任/评分准入、最终卡片展示、真实宿主操作是不同验收项。来源返回了商品但没有合格卡片时，应说明原因；这不能算“卡片与后续操作已经通过”，也不能通过绕过规则补齐卡片。

测试记录建议保留：提示词、响应时间、`renderId`、原卡片来源/商品链接、具体规格、价格观察时间，以及 `PASS / FAIL / BLOCKED`。`BLOCKED` 用于没有可选卡片、商家暂时不可用、缺少混合来源样本或未完成真实宿主绑定；不要从分母删除。

## 10 个可直接粘贴的提示词

### 1. 单个已接入商品链接

在新任务粘贴：

```text
用 FindCheap 查看这个 Root Science Firm 商品：https://www.shoprootscience.com/shop/firm-peptide-serum
告诉我当前商品价、库存、商品评分和实际来源。不要换成其他精华，也不要把商品价写成含税运费的到手价。
```

正确：锁定原域名和 Firm 商品；Woo 来源身份可追溯，价格带当前观察时间。2026-09-08 的旧样本为商品 `69439`、$48.00、评分 5.00/9，仅用于识别，不要求实时结果永远相同。

错误：返回别的精华；把 Woo 来源写成 Shopify；把旧价格冒充实时价；把商品评分当成商家独立信任。来源不可用时编造卡片也算失败。

### 2. 无品牌品类搜索

另开一个购物目标或新任务粘贴：

```text
帮我找 100 美元以内的咖啡器具，不限定品牌。正常比较所有已配置来源，包括 WooCommerce；其他来源有结果也继续查 WooCommerce。说明实际商品来源和本轮覆盖限制，不凑数量。
```

正确：使用现有统一搜索，Woo 与其他已配置来源在首轮参与；按预算和实际证据筛选。没有合格 Woo 卡片可以是有效结果，但来源状态或执行证据应区分已查无匹配、部分失败、不可用和未配置。

错误：只有其他来源零结果时才查 Woo；声称覆盖所有 Woo 商家；把超时当成商品不存在；为显示 Woo 而放入无关商品。不要仅凭助手口头说“查过”判定来源调用通过。

### 3. 精确商品和木材规格

```text
查看这个 La Marzocco Convertible Portafilter 的 Walnut 规格：https://home.lamarzoccousa.com/product/convertible-portafilter/?attribute_option=Walnut
只核实这一个规格的当前价格和库存。不要用 Standard 起价，也不要换成滤杯、支架或其他配件。
```

正确：父商品 `355289`、Walnut 变体 `355292`；报价来自对应变体。旧样本 Walnut 为 $285.00，Standard 为 $250.00，实时价格允许变化。

错误：把父商品最低价当 Walnut 价格；将同词命中的支架当同款。若信任或评分准入导致没有合格卡片，明确记录 `BLOCKED`，不要制造可选引用。

### 4. 同店换规格与旧卡片保留

仅在案例 3 获得可选卡片后，先选中它，再粘贴：

```text
只检查我在这组卡片里选中的 La Marzocco 商品。把 Option 改为 Maple，显示核实后的规格和价格；保留原 Walnut 卡片的历史价格和原引用，不重新搜索其他商品。
```

正确：检查原商家和父商品，Maple 对应旧样本中的变体 `355293`；形成新快照，新卡片有新引用。原 Walnut 快照仍能重绘，内容未被覆盖。

错误：猜“最近一次”商品；修改旧卡片价格；变成其他商家；用旧 `selectionId` 指向新规格。没有原卡片时，本案例为 `BLOCKED`，不是自动改做文字搜索。

### 5. 父有货、子规格缺货

```text
核实这个 Offerman Woodshop 隔热垫的 Amorphous Trivet / Eucalyptus 规格是否现货：https://offermanwoodshop.com/store/kindlin/hearth-home/kitchen-trivets?attribute_type=Amorphous+Trivet&attribute_species=Eucalyptus
只按这个子规格的当前库存回答，不要用父商品或其他木材的库存代替。
```

正确：父 `43848`、子 `43860`。2026-09-08 旧样本父有货、该子规格缺货；本次必须重新读取，不能硬编码旧状态。证据不足则说明未核实。

错误：父有货就说 Eucalyptus 有货；将“可购买”当立即现货；为了出卡换成 Walnut。无合格卡片时保留原因，不能宣称已完成选择后的操作验收。

### 6. 多件装不能混成同等报价

```text
比较这两款 Scrub Daddy Original：
6 件装：https://scrubdaddy.com/product/scrub-daddy-original-scrubber-and-sponge-6-count/
4 件装：https://scrubdaddy.com/product/scrub-daddy-4ct-pack/
分别列出当前整包价、件数和有证据的单件价。不要因为 4 件装整包便宜，就说它的单位价格更低。
```

正确：区分商品 `769455` 的 6 件装和 `275529` 的 4 件装。只有整包金额与数量均核实后才计算单件价；当前运费税费未知应保留未知。

错误：把两包当同等数量；把整包价格直接写成单件价；用 Screen Daddy 替代 Scrub Daddy；商品价变化后仍沿用旧算式结果。

### 7. 混合来源比较

先通过正常搜索获得同一组中来自 Woo 与至少一个现有来源的合格商品卡。选择 2–4 件，再粘贴：

```text
比较我在这组卡片里选中的商品，包括 WooCommerce 和其他来源。逐项列出规格、商品价、可比较价格、优惠状态、商品状态和商家信任；同款与不同款分清，保留各自来源和原商品引用。
```

正确：只比较实际选中的 2–4 件；不同来源保留各自引用和事实。不能把某店库存与另一店价格拼成一条报价。只有同款或明确可比条件成立时才下最低价结论。

错误：忽略 Woo 卡片；因不同商家有相同数字 ID 选错商品；追加未选商品；伪造税费。如果当前不足两个来源，记录 `BLOCKED`，不要强行让测试满足数量。

### 8. 优惠未知与购物车边界

选中案例 1 的 Root Science Firm 卡片后粘贴：

```text
检查这件已选中的 Root Science Firm 有没有已验证优惠，区分商家通用优惠和确认适用于这件商品的优惠。缺少证据就明确说未确认。
再说明这件 WooCommerce 商品能否通过 FindCheap 加购物车、下单或取得含税运费总价；不支持就说明边界，不要执行购买。
```

正确：优惠查询对应已选商品/商家；来源不可用或无适用证据时保留未知，不凭 `on_sale` 生成 Coupon。当前 Woo 接入仅公开商品读取，跳转商家购买，不提供 Woo 加购物车、下单或到手价报价。

错误：把商家通用券直接从商品价扣掉；冒称没有查到就一定无优惠；改用 Shopify 的购物车接口；编造含税运费总价。

### 9. 缺少原选择时不猜引用

再新建一个没有商品卡片的任务，粘贴：

```text
把刚才那件 WooCommerce 商品换个颜色，再比较一下价格。
```

正确：指出当前任务缺少原商品上下文，要求提供原链接或先找到并选中商品。不猜 `renderId` / `selectionId`，不从其他任务偷偷替换目标。

错误：自行认定为另一任务的某件商品；用最新任意卡片继续操作；编造引用并声称已经核实规格。

### 10. 可选：由你明确授权的价格 Watch

**只有你确实要创建真实监控时才粘贴。** 本文没有创建监控。先回到有 Root Science Firm 原卡片的任务，选中该卡片：

```text
我明确授权为本任务中已选中的 Root Science Firm 创建价格监控：每 60 分钟检查一次，持续 30 天，只有商品价低于 40 美元才通知我。只监控原商家和原商品，不包含运费税费，不购买。请完成实际宿主定时任务绑定；如果只能保存本地规则，要明确告诉我尚未开始实际调度。
```

正确：创建前再次读取原商家/商品；失效或不匹配时不创建空规则。持久化准确 Woo 目标，并验证真实宿主定时任务与本地绑定后才说正在监控。回调使用原商品 ID，不重新进行模糊 Shopify 搜索；阈值为 `4000` cents，$40.00 不满足“低于 $40”。

错误：只返回 `READY_TO_SCHEDULE` 就声称监控已运行；将本地保存的 Automation ID 当真实宿主成功证明；监控其他精华；自动扩大为购买授权。测试后如不需要继续监控，可在同一任务明确要求停止，并核实宿主任务已停止。

## 三项只读生产 API 检查

以下命令只写在文档中，本次没有执行 HTTP。它们调用现有来源服务的查询路由；虽然内部传输使用 POST，上游只读取商品 GET，不操作购物车、账户或订单。无需 Woo 平台账户或 API key。

生产地址来自[项目环境示例](../../.env.example)。如果部署使用不同来源域名，先用已核实的部署地址替换，不猜 URL。三个示例都禁止自动重定向。429/超时应保留原失败，按响应说明稍后手动重试，不循环重试或更换代理。

### A. 搜索和覆盖状态

```powershell
$wooBase = 'https://findcheap-agent-production.up.railway.app'
$wooBody = @{
  query = 'firm'; productType = 'serum'; market = 'US'; currency = 'USD'; limit = 3
  productUrl = 'https://www.shoprootscience.com/shop/firm-peptide-serum'
} | ConvertTo-Json -Depth 5
$wooSearch = Invoke-RestMethod -Method Post -Uri "$wooBase/v1/woocommerce/search" -ContentType 'application/json' -Body $wooBody -MaximumRedirection 0 -TimeoutSec 15
if ($wooSearch.source -ne 'WOOCOMMERCE_STORE_API' -or $wooSearch.schemaVersion -ne 1) { throw 'Unexpected Woo source contract' }
if ($wooSearch.status -notin @('COMPLETE', 'PARTIAL')) { throw "Woo search unavailable: $($wooSearch.status)" }
$wooSearch | Select-Object status, registryVersion, snapshotAt, diagnostics
$wooSearch.products | Select-Object merchantId, productId, variationId, title, itemPrice, checkedAt
if (@($wooSearch.products).Count -eq 0) { Write-Warning 'Request completed with zero products; this does not prove the merchant sells no serum.' }
if ($wooSearch.status -eq 'PARTIAL') { Write-Warning 'Partial source result; retain failed-store diagnostics and do not mark full coverage passed.' }
```

检查：来源和 schema 正确；查看 `attemptedStores / succeededStores / failedStores / physicalRequests`。`COMPLETE` 仅指本轮受限请求完成，不能写成全球目录覆盖。HTTP 200 但 `UNAVAILABLE` / `NOT_CONFIGURED` 不算来源启用通过。

### B. 精确 Walnut 子商品读取

```powershell
$wooBase = 'https://findcheap-agent-production.up.railway.app'
$wooBody = @{ merchantId = 'lamarzocco-home-usa'; productId = 355289; parentProductId = 355289; variationId = 355292 } | ConvertTo-Json
$wooLookup = Invoke-RestMethod -Method Post -Uri "$wooBase/v1/woocommerce/products/lookup" -ContentType 'application/json' -Body $wooBody -MaximumRedirection 0 -TimeoutSec 15
if ($wooLookup.source -ne 'WOOCOMMERCE_STORE_API' -or $wooLookup.status -ne 'FOUND') { throw "Exact Woo variant unavailable: $($wooLookup.status)" }
$wooItem = $wooLookup.product
if ($wooItem.merchantId -ne 'lamarzocco-home-usa' -or $wooItem.productId -ne 355289 -or $wooItem.parentProductId -ne 355289 -or $wooItem.variationId -ne 355292) { throw 'Wrong merchant or parent/variation identity' }
if ($wooItem.selectedAttributes.Option -ne 'Walnut') { throw 'Wrong selected wood option' }
if ($wooItem.priceEvidence.scope -ne 'VARIANT' -or $wooItem.priceEvidence.currency -ne 'USD' -or $wooItem.priceEvidence.currencyMinorUnit -ne 2 -or $null -eq $wooItem.itemPrice) { throw 'Missing exact USD variant price evidence' }
if ([long]$wooItem.priceEvidence.amountMinor -ne [long]$wooItem.itemPrice.amountCents) { throw 'Price evidence and cents disagree' }
$wooItem | Select-Object merchantId, productId, parentProductId, variationId, selectedAttributes, itemPrice, availability, availabilityScope, checkedAt, merchantUrl
```

检查：目标必须为 Walnut `355292`，不能返回 Standard `355291` 或父价。旧样本为 `28500` cents；实时价格变化本身不算失败，当前最小单位证据与当前金额不一致才是失败。

### C. 按 Maple 规格检查父商品

```powershell
$wooBase = 'https://findcheap-agent-production.up.railway.app'
$wooBody = @{
  target = @{ merchantId = 'lamarzocco-home-usa'; productId = 355289 }
  requirements = @{ attributes = @{ Option = 'Maple' } }
} | ConvertTo-Json -Depth 5
$wooInspection = Invoke-RestMethod -Method Post -Uri "$wooBase/v1/woocommerce/products/variants" -ContentType 'application/json' -Body $wooBody -MaximumRedirection 0 -TimeoutSec 15
if ($wooInspection.source -ne 'WOOCOMMERCE_STORE_API' -or $wooInspection.status -notin @('COMPLETE', 'PARTIAL')) { throw "Woo inspection unavailable: $($wooInspection.status)" }
$wooMaple = @($wooInspection.products | Where-Object { $_.merchantId -eq 'lamarzocco-home-usa' -and $_.productId -eq 355289 -and $_.variationId -eq 355293 -and $_.selectedAttributes.Option -eq 'Maple' })
if ($wooMaple.Count -ne 1) { throw 'Exact Maple variant not returned; record incomplete instead of substituting parent price' }
if ($wooMaple[0].priceEvidence.scope -ne 'VARIANT' -or $wooMaple[0].itemPrice.currency -ne 'USD' -or $null -eq $wooMaple[0].itemPrice.amountCents) { throw 'Maple has no verified USD variant amount' }
$wooInspection | Select-Object status, registryVersion, truncated, checkedAt
$wooMaple | Select-Object merchantId, productId, variationId, selectedAttributes, itemPrice, availability, checkedAt
if ($wooInspection.status -eq 'PARTIAL' -or $wooInspection.truncated) { Write-Warning 'Variant inspection was partial; the returned variant is not evidence that all variants were checked.' }
```

检查：实际返回 Maple `355293`，金额归属对应变体。不能为了匹配旧样本金额，改用其他变体。该检查只证明生产来源 API 的一次具体操作；不证明 Codex 已加载新插件，也不代替卡片、选择、比较和 Watch 宿主验收。

## 样本依据

- [商家实测记录及完整分母](../engineering/changes/2026-09-08-woocommerce-merchants.md)。
- [Root Science Firm](../../apps/awin-feed-service/test/fixtures/woocommerce-live/root-science-firm-search.json)。
- [La Marzocco 实际父子变体和链接](../../apps/awin-feed-service/test/fixtures/woocommerce-live/lamarzocco-price-variants.json)。
- [Offerman 缺货子规格](../../apps/awin-feed-service/test/fixtures/woocommerce-live/offerman-out-of-stock-variant.json)。
- [Scrub Daddy 多件装](../../apps/awin-feed-service/test/fixtures/woocommerce-live/scrubdaddy-original-search.json)。
- [当前默认 Woo 访问表](../../apps/awin-feed-service/src/woocommerce-registry.ts)。
