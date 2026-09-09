# 9/9 改进计划实施记录

## 基线与授权

基线 `be98985578dc030184d9940a69e613f06c1fb6ab`（v0.18.3）；原有未跟踪文件为 `改进计划 9_9.md`。用户于本任务明确授权按该计划修改；没有本轮发布授权。遵循总设计第4–6节身份、证据、推荐规则及第8节任务状态前提。

## Research

- FACT：`coffee-category.ts/assessCoffeeCategory` 被检索、检查和需求核验共用；受控规格名遗漏真实回执中的 `Coffee product form` 和 `Ground or whole bean`。标题整豆会覆盖漏读的已选 Ground。
- FACT：`shopify-match.ts/assessRequestIdentity` 在 EXACT 时提前确认；Sony 官方检索允许裸 1000XM 系列，未锁定 WH/WF。`server.ts` 已有保存需求快照的澄清入口；`search-requirements-context.ts` 支持 Sony 系列细化。
- FACT：报价在 `verifiedQuoteTarget` 及单件/批量入口拒绝；单件有原因码，批量可能退化为通用错误。UI 对未知错误提示购物车副作用。
- FACT：摘要从全部 HIGH_RATED_UNVERIFIED 卡片计合格数；研究卡片也计入。身份未知会套用版本问题。
- FACT：Woo 路由在缺少相关商家时仍选查询哈希探索；INVALID_RESPONSE 合并不同响应阶段。更改须保留总预算及安全终止。
- UNKNOWN：实际 MCP 连接能否收到可信且重启稳定的任务身份、生命周期和通知交付确认。未证实前，不用模型参数或环境中的当前任务 ID 冒充授权边界。
- UNKNOWN：原 medicube 参考图片、40+40 人工真值、实际宿主端到端样本尚不齐备。模拟测试不能核销这些验收项。

## Propose

| 共同维度 | A：在各工具入口分别修补 | B：共享语义规则及错误合同，入口只编排 |
| --- | --- | --- |
| 身份一致性 | 每个入口独立防护，易遗漏检查/比较 | 共用分类函数，统一影响各消费者 |
| 接口和代价 | 初次改动小，重复逻辑多 | 少量共享函数/兼容字段，消费者回归较广 |
| 性能和安全 | 不增加请求，但规则容易分叉 | 不增加请求；保留安全与授权门槛 |
| 回滚 | 各入口撤回 | 按独立模块撤回，无数据迁移 |

选择 B；在现有模块中实现，不改写检索架构。每一后续模块的细节在修改前补充冻结记录。

## Plan v1（用户已授权）

1. F06：扩展受控咖啡规格名；先用 Ground 反例、Whole Bean 正例及冲突/非咖啡反例确认红测，再修共享函数。立即 `pnpm build:mcp` 和咖啡相关测试。
2. F05：共享 Sony 系列歧义判断，身份确认前阻断；工具入口澄清并保留需求快照；明确 WH/WF 或佩戴类型才能解除。先公共身份/澄清/续接回归红测；立即 MCP 构建及相关测试。
3. F12/F14：分别冻结共享报价诊断、最终摘要方案后新增反例、实现、立即 MCP 构建和模块测试。
4. F10/F11：核实路由和响应阶段合同，先兼容来源合同后消费者；每步运行来源服务构建，涉及 MCP 则同时构建 MCP，运行对应合同回归。
5. F01/F04：检查真实宿主可用接口，记录支持范围；依赖不成立的 F02/F03 不引入伪任务身份。可独立修的本地交付漏洞须先冻结合同。
6. 最终执行 typecheck、lint、完整默认测试、受影响包构建和 diff 检查；集成/实际宿主验收单列，逐项更新原计划，未达全部条件不勾选。

通过标准：新增反例确实因目标缺陷失败，修复后模块构建与自动断言通过；失败停留当前模块。源码验证不冒充部署或真实宿主验收。

## Implement / Test

进行中；下方随每步真实结果更新。

- F06：旧行为 128 项中 4 项新增反例失败；受控字段名修复后 MCP 构建通过，10 文件 243 项通过。
- F05：旧行为 33 项中 4 项新增反例失败（错误确认身份、澄清前检索）；共享系列规则及 MCP 需求快照续接后构建通过，7 文件 143 项通过。日志 `artifacts/qa-9-9/sony-{red,build,tests}.log`。

### F12 Plan v2 冻结

事实：Shopify 的无效目标在保存快照时降为 NOT_CHECKED；Awin 预检限额/失败也为 NOT_CHECKED，须按来源与已保存目标区分，不能一概称未审核商家。报价授权函数所有失败均发生提供者写操作之前；未知网络结果仍可能有先前已授权副作用。

选择：A 在 UI 猜自然语言错误；B 在服务端单件/批量入口共享资格原因码，UI 仅映射原因码。B 保留机器可读边界，无新增网络请求或许可；A 易误判写入结果，故选 B。单件既有 MERCHANT_CHECKOUT_ONLY 可恢复快照合同保留；批量使用明确 QUOTE_UNSUPPORTED，均不宣称支持审批。先添加真实 MCP 错误回执及双 UI 反例，再共享资格检查、UI 映射，立即 build:mcp 与 quote 系列测试。身份/授权/结果未知的安全边界不放宽。

- F12：新增/强化反例首次 13 失败、48 通过；修复后 MCP 构建通过，7 文件 129 项通过，详见 `quote-{red,build,tests}.log`。

### F14 Plan v3 冻结

事实：`summarizeSearchProducts` 已统一计算 displayEligible，而 server 的评分摘要重复按 tier 计数；`rememberSnapshot` 仅在数量变化时刷新文案，资格变化可能漏掉。A 在文案处增加独立过滤；B 用最终摘要派生高评分合格数并在资格变化时刷新。选 B，复用排序规则避免漂移，不更改商家准入。品类请求的候选证据未知不生成版本问题；已有命名商品的澄清保留。MCP 3 合格+3 研究反例、纯函数合格数、咖啡形态缺证据不问版本；立即 MCP 构建和摘要/高评分/咖啡回归。

- F14：首个 MCP 夹具误设 limit=3，纠正为6后复现原文案3/6冲突；两项反例失败。构建通过；首次相关回归发现 F12 的旧断言仍预期能力未知，按已冻结商家原因码更新该断言，保留零审批/零写入断言。5 文件69项通过。

### F11 Plan v4 冻结

事实：WooReadError 同一 INVALID_RESPONSE 混合 content-type、JSON语法、结构限额、商品schema和变体绑定；原 reason 驱动不可重试/隔离安全边界。A 扩张 reason 枚举并重写所有分类器；B 保留 reason，增加有界 `failureDetail`，只记录阶段代码而非商家正文。选 B，避免把结构错误变成可重试网络错误。

接口：WooStoreResult 可选 failureDetail；覆盖能力版本2才返回新字段，版本1保留 boundedReasons、旧版本两者均省略；新客户端接受可选字段并申请2，旧服务降级缺字段时仍可读。逐步先新反例，再源读取器/控制器和共享合同/HTTP/MCP消费者作为一个跨接口原子步骤，立即构建 MCP 与 Awin 服务及 Woo 全部单元合同测试。限额/安全不放宽；真实 Sony CODE 根因仍须观察原响应，不能凭新诊断宣称已修复。

- F11：4项阶段诊断红测全部失败；增加受控原因详情后两包构建通过，28文件1370项Woo测试通过。

### F10 Plan v5 冻结

事实：rankWooMerchants 的零评分尾部与相关店混选且无标记；coffee grinder 类目含coffee会占据饮用品名额。A 保留六店统一探索并只改善文案；B 相关店优先（总上限六），最多两家无匹配元数据探索，公开当前候选池相关数和两类计划数。选B，减少无关请求且仍保留未知元数据的召回机会；不能把零元数据命中等同库存为零。通过已有覆盖版本2增加可选routing诊断，旧客户端不接收新字段。路由词添加假发/耳塞受控别名；咖啡饮用品请求不以设备/配件标签评分，显式品牌/已登记域名优先保持。冻结红测→最小实现→两包构建→Woo回归；旧六店无关探索断言更新为两店，但安全/限额测试须保留原覆盖目的，使用有相关类目的夹具。

- F10：无关探索红测失败；两包构建通过；第一次Woo回归16项失败，均为原无关六店行为预期。来源限额/并发/健康夹具补充原查询 desk 类目，保持原18请求/3并发/6健康店安全断言；真实名单无关查询改验两店探索和互补四店。28文件1372项通过。HTTP验证版本0/1不泄漏新版字段、版本2保留诊断。
- 首轮全量验证：typecheck、lint通过；185文件3813项默认测试通过。随后扩展真实咖啡字段的注册MCP检查回归，9项通过，原引用不变。

### F10/F11 MCP回执补充步骤

沿用共享诊断方案：从全部Woo轮次累计“发起读取的店铺轮次”和其中失败轮次，缓存/被跳过不计入实际尝试，原失败不会被后轮成功抵消。仅所有有记录轮次均有新版routing且matchedStores=0时显示元数据覆盖缺口；旧服务无字段时不猜。先失败断言，再共享诊断函数和server文案，立即MCP构建及来源回执回归。未知传输/安全分类不变。

- 回执补充红测2失败，MCP构建通过；31文件1386项相关断言通过。

### F05 兼容入口补充

发现仍暴露给旧 app 的 search_shopify_products 直接走来源，不能只靠统一入口防护。沿用共享 Sony 门槛，在旧入口保存澄清及原预算快照；不改其他旧入口召回行为。另核验省略独立 brand 参数但 query 已明确Sony时，细化WH/WF仍可续接。新增两项公共MCP反例，修复后立即MCP构建及Sony/上下文回归。

- 兼容入口夹具先补齐必填 selectionMode，再复现2项失败；修复后MCP构建通过，7文件164项通过。保留原“明确佩戴类型及同代WH/WF”续接规则，不能换代或跨类型。

## 实际来源复核与阻塞项

### F01–F04：宿主前提尚不成立

已核对 `.mcp.json`、`stdio.ts` 和当前SDK `RequestHandlerExtra`：配置仅启动stdio及来源/Watch目录，没有可信宿主任务身份注入；SDK sessionId属于传输连接，taskId属于MCP操作任务，未建立与Codex对话的受信映射。仓库没有归档/删除事件入口、可信生命周期查询、通知送达ACK或调度停止ACK。

所需合同：宿主经认证通道提供稳定task ID及主体/作用域；同任务重启稳定、不同任务隔离；生命周期带唯一事件ID和单调修订，支持重放/查询；交付ACK绑定持久事件ID、任务和消息；停止ACK绑定该任务实际调度。模型参数、shell当前任务ID、Automation引用字符串不能替代这些证明。

本轮不写无法划分正确作用域的购物持久化，不新增模型可伪造ACK。F02/F03依赖F01；F04原“保存COMPLETED后、通知之前崩溃”窗口仍存在，须以待交付事件及真实确认协议解决。STOP_REQUIRED仍不是宿主已停止。

### F07/F08/F09与真实验收

当前修复bundle通过本地SDK stdio读取真实来源（不是Codex原生UI）：

- R10：7,903ms，70片/155g原请求仅返回Mild待核验，RESEARCH_ONLY、0可比商家；未拿Mild替代原版。原图/SKU证据仍缺，F07/F09未完成。
- R11：6,146ms，Sony官网Smoky Pink确定同款、银色独立商家及黑色待核验线索；只有1家可比商家，COMPARISON_INCOMPLETE。不同颜色未冒充同规格最低价，F08未完成。
- 两次仍有生产Woo来源失败。本地MCP连接的来源服务尚未部署新版，回执缺新版failureDetail，不能宣称生产故障已修复。
- Sony历史SEARCH_RESPONSE/INVALID_SCHEMA/CODE：2026-09-09T14:07Z受限复测 `Sony 1000XM5`、`Sony WH-1000XM5` 均200，code符合现有格式。未复现，未放宽CODE规则，保留待定位。
- F13缺真实宿主接受/拒绝/取消证据；F15缺40业务+40真实图片的独立人工真值、审核者及baseline；F16缺模型/宿主完整回合和足够样本。模拟回归和上述单次API时间不能替代验收。

证据：`artifacts/qa-9-9/live-local-recheck.jsonl`、`R10-local-repaired.json`、`R11-local-repaired.json`、`sony-live-code.jsonl`。

### F10：热门类目补源审核

2026-09-09T14:14Z，本地控制器+真实上游：1000店对human hair wig相关元数据0，探索2家/2次GET/0商品，registryCoverageComplete=false。字面coffee capsules探测6家正常空数组；这不代表统一检索编译及第二轮结果。

- [Wigs Wear House商品页](https://www.wigswearhouse.com/product/lovely-locks-elvis-black/)与Store API均可读，商品4614、USD35、名称一致；[配送页](https://www.wigswearhouse.com/shipping/)明确美国市场。默认reader/controller读取成功，但样本 `is_purchasable=false`，没有合格itemPrice，availability=UNKNOWN，故不准入。Costume样本不证明human hair或热门程度；商家全额销售不退政策仅记录，不授予可信资格。
- [Dekoni当前商品页](https://dekoniaudio.com/products/dekoni-x-hifiman-cobalt-closed-back-dynamic-headphone)可读，Store API路径404；历史Woo页面不作当前准入证据，未加入。

名单保持1000家，无新增信任/官网/联盟资格。F10路由和回执已修改；实际热门假发/耳机覆盖仍缺。证据：`woo-live-coverage.jsonl`、`wigs-admission.json`。

## 当前验证与交付状态

以下为首轮结束时点。后续已补一次性 Watch 事件恢复，默认测试增至187文件3834项；F01“没有身份注入”判断也已更正为正式候选接口待目标宿主验证。最新证据见[补充实施记录](2026-09-09-watch-completion-recovery.md)；未改变本轮未发布的状态。

- 两包逐步构建通过；typecheck、lint通过；默认测试 **186文件3823项通过**，含本地stdio冒烟。日志 `typecheck-final.log`、`lint-final.log`、`full-tests-final.log`。
- 默认套件不包含integration测试；生产负载、真实审批/通知/归档、40+40独立业务/图片及P95未验收，实际来源读取另列，不混计自动断言。
- F05/F06/F12/F14代码与自动回归完成；F10/F11部分完成；其余依赖/验收未完成。
- 本轮未改版本号，未提交、推送、部署或替换安装缓存。仓库插件bundle由本轮构建更新；已安装v0.18.3仍为原版。
- 最终真实进程重启复测：同一状态目录启动两个新进程，原引用恢复仍失败，REFERENCE_STATE_UNAVAILABLE；没有误报通过。本地bundle SHA256 `8c3af70c62a4f0049565adde4220694f73142d1584020b330764d645537b3977`，stdio发现24工具/2资源；原生UI、表单与生命周期未核验。证据 `repaired-restart-preflight.jsonl`。
