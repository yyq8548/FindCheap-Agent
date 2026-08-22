# FindCheap Agent

[![最新版本](https://img.shields.io/github/v/release/yyq8548/FindCheap-Agent?label=release)](https://github.com/yyq8548/FindCheap-Agent/releases/latest)
[![插件 CI](https://github.com/yyq8548/FindCheap-Agent/actions/workflows/ci.yml/badge.svg)](https://github.com/yyq8548/FindCheap-Agent/actions/workflows/ci.yml)

[English](README.md) | 简体中文

产品形式：**Codex 插件 Agent**。

FindCheap Agent 是一个只读的 Codex 购物插件，支持商品搜索、商品匹配、价格查询、商品卡片、已验证优惠和购物监控。每次最多返回三个商品，并提供图片、商家链接、价格证据、匹配标签、商品成色和库存状态。

Codex 通过本地 stdio MCP 服务器调用插件。主要商品来源是 Shopify Global Catalog。如果目录没有返回可用商品，用户授权后可以使用 Chrome 技能，对公开商家页面进行一次受限搜索。

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

插件通过 Shopify Global Catalog 搜索符合条件的商家，并保留品牌、型号、SKU、GTIN、颜色、尺寸和容量等信息。支持的中文商品词会转换成英文搜索词，商品身份和变体信息不会改变。

搜索结果使用三种匹配标签：

- `EXACT`：请求的变体具有可靠的 UPID、GTIN，或品牌加 MPN/SKU 证据。
- `DISCOVERY_MATCH`：结果与请求相关，但证据不足以确认是同一商品。
- `SIMILAR`：相似选项，不是同一商品。

如果本地证据文件支持，精确商家域名可以标记为 `OFFICIAL`、`AUTHORIZED_RETAILER`、`ESTABLISHED_RETAILER`、`UNKNOWN` 或 `RISKY`。可信商家优先于价格排序。当可信结果足够时，未知商家不会占用前三名。高风险域名会被排除。联盟状态不参与排序。

如果第一次目录请求没有可用商品，插件可以执行一次受限的宽松搜索。宽松结果仍标记为 `DISCOVERY_MATCH`。如果 Shopify 仍然没有结果，插件会询问是否使用已授权的 Chrome 搜索，不会静默切换数据来源。

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

后续问题会复用所选结果的 `renderId` 和 Shopify Variant ID。插件不会重新搜索商品标题，因此商品价、配送费和税费始终对应同一个变体。

## 商品卡片

Codex 可以在对话中显示交互式商品卡片。卡片按商家可信度和匹配质量分组，并显示商家信任证据、图片、商家、价格、型号或 SKU、身份信息、变体、商品成色、库存状态、观察时间和商家页面按钮。每张卡片都与生成它的搜索结果或所选变体报价绑定。

如果 Codex 客户端无法显示卡片界面，完整文字结果仍然可用。

## 已验证优惠

Coupon 和促销路径采用失败关闭策略。只有配置的 Deals API 提供当前证据时，插件才会返回 Coupon、Promo Code、会员优惠、Cashback 或线下 Coupon。

缺少证据时，插件会说明优惠来源不可用。它不会虚构优惠码、折扣、到期时间或 Cashback 比例。

默认插件会显示可用的 Shopify、商品卡片和 Watch 工具。只有配置完整的服务地址和 Token 后，Commerce 比价和已验证 Deals 工具才会出现。

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

Awin 商家 Amazonliss (US)（merchant `20282`）已批准 publisher `3047955`。生产环境中，`search_awin_products` 读取由 `AWIN_PRODUCT_FEED_URL` 和 `AWIN_PRODUCT_FEED_TOKEN` 配置的认证 HTTPS Feed 服务。本地开发才回退到 Downloads 中的 `datafeed_3047955.csv.gz`，也可用 `AWIN_PRODUCT_FEED_PATH` 指定路径。返回链接为带披露的已批准 Awin 深链。

该 Feed 有商品价、库存和商家商品 ID，但没有 GTIN、MPN、品牌和 condition。因此结果始终标记为 `DISCOVERY_MATCH`、`DISCOVERY_ONLY`、`condition: UNKNOWN`，不能当作精确同款比价。配送、税费、优惠券、会员价和到手价仍不可用。其他来源在没有各自已批准关系时继续使用商家原始链接；佣金不参与排序。

正式部署步骤见 [Awin Product Feed production deployment](docs/product/awin-feed-deployment.md)，包含定时下载、持久化卷、认证接口和所需密钥。

## 安装

运行要求：Codex 桌面版或 CLI，以及 Node.js 22。

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

Commerce API 会保持失败关闭，直到商家通过审计门。Shopify Global Catalog 仍是主要发现来源，授权 Chrome 仅作为零结果时的补充方式。
