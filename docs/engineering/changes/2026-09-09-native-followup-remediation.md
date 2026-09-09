# 原生测试复核后的修复与独立任务验收

## Research

- 基线：main / d9de9a080f2780940f76e1a2b30c305bc37b3a24，v0.18.4；开始时工作树干净。
- 授权：用户要求自主修复，并创建独立窗口/任务输入真实测试指令；用户报告使用 Full Access 与 Astra Ultra。宿主实际能力以新任务回执为准，不能把配置声明当作授权表单验收。
- 适用总设计：4.1 需求/形态与机器适配、5 价格及展示、8 目标连续性、10 执行边界、13 真实验收。
- FACT：任务 01a0874b-551b-7e20-bda2-6ae43179799a 的胶囊结果含 JBC 684/686/687，grind 为 auto-drip/french/home-espresso；当前受控别名未识别。研究卡均记录商品价 USD0 / VERIFIED。
- FACT：实际父399是 Subscription Coffee / Coffee Subscription；子项0金额、12oz、可见PDP标价0/oz，缺少订阅计费周期和完整费用。不能把零值改成猜测价格，也不能以此证明免费整件。
- FACT：Sony 经现有安全 fetch 的实际搜索→粉色详情→黑色详情共3 GET；黑色缺 notSellable，唯一 schema issue 为该字段 undefined。绑定SKU/价格29999/stock一致。历史 CODE 错误不是本次根因。
- FACT：文字入口和共享 merge 禁止 CORRECT + removeRequiredFeatures；实际任务退回整字段清空。视觉也使用该merge。需求撤销的原始用户意图由调用规则约束，服务端仅能验证原引用和提交值。
- FACT：BLEND10 描述被通用要求判为兼容 MATCHED，专用标题/类别/所选规格判 UNKNOWN。不能采用描述/交叉推荐推翻当前规格。
- 调用链：MCP search/inspect/compare → search-products / product-requirements / coffee-category；文字和视觉 → search-requirements-context；Sony官方port →安全fetch与严格SKU验证；来源服务reader/controller → Woo normalize → DTO → MCP卡片、比较和Watch。
- 依赖：Node24、pnpm10、现有zod/esbuild/vitest；无新增依赖、数据库迁移、权限放宽、信任名单升级。
- UNKNOWN：真实跨商家同规格召回、当前宿主授权显示/交互；新任务验证。原图和40业务/40图片标注仍按用户前序要求暂缓。

## Propose

| 问题 | A：既有模块收敛规则（选择） | B：可行替代 | 取舍 |
| --- | --- | --- | --- |
| 研磨与兼容性 | 受控研磨别名；公共需求评估复用专用品类/兼容性证据，包括 UNKNOWN/冲突 | 所有入口各自加转换和过滤 | A避免搜索/检查/比较分叉，未知不被描述提升 |
| 订阅价格 | 父/子明确订阅身份且无计费合同，省略itemPrice、保留原金额和UNKNOWN价格范围 | registry增加逐商品价格限制 | A跨同类商家适用，不增加配置合同；普通0价保留 |
| Sony | notSellable可缺失，缺失可售状态UNKNOWN；显式错误类型仍拒绝 | 拆分全部库存/购买性校验层 | A有单字段实证、改动小；不默认false |
| 条件纠正 | CORRECT/CONTINUE支持明确单项撤销，其他模式拒绝 | 新增独立需求patch工具，再纠正 | A保留现工具/引用和预算，少一轮状态变化 |

均可按源码回滚；无数据迁移。选择A基于当前自主修复授权，保持现有总设计与权限边界。

## Plan v1（实现前冻结）

| 步骤 | 模块/依赖 | 独立预期及验证 | 构建 |
| --- | --- | --- | --- |
| P1 | 条件纠正；独立 | 公共MCP文字/视觉：精确撤销、保留其他条件、原goal修订、原快照不变；伪造/无引用/冲突/新目标拒绝 | pnpm build:mcp |
| P2 | Sony；独立 | 实际脱敏缺字段夹具保留SKU/价而库存UNKNOWN；已有false正例/true/null/身份与安全反例 | pnpm build:mcp |
| P3 | Woo订阅价格；独立 | reader/controller搜索、lookup、inspect；父订阅继承、普通0价、描述营销不能触发限制 | pnpm build:awin-feed |
| P4 | 咖啡公共证据；独立 | 实际grind别名均GROUND；咖啡形态/兼容性与通用要求同结论；混合描述不推翻所选规格；无关要求保留 | pnpm build:mcp |
| P5 | 集成；P1-P4 | typecheck、lint、默认全套、所需Woo消费者合同、bundle stdio；记录首次失败 | 两包 |
| P6 | 原生验收；P5 | 新Astra Ultra任务，分轮Sony歧义→WH；独立咖啡整豆→胶囊→Original；基于实际回执判定，不以脚本代替宿主 | 核对实测插件bundle与源码hash |

MCP构建输出共享，顺序执行，禁止并发写同一bundle。每模块先红断言，再最小实现，立即构建/局部回归。源码/本地安装/生产服务/原生结果分别记录。新任务只执行购物验证，不代替用户同意表单，不下单/付款/创建无关监控。提交、远端发布与生产部署不由测试绿色自动授予；必要运行环境更新沿用会话已有明确授权并单列证据。

## Implement / Test

### P3 Plan v1.1（回归事实引发的局部修订，实现前冻结）

广泛Woo回归发现历史真实商品 Force of Nature 3261290 标题明确 `Pro Activator Capsules (one time purchase)`，但父类别包含 Subscription。v1 任一订阅类别降级会误伤明确一次性购买；保留原回归，不修改真实fixture。

- A2（选择）：商品/父名称明确 subscription 仍限制；仅类别 subscription 时，允许当前绑定商品名称明确 one-time purchase 排除泛类别歧义。描述和未选 options 不能解禁。
- B2：完全不使用类别标记；实现更少，但漏掉仅父类别明确订阅的商品。
- 选择A2，新增正价一次性购买/订阅名称优先/描述不得解禁边界，重新 build:awin-feed 和 Woo 回归。普通零价政策不变。

其余步骤进行中；待填写各步骤真实命令、退出码、失败和原生任务结果。

### 已完成的模块验证

| 步骤 | 先红证据 | 实现/立即构建/局部验证 |
| --- | --- | --- |
| P1 | 新增11例中5失败 | 精确撤销双入口与共享merge；MCP构建通过；8文件131断言通过。新增测试2处错误summary观察和Skill固定文字/字节约束已纠正，未提高门槛。 |
| P2 | 缺notSellable一例失败，其余4保护例通过 | 仅schema optional与严格false可售条件；MCP构建通过；Sony4文件80例通过。真实3GET返回黑色29999/UNKNOWN，无解析失败。 |
| P3 | 最初9/11失败；一次性边界2/14失败 | 来源构建通过；Woo来源及MCP消费者33文件1438例通过。原一次性真实夹具未修改；新测试returned统计预期按实际过滤后语义纠正。 |
| P4 | 最初10/12失败；独立审查新增5例失败；OR一例失败 | 受控别名和共享评估，移除搜索独有的单向升级；每次变更立即MCP构建。最终新18例通过；原5反例与OR边界保留。 |

最终源码版本0.18.5，插件包0.18.5+codex.20260909183846。两包构建、typecheck、lint通过；2026-09-09 18:44:27Z默认全套 **197文件/3905断言通过**（含5个bundle stdio断言）。默认全套不含外部Postgres集成，本次无相关修改/迁移。最初完整回归4失败均为版本元数据/固定Skill措辞，另typecheck3处为回执和联合类型标注；均修正后重跑，不删测试、不放宽安全字段或Skill字节门槛。日志在artifacts/native-followup-remediation，原失败日志保留。

P6原生任务、生产部署和安装核验尚待后续真实回执。所有源API探针都与原生宿主验收分开。

### P4 Plan v1.2（独立审查，实现前冻结）

独立审查复现：多系统要求中，每条要求复用整请求的系统选择可能把另一系统错误标MATCHED；选定形态未知时，排除ground不能静默SATISFIED。方案A（选择）按每条完整兼容要求评估同一选定规格，排除形态UNKNOWN明确进入缺口；方案B拒绝全部多系统请求并忽略未知排除证据，后者不能满足既有精确需求规则。新增两例先红，保持组合claim不拆分、原query的领域识别与选择边界，再构建与全部相关验证。

v1.2同一审查的范围补充：组合兼容要求、排除系统和偏好也必须遵循同一所选证据。方案A扩展共享评估到三者：组合要求不能以兼容单项证明整项，缺完整证据UNKNOWN；明确系统冲突仍CONTRADICTED；形态偏好不能命中未选父选项。方案B只修required数组会留下相邻入口分叉，故选择A，先增加三个独立反例再实现。

### P4 Plan v1.3（OR反例，实现前冻结）

审查用 `compatible with Original or organic` + 有机Vertuo商品复现：单系统矛盾不能证明复合OR为假，作为排除项时会绕过。选择保持未完整解析的复合条件为UNKNOWN（必选/排除/偏好共用）；不论单系统真假，都不凭单分支判断整个复合条件。另一方案是引入完整AND/OR解析器，增加本次不必要的语法和迁移范围。原AND断言相应按不拆解完整条件的既有合同改为UNKNOWN，独立系统冲突仍保留CONTRADICTED；新增OR必选/排除反例先红。
