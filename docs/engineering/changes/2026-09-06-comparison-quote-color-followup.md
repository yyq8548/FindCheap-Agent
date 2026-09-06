# 0.17.26 验收后续：颜色、报价与精简比较

## 授权与业务合同

Chris 批准修复任务 01a07705 中已确认的问题，并将比较视图固定为商品、规格、对比价格、商品价、质量依据、到手价、优惠、商品状态、商家信任九项。只精简展示；库存合并商品状态，影响决策的限制保留在对应项。遵守总设计第 2、5、6、7、10、13 节。当前授权仅修改和验证，不包括提交、推送、部署、安装、真实 Cart 或新的商家审核。

基线：main / 37afdd616d670c5f7427a055e1f9541b80c1031d / 0.17.26；开始时工作树干净。用户为业务负责人；本轮由主执行者负责实现和验证。最小拓扑仍为单 Agent、已有 Backend ports 与共享 executor。无新依赖、无本地商品目录、无数据库迁移。

## Research

| 事实与调用链 | 合同／消费者 | 证据 |
| --- | --- | --- |
| FACT：black color 未被识别为颜色要求，随后全商品描述覆盖选定变体；classifyShopifyCandidate 也从全商品文本形成 requested variant exact | requirement matcher → requirements → search/ranking/inspection/recovery；Shopify match → catalog/official sources | product-constraint-matcher.ts:isColorRequirement；product-requirements.ts:evaluateProductRequirements；shopify-match.ts:classifyShopifyCandidate |
| FACT：Shopify 卡片主要按平台与 cartQuotes 是否存在标记可报价；实际 selectedQuoteTarget 还拒绝未核验商家／目标 | search/visual/inspection → preflight/rememberSnapshot → cards/comparison；single/batch quote → target validation → real consent → Cart | server.ts:preflightQuoteCapabilities、selectedQuoteTarget、quote_selected_shopify_product |
| FACT：不支持报价时已解析单选，但 recoverableQuoteResult 返回全快照而无本次目标；isError 不附模型回执 | single quote → output schema → appendModelContext → native UI/model | server.ts:recoverableQuoteResult；execution/model-context.ts |
| FACT：比较有独立表格和卡片内嵌两个展示入口；计算、排序、选择由服务器所有 | ProductComparisonOutput → product-comparison-ui / product-card-ui | product-comparison-ui.ts:rows；product-card-ui.ts:renderComparison |
| FACT：Coupon 工具输入缺 responseLocale，回执与错误固定英文 | DealConciergeInputSchema → researchSelectedProductDeal → output/receipt | server.ts:research_selected_product_deal；deal-concierge.ts |
| FACT：真实补搜回执 formSupported=true、DECLINE、1ms；来源检索和双选识别均成功 | begin_web_search → MCP form → web lease；DECLINE 停止，不重试 | 原任务本地记录；server.ts:begin_web_search |

依赖约束已读取 package/workspace/tsconfig：Node 24、pnpm 10.34.5、MCP SDK 1.30.0、Zod 3.25.76；构建为 pnpm build:mcp。默认 Vitest 排除 live integration。前轮已有内存真实路径红断言；本轮把最小合成案例固化为回归，不复制原图或完整聊天。

UNKNOWN：宿主即时拒绝的内部原因；没有授权改变宿主权限或主动重复申请已拒绝恢复。ASSUMPTION：保留原工具名／状态兼容，只增加安全目标回执；购物记忆／Watch 不在本轮范围。

## Propose

| 路线 | 收益 | 风险与代价 | 回滚 |
| --- | --- | --- | --- |
| A：复用领域校验；报价展示与执行共用无副作用目标资格；增加操作回执；两个 UI 仅投影九项（选择） | 消除同一事实两套判断，保留 ports 与安全门槛 | 跨入口合同需集成测试；无新平台或数据格式 | 恢复本轮源码与 bundle，不改历史数据 |
| B：先隐藏所有可报价提示，增加专门能力探测工具，UI 另建精简输出 schema | 独立能力响应，隔离显示格式 | 增加工具调用与模型路由，复制商品投影；升级消费者更多 | 撤回新工具/schema，恢复原工具流程 |

选择 A：符合少代码、最小接口变更和用户“不要重写”约束。执行安全不能因 UI 简化而删除；权限未知始终停止。声明可报价只代表静态资格通过，实际调用仍需当前目标、服务可用性及一次真实授权。

## Plan v1（实施前冻结）

| 步骤／依赖 | 原子变更 | 自动断言／退出条件 |
| --- | --- | --- |
| C1，无 | 统一颜色前后缀识别；选定颜色独占变体取证；不从全描述造 exact | black color/colour/中文、613未知、red冲突、黑色正例；需求与来源匹配均先红后绿 |
| Q1，C1 | 复用无副作用目标资格给所有快照标记报价能力；执行再次核验 | 未核验／坏变体不显示 supported；可信有效目标可报价；0真实Cart；单／批量安全回归 |
| Q2，Q1 | 明确报价目标回执：原renderId、实际selectionId及选择来源／版本；错误保留上下文 | 显式A且UI选B、UI单选、unsupported、拒绝、临时失败、过期外来引用；不绑定猜测目标 |
| U1，Q2 | 独立与内嵌比较均固定九项；合并库存，关键限制就地显示 | DOM九项及顺序、2–4列、金额不改、优惠资格、相似差异、缺货和未知继续可见 |
| L1，无（串行实施） | Coupon 输入支持当前语言，安全消息本地化；不改来源事实 | 中文／英文切换、无券／源失败／引用失败；不请求Cart |
| H1，无 | 只读检查宿主相关日志／接口，保留DECLINE停止测试 | 有证据才改原因分类；否则明确宿主未解决，不修改权限配置或制造新恢复请求 |
| V1，全部 | 总设计同步、MCP构建、typecheck、lint、完整默认测试、stdio、diff；UI视觉核验 | 全部必选断言绿；真实宿主／独立图片不足单列，不冒充达标 |

每步先运行对应失败用例，再最小实现，立即执行 pnpm build:mcp 与局部断言。共享代码若涉及 Awin 服务消费者则补对应构建。失败停在当前步；新增事实改变计划时先记录增量。全程不降低预算、信任、身份、报价副作用或真实授权门槛。日志只保留安全结构化信号，不保存原始用户图片／完整聊天／凭据。

## Implement / Test

| 步骤 | 实施与证据 | 状态 |
| --- | --- | --- |
| C1 | `color-variant-contract` 首跑 7 个失败变绿；追加无选定颜色／排除／偏好同源缺陷再复现 2 个失败并修复。最终 16 项；`requirements-workflow` 增加公开 MCP 路径，613 不因共享描述中的 black 获得推荐。保留真实黑色正例 | 本地完成 |
| Q1 | 从原执行资格拆出纯 `verifiedQuoteTarget`，所有 `rememberSnapshot` 入口和单／批报价执行共用。5 个不合资格却显示 supported 的红断言变绿；有效可信目标仍通过原模拟授权流程。报价相关初轮 53 项通过 | 本地完成 |
| Q2 | 解析成功后冻结 `quoteOperation`：原 renderId、实际 selectionId、UI／EXPLICIT、UI revision。非错误结构化输出含该字段；所有已解析目标的回执含安全 JSON 文本与 metadata。未知／外来／过期引用不生成已验证目标。显式 A 与 UI B、unsupported、拒绝、超时、迟到结果均有断言 | 本地完成 |
| U1 | 两个视图均 9 行，固定顺序不受 focus 排序影响，库存并入状态；单位价格并入对比价格，未满足需求／视觉差异仍显示。新增 2／3／4 列 DOM 断言；两个 UI 文件合计 73 项通过。真实浏览器本地合成两列独立／四列内嵌界面及截图检查通过 | 本地完成 |
| L1 | Coupon schema 增加可选 responseLocale，回执含 locale／有效 renderId；成功、无券、源故障、外来／过期引用及限制中文／英文切换。保留来源原文、code、URL、资格和状态，ZIP 不授权 Cart。领域 10 项及新增 MCP 6 项通过 | 本地完成 |
| H1 | 原任务回执为 `formSupported=true, hostAction=DECLINE, durationMs=1`；桌面 2026-09-06 日志确认目标任务 FindCheap MCP 启动 ready，但未发现拒绝内部原因事件。已有中英文 DECLINE 回归证实：重复请求不再弹表单、不发 lease／queries、不执行网页读。相关颜色／需求／报价／网页局部最终 144 项通过（追加 MCP 颜色用例前） | 安全诊断完成；宿主原因未解决 |

实施增量：C1 检查发现同一共享颜色证据也污染“排除／偏好”和缺少选定颜色时的硬条件，加入同一模块回归并修复。Q2 使用已校验的局部操作回执，不扩大共享 executor 对任意错误的模型上下文投影；错误不重发整份快照。没有更改权限配置、重复申请真实被拒绝授权或尝试真实 Cart。

最终验证（2026-09-06，本地源码与本地 bundle）：

- 每个修改模块后 `pnpm build:mcp` 通过；最后构建成功。
- `pnpm typecheck`、`pnpm lint`、`git diff --check` 通过。
- `pnpm test`：**122 个文件、1,795 项全部通过**；包含 4 项 stdio smoke。stdio 另外独立复跑 4/4。
- 首次完整检查暴露测试类型标注、类型 import lint、旧 UI 空限制占位文案断言，已修正并完整重跑；未以删除安全断言换通过。
- 未修改 Awin 服务共享实现；未发真实来源请求，未创建真实 Cart 或 Watch。浏览器预览使用本地合成数据，临时服务和页签已关闭；不代表 Codex MCP iframe 的真实授权通过。

未完成／未声称：宿主即时 DECLINE 内部原因与弹窗验收、真实商家 Cart 副作用验收、原任务最终模型回复验收。没有 commit、push、版本升级、Railway 部署、发布或安装缓存替换；当前用户安装仍是上一轮版本。未来获准发布时，需同时核验 UI 资源缓存刷新。
