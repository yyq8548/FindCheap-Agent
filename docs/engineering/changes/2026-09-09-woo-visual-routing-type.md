# WooCommerce 视觉检索品类传递

## Research

基线 `a651e819b1c522bb11e449b87ae1abea13118091`，已读 AGENTS、研发协议、总设计第 4／7／8／13 节。用户已批准品类优先修复；根代理授权本子步骤仅修改 Woo 请求的类型选择、公共回归及本记录。来源 planner 由另一代理负责，版本、提交、安装和部署由根代理统一处理。

FACT：`search_visual_candidates` 接受仅含 `visualInput.productType` 的合法结构；server 先执行 `enforceVisualEvidenceAuthority`，`visualRetrievalSearchInput` 保留嵌套视觉字段并编译 query。`searchProducts` 只把顶层类型补入缺失的视觉类型，不做反向复制。Woo 请求构造只读取顶层 `input.productType`，因此纯视觉类型在独立 routing 字段丢失；旧 planner 只能从 query 词汇获得这一线索。

FACT：普通文字顶层类型从 `search-products.ts` 两轮请求、`woocommerce-client.ts`、共享 `WooSearchInputSchema`、HTTP handler 到 controller/planner 均保留；CONTINUE 保留旧顶层及嵌套视觉字段，URL resolvedRequest 的 spread 保留显式顶层类型。Woo direct URL 首读省略类型但已绑定单一注册商家，不是本次跨店类型路由缺陷。共享 DTO 已有可选 productType，无需扩展。

现有 `woocommerce-visual.test.ts` 同时提供顶层和视觉类型，不能发现该遗漏。UNKNOWN：本次没有新的原生图片或商品覆盖回执；离线传输断言不证明真实图片识别与购物验收。

## Propose

| 方案 | 改动与收益 | 风险／兼容／撤回 |
| --- | --- | --- |
| A：仅 Woo 请求使用顶层类型，否则视觉类型 | 一个请求字段，复用原可选 DTO；两轮召回都收到已有品类信息。 | 不回写硬条件、品牌或私有身份；顶层优先，缺失保持缺失。无新依赖，撤回本字段即可。 |
| B：引入独立 routingCategory 及 origin 的内部 DTO | 显式区分用户类型与视觉检索提示，planner 接收专门字段。 | 可实施但需共享合同、client、HTTP、controller 与旧客户端兼容；本修复无需新字段，跨模块成本较高。 |

采用根代理已批准的 A。视觉类型只用于来源商家路由，不能凭此升级商品身份、商家信任、所选规格或推荐资格；不把 query 词、品牌或图像推断改写成显式硬条件。

## Plan v1（实现前冻结）

1. 新增 `woocommerce-visual-routing-type.test.ts`，在公开 `searchProducts` 函数和真实 Woo HTTP client／严格 DTO 之间观察 JSON 请求；全部来源传输为离线合成，不伪造原生授权或停用校验。覆盖嵌套视觉类型、CONTINUE 保留、顶层冲突优先、原文字类型、两类类型均缺失、原输入不被改写。先保存旧行为红测。
2. 仅改 `search-products.ts` 的 Woo 请求 productType 表达式，值为 `input.productType ?? input.visualInput?.productType`，缺失时不发送。立即 `pnpm build:mcp`，再运行新断言与 Woo 视觉、已知平台 URL、bounded recovery、context 相关回归。
3. 完成 typecheck、lint、diff 检查；保留首轮失败与实际产物哈希后交接。若发现需要持久化、DTO 或身份变更，停止扩展并返回根代理判断。本步骤不改版本、不提交、不安装、不部署、不发起原生任务或来源请求。

## Implement / Test

新增 5 项公共 workflow→HTTP client→strict DTO 断言。旧行为 3 PASS／2 FAIL：NEW_PRODUCT 与 CONTINUE_PREVIOUS_PRODUCT 都实际把嵌套 `lip balm` 传成 undefined；红测证据为 `artifacts/remaining-completion/woo-visual-type-red.json`。两个反例均验证有两轮请求，不是未调用来源造成的假失败。

仅修改 `search-products.ts` Woo 请求的一行 productType 表达式。没有回写原输入，观察品牌没有升级为显式品牌，价格上限保留；两种类型都缺失时仍不发送，query 中 espresso/coffee 不生成类型。显式顶层类型始终优先。

立即 `pnpm build:mcp` exit 0。新 5 项与 Woo 视觉、known-platform URL、bounded recovery、anchor context、普通 context、HTTP client 共 7 文件 108/108 PASS；`pnpm typecheck` exit 0；修改源码和新测试文件的 ESLint exit 0；`git diff --check` exit 0。证据集中在 `artifacts/remaining-completion/woo-visual-type-{build,green,typecheck,lint}.log` 与 `woo-visual-type-green.json`。

当前局部 MCP bundle SHA `3f175106fc4096780bcbf47257927cd64843879a65cd5c21b674c27a74be1ad0`；最终 R2 cache suffix、全套集成、提交、安装及生产由根代理管理，此哈希不是已安装或原生验收证明。独立审查已交另一代理。旧 R1／R4 安装、生产、原生失败及审批分母保持原记录，本步骤无新网络或原生任务。
