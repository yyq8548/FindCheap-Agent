# 原生测试复核后的修复与独立任务验收

当前结果：P1–P4及原生再发现的P7均已完成代码修复；最终默认回归197文件/3,927断言、typecheck和lint通过。首轮原生4项通过/1项部分通过；P7修复后的原生目标未被观察到，记NOT_OBSERVED。原生授权和跨商家业务验收未完成。最终交付、来源降级及后续定位项见文末；下文保留最初宿主启动失败和旧版实测过程。

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

后续模块与交付验证见下文；原生任务验收单列，不由源码探针替代。

### 已完成的模块验证

| 步骤 | 先红证据 | 实现/立即构建/局部验证 |
| --- | --- | --- |
| P1 | 新增11例中5失败 | 精确撤销双入口与共享merge；MCP构建通过；8文件131断言通过。新增测试2处错误summary观察和Skill固定文字/字节约束已纠正，未提高门槛。 |
| P2 | 缺notSellable一例失败，其余4保护例通过 | 仅schema optional与严格false可售条件；MCP构建通过；Sony4文件80例通过。真实3GET返回黑色29999/UNKNOWN，无解析失败。 |
| P3 | 最初9/11失败；一次性边界2/14失败 | 来源构建通过；Woo来源及MCP消费者33文件1438例通过。原一次性真实夹具未修改；新测试returned统计预期按实际过滤后语义纠正。 |
| P4 | 最初10/12失败；独立审查新增5例失败；OR一例失败 | 受控别名和共享评估，移除搜索独有的单向升级；每次变更立即MCP构建。最终新18例通过；原5反例与OR边界保留。 |

最终源码版本0.18.5，插件包0.18.5+codex.20260909183846。两包构建、typecheck、lint通过；2026-09-09 18:44:27Z默认全套 **197文件/3905断言通过**（含5个bundle stdio断言）。默认全套不含外部Postgres集成，本次无相关修改/迁移。最初完整回归4失败均为版本元数据/固定Skill措辞，另typecheck3处为回执和联合类型标注；均修正后重跑，不删测试、不放宽安全字段或Skill字节门槛。日志在artifacts/native-followup-remediation，原失败日志保留。

第一次P6原生尝试因宿主MCP启动握手失败阻塞；后续恢复及真实原生结果见下文。以下为当时生产部署和安装交付证据，所有源API探针均与原生宿主验收分开。

### 已核实交付（2026-09-09）

- Git：运行版本提交 `b0a427743aaf8e0eead1a196374d36b08fabf3f5` 已推送；独立核对本地HEAD与远端main均为该提交。
- CI：[plugin-ci 34391060679](https://github.com/yyq8548/FindCheap-Agent/actions/runs/34391060679) 与 [windows-installer-ci 34391060629](https://github.com/yyq8548/FindCheap-Agent/actions/runs/34391060629) 均为 `completed / success`，headSha均为上述运行版本提交。
- Railway：部署 `b6fff2fd-3810-4e5a-9302-ee081b278cde` 的真实部署回执为 `SUCCESS`。独立SSH读取 `/app/dist/main.cjs`，SHA256为 `cc07b320d421907b73487784fbcbf5234cfbcf555d201753968df6a1dd3955f1`，与本地来源服务构建产物完全相同；公开 `/health`、`/ready` 均HTTP200。
- 生产注册表：沿用v0.18.4不可变基线，官方legacy 111条、官方v2 248条、可信393条的版本、全部记录字段及规范化哈希一致。没有借本次修复新增或提升商家信任。
- 生产商品探针：18:50:28Z开始对公开lookup接口读取JBC父399的子变体684、686、687，三者均HTTP200 / `FOUND`。保留 `amountMinor=0`、对应变体与 `IN_STOCK`，`priceEvidence.scope=UNKNOWN` 且无 `itemPrice`。这是公开商品读取，不是购物车请求或原生宿主验收。
- 本地安装：宿主回执确认 `0.18.5+codex.20260909183846` 已安装且enabled。独立读取缓存与源码的14个分发文件，统一CRLF/LF后全部相同，缓存原始哈希也与安装报告逐项一致。缓存MCP bundle原始SHA256为 `c24eecdc144abe8bcacc61286bc1685a90a2051a34c36e08b11bb0cc2abc4ffb`。
- 已安装包stdio复测5/5通过。该运行验证实际包的协议与进程边界；其中合成可信metadata及本地Watch持久化断言不证明真实UI、通知投递或宿主停调已验收，也不增加独立业务验收分母。
- 保留安装异常：安装命令报告 `failed to back up plugin cache entry: Access is denied. (os error 5)`，旧缓存备份仍受占用。新缓存的安装状态、文件和stdio已分别核验；不能把该命令本身记录为无错误成功，未删除被占用的旧缓存。

证据位于本地ignored目录 `artifacts/native-followup-remediation/`：`deployment-status.json`、`production-independent-verification.json`、`production-after-2026-09-09T18-50-00-837Z.json`、`production-jbc-lookup.json`、`cache-parity.json`、`installed-state.json`、`installed-stdio.log`、`plugin-install.json`。注册表对照基线仍为 `artifacts/release-v0.18.4/production-before.json`，未覆写。交付已核实不等于P6或全部业务验收完成；原生任务结果待后续实际回执补充。

### P4 Plan v1.2（独立审查，实现前冻结）

独立审查复现：多系统要求中，每条要求复用整请求的系统选择可能把另一系统错误标MATCHED；选定形态未知时，排除ground不能静默SATISFIED。方案A（选择）按每条完整兼容要求评估同一选定规格，排除形态UNKNOWN明确进入缺口；方案B拒绝全部多系统请求并忽略未知排除证据，后者不能满足既有精确需求规则。新增两例先红，保持组合claim不拆分、原query的领域识别与选择边界，再构建与全部相关验证。

v1.2同一审查的范围补充：组合兼容要求、排除系统和偏好也必须遵循同一所选证据。方案A扩展共享评估到三者：组合要求不能以兼容单项证明整项，缺完整证据UNKNOWN；明确系统冲突仍CONTRADICTED；形态偏好不能命中未选父选项。方案B只修required数组会留下相邻入口分叉，故选择A，先增加三个独立反例再实现。

### P4 Plan v1.3（OR反例，实现前冻结）

审查用 `compatible with Original or organic` + 有机Vertuo商品复现：单系统矛盾不能证明复合OR为假，作为排除项时会绕过。选择保持未完整解析的复合条件为UNKNOWN（必选/排除/偏好共用）；不论单系统真假，都不凭单分支判断整个复合条件。另一方案是引入完整AND/OR解析器，增加本次不必要的语法和迁移范围。原AND断言相应按不拆解完整条件的既有合同改为UNKNOWN，独立系统冲突仍保留CONTRADICTED；新增OR必选/排除反例先红。

### P6 环境恢复计划（执行前冻结）

新任务实际 Astra Ultra / danger-full-access / approval=never；两轮均未获得 FindCheap MCP，工具总数312，FindCheap为0；本研发任务332项中有20项FindCheap。安装器备份错误后，旧0.18.4缓存目录存在但四项关键文件均缺失，新0.18.5完整。旧路径仍被宿主引用是待验证假设，不能宣称已经找到宿主根因。

- A（选择）：从不可变旧提交 d9de9a0 恢复旧0.18.4目录缺失的14个分发文件，逐字节验证；不覆盖现有文件、不改变0.18.5安装选择，再检查同一任务是否恢复工具。恢复旧文件不等于新版本验收。
- B：保持旧缓存缺失并重启整个Codex应用，可能刷新版本选择，但会中断其他运行任务且不修复残缺旧目录。
- 本次只做A的可逆缓存修复。无需重新构建不可变旧产物；验证为14文件git对象字节相等、新缓存哈希及安装状态不变、原生任务工具发现复查。宿主如仍无法加载，明确记录阻塞，不用脚本回执冒充原生实测。

### P6 初次原生任务结果（历史）

已创建并在应用中打开任务 `01a0877f-e270-7372-bc02-36ead0825d77`：**v0.18.5 原生实测：Sony 与咖啡**。实际上下文确认 gpt-6-astra / ultra / danger-full-access / approval=never。这里是独立Codex任务，不宣称创建了另一个操作系统窗口。

| 尝试 | 实际结果 | 判定 |
| --- | --- | --- |
| Sony 1000XM5黑色、全新、350美元以内 | 60,441ms，模型提出WH/WF问题；没有FindCheap调用 | BLOCKED；模型文字不算处理器通过 |
| 工具发现诊断与WH明确答复 | 57,064ms，枚举312工具、FindCheap为0、函数undefined | 确认该任务工具缺失；未开始商品检索 |
| 恢复旧缓存后的单次工具复查 | 10,800ms，仍312工具、FindCheap为0 | BLOCKED；不能宣称恢复可调用 |

实际宿主日志记录 FindCheap 启动后 `handshaking with MCP server failed: connection closed: initialize response`。不是本轮商品搜索返回零结果，也不是没有选择Skill。安装器错误后旧0.18.4缓存曾为空目录；已从原提交恢复全部14文件并逐字节验证。该目录缺失与握手失败有关是有依据的假设，尚未证明唯一根因；恢复后仍阻塞。新版0.18.5缓存及生产服务验证不受这一结论替代。

原生商品调用数 **0**。Sony处理器澄清→WH、整豆→胶囊条件纠正、Original适配、原生授权表单均 **NOT_RUN**；不以源码3,905断言、源API探针或安装stdio5/5填补。当前没有可调用的桌面宿主热刷新工具；插件安装说明要求重启Codex并开新任务。需重新加载后先确认20个FindCheap工具存在、实际运行版本正确，再按下面顺序实测：

1. `帮我找 Sony 1000XM5，黑色、全新，预算350美元以内。`
2. `我要头戴式 WH。`
3. `帮我找40美元以内的整豆咖啡，不要磨好的咖啡粉。`
4. `我要胶囊咖啡。`
5. `我的机器是 Nespresso Original。`

保存证据：`artifacts/native-followup-remediation/native-task-receipts.json`、`previous-cache-restore.json`、`host-plugin-load-diagnostic.json`。原生表单、跨商家覆盖和原先暂缓资料的验收边界仍保留。

文档交付采用在现有工程记录/release/统一改进清单补充实际状态的方案，避免另建冲突的通过清单。此次文档更新没有运行产物，构建N/A；检查相对链接、记录的失败分母、状态及git diff后提交。运行产物沿用已验证的b0a4277，无重复发布运行代码。

### P6 缓存兼容入口计划（新版实测前冻结）

恢复旧缓存后，全新任务 `01a0878a-eb1b-70f3-a236-8929f5f6292f` 已获得20个FindCheap工具并发生真实Sony调用；原生回执buildVersion却为 **0.18.4**。因此宿主仍引用旧包入口已获得运行版本证据，不能把新Skill文字当作运行版本，也不能以旧版Sony错误回改新版源码。

方案A（选择）：沿用用户明确授权的“替换安装缓存”，先将刚恢复的14个旧分发文件逐字节备份到ignored验收目录，再把正式0.18.5分发文件同步到宿主仍引用的旧路径。此路径是临时兼容入口，目录名不代表其运行版本；内部manifest、bundle及回执必须明确0.18.5，14文件哈希均与正式新缓存相同。正式0.18.5缓存与插件注册选择不变。方案B：停止本轮自主验收，由用户重启整个应用刷新路径；无需兼容入口，但会打断其他任务并留下验收依赖。

选择A是本机缓存交付修复，不改仓库产品代码、工具权限或安全规则。仅覆盖已确认等于旧Git对象的14文件，不覆盖其他文件；保留旧文件和恢复脚本。同步后新建原生任务，先以真实searchTrace.buildVersion确认0.18.5，再跑完整Sony和咖啡序列。任一哈希、版本不符即停止新版验收。退出条件：正式缓存未变、兼容入口14文件字节一致、原生回执明确新版。回滚可从旧备份按原文件路径恢复；重启宿主改用正式新缓存后可清理临时入口，当前不删除占用目录。

### P7 Plan v1（原生独占系统反例，实现前冻结）

Research：原生任务 `01a0878f-1225-7a91-8d3a-379504f91086` 的0.18.5回执在Original请求下仍返回Midtown Roast Coffee Capsules（Shopify变体44558789574700，USD1199）。其当前商品描述明确 `COFFEE CAPSULES ARE EXCLUSIVELY COMPATIBLE with the L’OR BARISTA System`，选定规格为空；现有专用判断忽略全部描述，故与共享要求均为UNKNOWN。总设计4.1要求明确系统冲突排除，同时禁止未选父描述证明所选兼容；本步仅补受控负面证据，不把描述升级成正面证明。

| 方案 | 收益及风险 | 范围与回滚 |
| --- | --- | --- |
| A（选择）：专用评估的UNKNOWN分支读取严格当前胶囊主语的ONLY/EXCLUSIVELY单系统句 | 修正当前实证；严格绑定、单系统和歧义拒绝降低误排。只提供负面冲突，不能证明兼容 | coffee-category与现有一致性测试；源码可独立回退，无数据迁移 |
| B：各来源adapter提取exclusiveSystem结构证据，再由统一评估消费 | 可附更明确来源字段，但新增合同和多个消费者；仍需同样的句义/当前商品绑定规则 | 需来源DTO、适配器、MCP多模块兼容验证，代价高于此单一实证 |

选择A沿用用户持续修复和真实自测授权。冻结：P7a先加入真实标题/完整描述夹具及边界红断言；P7b实现仅在明确胶囊、用户系统已知、无选定系统字段且主标题未证实系统时使用负面fallback；P7c立即 `pnpm build:mcp`，运行coffee-evidence-consistency、coffee-category-compatibility、coffee-category-search、coffee-inspect及有关咖啡回归。主任务负责最终全套、缓存交付和再次原生验收。

边界：任何选定System（包括待选择）优先，不用父描述覆盖；普通L’OR品牌、espresso capsules、正面营销和交叉推荐不构成排除；多系统、OR、条件语句和未识别系统保持UNKNOWN。同系统exclusive描述也不生成MATCHED。L’OR BARISTA仅为受控负面系统标记，不增加公共系统枚举或商家特例。请求预算、信任、价格、网络与授权合同不变。

P7实施/验证：新增22例（原18例保留）。首次 `pnpm exec vitest run apps/mcp-server/test/coffee-evidence-consistency.test.ts` 实际退出1，4失败/36通过；真实Midtown及3种严格独占句均因旧行为UNKNOWN而红，负面边界保持通过。实现后立即 `pnpm build:mcp` 退出0；咖啡一致性、兼容性、搜索、inspect、基本形态、cup forms、capsules和catalog共8文件/263断言通过，两owned文件eslint通过。原生漏排仍保留为第一次失败；本步固定真实描述的自动回归不能替代主任务后续的新原生搜索。绿色原始日志在 `artifacts/native-followup-remediation/p7-coffee-regression.log`，首次红断言的工具回执摘要在 `p7-red-evidence.json`（摘要非原始stdout）。

## 最终交付与验收结论

- 最终运行代码提交：`43753b9cb62024122539159bab2cf7c4abb6288e`，已推送；初始四类修复为`b0a4277`。最终[plugin-ci](https://github.com/yyq8548/FindCheap-Agent/actions/runs/34394403063)及[Windows installer CI](https://github.com/yyq8548/FindCheap-Agent/actions/runs/34394403064)均成功。
- 最终包：`0.18.5+codex.20260909191446`，installed/enabled。正式缓存与两个宿主旧路径兼容入口各14文件逐字节等于源码，共42文件核对。MCP SHA256为`1c9ab5d4d4d87206d2f36bfc61d9acf8f2bfbdf8c2827296d845529d8b4a0aa5`。旧路径目录标签保留，内部manifest及新任务运行版本明确为新版；旧文件已分别精确备份。CLI备份失败仍保留为真实错误，缓存内容修复不冒充CLI安装全程无误。
- 验证：P7立即构建与263相关断言通过；最终typecheck、lint通过；197文件/3,927断言通过，最终安装版额外stdio5/5通过。本次P7只改MCP，来源bundle未变，无需再次部署相同来源产物。
- 生产：部署仍为`b6fff2fd-3810-4e5a-9302-ee081b278cde`、SUCCESS，运行source hash与当前本地`cc07b320…3955f1`相同，health/ready HTTP200。但Awin feed刷新降级：沿用15:58:37Z的69,409行快照，连续失败6次，最新`SOURCE_RATE_LIMITED`；此前已有`DUPLICATE_PRODUCT_KEY`。可用与数据新鲜程度分开报告，不能称全部来源健康。

### 已执行的新版原生购物

任务 `01a0878f-1225-7a91-8d3a-379504f91086` **v0.18.5 原生购物验收**：实际Astra Ultra、Full Access，原生searchTrace确认0.18.5，5轮共6次FindCheap调用。

| 轮次 | 原生结果 | 范围内判定 |
| --- | --- | --- |
| Sony裸系列 | 处理器要求WH/WF，来源未查询 | PASS，46.620秒 |
| WH明确答复 | 同goal修订2，保留黑色/全新/350美元；官方黑色299.99美元，库存UNKNOWN，无旧详情schema错误 | PASS，33.396秒；不是跨店比较完成 |
| 整豆咖啡 | 新goal；40美元；3匹配+3研究，未把6卡全称合格 | PASS，42.975秒 |
| 改胶囊 | CORRECT+removeRequiredFeatures只撤销Whole bean；同goal修订2，保留40美元和Ground排除；无参数错误、无0美元订阅卡 | PASS，52.634秒 |
| Original机器 | 同goal修订3，3研究卡的通用/专用兼容性均UNKNOWN；Peet’s独占L’OR仍漏入研究卡 | PARTIAL，76.608秒；触发P7修复 |

整豆/胶囊来源实际包含Awin、Shopify、Woo；COMPLETE仅为有界请求完成，非搜索1,002家。各轮Woo schema/timeout/budget错误全部保留。JBC的28美元研究卡没有所选grind或描述，形态UNKNOWN，不能把它误认成已证明的咖啡粉冲突。Original后的begin_web_search返回PERMISSION_DENIED、hostAction=DECLINE、2ms；没有核实可见表单或用户点击，未重试/未开启浏览器。

### P7最终原生复查及剩余项

新任务 `01a0879d-ceb1-7c30-bb54-4bcecc88132c` **v0.18.5 Original 最终回归** 实际运行最终bundle。输入为40美元内胶囊、排除散装咖啡粉、机器Original；完整回合64.109秒。结果0卡，检索身份哈希为空，无法确认本轮观察到Peet’s并剔除，故 **NOT_OBSERVED**，不能用0卡宣称P7原生通过。

本轮模型生成query=`Nespresso Original compatible coffee capsules`、requiredFeatures=`Nespresso Original compatible`，与此前query=`coffee capsules`及前缀兼容要求不同，触发EXACT_PRODUCT；Shopify诊断同时记录身份/相关性过滤。Woo12个商家回合有3个失败，包括CONTENT_TYPE与SECURITY_REJECTED，终态正确停止，没有绕过。零结果不能全部归因来源。后缀兼容表述不在专用完整要求解析格式内，但本轮无候选进入评估，因此是待验证接口风险，尚非本轮已证明的候选错判。

下一步分开定位：初始兼容性查询的类别/身份路由与后缀要求规范化；Awin重复键/限流刷新链；来源可用后P7原生定向复查。原生报价表单、真实Watch交付及原先暂缓原图/40业务/40图片验收继续保留。未新增付款、购物车或Watch操作。

原始证据在ignored目录`artifacts/native-followup-remediation`：`native-acceptance-receipts.json`、`native-acceptance-independent-review.json`、`final-native-regression.json`、`final-cache-delivery.json`、`production-final-status.json`及全部红绿日志。本文保留审阅摘要，不能把本机ignored文件冒称已随Git发布。
