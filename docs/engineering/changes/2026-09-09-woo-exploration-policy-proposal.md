# WooCommerce 无关商家探索策略提案（NF07）

状态：**待用户决定；未冻结实施方案，未实现，未部署。** 本文仅记录只读研究。不得据此修改运行策略、主改进计划的完成状态或发布说明。

用户待决定的问题为：“明确品牌/型号、没有相关商家时跳过无关探索；泛品类有限探索。” 本文中的“相关”沿用现有路由信号，**相关类目仍算相关；不会因为商家没有命中目标品牌，就禁用所有此类商家。** 如果需要“明确品牌查询只访问已登记该品牌的商家”，这是覆盖范围更窄的另一项决定，不包含在本提案中。

## 当前事实与作用链

- `apps/awin-feed-service/src/woocommerce-routing.ts` 对每个已准入商家计算 preferred、brand、form、category。任一信号大于0即算相关；先取最多6家相关商家，剩余名额补最多2家无关探索。路由标签不证明商品身份、库存、价格或商家可信度。
- `packages/contracts/src/woocommerce.ts` 的 `WooSearchInputSchema` 只有可选brand，没有brandMode、model或探索策略。MCP和来源服务均使用严格schema；未知字段会被拒绝。
- `apps/mcp-server/src/search-products.ts` 知道brandMode和视觉输入，但当前调用Woo时只转交brand。`resolveSearchIntent` 的EXACT_PRODUCT也可能来自启发式词语判断，不能单凭此状态证明用户明确指定了品牌或型号。
- `apps/awin-feed-service/src/woocommerce.ts` 先排除已尝试商家和暂时不可用商家，再交路由规划。因此当前 `routing.matchedStores` 描述的是传入规划器的候选集合，并不总是整个eligible registry。
- 当前规划为空会落入UNAVAILABLE；continuation只按已请求商家数量构造。若直接把exploration删掉，可能把“有意不访问”误报为来源故障，并产生没有进展的后续请求。

作用链为：用户明确约束及服务器保存的请求 → MCP确定探索策略 → Woo请求合同 → 来源服务判断整个eligible集合的相关性 → 有界商家规划 → 诊断、continuation和MCP来源状态。商品身份过滤、首选推荐、可信库和访问安全规则保持各自职责。

## 两个可行选项

### A：明确目标且整个eligible集合零相关时，跳过无关探索

仅在下列条件同时满足时规划0家商家：请求携带明确的受限探索策略、没有已准入的直达商品URL、整个eligible集合的四类现有相关信号全部为0。泛品类及未证明明确目标的请求保留现有有限探索。

优点是减少确定缺少相关路由信息时的无关请求；代价是可能错过metadata不完整、实际售卖目标商品的商家。该结果只能说明“本次登记信息未提供相关商家”，不能说明整个WooCommerce市场无货或没有同款。

本选项不会改变有相关商家时现有的最多6家规划及补充探索规则。也不会把“类别相关、未登记此品牌”的商家重新分类为无关。例如，Sony耳机查询命中了已登记的headphone类目时，仍存在相关商家；不能宣称A会停止所有这些查询。

### B：保留当前策略

明确目标与泛品类均保持最多2家无关探索，并保留有界诊断、商家隔离及最多两轮/12家现有上限。

优点是为不完整metadata保留少量召回机会，无新增协议兼容问题；代价是明确目标完全缺少相关商家时仍可能付出两个店铺请求及其超时成本。选择B不等于增加商家数量或放宽身份过滤。

## 选A时的最小合同与边界（尚未批准实施）

1. Woo请求增加一个可选策略字段，例如 `explorationPolicy: "BOUNDED" | "SKIP_IF_NO_RELEVANT"`。缺省为BOUNDED，保留旧客户端行为；不为此新增猜测性的model字段。字段名称在实施冻结时最终确定。
2. MCP根据已有明确语义产生该策略，不增加让模型直接提交服务器身份锚点的公共MCP参数。最小触发范围为非视觉请求中的明确REQUIRED品牌，或用户文本中已有且通过既有强标识判定的型号/SKU/GTIN。不能仅凭brand字段非空、EXACT_PRODUCT启发式、OBSERVED/PREFERRED或视觉猜测触发；一般品类、包装数量、尺寸、兼容的机器系统名称不得冒充商品品牌/型号。无法确定是明确型号的纯名称请求保留BOUNDED，不猜测。
3. 判断“零相关”的集合为全部已启用、允许搜索、币种符合请求的已准入商家。相关性采用现有preferred/brand/form/category四项，不能只在当前未尝试或未熔断子集上判断。商家本身仍须满足现有准入；未知preferred host不增加访问权限。
4. “相关商家存在但全部暂不可用”保持故障或跳过诊断；“这一轮相关商家已尝试完”保持本轮耗尽语义，均不能说整个registry零相关。对已准入直达URL继续单店绑定读取；原URL、父子、变体、币种及安全校验不变。
5. 策略只决定是否发出无关探索请求。它不确认商品型号、品牌、同款身份或首选资格，也不影响Shopify/Awin等其他来源的现有查询和候选过滤。

## 状态与后续请求

有意零规划应呈现：plannedStores=0、attemptedStores=0、physicalRequests=0、相关/探索规划数为0、products/stores为空、registryCoverageComplete=false，不返回continuation。它不是NOT_CONFIGURED，也不是网络UNAVAILABLE。

为缩小响应兼容范围，可保留后端已有COMPLETE状态表示“本次规划已结束”，由MCP结合本次受限policy与零路由诊断映射到已有SKIPPED来源状态；这不代表全registry扫描完成。若实施选择新增更明确的响应状态或原因，则必须单独处理旧客户端严格响应schema，不能直接增加枚举并忽略兼容性。

MCP第二轮必须保留第一轮由明确用户约束产生的policy；不能因检索编译器把query缩短，就丢掉策略或重新发无关探索。意图跳过后不得产生相同空continuation循环。缓存键当前包含完整input，可用于区分两种policy；不能复用BOUNDED结果冒充零规划结果。

## 最小改动范围和兼容顺序

预计涉及共享Woo请求合同、来源routing/controller、MCP Woo请求构造与来源状态映射，以及对应合同和行为测试。若实施中发现需要改变身份解释、推荐标准或新增诊断协议，须先更新冻结范围。

1. 先写失败断言，冻结准确触发条件和空规划状态。
2. 来源服务先接受可选新字段并保留缺省行为，构建和来源合同/路由回归通过后部署。
3. 确认服务已经支持字段，再让新版MCP发送该字段，完成MCP构建和调用链回归。新MCP先调用旧服务会因strict schema收到400，不能把这种升级顺序错误当作正常来源缺货。
4. 老客户端不传字段时继续旧行为；服务器保存的旧请求没有此字段时不伪造过去已执行的策略。恢复/继续搜索需从保留的用户约束重新确定本次策略。

## 具体测试入口与验收

- 合同：缺字段维持旧行为，合法policy往返，非法值拒绝；旧客户端对新服务仍可解析现有响应。
- 来源路由/controller：明确品牌或强型号且整个eligible集合四项均0时，source网络调用计数为0；泛品类仍最多2家探索。类别相关但品牌未登记时仍查询，不能误变成品牌白名单。
- 语义反例：OBSERVED、PREFERRED、视觉品牌、咖啡机器兼容系统、普通尺寸/包装数量及仅启发式EXACT_PRODUCT不误触发受限策略。已有明确品牌或强标识的正例分别覆盖。
- 集合边界：相关商家全熔断、相关商家已被上一轮尝试、仅无关商家可用、未知preferred host与已准入直达URL；分别核对诊断，不把暂不可用或本轮耗尽当成全registry零相关。
- continuation/cache：零规划无continuation、第二轮不重新探索；BOUNDED与受限policy缓存隔离，6家/轮和12家总上限保持。
- MCP集成：请求只携带正确推导的policy；意图零规划显示SKIPPED而非网络失败，registryCoverageComplete仍false；Shopify/Awin查询不被Woo零规划阻断，结果文案不声称“全市场无商品”。

建议入口为现有 `woocommerce-routing.test.ts`、`woocommerce-routing-1000.test.ts`、`woocommerce-search.test.ts`、`woocommerce-http.test.ts`、`woocommerce-client.test.ts` 和MCP有界恢复/诊断测试；优先增加行为断言，不仅复制实现条件。实施后按原子改动构建、定向回归和最终集成顺序验证。

截至本文落盘：仅完成只读研究和提案，没有修改运行代码、商家名单、预算、主计划或release；也没有把用户尚未作出的选择视为批准。
