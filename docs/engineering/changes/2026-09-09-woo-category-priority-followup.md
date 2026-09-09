# Woo 明确品类优先与保守商家冲突筛选

## Research

基线 commit `a651e819b1c522bb11e449b87ae1abea13118091`，开始时工作区干净，已安装 v0.18.7 R1 是保留的历史基线。已读 AGENTS、研发协议、总设计来源及查询章节、严格 Woo 请求／响应合同、registry 标签与 controller／planner 消费链。

FACT：实际 Glossier 唇膏请求的 `productType:"lip balm"` 和 Flavor Espresso 均保留，但第二轮 query 的 Espresso 被旧软路由当作 coffee 类目信号，选择 1Zpresso、Espresso Vivace、La Marzocco。三家均返回 0 商品，未错误进入卡片。用户随后明确批准：**明确商品品类优先，排除类目明确冲突的商家；类目资料缺失仍保留有限探索。** 这是一项新的路由规则；此前 NF07“零相关就跳过所有探索”仍未答复，不实施。

现有严格 `WooSearchInput.productType` 为可选字符串，controller 收到后原样给 planner；MCP 两轮顶层类型传递及 visual-only 合法类型 fallback 由主任务负责。planner 先按 preferred／brand／form／category 排序，任一正信号算相关，最多 6 店并补最多 2 店探索。controller 先排除已尝试和健康隔离店，再规划并执行；错误、注册表归属和直达 URL 的安全校验独立存在。仅把 planner 结果变空会得到 UNAVAILABLE 和无进展 continuation，需要同时处理新规则产生的有意空规划。

资料不是全商家库存真值。注册表中实际标签超过千种，含完整细类、父类、宽泛 `beauty`／`Home`／`gifts`／`accessories` 和未解释词。不能把“不等于目标细类”当作已知冲突，也不能凭商家名字／品牌／query 中口味或颜色下硬结论。

| 边界 | 本次合同 |
| --- | --- |
| 明确请求 | 仅独立 `productType` 的受控完整类别短语及规范复数／中英别名；不从 query、颜色、口味猜硬品类。未识别或含未解释复合意义时保持旧软路由 |
| COMPATIBLE | 至少一个已解释标签直接兼容该类别，或属于明确兼容父类；多品类商家只要有兼容项就保留 |
| UNKNOWN | 空标签、未解释标签、宽泛标签，或只知道是同一领域的不同细类；不把资料不足当冲突 |
| CONFLICT | 所有商家标签均已解释，且既无兼容项，也无同域／未知项；已证明落在不相交领域才排除 |
| 相关父类／邻近细类 | skincare／makeup／cosmetics 可覆盖 lip balm；鞋与靴兼容。lip balm 与 serum、headphone 与 amplifier 等同域细类至少为 UNKNOWN，不能跨组硬排 |
| 真实反例 | 1Zpresso 的 coffee／grinder／espresso／manual grinder，Vivace 的 coffee／beans／espresso，La Marzocco 的 coffee／espresso／portafilter 必须完整解释，对 lip balm 跨域冲突；使用实际注册表条目固定回归 |
| 预算／资格 | 兼容组先选最多 6 店，UNKNOWN 最多 2 店补位；各组内保留既有品牌／preferred 排序，不能用品牌救回冲突。最多两轮、访问资格、信任、候选匹配不变 |
| 直达目标 | 已通过来源 URL 注册表校验的 `productUrl`（含私有 Woo anchor 下传）不受商家类别摘要误拦；安全及变体校验不变 |
| 健康／空规划 | 类目筛选在可用性选择之前执行，兼容店故障仍报告故障。仅本次候选全部因明确品类冲突而为空时 COMPLETE，保留技术 eligible 分母、coverage=false，无 continuation |

受控解释复用现有路由词组及 coffee form，补 lip balm 和这三家实际标签所需的完整短语；内部细类及领域用于路由，不迁移商家数据。领域用于识别不相交，不能仅凭同域把商家升级为相关。宽泛或未支持标签保持 UNKNOWN，不宣称分类覆盖所有注册表标签。

实现前补充语义边界：旧召回词表不是硬分类表。孤立 grinder／manual grinder／espresso／beans 不构成唯一硬品类；仅当同一商家标签还有明确 coffee、受控 coffee form 或明确 coffee equipment 类目时，允许这几个受控词按咖啡上下文解释。品牌、商家名称、query 不能提供这个上下文。裸 pedal／quilt／notebook 等跨域词保持 UNKNOWN；effect pedal／sleeping bag／纸质笔记本等明确短语可解释。测试保留孤立和有明确同组上下文的对照。

同模块追加已观察到的 medicube 类型：主任务核实既有原生输入明确 `productType:"toner pads"`，按相同批准规则补 toner pad／toner pads／爽肤棉片，归护肤域并由 skincare 父类兼容；bare pads 保持未知，不凭商品 query 推成美容。追加三项红断言后才补映射，无新增网络观察。

## Propose

| 方案 | 行为／收益 | 代价／风险／回滚 |
| --- | --- | --- |
| A：planner 内受控三态解释，controller 处理对应空规划 | 复用现有 productType 和标签，直接消除真实口味／颜色跨域选店；同域、未知和多品类保守 | 小范围函数及公共行为测试，无新 schema／依赖；词表未覆盖项保持 UNKNOWN，可回滚对应模块 |
| B：给 registry 增加层次品类字段并审核迁移 | 显式父子关系及覆盖度，未来可减少字符串歧义 | 需逐商家审核、数据迁移、合同及旧客户端兼容，当前无法把旧自由标签直接提升为完整分类证据；回滚需保留旧标签 |

推荐 A，主任务已按用户本轮明确批准采用。B 可独立规划，不能为了本次修复推断全部标签和商家库存。主任务另外批准 controller 新空规划分支及健康隔离保护；不变更旧 NF07。

## Plan v1（实现前冻结）

1. 先新增公共 `planWooMerchants`／真实 `createWooCommerceController` 红断言：Glossier 原生三咖啡店排除，颜色／口味同词不越品类；兼容父类、多品类、同域细类、空／宽／未映射标签；品牌／preferred 不救冲突；未知请求类型保留旧行为；直达 Woo URL 保留。固定数值断言 6 店／2 探索及两轮预算。
2. 原子修改 backend `woocommerce-routing.ts` 和不可分开的 controller 消费分支：三态筛选→可用性→规划；只在新过滤产生空候选时完成本次规划，不伪称全 registry 完成。调整原“全部 books 对显式 wig 仍探索”的测试以符合新批准规则，同时保留新的未知标签探索正例。无相关规则不得顺便扩散。
3. 立即独占 `pnpm build:awin-feed`，随后新增断言与相关 controller／routing／安全／metadata 回归；类型检查、涉及文件 ESLint、diff 全通过再交主任务。MCP 与来源产物由不同负责人构建，避免共享产物冲突。
4. 独立代理审核实际标签的歧义、多品类和范围，保留首次红／后续失败与修正；新可复现边界在当前模块修正，若需新 schema 或业务规则重新冻结。模块完成后交主任务统一后缀、发布与原生复验，不能用离线通过冒称安装或真实覆盖。

范围仅 backend planner、必要 controller 分支、对应测试和本文；不修改版本、plugin、README、architecture、总计划、merchant registry 或 NF07，不提交／部署／联网或发起原生任务。主任务负责 MCP 类型传参与产品文档。

## Implement / Test

新增公共 27 项首跑 17 PASS／10 FAIL，保留 `woo-category-priority-red.json`；失败涵盖真实咖啡店跨域、父类／多品类、鞋靴、未知探索、品牌不能救回、明确上下文与健康／空规划等旧行为。三态实现和 controller 原子消费修改后立即 `pnpm build:awin-feed` 成功，27／27 PASS。

新增 medicube 类型的三红单独保留 `woo-category-priority-toner-red.json`（31 项 28 PASS／3 FAIL，含新 bare pads 未知正例）。补受控 toner pad 及 skincare 父类映射后立即第二次来源构建成功。最终分类只读 merchant categories；query 中 Espresso 继续可作组内软排序词，但不能使已排除商家重返候选，UNKNOWN 不会因品牌或类别词软命中突破两家探索上限。bare grinder／espresso 等仅在同条商家 metadata 的明确 coffee 语义下解释，无品牌或名称补证。

controller 先从全部本轮候选中筛掉明确冲突，再做已有健康可用性选择，避免只剩不相关可用店时吞掉真实兼容店故障。新过滤确实使本轮所有候选为空，才将这次规划记 COMPLETE、原 eligible 技术资格分母不变、registryCoverageComplete=false、无 continuation；未配置和故障路径不复用该结果。直达目标在原 URL 注册表校验后不做类目摘要排除。

首轮相关 9 文件 930 PASS／1 FAIL（`woo-category-priority-related.json`）。失败是原测试把 1,000 家明确 `book` 标签误称“资料缺失”，仍期望对显式 wig 访问两店。按已冻结新规则保留其 book fixture，改名并断言明确冲突全部排除、0 请求、无 continuation；未知／宽泛／不完整元数据的探索由新的公共正例独立验证，没有删除安全边界断言。

最终必选验证：

| 范围 | 结果／证据（`artifacts/remaining-completion/`） |
| --- | --- |
| 来源模块 build 与 toner 增量后立即 build | 两次 exit 0；`woo-category-priority-build.log`、`woo-category-priority-build-r2.log` |
| 新增品类规则、既有两类 routing、真实 controller search／store reader／失败详情／选择绑定／覆盖／1000 家数据回放 | 9 文件 931 PASS／0 FAIL，其中新增 31 项；`woo-category-priority-related-r2.json` |
| `pnpm exec tsc --noEmit --pretty false` | exit 0；`woo-category-priority-typecheck.log` |
| 两个源码、两个测试文件 ESLint | exit 0；`woo-category-priority-lint.log` |
| 本范围 diff 检查 | exit 0，无 whitespace error |

来源替身只隔离网络和商家返回内容，公共 controller 决定规划／拒绝／故障，未发任何来源或原生请求。映射未覆盖的类别保持 UNKNOWN 或未知请求原路由；这不是全 registry 分类／商品库存真值。构建锁已交主任务做最终后缀、双产物和完整验证，本文不宣称安装、部署或原生验收已完成。

独立窄复验完成 1 文件 10／10 PASS，无新增已复现阻断。覆盖原生三咖啡店对 lip balm／toner、混合及 UNKNOWN preferred、同域／裸歧义、未知请求类型原路由、全冲突及 cache、403 健康隔离／重复和 continuation 的共享覆盖解释、直达及未收录 host、两轮 6／2 上限。独立执行禁止外部 fetch，未改运行代码或构建。证据 `woo-category-independent-probe-result.json`、`woo-category-independent-final.json`；源码 SHA256：planner `5dc1ab479be2854d745c4da82753ec01e24e820123b0c3159c516c05fe206f61`，controller `4159e26632e4250f96eca5bc7cc2647bde405eb72eb2642858f82a97c6840e3d`。模块和工程记录正式交还主任务集成交付。
