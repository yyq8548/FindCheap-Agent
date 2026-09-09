# NF01：兼容性查询与商品身份分离

## Research

- 基线：main / `7401b6d8a4e31b7b7b68cfbd2381f642ac334736`，v0.18.5；开始时工作树干净。用户授权继续修复和真实自测，原图及40+40人工标注仍暂缓。主任务批准本步自主采用最小方案A。
- 适用规则：总设计4.1先区分商品身份、形态和兼容性，编译来源查询但保留原条件；5.1信任不替代商品证据；8保留原目标、要求与快照；13自动回归不替代原生验收。
- FACT：原生任务 `01a0879d-ceb1-7c30-bb54-4bcecc88132c` 的query为 `Nespresso Original compatible coffee capsules`，productType为coffee capsules，required为 `Nespresso Original compatible`，excluded为 `loose ground coffee`，预算4000。实际searchIntent错误为EXACT_PRODUCT，Shopify有原始召回但过滤后0候选；来源失败分母不能因此消除。
- FACT：用保存的真实Shopify Catalog响应，经同一真实adapter和searchProducts隔离网络重放，普通 `coffee capsules` 为CATEGORY_DISCOVERY/3候选，改成上述兼容句为EXACT_PRODUCT/0候选。原商品、价格、信任不变。此为受控回放，不是新的原生或当前价格验收。
- 调用链：searchProducts → productOnlyQuery/stripRequiredFeaturesFromQuery → resolveSearchIntent/hasNamedProductIntent → buildSourceQuery → compileSourceQuery → Shopify Global adapter → classifyShopifyCandidate → candidateIdentity/共享要求评估。当前query剥离只处理内存/存储和商家条件；Nespresso、Original、compatible落入名称词。Global adapter已先按该query剔除商品，不能只修改最终卡片过滤。
- FACT：coffeeCompatibilityRequirement只识别前缀表达，后缀compatible尚未作为完整单项处理；parseCoffeeCategory不识别loose ground coffee。专用评估、required/excluded/preference和inspect共用这些入口。
- 消费边界：新增解析只接受完整、单系统且明确表达兼容关系的纯胶囊品类句；额外品牌、款名、SKU、机型编号、复合AND/OR不被删除。明确brand字段仍由现有品牌门禁核验；SAME_PRODUCT、URL/Woo anchor和强标识继续优先。查询编译不能改原query、required/excluded、预算、目标或快照。
- 依赖与验证：Node24、pnpm10、既有vitest/esbuild，无新依赖、数据库迁移、商家信任扩展或网络权限。MCP本地构建为 `pnpm build:mcp`。只验证受影响咖啡/检索/身份及消费者，最终全套与原生由主任务执行。

## Propose

| 方案 | 收益 | 代价与风险 | 回滚 |
| --- | --- | --- | --- |
| A（选择）：既有coffee模块加入完整兼容品类句解析，意图和来源编译复用；前后缀及形态别名共用 | 修正已复现调用格式，所有硬要求原样保留；不依赖模型改词 | 只接受受控完整句，额外命名/复合句留原路径；小范围MCP改动 | 回退本次源码，无数据迁移 |
| B：新增结构化query AST，所有来源和消费者接收独立identity/category/system字段 | 可统一更多自然语言组合与来源适配 | 需新增合同、多消费者兼容与更大语法验收，不适合本次单一格式缺陷 | 回退新增合同与所有依赖消费者 |

主任务基于既有用户授权选择A；没有改变购物业务规则，遇到额外品牌/型号无法确定时保持原身份规则，不自行放宽。

## Plan v1（实现前冻结）

| 步骤 | 入口与改动 | 独立断言 | 立即构建与退出条件 |
| --- | --- | --- | --- |
| Q1 | coffee-category共享受控解析；完整兼容要求支持后缀，loose ground同义形态；只识别单系统纯兼容胶囊句 | 前/后缀和连字符；未含兼容关系的品牌式文字、额外品牌/SKU、AND/OR不吞并；required/excluded/preference仍据所选规格，正面描述UNKNOWN | 先红后实现，build:mcp与Q1局部回归全绿 |
| Q2，依赖Q1 | resolveSearchIntent、requestedCoffeeCategory、buildSourceQuery在纯兼容品类下使用同一解析；原输入/要求不写回 | 真实保存Catalog响应经公共MCP恢复非零合理研究项；三来源编译形态查询，系统冲突/unknown不升级；预算/品牌/SKU/SAME_PRODUCT及原快照保持 | 先红后实现，build:mcp与检索/咖啡/身份/inspect回归全绿 |
| Q3，依赖Q1-Q2 | 所有本步代码检查与证据记录，向主任务交接 | 记录失败与修复原因、最终相关回归结果、源查询与原要求区别；不把受控回放记为原生通过 | 相关lint、diff check；停止写入并释放MCP构建锁 |

不修改总设计、公共版本、主计划、安装缓存，不提交或推送。独占MCP构建输出直至交接；主任务负责版本、完整集成、交付和再次原生检索。必选检查失败停在当前模块，发现新根因先修订计划。

## Implement / Test

Q2补充冻结：首轮修复及构建后，公共MCP真实夹具已返回3研究卡；红断言继续发现expanded第二轮将完整兼容要求追加回Awin/Woo查询。仍属Q2来源编译：对category路径组装后的完整纯兼容句复用同一parser；额外品牌/SKU/AND/OR词不删除，所有原要求仍用于候选门禁。保留此次失败日志。测试初稿错误要求排除仅含OneCUP品牌、没有系统冲突证据的旧观察，核对保存原始响应后改为UNKNOWN；这不是额外放宽生产规则。

| 记录 | 结果 | 证据 |
| --- | --- | --- |
| Q1初始红测 | 13例，7失败/6通过；后缀兼容、loose ground和宽coffee类型复现 | `artifacts/native-followup-remediation/nf01-q1-red.log` |
| Q1实现后立即构建及局部回归 | build:mcp退出0；4文件211通过 | `nf01-q1-build.log`、`nf01-q1-green.log`，同上目录 |
| Q2初始红测 | 19例，9失败/10通过；实际兼容query导致EXACT及零卡 | `nf01-q2-red.log` |
| Q2首轮构建及补充红测 | build:mcp退出0；初次局部仍2失败，核对夹具后独立复现Awin/Woo第二轮追加兼容词，2失败/17通过 | `nf01-q2-build.log`、`nf01-q2-post-build-failed.log`、`nf01-q2-expanded-red.log` |
| Q2第二轮编译实现后立即构建 | build:mcp退出0；原19例全部通过 | `nf01-q2-expanded-build.log`、`nf01-q2-green.log` |
| 增强消费者验证 | 新增JSON inspector与历史/旧快照断言，两个新增测试文件共34例通过 | `nf01-consumer-green.log` |
| 最终受影响回归 | 17文件480例全部通过，退出0 | `nf01-regression.log` |
| 局部静态检查 | 两个源码与两个测试文件eslint通过 | `nf01-lint.log` |

最终改动仅两个MCP源码：coffee-category新增完整兼容品类句解析、后缀要求、loose ground别名；search-products复用到意图、品类、首轮和第二轮编译。新增两个测试文件共34例。build:mcp按既有流程重建bundle、metafile及第三方声明，没有新增依赖。

公共MCP受控重放结果：前后缀表达均为CATEGORY_DISCOVERY、返回3研究卡。Shopify/Awin只接收coffee capsules或coffee pods；Woo接收coffee；原query、required/excluded和4000预算在历史中保留，预算收紧到100继承条件后为空。匹配证据未知的卡不获得首选，Midtown明确独占L’OR BARISTA的冲突被排除。品牌Acme的独立夹具只保留该品牌、预算内且所选Original兼容的正例，Other品牌、Vertuo与超预算反例被排除。

真实JSON inspector的模拟商家数据验证：所选Original由UNKNOWN变MATCHED；所选Vertuo返回NO_MATCHING_VARIANT；旧render产品不变。前后缀兼容要求的required、excluded、preferences消费者一致，UNKNOWN偏好不计分，AND/OR及其它附加条件仍不能由单系统证明。SAME_PRODUCT与额外品牌/款名/SKU/GTIN保留原EXACT边界。

相关回归命令：`pnpm exec vitest run apps/mcp-server/test/coffee apps/mcp-server/test/retrieval-plan.test.ts apps/mcp-server/test/search-products.test.ts apps/mcp-server/test/requirements-workflow.test.ts apps/mcp-server/test/inspection-selection-continuation.test.ts`。

边界：这里是隔离网络的保存真实响应重放和模拟JSON商家检查，不是当前价格、全球商家覆盖或新的原生宿主验收。Awin/Woo注入的不可用状态和保存Catalog的PARTIAL/hasMore在结果中保留。主任务仍需完整集成、缓存更新和新原生测试；原图与40+40人工集按用户指令继续暂缓。
