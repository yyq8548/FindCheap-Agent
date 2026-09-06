# 真实对话测试改进计划（1–9 项及六图补充）

> 日期：2026-09-06。实施 v3：用户已批准代码修复；技术方案与冻结步骤见第 10 节，实施／测试证据见第 11 节。
> 当前授权：修复及验证本计划的问题。不提交、推送、部署、升级版本或替换安装缓存；实际宿主与真实图片验收单列。

## 1. 依据与范围

- 业务基准：[Agent 总设计](../../architecture/agent-design.md)第 2、4–8、10、13 节；执行流程：[五阶段研发协议](../agent-development-protocol.md)。本文件不修改已批准的业务规则。
- 测试来源：[比较 Sony WH-1000XM6 价格](codex://threads/01a076bf-0c1a-7771-8942-72af727f6ce4)。按对话顺序对应测试 1–9，第 9 项包含后续 Sony 报价重试。
- 测试版本：0.17.25，插件包 0.17.25+codex.20260906122817；本次文档编写时源码为 main / `3f4a058da023eb8ca52aa56798ed9fccab22a94b`，初始工作区无改动。
- 证据方式：第 2–9 节保留原只读审计事实；第 10–11 节记录本轮源码复现、修复与自动回归。本轮未重新核验线上或安装状态。
- 价格、优惠数量和状态仅代表该次测试观察，不是当前价格承诺。仅保留必要事实摘要，不复制完整聊天、私有日志、原图或授权凭据。

## 2. Research：已观察事实与未知项

| 编号 | 测试与事实 | 判定及保留边界 |
| --- | --- | --- |
| T1 | Sony WH-1000XM6 黑色全新，要求比较可信商家价格。返回 Sony 官网 $398、NEW、有货；其余商家未核实。后端为 READY，恢复动作 NONE。 | 同款查找通过，多家可信商家比价未完成。不能将未审核低价商家转为可信来补足数量。 |
| T2 | 输入 DÔEN Cornella 黑色裙子的明确官网商品链接，结果为零张卡片。回包记录候选被身份门槛排除；补搜返回 PERMISSION_DENIED，hostAction=DECLINE，durationMs=2。 | 已知链接未形成可核实同款，测试失败。尚未定位 URL 解析、来源查询或身份校验中哪个环节导致漏检；不归因为商品不存在。 |
| T3 | $30 内改善干燥毛躁的洗发水。Scotch Porter、Sol de Janeiro 满足商品需求，但信任状态未核实；Awin 的 Amazonliss (US) 已可信，但具体功效证据不足。补搜 DECLINE，durationMs=0。 | 需求识别和安全降级有效，可信购买推荐未达成。商家信任与商品功效是两个独立门槛。 |
| T4 | 预算降至 $20，保留原需求，原 goalId 的 revision 从 1 更新到 2。明确区分 $12/90ml 与此前 $26/295ml。 | 需求继承通过；没有将小容量当作原规格降价。可信推荐缺口延续 T3。 |
| T5 | 英文请求可信商家的 $100 内黑色假发。英文回复，推荐人工验证的 Ishow Hair，未混入胶带或无关品类。 | 核心通过。保留语言切换、大类、预算和 Awin 人工信任规则。 |
| T6 | 只传原 renderId，比较接口成功读取第 1、3 件真实选择，分别 $36.41、$48.74。最终推荐与后端 recommendedSelectionId 一致。 | 当前会话选择同步与比较通过；不代表跨重启记忆或所有 UI 生命周期通过。 |
| T7 | 指定 Ishow Finger Wave 假发优惠查询 COMPLETE，取得 29 条商家优惠，全部 recommendationEligible=false：1 条批发条件、15 条范围未确认、13 条未达最低消费。 | 不是优惠连接失败。没有商品已确认适用券，不承诺直接可用或编造折后价。实际结账抵扣未验收。 |
| T8 | 提供 ZIP 10001，同时要求只比较商品价。仅调用比较，返回 ITEM_PRICE，没有发起报价。 | 通过。ZIP 不是报价授权。 |
| T9 | Ishow 卡片为 MERCHANT_CHECKOUT_ONLY，报价拒绝符合能力限制。Sony 重试另报该快照没有已同步的 2–4 个有效商品选择；用户随后指定 Sony，回答仅商家结账页能计算总额。 | 只覆盖不支持与选择不足分支。不能确认是单选、未选择或同步故障；尚未验证支持报价商品的真实授权和成功报价。 |

其他已观察差距：首轮额外读取记忆、重复进度说明；部分失败回复向用户暴露内部技能路径和规则。优惠工具摘要为英文、最终回答为中文；这仅是语言审计线索，尚不能据此认定用户卡片出现语言错误。

### 仍需技术 Research 的问题

1. T1 的终止条件是否只判断“有可推荐商品”，没有表达“用户要求多商家比价”的未完成状态。
2. T2 的明确链接如何经过安全读取、身份提取、来源查询与候选过滤；具体丢失点是什么。
3. 两次宿主 DECLINE 的实际机制。毫秒级返回不能证明弹窗显示或用户主动拒绝，也不能证明插件参数一定正确。
4. T3 的已审核 Registry 覆盖、域名规范化和商品属性取证是否存在缺口。不能仅因品牌知名或域名看似官方就升级信任。
5. T9 的选择数量、selection revision、快照引用和工具路由；现有记录不足以认定 UI 丢选。

本轮没有遍历这些实现调用链。因此代码 Research、两案选型和实施冻结均未完成。

## 3. Propose：本轮文档存放方式

| 维度 | A：直接扩写总设计状态表 | B：独立增量计划，链接总设计 |
| --- | --- | --- |
| 收益 | 总设计读者立即看到全部反馈 | 区分批准规则、测试观察与待证实假设，便于合并后续测试 |
| 风险 | 把未定位的问题混入现状结论，持续增加总设计篇幅 | 后续实施者需要读取本文件；通过任务交付链接及实施前引用解决 |
| 代价 | 修改总设计并反复调整临时细节 | 新增一个研发文档，无运行接口或依赖变化 |
| 撤回 | 撤回总设计相关增量 | 单独撤回本文件，不影响产品运行 |

本轮采用 B。只冻结“文档落地”范围，不把下述候选步骤视为已获实施批准。代码阶段的至少两种可行方案，须在剩余测试合并并完成源码 Research 后另行比较。

## 4. Plan：候选改进工作包

下面的模块是待核查入口，不是已确认的故障位置。保留既有 Backend、executor 和来源适配器，不重写系统，不新建本地商品目录。

### G0：合并测试并冻结实施依据

- 前置：用户完成剩余测试并提供结果，明确后续分析或实施范围。
- 合并每项输入、版本、预期、回包、实际输出、判定和证据；保留首次失败，区分产品限制、程序缺陷、宿主问题、未覆盖路径。
- 针对本次范围追踪入口、状态归属、全部受影响消费者、依赖和安全边界。比较至少两种可行方案，再冻结原子步骤、接口、预算、构建和断言。
- 完成条件：每个拟修问题有可复现观察点及独立预期；关键未知项明确解决或列为阻塞，不先假定根因。

### P1-A：恢复明确商品链接的身份与取证链

- 对应：T2。前置：G0。
- 候选入口：[search-products](../../../apps/mcp-server/src/search-products.ts)、[selected-product](../../../apps/mcp-server/src/shopify-selected-product.ts)、[official-store search](../../../apps/mcp-server/src/shopify-official-store-search.ts)、[Backend](../../../apps/mcp-server/src/backend.ts)。
- 先定位丢失点，再让已有安全商品页读取优先建立身份和变体证据。区分身份不匹配、价格未取得、缺货和检索不完整；不能统一丢成“没有商品”。
- 验收：固定 DÔEN 链接与带追踪参数版本保持同一商品身份；黑色不被其他颜色替换；明确缺货可保留同款信息；私网、恶意 URL、未经允许的重定向仍阻止。真实页面不可读时准确说明限制。
- 自动回归候选：[text-search-reliability](../../../apps/mcp-server/test/text-search-reliability.test.ts)、[web-product-recovery](../../../apps/mcp-server/test/web-product-recovery.test.ts)。固定证据断言与实际官网复测分别记录。

### P1-B：让结束条件对应用户的比价目标

- 对应：T1。前置：G0；与 P1-A 涉及同一编排时顺序实现。
- 候选入口：[search-products](../../../apps/mcp-server/src/search-products.ts)、[requirements context](../../../apps/mcp-server/src/search-requirements-context.ts)、[web recovery](../../../apps/mcp-server/src/web-product-recovery.ts)。
- 区分“已找到可推荐同款”和“已获得足够的可信报价完成比较”。可先交付已核实结果；明确要求多商家比价且覆盖不足时，在原预算内评估尚未使用的互补来源。
- 验收：相同 Sony 请求保留官网正确黑色全新结果，不因为已有一个结果就丢弃尚未完成的比价目标；来源不足或预算终止时明确只能核实一家。不能承诺一定找到两家，不能添加重复报价、降级信任或放宽身份凑数。
- 单纯“找商品”请求仍允许及时结束，不能强迫每个搜索多跑一轮。普通 90 秒目标、每来源限制和原目标预算继续有效。
- 自动回归候选：[Sony recovery](../../../apps/mcp-server/test/sony-known-product-recovery.test.ts)、[requirements workflow](../../../apps/mcp-server/test/requirements-workflow.test.ts)、web-product-recovery。

### P1-C：核验宿主授权通路，保持拒绝即停止

- 对应：T2、T3；影响后续报价正向验收。前置：G0，可独立开展只读事实定位。
- 候选入口：[server](../../../apps/mcp-server/src/server.ts)中的 begin_web_search、现有宿主授权适配及 web-product-recovery。
- 区分能力声明、请求是否送达、实际 UI 展示、宿主 accept/decline/cancel、插件错误映射。插件可修的问题才修改；宿主原因保留外部阻塞证据。
- 验收：真实宿主中分别记录允许、拒绝、取消和能力不可用；只有真实接受后启动补搜。拒绝后不重试申请、不换浏览器、不修改全局权限，不用模型声明替代 permit。
- 无法验证弹窗时标记待验收，不能以 mock 全绿或更改报错文案宣称已修复。真实交互验证需与用户协调，不能打断当前剩余测试。

### P2-A：补齐可信度与商品需求的独立核验

- 对应：T3、T4。前置：G0；依赖 P1-B 冻结的恢复合同，不以 P1-C 成功为前提放宽授权。
- 候选入口：[merchant-trust](../../../apps/mcp-server/src/merchant-trust.ts)、[trust Registry client](../../../apps/mcp-server/src/merchant-trust-registry-client.ts)、search-products、shopify-selected-product。
- 对已有审核记录查漏匹配；对可安全读取的商品补取缺失需求证据。新增商家仍先审核、记录依据并取得所需授权，不能批量默认转正。
- 验收：洗发水的干燥／毛躁条件不被替换为卷发硬条件；已核实 Awin 商家保持可信，但未知功效不能自动通过；高评分不替代商家信任。无法同时满足时保留研究候选及缺口。
- 回归 T4 的原目标继承、预算上限和容量变化说明；有单位价时用于可比事实，不将小包装总价低直接标为更有性价比。
- 自动回归候选：[functional requirements](../../../apps/mcp-server/test/functional-requirements.test.ts)、[requirements context](../../../apps/mcp-server/test/search-requirements-context.test.ts)、text-search-reliability。

### P2-B：补齐选择与报价能力的可解释路径

- 对应：T6、T8、T9。前置：G0；真实授权正向验收依赖 P1-C 对相关宿主能力的验证。
- 候选入口：server 中单件 quote_selected_shopify_product 与多件 quote_and_compare_selected_products、[comparison](../../../apps/mcp-server/src/product-comparison.ts)、卡片选择回执和 [quote authorization](../../../apps/mcp-server/src/quote-authorization.ts)。
- 先分别复现单选、双选、取消选择、新搜索后选择、引用旧快照以及迟到选择事件。检查所需数量和 quoteCapability，再确定最小接口或路由改动。
- 单件和多件请求都只能使用服务器核实的原快照引用；未取得有效选择时不按商家名或标题猜测，不拿“最新搜索”替代原选择。
- MERCHANT_CHECKOUT_ONLY 直接准确解释能力限制；不是需要绕开的安全错误。分别表达未报价、不支持报价、选择不满足和执行失败。
- 选择明确支持报价、且副作用已审核的商品，在用户明确请求及真实宿主接受后验收成功路径。验证商品／变体／ZIP 绑定、税费运费组成、过期及取消。缺少任一必要费用，不称最终到手价。
- 自动回归候选：[selection UI](../../../apps/mcp-server/test/product-card-selection-ui.test.ts)、[comparison server](../../../apps/mcp-server/test/product-comparison-server.test.ts)、[quote authorization server](../../../apps/mcp-server/test/quote-authorization-server.test.ts)、[quote boundary](../../../apps/mcp-server/test/research-quote-boundary.test.ts)。

### P3-A：收敛购物回复与语言一致性

- 对应：T1–T3 的进度／内部规则暴露；T5、T7 的语言回归。前置：G0 和受影响错误／状态合同冻结。
- 候选入口：现有购物技能、模型可见回执与 UI 本地化。只改经确认有问题的分支，保持运行技能的安全规则。
- 验收：初始搜索只有必要的本地化进度句；用户回复不出现内部文件路径或“技能要求我这样做”；选择操作不增加无关文件读取。当前消息语言控制用户可见文案，商品名、代码及原始条款保持准确。
- T7 英文工具摘要先核查其是否是用户可见输出，不把正常英文来源字段直接认定为 UI 缺陷。保留无适用优惠时不计算折后价的行为。

## 5. 构建、断言与闭环门槛

本节是后续冻结要求，不是本轮已执行的代码验证。

1. 每个原子步骤先建立能在旧行为上失败的回归，再做最小修改。改完当前模块，立即局部构建与相关断言通过，才进入依赖步骤。
2. 已核对根 package.json 的入口：MCP 构建为 `pnpm build:mcp`，来源服务为 `pnpm build:awin-feed`，默认断言为 `pnpm test`。冻结时按实际消费者选择，不能用 typecheck 代替构建。
3. 相关测试可用 `pnpm exec vitest run <已存在或本步新增测试路径>`；精确列表及所需集成环境在代码 Plan 冻结。身份、信任、选择、价格和授权属于核心逻辑，最终必须覆盖相关完整回归、构建、类型及 lint 检查。
4. 默认测试不包含数据库 integration 套件。需要时明确环境与命令，不连接未经授权的生产环境；未执行不记为通过。
5. 原 T1–T9 固定为开发回归，保留 T4–T8 已通过行为。新增测试必须包含正向、边界、拒绝、取消、过期、跨快照和迟到响应；不通过删除断言或放松安全门槛消除失败。
6. 实际 Codex、官网、卡片选择及报价验收独立记录；这九项不是完整产品验收，也不是图片或跨重启记忆的通过证据。
7. 每个工作包分别报告代码完成、自动断言、真实验收和阻塞项。发布另需明确授权；当前不安排版本升级、迁移、部署或缓存替换。

## 6. 首轮纯文档五阶段记录（v1）

- Research：核对已审查的 T1–T9 事实、总设计适用章节、协议、源码基线及文档位置。未把待查代码根因写成事实。
- Propose：比较直接改总设计与独立增量计划，选择独立文档。
- Plan：仅新增本文件，记录事实、未知项、候选工作包和验收要求；不冻结运行代码实施。
- Implement：仅新增研发文档。构建 N/A：无运行产物。
- Test：24 个本地相对链接、T1–T9 行完整性、五阶段／优先级／权限边界断言及空白检查通过；`git diff --check` 和针对新增文件的 `git diff --no-index --check` 通过。仅本文件新增；没有运行产品构建或购物测试。

## 7. 其余测试接续方式

用户已提供第二个任务，其六图及一次品类确认记录在第 8 节。原任务没有明确测试编号，本文件使用 V1–V6，避免伪造原验收清单的编号对应。不主动修改测试环境或启动购物复测。

未来结果继续按“编号／原始需求／版本／实际输出／预期／证据／判定”追加。当前可先确认缺陷优先级；代码实施仍需 G0 的技术 Research、两案比较和计划冻结。新结果推翻假设时保留修订原因，不直接按旧假设实施。

## 8. 六图补充：事实与验收

来源：[查找 DOEN 裙子](codex://threads/01a076d0-d29f-76f0-b987-da91bd9f3278)，测试版本仍为 0.17.25。包含六张独立图片和一次“是”的品类确认，不包含 Watch 建立／停止、重启、归档／删除或成功报价测试。

核对方式：只读原任务、原始工具参数与回包，并检查本地原图；没有上传图片、重跑搜索或更改运行环境。以下工具判定不等于人工确认原图商品真值。

| 编号 | 原始输入与实际结果 | 判定、差距及证据定位 |
| --- | --- | --- |
| V1 | DOEN 红白花束裙。首轮六张图复核后留下 Julia Dress / Rose Petit Bouquet de Chamonix，官网 $278，POSSIBLE_SAME_ITEM，READY。 | 可能同款识别与表达通过，不升级为已确认同款。询问尺码合理。原日志工具回包第 24、29 行，最终回答第 34 行。 |
| V2 | DOEN 蓝绿红格纹短裙。首轮识别 Faye Dress / Alderbrook Plaid；第二轮三张冲突图全部排除，首轮正确候选仍保留，官网 $268，RESEARCH_ONLY、缺货。 | 候选跨轮保留通过，购买路径未完成。回包 PRODUCT_COLOR／availableSizes=[] 与“仅 XXS 缺货、其他未知”的文案范围待核对；不能先认定全尺码缺货。工具回包第 48、55、62 行，回答第 67 行。 |
| V3 | 用户称 Reformation 裙子，图片为灰白竖条纹吊带上衣。入参已记录“可能是上衣”，仍按 dress 查完两轮才提问。用户确认后，以 CORRECT_PREVIOUS_PRODUCT 调用 search_products 并携带 visualInput，原 goal revision 正确更新为 2，但最终没有候选、visualReview 或 recovery。 | 未完成找图商品。品类歧义处理太晚；纠正后没有走通可观察的候选看图复核流程。初次 occlusions 文本超过 100 字符，被拒后缩短并成功纠参，不能误算成网络重试故障。第 78、81、85、88、95、100、122、125 行。 |
| V4 | Reformation 深棕抹胸围巾长裙。两轮九张图加载复核，最终 Oren Silk Dress / Black Bean，官网 $174，有货，HIGHLY_SIMILAR、SIMILAR、READY。 | 相似兜底及最终文字承接通过。模型第二轮报 POSSIBLE_SAME_ITEM，服务端只接受 HIGHLY_SIMILAR；最终说明官网 midi 与照片近拖地的差异，不是同款误判。长度差异在结构化证据中的承载待查。第 144、151、155、158、163 行。 |
| V5 | Reformation 蓝绿底大朵粉花裙。两轮七张图加载复核，后端返回三张可信官网相似卡，首选 Topanga $89，另有 Romy Velvet $98.40、Prescott $109。 | 后端相似兜底通过，最终文字承接不完整：只说没确认同款并索要原帖，没有承接已有可购买相似首选。并非后端零结果；实际卡片是否可见不能只从最终文字推断。第 177、184、191、196 行。 |
| V6 | Reformation 白底灰花短裙。两轮八张图加载复核，首轮 Belden Mini Dress 跨轮保留；最终 Cream 纯色官网相似款 $83.40，有货、READY。 | 后端保留与相似兜底通过；最终只强调纯色不符、原图身份未核实，没有清楚传达可用相似推荐。价格链接可由卡片承担，不要求正文重复全部字段。第 212、219、224、229 行。 |

### 8.1 不能混在一起的原因

- V3 初次两轮全部冲突，终态 REPORT_INCOMPLETE / BUDGET_EXHAUSTED，明确说明剩余图片读取或复核轮次不足；这不等于用满 180 秒。纠正后的文本工具回包虽带 VISUAL_DISCOVERY，却没有交付新视觉会话或明确恢复动作。具体预算与调用合同需沿实现验证，不能直接断言应当重置预算。
- V4–V6 均为有界检索结束、incomplete=false、READY、SIMILAR，无 recovery，也未调用 begin_web_search。剩余服务预算约 125.77／136.59／144.98 秒；不是宿主拒绝、图片安全失败或超时。尚有时间本身也不证明必须继续搜索。
- V4–V6 所有候选图均加载成功，每个候选 ID 有复核判定；不能解释成“图片读取能力失效”。V5、V6 的文字问题也不应通过降低匹配门槛修复。
- 六张图的初始回合耗时约 59–83 秒；V3 另有约 35 秒确认回合。仅证明这几次在目标时限内给了结果／说明，不代表全局 P95 或完整宿主预算达标。
- 按本次后端终态，六图为 2 个可能同款、3 个相似结果、1 个无结果。不是 5/6 已确认同款，更不是通用准确率。原图对应型号、配色和未命中的真实商品仍需独立真值验收。

### 8.2 契约与可观测性审计线索

1. Julia、Faye 已为 POSSIBLE，但 questions 仍留有英文 “Only similar products were found...” 引导。应统一身份结论与语言，避免后续模型采用过期问题。
2. Faye 的库存范围字段、代表尺码和用户文案存在表面不一致，先核实源数据及归一化语义；不扩大或缩小库存结论。没有 Watch 创建调用，不能报告创建失败。
3. V4–V6 的终态 visualEvaluation.reviewedCandidates=[]，同回包 searchTrace 却记录 reviewed=9／7／8，并有完整复核流水。部分 funnel 的 presentedUnique=0、officialStore.productsReturned=0 与最终 1／3／1 张官网卡并存。需明确“本轮新增”“跨轮累计”“最终呈现”口径，不拿这些零值认定未审图或无官网结果。
4. Oren 最终文字说明长度差异，但结构化 visualMatchEvidence 未记录该差异。需要让后续比较也能取得差异，不能仅依赖最后一句自然语言补充。

## 9. 六图新增工作包与合并优先级

这些是草案增量，沿用 G0 和第 5 节的冻结、逐模块构建及断言门槛。现有同款／相似安全门槛不变；实际代码位置均为待核查入口。

### P1-D：品类澄清前置，纠正后保持完整视觉合同

- 对应 V3。先在用户称呼与可见结构明显冲突时提出一个关键澄清，不先消耗两轮错误品类检索；不擅自忽略用户确认的大类。
- 纠正后继承原目标、品牌和有效结构线索，撤销错误大类及不再适用的视觉资格。按已冻结合同交付候选、复核或明确的不可继续原因，不能变成没有后续动作的静默零结果。
- 候选入口：server、search-requirements-context、[visual discovery](../../../apps/mcp-server/src/visual-product-discovery.ts)、search-products。
- 验收：固定原条纹图及“是”确认，检查正确大类、goal revision、候选图复核、终态与预算连续性；超长文本一次纠参正常；不使用 NEW_PRODUCT 或第三轮复核绕过限制。
- 回归入口：[visual identity server](../../../apps/mcp-server/test/visual-identity-server.test.ts)、[requirements workflow](../../../apps/mcp-server/test/requirements-workflow.test.ts)、[flow budget](../../../apps/mcp-server/test/search-run-flow-budget.test.ts)。

### P1-E：最终回答忠实承接同款、相似和缺货状态

- 对应 V1、V2、V4–V6，优先于仅修改措辞风格的 P3-A。READY + SIMILAR 时承接服务端首选，明确“未确认同款，但有已核验相似款”，说明显著差异及适用范围，不能只留下失败口吻和索要更多线索。
- 保留 POSSIBLE 与已确认同款的区别；缺货研究卡不当作可购买推荐。缺货范围核实后，可以提出 opt-in Watch 选项，身份、尺码、来源与用户授权未满足时不创建。
- 清除不再适用的 questions；模型可见摘要、结构化差异、卡片及最终文字使用同一终态。价格链接已经在卡片呈现时不强制重复。
- 候选入口：[visual outcome](../../../apps/mcp-server/src/visual-search-outcome.ts)、[model context](../../../apps/mcp-server/src/execution/model-context.ts)、现有购物技能。运行技能变更不适用纯文档免构建。
- 验收：回放三种固定终态，分别检查首选承接、差异、购买资格和下一步；保持 Oren 服务端降级行为，避免把相似款升级成同款。
- 回归入口：[visual terminal outcome](../../../apps/mcp-server/test/visual-terminal-outcome.test.ts)、[visual search outcome](../../../apps/mcp-server/test/visual-search-outcome.test.ts)、[workflow replay](../../../apps/mcp-server/test/workflow-replay.test.ts)；另需实际 Codex 最终回复验收。

### P2-C：核查视觉召回与停止策略，不靠放宽门槛提升命中

- 对应 V3–V6，并入 P1-B 的“完整任务目标”合同。区分已有可用相似款和已完成计划内同款检索；按明确来源覆盖、证据缺口及剩余复核资格决定停止或受限恢复，不单看还有多少秒。
- 技术 Research 后至少比较两条现有边界内的路线：两次原生检索之间更强的品牌／大类／显著结构与花纹查询，或首轮不足时将剩余一次复核用于获授权的网页发现。两者都不得增加第三轮、上传原图或在拒绝后换通道。
- 对 V5、V6 先保留已正确返回的相似卡及差异，再用人工确认的原配色链接验证漏检环节；本次未查到真值，不能宣称已定位为 Registry、关键词或目录覆盖问题。
- 候选入口：[visual query](../../../apps/mcp-server/src/visual-retrieval-query.ts)、visual-product-discovery、web-product-recovery、[search run](../../../apps/mcp-server/src/search-run.ts)。
- 回归入口：[visual retrieval query](../../../apps/mcp-server/test/visual-retrieval-query.test.ts)、[visual round recovery](../../../apps/mcp-server/test/visual-round-recovery.test.ts)、[visual web recovery](../../../apps/mcp-server/test/visual-web-recovery.test.ts)。固定开发样例与独立验收样例分开，不建立本地商品目录。

### P2-D：统一库存范围和跨轮诊断口径

- 对应 V2 与 V4–V6。库存明确区分商品配色范围、具体尺码和未知范围；代表变体不等于用户选择，其他尺码无证据时不推断有货或缺货。
- 诊断字段区分当前阶段与整个流程，记录已加载、已复核、保留、最终呈现的对应数量；缺货身份召回不计作可购买任务完成。空诊断列表不能与累计复核成功共用未说明的含义。
- 候选入口：generic-official-store-search、visual-product-discovery、visual-search-outcome 和 server 的元数据输出；先核实实际消费者再定最小修改。
- 验收：Faye 源记录、卡片、摘要和回答库存范围一致；V4–V6 的累计复核 9／7／8 与最终卡片 1／3／1 有可追溯关系；不改变排名、权限或持久化范围来修日志。
- 回归入口：[generic official search](../../../apps/mcp-server/test/generic-official-store-search.test.ts)、[visual funnel](../../../apps/mcp-server/test/visual-funnel.test.ts)、[visual budget diagnostics](../../../apps/mcp-server/test/visual-budget-diagnostics.test.ts)。

### v2 文档五阶段增量记录

- Research：六图原输入、工具回包、原图和最终文字完成只读核对；未定位源码根因。现有 main SHA 未变，工作区原有改动仅本计划文件。
- Propose：比较追加原计划与另建平行计划。选择追加，避免同一缺陷多处维护；原 T1–T9 结论不被六图覆盖。
- Plan：只更新标题／状态、第 6 节历史标注和第 7–9 节，合并证据及候选优先级，不修改总设计或运行行为。
- Implement：仅文档增量。构建 N/A：无运行产物；图片只在本地读取，没有复制进仓库。
- Test：v2 的 41 个本地链接、T1–T9／V1–V6 共 15 行、阶段／关键结论／权限边界断言及空白检查通过；`git diff --check`、新增文件 diff 检查通过。独立只读复核后三图事实与推论边界，无必须修正项。没有执行产品构建、自动购物回归或发布。

## 10. 批准实施：技术事实与冻结计划（2026-09-06）

用户已批准修复本计划的代码问题。本节取代前文的“待批准”实施状态；此前测试事实仍保留。本轮授权不包括提交、推送、部署或安装。基线为 `3f4a058da023eb8ca52aa56798ed9fccab22a94b`，运行版本仍为 0.17.25。

### 10.1 Research

调用拓扑：工具注册／executor → search requirements → searchProducts → 现有 Backend ports／官方适配器 → 资格门槛 → 快照 → 比较／报价；图片入口另外经过候选图加载、两轮有界复核及 finalization。结构化输出同时交给卡片、compact model context 和验收器。改动必须维护这三个消费者的一致性。

依赖约束：Node 24、pnpm 10.34.5、MCP SDK 1.30.0、Zod 3；沿用现有构建与 Vitest，不增加运行依赖。主代理负责共享 server 编排，子任务仅修改划定文件。共享插件 bundle 构建串行执行。

已经复现或由完整合同确认的事实：

- T2 原实参在公共 searchProducts seam 返回零卡：URL 的 https／www／域名／products 被当作身份词；普通 URL 未传入官网已有的直接 PDP 读取路径。不能仅删除 URL 词后把 slug 当身份事实。
- 官方选中商品 HTML/JSON-LD fallback 丢弃已读取的 description；同一变体即使来源明确两项功效，也会被后续需求门槛排除。固定 fixture 已复现。尚不能断言 T3 的真实来源恰好走此路径。
- T1 的 MATCH_FOUND 只证明找到商品，不证明显式多商家比较完成；需要独立、可继承的用户任务意图，不能强迫所有单品搜索补搜。
- V3 的 search_products 接收 visualInput，却没有交付看图复核会话。纠正必须进入既有视觉入口或返回明确下一步，保留原预算与安全上下文。
- V1／V2 终态保留过期 catalog questions；compact receipt 丢失视觉组、视觉终态、库存范围及可售尺码，V5／V6 的可用相似结果因此不能完整投影给文本消费者。
- PRODUCT_COLOR 的 XXS 是代表规格，不是用户选择。未取得当时原始库存响应，不修改官网库存算法。
- visualEvaluation.reviewedCandidates 被验收器定义为本回包展示的图片；终态为空合法。累计复核和当前阶段计数必须另列，不能改变旧字段语义。
- sync selection 接收 0–4 个 ID，批量报价要求 2–4，而单件报价不接受仅 renderId：存在一件已选商品的路由缺口；现场证据不能证明 UI 掉选。
- SDK 会规范化旧 elicitation:{} 为 form 支持；当前调用已有 relatedRequestId、signal 和 timeout。宿主即时 DECLINE 不能解释成用户点击拒绝，也没有证据证明改能力判断能修复弹窗。

可证伪假设：直接链接绕过普通关键词分词后应取得源身份；保留 HTML 源描述后同一变体功效断言应通过；终态字段投影后文本 receipt 应完整；一个已同步 ID 应可进入单件报价资格检查而不是多选错误；纠正的视觉输入应继续既有视觉预算而非静默零卡。每项先在真实公共 seam 上断言失败，再修改。

### 10.2 Propose

| 决策 | 方案 A（本轮采用） | 方案 B | 收益／风险／代价 |
| --- | --- | --- | --- |
| URL 与功效取证 | 复用官网直接 PDP adapter，分离 URL 与检索提示，源产品建立身份；补齐现有 description 投影 | 在 executor 增加独立 hydration orchestration | A 不增加第二套网络流程；需测试 URL 约束及身份来源。B 影响所有工具消费者，代价更高 |
| 任务完整性 | 可选显式多商家意图，按可信可比较来源数量判断补搜 | 所有 SAME_PRODUCT 都要求多商家 | A 保留普通快路径；B 会给只找一件商品增加无谓授权与延迟 |
| 视觉终态 | 补现有 receipt／outcome 字段，清理旧问题，新增明确诊断范围 | 新建 answerSummary 并迁移 UI／模型／比较 | A 改动局部且兼容；B 重复状态多、迁移范围大。真实模型承接仍需验收 |
| 品类纠正 | 复用同一候选执行函数及原 SearchRun；不够预算时明确终态；前置显式品类澄清 | 在文本搜索重写简化视觉流水线 | A 保留图像资格与次数上限；B 容易出现两套安全逻辑 |
| 第二轮检索 | 在现有两轮内保留品牌、大类、主要花纹／结构的有界定向查询 | 第一轮后请求网页授权，把剩余一轮给网页候选 | A 不依赖当前拒绝的宿主授权，保留相似兜底；B 可扩来源但宿主未验收。本轮不增加第三轮或自动换通道 |
| 选择与宿主 | 单件工具按 renderId 解析唯一已同步 ID；分开无选择／单件／批量；诊断宿主响应 | 新增一个独立 selection receipt 工具，另换授权方式 | A 接口扩展小，无新增工具；B 增加调用次数且没有证据能修复宿主弹窗 |

### 10.3 Plan（冻结原子步骤）

| 步骤与依赖 | 工作包／文件边界 | 红绿与完成条件 |
| --- | --- | --- |
| I1，无前置 | P1-A：known-product URL helper、search-products、相关 official tests | 原 T2 URL 输入返回源确认商品；未知／恶意 URL 不取得信任或绕过网络限制 |
| I2，无前置 | P2-A：shopify-selected-product、selected-product-inspection tests | HTML fallback 保留有界描述；缺失功效仍不通过，商家信任不变 |
| I3，无前置 | P1-E／P2-D：model-context、visual-search-outcome、search-diagnostics；server 集成由主代理完成 | 终态相似／可能同款／缺货范围可从 receipt 读到；旧 questions 清空；兼容验收器字段 |
| I4，依赖 I1 | P1-B：显式跨商家意图、requirements merge、recovery 与 skill | 单商家找到不冒称完成比价；普通单品仍快路径；补搜保留旧候选、信任及授权门槛 |
| I5，依赖 I3 | P1-D／P2-C：server 共用视觉入口、品类澄清合同、visual query 与 skill | 类别歧义先澄清；纠正后有复核／明确终态；不重置原预算，不增第三轮；主要花纹与结构不丢 |
| I6，无前置，server 串行合并 | P1-C／P2-B：选择解析／报价错误；宿主安全诊断 | 0／1／2–4 分支准确；单件仍需支持报价、可信商品和真实宿主授权；DECLINE 不重试不绕过 |
| I7，依赖 I3–I6 | P3-A：购物 skill 路由与终态答复 | 当前语言、快路径、已选引用、相似推荐、缺货 opt-in Watch 有一致断言；无原始图上传、无自动 Watch |
| I8，依赖全部实现 | 集成回归、全量构建／类型／lint／测试／diff，更新本记录 | 报告每项结果和未验收项，不把 fixture、开发样本或模拟授权当真实宿主验收 |

每个修改模块先运行对应红色回归，修改后立即运行局部测试及 MCP 构建（共享 bundle 串行）。失败停在该模块修正。最终全套验证不能代替局部验证。

待真实验收项：Codex 是否真正展示授权弹窗；修复后最终自然语言和实际卡片；Sony 单／多选；原六图正确配色真值及独立样本。T5–T8 已通过的身份、选择、Coupon 资格和商品价口径只加回归保护，不扩大行为。不能自动新增商家信任、创建 Watch、建立本地商品目录，或声称覆盖全网。

I5 冻结细化：源码合同复核确认 search_products 输出是商品卡 schema，视觉入口有独立 VISUAL_SEARCH executor capability。为保持这两项边界，误用文本入口时返回一次明确 USE_VISUAL_TOOL 路由提示，原参数／引用转交既有视觉工具，而不让文本工具直接执行候选图片流水线。视觉入口复用父快照 SearchRun；显式 categoryCandidates 在来源读取前澄清，父目标总复核次数仍最多两轮。已耗尽的旧目标只能报告预算不足，不能因纠正重新取得两轮。

独立复核增量（I1／I4，实施前冻结）：原URL公共回归通过后，用带 variant 的源 fixture 复现跨店颜色／尺码丢失；必须把 URL 明确选择且来源确认的变体写入 effective request，后续沿同一快照继承，无 selector 的代表尺码仍不是用户要求。Shopify 已验证 PDP 末尾斜杠按 adapter 规范统一。I4 网页恢复复核发现只返回新来源会丢原候选：保留父快照经相同规则验证的候选，与新来源合并再选择；零新结果也不得抹掉已有匹配。授权请求按实际结果说明“已有商品但比价未完成”，不再一律说没找到商品。两项各先红绿回归再局部构建，不新增网络通道或信任来源。

I5 等待预算增量：181 秒用户停留的回放复现“确认后尚未查询就超时”。采用 SearchRun 内一次性、原 renderId 绑定的类别澄清暂停／恢复，期间禁止来源读取、复核和授权；仅合法 CORRECT 且类别已确认时恢复。observedClarificationWaitMs 单列，不伪称宿主表单的 verifiedUserWaitMs。与“确认后重建 SearchRun”相比，此方案保留已用服务时间、读取上限和原两轮计数；无模型提供的等待时长，也不能反复澄清延长预算。

P2-C 精确查询复现：V6 原描述二轮查询留下品牌／品类／配色／花纹／长度，却丢了全部结构词；首个可靠描述未被现有结构词典识别，cap sleeve 因简化被丢弃。选择在 query builder 中从原有最多两个可靠结构挑选可被既有编译器输出的一项；不扩充全局词典、不改匹配门槛。原 16 项加 V6 回归后 17 项通过，不能因此声称原图已找到。

## 11. Implement 与 Test：实施证据

### 11.1 按模块交付

| 工作包 | 已实现与验证 | 保留边界 |
| --- | --- | --- |
| P1-A | 官网 URL 不再被标点归一化破坏；复用已审核 PDP adapter；源产品建立 effective request；显式变体锁色／尺码；Shopify 尾斜杠兼容。T2、错误配色、变体混入均先红后绿 | slug 不是身份；未知域不自动获信任；无 selector 不锁代表尺码 |
| P1-B | compareMerchants 可选显式意图及继承；可信域数量不足时 COMPARISON_INCOMPLETE；一次获授权网页恢复保留原候选并重验，保留旧快照，最新同商品缺货／涨价覆盖旧观察 | 普通单品快路径不变；原事实保留时间；不声称全网最低 |
| P1-C | 原 SDK 授权机制保留；拒绝文案不归罪用户、不声称弹窗显示；已有商品时补搜授权说明准确；无能力／DECLINE／false 许可不产生 Cart | 仓库内尚无法确定宿主即时拒绝根因，实际弹窗仍待验收 |
| P2-A | HTML/JSON-LD 补证保留同商品源描述；过长整段不用、不用旧正面文字遮住新反证；原需求门槛不变 | 未将 Scotch Porter／Sol de Janeiro 等未审核域转正；不能保证真实 T3 商品功效已有足够证据 |
| P2-B | 单件报价支持 renderId 唯一同步 ID；0／1／多件／未同步／过期／外来 ID 分开；单件路由固定准确 ID；暂时失败不改成永久不支持；错误本地化 | 报价仍须 capability、精确变体、ZIP、真实宿主批准；无越权补选 |
| P1-D | 品类歧义在读取前澄清；错误文本入口明确路由一次；纠正进入视觉工具，沿原 SearchRun／goal；两轮总数受执行层限制；181 秒澄清等待单列 | 非受信任务上下文不能推测用户回答；跨重启活动视觉会话不自动复活 |
| P1-E | 最终过期 questions 清空；compact receipt 投影视觉状态、首选、已验证差异、库存范围；READY + SIMILAR 明确承接；长解释列表有界并标摘要缺省 | 静态技能断言／回放不证明实际模型一定遵循；未提交的 Oren 长度差异不会被服务器凭空补造 |
| P2-C | 二轮保留可编译结构，V6 精确 fixture 已红绿；其余品牌／品类／花纹和颜色保护测试继续通过 | 无第三轮，无自动网页通道；原图商品／配色真值与实际召回仍待独立样本 |
| P2-D | 缺货文案区分 PRODUCT_COLOR／SELECTED_VARIANT／未知；diagnosticScopes 区分当前检索、当前图片输出、累计复核；保留验收器旧字段语义 | 不修改当时未取得原始响应的库存算法；源码表示不等于当前官网库存 |
| P3-A | 购物 skill 明确视觉纠正、跨商家意图、相似承接、摘要标志、单／多件报价；保持当前语言、一句进度、无额外文件读取 | 技能仍受 6,400 字节／36 行自动门槛；真实宿主行为另测 |

所有运行模块均在对应红绿回归后串行执行 MCP 构建。独立复核另外修复了变体丢失、补搜丢原候选、单件路由误报另一已选 ID、澄清等待吞预算、结构词全部丢失及长回执超限；未把这些风险留作泛泛建议。

### 11.2 回归证据与真实验收

测试产物在本地忽略目录 `artifacts/acceptance-2026-09-06/`，仅含合成 provider／MCP 回放。没有复制原图或完整用户聊天进仓库。先失败的断言及各模块独立复核结果均保留在本次任务记录中。

必须区分：自动断言验证执行合同，开发六图用于定位已发生问题；二者都不能替代 Codex 真实选择、授权弹窗和最终自然语言验收，也不能替代总设计的独立样本数量／准确率门槛。原 T7 没有符合条件的券是正确结果，不应靠编造折扣“修好”。

完整测试首次失败于 stdio 输入字段列表未更新 compareMerchants，已同步 schema 合同。随后全量只剩报价 body-stall 用例偶发失败：等待 promise 超时不等于其独立请求信号已在同一事件轮中中止，单列核实，不修改生产超时或增加 mutation 重试。

最终验证（2026-09-06，本地工作树）：

- `pnpm build:mcp`：通过，包含 MCP bundle、图片 worker、依赖通知生成；逐模块构建与最后整包构建均成功。
- `pnpm typecheck`、`pnpm lint`：分别通过，退出码 0。
- `pnpm exec vitest run --reporter=json --outputFile=artifacts/acceptance-2026-09-06/all-tests.json`：**120 文件／1,765 测试全部通过，0 失败、0 pending，success=true**；包含本地 bundle 的 stdio 协议冒烟测试。默认测试不包含单独的 live integration 配置，不能据此称实际桌面／线上通过。
- 报价 body-stall 测试改为等待同一请求的实际 abort 事件，同时保留 QUOTE_TIMEOUT、500ms 配置和全程一次 mutation 断言；整文件独立连续 6 次、每次 11 项通过。旧用例孤立 8 次未复现，已如实区分全量观察与源码时序解释。
- 源码 HEAD 仍为 `3f4a058da023eb8ca52aa56798ed9fccab22a94b`；运行版本未升级。修改与生成 bundle 留在工作树，未提交、推送、部署或替换 Codex 缓存。

交付结论：已确认的代码／合同缺陷完成本地修复和自动验证；不能称整个 Agent 总设计达标。下一次真实验收应优先测 T2 官网链接、T1 跨店补搜、T9 单选／多选报价，以及 V3 品类确认、V5／V6 相似首选承接；记录真实授权弹窗是否出现。宿主为何自动 DECLINE、六图原配色真实命中与独立样本准确率仍未解决或未验收。Watch、重启／归档／删除不在本轮测试范围，也未被本轮改动补齐。
