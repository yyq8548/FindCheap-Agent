# FindCheap Agent

[![最新版本](https://img.shields.io/github/v/release/yyq8548/FindCheap-Agent?label=release)](https://github.com/yyq8548/FindCheap-Agent/releases/latest)
[![插件 CI](https://github.com/yyq8548/FindCheap-Agent/actions/workflows/ci.yml/badge.svg)](https://github.com/yyq8548/FindCheap-Agent/actions/workflows/ci.yml)

[English](README.md) | 简体中文

产品形式：**Codex 插件 Agent**。

FindCheap Agent 是一个只读的 Codex 购物插件，支持商品搜索、商品匹配、价格查询、商品卡片、已验证优惠和购物监控。每次最多返回三个商品，并提供图片、商家链接、价格证据、匹配标签、商品成色和库存状态。

Codex 通过本地 stdio MCP 服务器调用唯一公开的 `search_products` 工具。路由器先考虑符合条件的已批准联盟商品，再用 Shopify Global Catalog 补足结果；第一轮无法补足所需卡片时，会自动执行一次范围更大的内部搜索。只有两轮 API 搜索都没有返回可用且已验证的商品后，才会询问是否授权 Chrome 对公开商家页面进行一次受限搜索。

插件不会下单、结账、付款或预留库存。

## 使用方法

在 Codex 中直接调用 FindCheap Agent：

```text
@FindCheap Agent 搜索 Sony WH-1000XM6，显示三个商品卡片。
```

启用插件后，也可以直接用自然语言提问：

```text
帮我找三个可信商家的 AirPods Pro 2 报价。
```

需要查询运费、税费和预估总价时，请提供美国邮编：

```text
报价第一个商品，美国邮编是 33065。
```

创建购物监控：

```text
监控这个商品，全新价格低于 $170 时提醒我。
```

后续报价时，可以用结果序号或直接选择商品卡片。FindCheap Agent 会复用首次结果中的商品和变体，不会重新按标题搜索。

## 商品搜索

插件用一次受约束的请求搜索所有合格来源。所有商品品类都会查询已加入的 Awin Program；只有同时满足商品身份、成色、必需功能、库存和价格限制的联盟商品才会进入候选，其余位置由 Shopify Global Catalog 补足。中文商品词会转换成英文搜索词，品牌、型号、SKU、GTIN、颜色、尺寸和容量等身份与变体信息保持不变。

用户明确提出的非价格要求会作为硬性筛选条件，而不是仅用于排序。匹配器会统一处理屏幕尺寸、内存、存储、包装数量、容积、重量、分辨率、刷新率、功率、服装和鞋码、颜色、型号代际及兼容性表达。它支持常见公制、美制和中文写法，可以将 `14 英寸`、`35.56 厘米` 和 `14寸` 等同类表达正确对应，也能识别至少、最多和约等范围要求。内存、存储、物理尺寸、数量和营销刷新率标签会分开判断，避免因为数字相同而产生错误匹配。

用户搜索主体商品时，保护套、扩展坞、支架、屏幕保护膜和替换耳罩等常见配件会被排除；明确搜索配件时仍可正常返回。型号和代际按照完整边界匹配，较长型号不会被误认为用户要求的较短型号。

`MacBook Pro` 这类明确的产品系列可以作为品类判断中的身份依据。查询已经包含产品系列或型号时，翻译不会再追加 `laptop`、`phone`、`headphones` 等通用品类词。商品标题即使没有这些通用词，也不会因此被误删。用户没有说明成色时，路由器不会假设商品是全新。每项结果会保留实际观察到的成色标签，`UNKNOWN` 仍可进入候选。用户明确要求全新、二手、翻新、开箱或成色未知时，该要求才会成为筛选条件。

搜索结果使用三种匹配标签：

- `EXACT`：请求的变体具有可靠的 UPID、GTIN，或品牌加 MPN/SKU 证据。
- `DISCOVERY_MATCH`：结果与请求相关，但证据不足以确认是同一商品。
- `SIMILAR`：相似选项，不是同一商品。

### 结果可靠性

FindCheap Agent 分开表达商品身份、商家可信度、成色和价格证据：

- 匹配标签只描述商品身份。`EXACT` 需要可靠的身份信息；`DISCOVERY_MATCH` 和 `SIMILAR` 都不能证明两个商品页属于同一商品。
- 普通搜索按三层商家顺序返回结果。经过独立审核的官方、授权或成熟零售商，以及已批准的 Awin Program 排在第一层。商家没有经过独立验证时，评分高于 `3.8` 且至少有 `2` 条评价的 Shopify 商品排在第二层。其他相关商家可以排在最后，但卡片会明确提示商家可信证据有限。商品评分不能证明商家可信。标记为 `RISKY` 的域名会直接排除。
- Awin 批准只确认当前配置的联盟计划和链接路径，不代表平台独立认可该商家或商品。佣金不影响相关性和排序。
- 卡片中的商品价是数据源在观察时返回的价格。运费、税费、必要费用、会员价、优惠券和到手总价，只有取得对应商家证据或报价成功后才会显示。按 ZIP 计算的税费可能是预估值，最终金额以商家结账页为准。
- `UNKNOWN` 表示数据源没有验证商品成色，不能描述为全新。对于可信证据有限的商家，购买前应检查卖家身份、退货政策和付款保障。

联盟佣金不会影响路由或排序。明确要求最低价时，插件会跨来源比较符合条件的商品价；普通搜索保留商家多样性。第一轮无法补足结果时，插件会把用户要求加入搜索词、扩大内部候选池，再重新执行成色、功能、价格和商家检查。扩展搜索不会把弱匹配伪装成 `EXACT`。只有第二轮仍没有可用商品时才会询问是否使用 Chrome；来源错误或部分覆盖会失败关闭。

## 报价比较与配送估算

只有当身份信息证明结果属于同一商品和同一变体时，插件才会比较报价。精确匹配排在探索结果和相似选项之前。

每个结果可以包含：

- 商家和商品名称
- 已验证的公开商品价
- 图片和商家原始链接
- 库存信号和商品成色
- 型号、SKU、GTIN 或变体证据
- 观察时间和来源状态

没有邮编时，显示公开商品价。提供美国邮编后，插件可以创建一个短期匿名 Shopify Cart，并分别显示商品价、配送费、税费和预估总价。免费配送显示为 `$0.00`。

只有商家返回 `totalTaxAmount` 时，插件才使用 Shopify 税额。否则，商品卡可以显示基于邮编所在州和平均地方税率计算的税费估算。该数字不是结账税额。部分商家需要完整地址或进入结账流程后才返回配送费和税费。不支持 Cart 报价的商家只显示商品价。

后续问题会复用所选结果的 `renderId` 和稳定商品身份。原生 Shopify 卡片使用 Variant ID；受支持的 Awin 商家页面会先把原始商家商品路径安全解析为唯一 Shopify Variant。插件不会重新搜索商品标题，因此商品价、配送费和税费始终对应同一件已选商品。

## 商品卡片

Codex 可以在对话中显示交互式商品卡片。卡片按商家可信度和匹配质量分组，并显示商家信任证据、图片、商家、价格、型号或 SKU、身份信息、变体、商品成色、库存状态、观察时间和商家页面按钮。每张卡片都与生成它的搜索结果或所选变体报价绑定。

如果 Codex 客户端无法显示卡片界面，完整文字结果仍然可用。

## 已验证优惠

Coupon 和促销路径采用失败关闭策略。只有配置的 Deals API 提供当前证据时，插件才会返回 Coupon、Promo Code、会员优惠、Cashback 或线下 Coupon。

缺少证据时，插件会说明优惠来源不可用。它不会虚构优惠码、折扣、到期时间或 Cashback 比例。

默认插件会显示统一商品搜索、商品卡片和 Watch 工具。只有配置完整的服务地址和 Token 后，Commerce 比价和已验证 Deals 工具才会出现。

## 购物监控

用户可以让 Codex 监控商品，并在以下情况发生时通知：

- 价格低于目标值
- 出现已验证 Coupon 或促销
- 商品恢复库存
- 指定尺寸、颜色或变体补货

定时运行和通知由 Codex Automation 完成。只有成功绑定 Automation ID 后，监控才会生效。插件会在 MCP 重启后保留规则、上次观察结果和状态变化，避免对同一结果重复提醒。

价格门槛是严格小于。"低于 $40" 会存储为 `4000` 美分，并在 `$39.99` 触发，不会在 `$40.00` 触发。

暂停、恢复和删除操作会同步 Automation 与 Watch 规则。未验证 Automation 绑定的旧规则会标记为 `LEGACY_UNVERIFIED`，直到完成核对。

示例：

```text
监控 AirPods Pro，已验证商品价低于 $170 时提醒我。
```

```text
这件夹克黑色 M 码补货时提醒我。
```

## 联盟状态

生产环境使用 Awin publisher `3047955` 的私有 Feed List，自动发现所有 `Joined`、美国区、英文 Feed。Railway 服务会在启动时及每六小时下载并验证全部符合条件的 Feed，因此新加入的 Program 不再需要单独添加 Feed URL 或商品品类规则。只有同时包含该 publisher ID 和对应 merchant ID 的联盟链接才会返回，并附带联盟披露。Awin 结果与 Shopify 使用同一套商品卡片；本地开发仍可用 `AWIN_PRODUCT_FEED_PATH` 指定 Feed。

Feed 始终提供商品价、库存和商家商品 ID，但 GTIN、MPN、品牌和 condition 可能缺失。因此结果始终标记为 `DISCOVERY_MATCH`、`DISCOVERY_ONLY`、`condition: UNKNOWN`，不能当作精确同款比价。当原始商家商品路径可安全解析为唯一且受支持的 Shopify Variant 时，后续邮编报价可显示配送费、税费和预估总价；否则继续只显示商品价。优惠券和会员价仍需独立验证。其他来源在没有各自已批准关系时继续使用商家原始链接；佣金不参与排序。

正式部署步骤见 [Awin Product Feed production deployment](docs/product/awin-feed-deployment.md)，包含定时下载、持久化卷、认证接口和所需密钥。

## 安装

### Windows 一键安装

[下载 `Install-FindCheap-Agent.cmd`](https://github.com/yyq8548/FindCheap-Agent/raw/refs/heads/main/installers/windows/Install-FindCheap-Agent.cmd)，双击运行，然后重启 Codex 并创建新任务。安装器会自动添加或更新 marketplace、从 `main` 安装最新版插件，并在需要时配置官方便携版 Node.js 24。它不会索取联盟、商家、支付或账户凭据。

### 手动安装

运行要求：Codex 桌面版或 CLI，以及 Node.js 24。

```powershell
codex plugin marketplace add yyq8548/FindCheap-Agent --ref main
codex plugin add findcheap-agent@findcheap-agent
```

重启 Codex，打开一个新任务，然后尝试：

```text
FindCheap Agent 搜索 DÔEN 连衣裙，显示三个商品卡片。
```

测试和更新方法请参阅[分享与安装说明](docs/product/findcheap-agent-share-package.md)。

## 仓库结构

- `plugins/findcheap-agent/`：可分发的 Codex 插件。
- `apps/mcp-server/`：本地 MCP 服务器和商品卡片资源。
- `apps/commerce-api/`：经过审计的比价 API。
- `apps/ingestion-worker/`：商家数据导入和 Watch 状态处理。
- `docs/product/`：部署、数据来源、Coupon、Watch 和联盟运行手册。

Commerce API 会保持失败关闭，直到商家通过审计门。统一路由会使用已批准联盟来源和 Shopify Global Catalog，授权 Chrome 仅作为所有来源完整返回零结果时的补充方式。
