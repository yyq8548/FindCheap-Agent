# 已知非 Woo 商品链接的 Woo 来源分流

## Research

目标遵循总设计 4.1：从实际商品证据编译各来源查询，受限并行召回，已知链接不授权另一个平台直接读取该网址。已读 AGENTS、研发协议、总设计适用章节及当前构建配置。基线 commit `87f6f1c13d4a8217564b6e2049f691a4222a8aee`，开始时工作区无未提交修改；v0.18.6 已发布，其证据保留，主任务负责后续补丁版本和发布。

FACT：原生 R4 Glossier 搜索与选定商品检查成功，但 Woo 为 `SOURCE_REJECTED`、不可重试，逻辑来源读 2 次、已记录商家 HTTP 读 0 次。`searchProducts` 已将官网实际商品编译成 `Glossier Balm Dotcom`，但 `directWooUrl` 在已知非 Woo 平台时仍使用通用 URL fallback。客户端把该 URL 作为 Woo `productUrl`；后端正确拒绝 Shopify `variant` 或未收录为 Woo 的商家 host，发生在商家相关性路由之前。二轮又携带同一 URL。离线公共 `searchProducts`＋真实 Woo client/controller 复现 Shopify parent、variant 两例失败，普通文字对照通过：3 例 1 PASS／2 FAIL，外网调用 0。原始证据见 `artifacts/remaining-completion/woo-known-shopify-url-diagnostic.md` 与 `woo-known-shopify-url-probe-report.json`。

UNKNOWN：原生回执未保存后端 HTTP status/body；不能把离线确证的 400 写成已捕获的原生 HTTP 事实。HTTP 计数只在成功响应后累计商家 diagnostics，0 不等于未发起 backend POST。NF07 无相关商家探索策略仍未决定，本缺陷在该策略前即拒绝。

| 入口／消费者 | 当前职责与不变量 |
| --- | --- |
| `search-products.ts` → `resolveKnownProductUrl` | 识别审核官网平台与只读商品路径；不凭 URL slug 确认身份 |
| `searchProducts` → official port | 实际读取后建立私有身份并编译商品文本 |
| `searchProducts` → Woo client | `wooAnchor` 优先；真实 Woo 或未知 URL 的直接读取仍受来源注册表约束 |
| Woo client → source controller | 公共 DTO 不变；来源服务保持 host／selector／网络安全拒绝 |
| 搜索、继续与视觉消费者 | 共用 `searchProducts`；公开模型不能声明私有锚点，既有身份和过滤不变 |

改动只有 MCP 编排的分流选择，无依赖、schema、持久数据、来源服务或探索规则变更。所属构建为 `pnpm build:mcp`；公共搜索、Woo URL／锚点／客户端、官网链接及身份合同构成相关回归。

## Propose

| 方案 | 收益与代价 | 风险／回滚 |
| --- | --- | --- |
| A：在现有 direct target 选择处区分已知平台与未知 URL | 一处条件分支；已知非 Woo URL 使用已编译文本正常搜索 Woo，私有锚点和未知 URL fallback 保持 | 需公共回归证明既有 Woo 直读与拒绝边界；可单独回滚该条件，接口不迁移 |
| B：提取平台感知的 direct-target helper | 显式表达优先级，方便未来多个调用者复用 | 当前单调用点增加抽象和文件；同样需要安全合同，可回滚 helper 与调用者 |

推荐 A。主任务根据用户“完成全部可控修复”的现有授权批准 A。不能通过跳过 Woo 聚合搜索、接受外平台 URL、放宽后端或调整 NF07 解决；不改变广泛重试规则。

## Plan v1（实现前冻结）

1. 在 `apps/mcp-server/test/woocommerce-known-platform-routing.test.ts` 添加公共搜索回归：已知 Shopify parent／variant URL 必须用编译文本参与 Woo，普通文字保持；私有 wooAnchor 优先、已知 Woo 直读、未知已收录 URL 仍直读、未知未收录 URL 仍拒绝。使用真实客户端／控制器与离线传输替身，断言来源状态、实际请求参数和读操作，禁止外网。
2. 先保留新增断言红记录，再仅修改 `search-products.ts` 的 direct target 选择：anchor 优先；已识别平台仅 WOOCOMMERCE 使用 source URL；未识别时保留 generic helper。立即独占 `pnpm build:mcp`，再运行新增断言。
3. 新增和相关搜索／Woo／官网／身份测试、类型检查、涉及文件 ESLint 与 diff 检查全部通过后交接。原 2 FAIL／1 PASS 诊断不覆盖，修后报告使用新文件；独立复核交另一代理。失败停在当前模块修正，新增范围重新冻结。

禁止改版本、manifest、README、总计划、后端／NF07、真实安装缓存；不提交，不运行新原生任务或来源请求。本地通过不替代最终安装版本的真实购物复验；后续发布由主任务单独执行。

## Implement / Test

运行实现仅修改 `search-products.ts` 的 direct target 条件：私有锚点优先；已知非 Woo 平台返回无直接目标，后续 Woo 聚合使用原本已编译的商品文本；未知 URL 保留 generic fallback。没有改源服务、NF07、重试、公开输入或身份资格。

永久公共 7 项首跑 4 PASS／3 FAIL，保留 `woo-platform-routing-red.json`。其中 known Woo 测试未装配 managed official registry，不能证明其“已知”前提；按现有公开注册入口补测试数据后，`woo-platform-routing-red-r2.json` 为 5 PASS／2 FAIL，仅 Shopify parent／variant 两个实际行为失败。随后一处分流修复并立即 MCP build，通过新增 7／7。

类型检查首跑发现新增测试将可选 `sourceFailures` 直接 `.filter`；仅补测试的缺省空数组处理，保留首次日志，运行逻辑不变。最终验证：

| 范围／命令 | 结果与证据（均在 `artifacts/remaining-completion/`） |
| --- | --- |
| `pnpm build:mcp`，含 notices | exit 0；`woo-platform-routing-build.log` |
| 新增 `woocommerce-known-platform-routing.test.ts` | 7 PASS／0 FAIL；`woo-platform-routing-green-r2.json` |
| 官网 URL intake/search、Shopify URL 锚点、Woo 上下文／客户端／信任准入／私有身份／持久化／隔离／受限恢复、来源选择绑定与搜索 | 13 文件 192 PASS／0 FAIL；`woo-platform-routing-related.json` |
| `pnpm exec tsc --noEmit --pretty false` | exit 0；`woo-platform-routing-typecheck-r2.log` |
| 两个涉及源码／测试文件 ESLint | exit 0；`woo-platform-routing-lint-r2.log` |
| diff 检查 | 无 whitespace error；Windows Git 的 LF 提示不影响校验 |

公开断言确认 Woo 实际参与且输入是商品文本、Shopify 私有 URL 身份与 Espresso／预算保留；真实 Woo 及未知已收录 URL 继续只读目标；未知未收录 URL 仍在 merchant read 前返回不可重试拒绝。控制器和客户端是真实实现，网络与商家结果为离线替身，各例外部 fetch 调用 0。当前完成的是路由行为合同，空测试商品列表不证明真实商家持有该商品。

交接时未升版本的 MCP bundle 为 1,412,427 bytes，SHA256 `e75bca1d8d1e1120ab56169579e72e0cf17209c093f0cfe4f48fc61ae200e86e`。源码构建锁已交主任务统一 v0.18.7 构建、全套、发布与原生复验；该哈希仅记录模块构建，不作为最终安装版本证据。原 v0.18.6 发布和真实回执保持原版本；没有重试原目标、创建原生任务或联网读来源。

独立复核最终 6／6 PASS：重放原三项并补 Woo 未配置、official port 缺失、official 读取失败组合；均无外网，其他可用来源仍参与。首轮 5 PASS／1 FAIL 是复核测试错误预期未配置 Woo 为 `SKIPPED`，既有公共合同实际省略字段；只修 artifact 预期后另存 `woo-known-shopify-independent-report-r2.json`，原失败保留。最终结论和实际报告路径见 `woo-known-shopify-independent-final.json`。静态复核确认 anchor 优先、未知网址仍拒绝、NF07 不变，无新增已复现阻断。
