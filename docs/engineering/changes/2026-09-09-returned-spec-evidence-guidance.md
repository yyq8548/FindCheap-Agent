# 本次返回规格的事实边界

## Research

- 目标：落实总设计第 3 节模型／代码事实责任、第 5.1 节商品证据、第 13.1 节真实验收边界；这是已批准事实规则的说明补强，不改变商品资格、身份、报价或搜索协议。
- 基线：`8ec86c52c8352ec7f08033b06a41db7d23b1571e`，v0.18.7 R2。开始时已有根代理的 delivery/release 文档修改及 native-user-checks 新记录，不属于本改动。
- FACT：Glossier R2 原生回合 `01a08881-560e-7a63-851b-22579cb0d760`，75,182 ms；search/inspect 均成功，但最终“已核对为 Espresso，15 ml”中的容量没有出现在两份完整工具回执。保留 `artifacts/remaining-completion/glossier-v0187-r2-native-audit.json`，不判断容量数值本身错误，也不重标旧样本。
- FACT：compare skill `Selected` 已规定服务端拥有事实；Specs 及 `server.ts` 的 inspectionConfig.description 未明确“成功只核验实际返回字段”。default prompt 要保留卡片证据与限制，未单列缺失容量／重量／数量。
- 调用链：安装 skill/default prompt → 模型选择原 renderId/selectionId → 公共 MCP `inspect_selected_product` 描述 → 已有检查 handler/快照 → 模型最终文案。旧 Shopify 别名共享 inspectionConfig；没有新输入、输出、错误码、权限、依赖、持久化或网络请求。
- 消费者：比较 skill、其 default_prompt、公共 inspect 描述与 Shopify 兼容别名。source 服务不消费本次说明，无 source 构建。
- 验证入口：现有 `shopping-friend-guidance.test.ts`、`findcheap-chrome-v0.test.ts`、`acceptance-followup-routing.test.ts`；`server.test.ts` 通过真实 in-process `client.listTools()` 观察已注册说明。`package.json` 已核 `pnpm build:mcp`、`pnpm typecheck`、ESLint/Vitest 命令。
- 预算：当前 skill 7,177 UTF-8 bytes，既有上限 7,200 与 `floor(19,954×0.36)=7,183`，36 行。不得提高阈值或削弱旧断言；先等义精简现有句子，再补规格规则。
- UNKNOWN：静态说明合同不能保证原生模型遵守；本轮已观察失败永久保留，最终安装后的独立目标验收归根代理。

## Propose

| 维度 | A：三个可见入口各写明边界（采用） | B：inspect 描述为完整规则，skill/default prompt 指向该描述 |
| --- | --- | --- |
| 职责 | 模型读到任一入口均可知道缺失规格不等于已核验 | 工具描述集中维护，购物说明只保留短引用 |
| 收益 | 搜索后直接回答及检查后回答都覆盖；不依赖模型再寻规则 | 更少重复文字、skill 预算压力更小 |
| 风险 | 三处需要合同保持语义一致 | 尚未读到 inspect 描述时规则更间接，容易遗漏 |
| 成本／兼容 | 三处纯说明；同义压缩保留全部旧分支，不改协议 | 同样三处，无协议变化，但更依赖正确读取次序 |
| 回滚 | 撤回三处说明及对应测试，原运行数据无迁移 | 同左 |

选择 A：根代理已经明确批准仅补可控说明，当前事实缺口直接发生在模型输出；不为此新增校验器、工具或上游读取。

## Plan v1（实施前冻结）

| 步骤／依赖 | 模块与最小修改 | 构建／自动断言 | 通过标准 |
| --- | --- | --- | --- |
| P1／Research 完成 | 增强现有 shopping-friend inspection guidance 与 server listTools 合同；分别观察 skill/default prompt 和公开 inspect 描述 | 先运行这两个已有用例，保存旧说明缺失导致的红结果 | 因缺少返回字段边界失败，不因外部网络或夹具异常失败 |
| P2／P1 红 | 三处写明：仅返回字段已核验；缺失容量／重量／数量／其他规格保持未知，不从记忆或用户期望补成事实；可选缺口不阻断已确认商品、不增加调用或澄清。skill 内等义压缩以保持原字节预算 | 完成同一说明模块后立即 `pnpm build:mcp`，再运行说明／预算、server、Shopify URL/tracking、Woo followups 相关回归 | 原预算不变，所有断言通过；source SHA 不变 |
| P3／P2 绿 | 同步本独立记录最终证据，交付根代理 | `pnpm typecheck`、相关修改 TS 的 ESLint、`git diff --check` | 无新增类型／lint／diff 错误，原生遵守仍独立验收 |

禁止：版本/suffix/README/总设计/主计划/source/缓存修改、提交推送、额外原生任务、报价／搜索行为变化、用缺失可选属性阻断已有商品。范围外发现留后续，不扩修复。

## Implement / Test

### P1：真实红断言

- 增强已有 `shopping-friend-guidance.test.ts` 的 inspection 用例与已有 `server.test.ts` 的 inspection 用例，没有新增镜像测试、没有删除旧断言。
- 首次 `returned-spec-guidance-red.json`：2 fail。购物说明确实缺字段边界；另一断言最初放在未配置 inspector 的 listTools 测试，返回 undefined，不属于有效缺陷红证据。保留该次失败，随后将同一断言移动到已有配置 `selectedProducts.inspect` 的规格检查用例；不改生产代码或伪造能力。
- `pnpm exec vitest run tests/contract/shopping-friend-guidance.test.ts apps/mcp-server/test/server.test.ts -t 'routes inspection directly|inspects a requested size' --reporter=json --outputFile=artifacts/remaining-completion/returned-spec-guidance-red-r2.json`：exit 1，2 个选中用例均因旧说明没有 `Only returned specs verified` 而失败；80 个未选用例不计通过。

### P2：同一说明模块与立即构建

- Specs、default prompt、inspect 描述加入相同边界：`Only returned specs verified; missing capacity/weight/count/etc unknown, never from memory/user requirements. Optional gaps: no blocking/extra calls/questions.`
- 为保留旧字节预算，仅同义精简现有 skill 的选择、输出、评分与视觉说明；保留所有旧安全分支和静态合同关键句。没有把缺失可选规格变成硬条件，没有新增查询或澄清。
- 写入前一次草稿预算检查为 7,187 bytes，超过 7,183，工具 exit 1；该保护发生在全部写入之前，没有半成品源码。继续等义精简后最终为 **7,182 bytes／33 行**，较基线仅加 5 bytes；7,200、7,183、36 行三项上限均未改，预算测试文件未改。
- 三处同一说明模块写入后立即 `pnpm build:mcp`：exit 0。日志 `artifacts/remaining-completion/returned-spec-guidance-build.log`。
- MCP SHA：`058ea0cbb047d0fbbd401a575df5448404953ac8dfa48d075fd17fdae4f616d9`。
- source SHA 仍为 `14ce0c4ef5bfb944042659cf8c6e7e6fcf6d34894bf34db52bd9b7983f85fa1e`，没有 source 改动／构建／部署。

### P3：必选验证

| 验证 | 实际结果 | 证据 |
| --- | --- | --- |
| 三份现有说明／预算合同 + server + Shopify URL/追踪参数 + Woo followups + bundle provenance | 8 文件 **172/172 PASS**，0 fail、0 skip，exit 0 | `artifacts/remaining-completion/returned-spec-guidance-green.json`／`.log` |
| `pnpm typecheck` | exit 0 | `returned-spec-guidance-typecheck.log` |
| ESLint：server.ts、server.test.ts、shopping-friend-guidance.test.ts | exit 0 | `returned-spec-guidance-lint.log` |
| `git diff --check` | exit 0；仅已有 Windows 行尾提示 | 本次命令回执 |

constraint_fix 已独立只读复核最终 diff、HEAD 完整说明及绿色报告：无阻断发现；新规格规则、可选缺口不阻断、无额外查询及旧边界均保留，预算及旧断言未放松。报告 `artifacts/returned-spec-guidance-independent-review.md`；没有重复构建或改动本模块。

本模块停止运行文件修改，并将 MCP 构建锁交回根代理。根代理负责最终包后缀、整包验证、安装、单次目标原生回归和发布。本轮不提交／推送／安装、不启动完整文字／图片矩阵。

结论：说明合同和相关本地验证完成；75.182 秒 R2 原生样本的无证据容量 finding 保留原样。新说明是否被原生模型遵守仍需最终包独立验收，不用静态合同或更多测试数量替代。
