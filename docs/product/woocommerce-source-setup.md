# WooCommerce 来源配置与运维

本接入是现有 Backend 的可选独立来源。用户继续使用 `search_products`，支持品类、品牌、型号及注册商家的商品链接。WooCommerce Store API 是单店接口；跨店覆盖由 FindCheap 维护，不是 WooCommerce 提供的全平台目录，也不是联盟网络。公开商品读取无需 WooCommerce 平台账户或 API key。

实现与验收状态见[实施记录](../engineering/changes/2026-09-08-woocommerce-independent-source.md)，商家样本见[真实接口记录](../engineering/changes/2026-09-08-woocommerce-merchants.md)。源码版本不证明生产已启用。

## 配置顺序

1. 部署兼容版本的现有 `awin-feed-service`，先保持 `WOOCOMMERCE_SOURCE_ENABLED=false`。关闭时 Woo 路由返回 404，既有来源继续工作。
2. 在来源服务配置 `WOOCOMMERCE_SOURCE_ENABLED=true`。默认访问表现为 [50 家商家](woocommerce-merchants-50.md)，表版本 `2026-09-08-expanded-50`。可用经核验的完整 `WOOCOMMERCE_REGISTRY_JSON` 替换；省略使用内置表，不要设置为空字符串。配置变更需重启服务以重建缓存及访问策略。服务端名单扩展由现有 v0.18.0 客户端直接读取，不需要再换插件缓存。
3. 验证服务路由后，在 MCP 进程环境设置 `WOOCOMMERCE_API_BASE_URL=https://<source-service-host>`，只允许无凭据的 HTTPS origin 和默认端口。v0.18.0 插件 `.mcp.json` 默认指向 FindCheap 公开来源服务；独立运行 MCP 时省略变量不装配 Woo 端口；显式 `WOOCOMMERCE_SOURCE_ENABLED=false` 也关闭 MCP 路径。客户端默认 9 秒超时。
4. 重启新版本 MCP，检查搜索响应中的 `sources.woocommerce`、`woocommerceCoverage`、来源错误和实际请求计数。不能把 `COMPLETE` 当成遍历了所有 Woo 商家。v0.18.0 发布时先验证生产来源，再更新已安装插件。

服务开启不需要新增数据库表、后台全量爬虫或定时任务。不要配置管理 API consumer secret、登录信息或商家订单接口。

## HTTP 合同

内部请求使用 POST JSON；商家侧只使用商品 GET。完整 schema 是 [woocommerce.ts](../../packages/contracts/src/woocommerce.ts)。

- `POST /v1/woocommerce/search`：`query`、可选 `brand/productType/productUrl`、`market/currency`、`requirements`、`limit` 及受限 continuation。返回原始商品、逐店状态、表版本、覆盖及预算诊断。
- `POST /v1/woocommerce/products/lookup`：精确 `merchantId/productId`，变体附 `parentProductId/variationId`。返回 `FOUND/NOT_FOUND/UNSUPPORTED/UNAVAILABLE`。
- `POST /v1/woocommerce/products/variants`：`target` 和 `requirements`；只检查原商品的规格，不按标题另搜。
- `GET /v1/woocommerce/images?merchantId=...&imageId=...`：只解析服务已记录的图片引用，不接受任意 URL。

精确 body 示例：

```json
{"query":"firm","market":"US","currency":"USD","limit":3}
```

```json
{"merchantId":"root-science","productId":69439}
```

单次聚合最多 18 次物理请求、8 MiB 响应和 8 秒；商家单响应最多 1 MiB、单次读取 3 秒。每查询最多并行 3 店，服务全局最多 12 个读取、每店最多 2 个读取；只有暂时网络错误可以受限重试，429、访问拒绝及安全失败不自动绕过。SearchRun 每次目标检索最多两次 Woo 聚合。硬边界保留在代码，首版不提供任意扩大预算的环境变量。

搜索缓存 60 秒，最多 24 MiB／2,000 项；key 包含完整请求和注册表版本。缓存命中保留原观察时间，并报告零新增物理请求。lookup/inspect 不缓存，保证已选商品与 Watch 获取新观察。图片引用另有 2,000 项上限；淘汰后不回退任意图片 URL。

## 商品、信任和后续操作

首版展示有明确 USD 商品价的 simple 或精确 variation。父商品起价／范围不作为选中规格价；非 USD 保留原币证据但不参与 USD 卡片比较；组合、订阅、自定义定价及 external 类型不扩大为可购买商品。缺价不当作 0；未知货况不写成 NEW；预售／backorder 不冒充现货。

访问表与商家信任表分离。配置了商家，只证明允许尝试其公开接口；不自动获得可信商家、品牌官网、配送美国、报价或联盟优惠资格。50 家包含 Akko、PINE、CableMod 等电子品类商家，但没有承诺全部型号或完整目录覆盖。原有 40 个业务回归为确定性夹具；新增 45 家的实际接口证据另见商家名单。

`inspect_selected_product` 根据原快照分发，保留 `inspect_selected_shopify_product` 兼容名。新规格生成子快照；旧快照复制原始 DTO，不受端口对象后续变动影响。混合比较共用既有事实和排序。只有商家、商品／变体及对应 URL 都有证据时，Woo 与联盟 Feed 的同一报价才合并。

Woo 卡片为 `MERCHANT_CHECKOUT_ONLY`，不进入 Shopify Cart。优惠必须由既有获准优惠来源和商家映射提供，不能从 Woo 返回的商品价发明 Coupon。

Watch 仅在用户明确请求后创建。所选 Woo 商品传原 `quoteReference`，创建前实时核验锁定目标，初始库存原子保存；检查只读取该商家和商品／变体。补货只接受可靠缺货 → 有货。新规则使用独立 `.woocommerce-v1.json` 文件；旧 Watch 文件、容量、原子锁及停止意图规则保留。绑定 Automation ID 只是本地记录，实际宿主调度、通知和停止另行验证。

## 验证与回退

本地：`pnpm typecheck`、`pnpm lint`、`pnpm build:awin-feed`、`pnpm build:mcp`、`pnpm test`、`pnpm test:mcp-stdio`、`git diff --check`。

真实来源样本（只读 GET）：

```powershell
$env:FINDCHEAP_WOO_LIVE='1'
pnpm exec vitest run --config vitest.integration.ts apps/awin-feed-service/test/woocommerce-live.integration.test.ts
```

故障时先关闭来源服务开关或移除 MCP URL，重启对应进程。回退插件前先列出并暂停／删除相关 Woo Watch，核对宿主停止；旧插件不会管理新后缀规则，不能据此声称既有 Automation 已停止。提交、推送、部署及替换安装缓存遵循仓库的独立授权要求。
