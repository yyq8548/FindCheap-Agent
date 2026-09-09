# 视觉复核参数说明补充

## Research

依据[总设计第4.2节](../../architecture/agent-design.md#42-图片同款优先相似款明确分开)和[研发协议](../agent-development-protocol.md)。基线`bea1c85`，版本0.18.6；本步骤落盘前目标server.ts和分发compare skill无未提交改动。改动只影响模型读取的finalize工具说明及购物技能，不改变视觉判断、价格、身份、授权或重试合同。

修复前原生任务`01a087fb-e397-7970-b4ee-196ceb35208d`的I01-R1首次finalize失败：第5个verdict的SILHOUETTE candidateEvidence为243字符，且matches中DISTINCTIVE_DETAIL重复两次。原始回执为`INVALID_ARGUMENTS / INPUT_VALIDATION / CORRECT_ARGUMENTS`，允许一次参数纠正。模型随后把该文本改为128字符并去重，一次纠正成功。失败与成功均保留在ignored `I01-R1-business-receipt-summary.json`，不作人工同款真值或最终候选性能通过证据。

`search-products.ts`的VisualEvidencePairSchema早已限制referenceEvidence和candidateEvidence trim后1–160字符；CodexVisualVerdictSchema要求matches内部属性唯一、conflicts内部属性唯一，且两表不得使用同一属性。server.ts的FinalizeVisualSearchInputSchema消费该schema。当前可见工具文字声明仅把证据字段展示为string，分发技能也未写明上述长度与唯一约束；不能据此声称服务端缺校验。

## Propose

| 方案 | 作用 | 风险与决定 |
| --- | --- | --- |
| A：工具description与现有视觉verdict技能条款明确约束 | 模型提交前可看到长度和属性规则；两个现有消费者一致 | 最小说明变更，保留原校验；主任务批准采用 |
| B：放宽长度或服务端自动裁切、去重 | 可能接受本次错误参数 | 改变证据合同、可能隐藏矛盾；不获批准，拒绝 |
| C：证据字段／verdict的schema describe补注 | 字段级说明也可改善理解，无需放宽schema | 需要改动共享schema元数据，且宿主文字转换未必保留跨字段refinement；本轮选用直接可见的A |

## Plan V1（实施前冻结）

1. 只在server.ts的finalize_visual_search description、分发compare-products技能第6条补充：每段referenceEvidence／candidateEvidence最多160字符；一个verdict的属性只允许出现一次，只能属于matches或conflicts之一。
2. 不改schema、自动裁切／去重、权限、重试、版本或测试实现；说明不复制成无行为价值的新测试。
3. 本步骤共享MCP构建槽由constraint_fix独占；说明落盘后立即通知其在同一MCP产物构建中纳入。完成构建后运行现有视觉纠正合同与stdio smoke，另做diff检查；本子任务不并行构建，不以旧bundle验证新description。
4. 原I01-R1及原8位置清单保留为修复前证据。最终候选如何重新冻结由主任务决定，不自行新建／重跑图片任务。

## Implement / Test

两处说明已落盘，schema和校验逻辑没有修改。constraint_fix在共享MCP构建槽执行`pnpm build:mcp`，`shopify-url-anchor-build-r2.log` exit0，包含本次说明；随后独立检查当前分发bundle确实含新增160字符说明。

现有`visual-correction-contract.test.ts`与`stdio-smoke.test.ts`共2文件／8断言通过，命令`pnpm exec vitest run apps/mcp-server/test/visual-correction-contract.test.ts apps/mcp-server/test/stdio-smoke.test.ts --reporter=json --outputFile=artifacts/remaining-completion/visual-verdict-guidance-contract-tests.json` exit0；`git diff --check`通过。没有新增照搬说明的测试，没有放宽或自动修正输入。

本次完成说明与既有合同／当前bundle验证，不证明未来模型不会再次提交超长或重复字段。修复后原生矩阵尚未运行；原失败仍保留，未创建额外测试任务。未提交、推送、改版本或替换缓存；发布及最终候选验收由主任务管理。

## R3 技能预算修订（压缩前冻结）

主任务完整回归首次208文件中4083断言通过、2失败：新增技能说明使预算检查读到7292字符，超过原7200／7183上限。原失败保留在`final-tests-r3.json`。不提高预算；只压缩新增限制和现有等义连接语，至少减少110字符，完整保留长度、属性唯一／不交叉、权限、身份及推荐安全约束。

仅改分发SKILL及本记录；server工具说明不变，无需重复构建其bundle。验证既有`tests/contract/findcheap-chrome-v0.test.ts`（包含golden20）、视觉纠正合同及stdio smoke；保持原预算／断言，全部通过后再交主任务集成。

局部压缩阶段UTF-8长度7181字节，比首个超预算版本7292减少111字节，低于原7183／7200阈值（合同实际计UTF-8字节，不是字符数）。长说明改为字段名加简短限制；其余只压缩等义连接语，保留160字符、属性跨matches／conflicts唯一、未知货况、商品卡、Chrome和授权等原规则。

压缩的首两轮各25通过／1失败，原因分别是既有合同锁定的UNKNOWN货况句、unsynced选择句被等义改写；已恢复原句，未修改断言。原`visual-verdict-guidance-budget-tests.json`及`-r2.json`保留。最后三文件26断言全部通过（含golden20预算／合同、视觉纠正及stdio），证据`visual-verdict-guidance-budget-final.json`；未重复构建server说明、未新建原生任务或放宽预算。

## R3 最终集成结果

上述局部通过后，全库 `final-tests-r4.json` 记录209文件、4095 PASS／2 FAIL：等义连接语 via／using 与另两个静态合同锁定的 through／with each 不一致。这里是合同文字差异，安全规则没有删除；主任务恢复原文并继续压缩其他等义连接语，未改断言、原7200／7183预算或服务端校验。

最终技能为 **7177 UTF-8字节**。全库 `final-tests-r5.json` 为 **209文件／4097 PASS／0 FAIL**；`final-typecheck-r4.log`、`final-lint-r4.log` 通过，MCP 构建及分发哈希核对通过。原 r3 的208文件、4083 PASS／2 FAIL（超预算）和 r4 两项文字合同失败均保留，不能仅报告最后全绿而省略早期失败。

准备发布的包为 `0.18.6+codex.20260909214736`，MCP SHA256 `af828bf8d1a821d535b7207e2ca69c81f73e9db812a0e1c2ccce9d0fc9c05502`。本记录更新时 R3 运行代码／测试／包已提交推送 `3d6ac6e`，最终安装、CI 和修复后原生回合尚待；当前自动通过不证明模型以后不会再提交错误参数。原 I01-R1 及其一次成功纠正仍是修复前证据，不能移入最终候选性能统计。
