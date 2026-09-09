# NF02：Awin 刷新故障跟进

## Research

- 基线：main `7401b6d8a4e31b7b7b68cfbd2381f642ac334736` / v0.18.5，开始时工作树干净。授权为修复刷新相关缺陷；本步骤不提交、推送、部署，不改版本和商家信任。
- 适用总设计：第7节来源预算、第10节脱敏日志及非关键来源降级、第13节保留可用旧缓存及原时间。开发流程遵循[研发协议](../agent-development-protocol.md)。
- 调用链：`runtime.startAwinFeedRuntime` 定时/快速重试 → `service.createAwinFeedController.refresh` → Feed List发现 → 每源请求账本/下载/严格归一化 → source cache → streaming合并/索引验证 → 原子全局快照。MCP只读服务输出；两个共享merge入口仍由 `packages/awin-feed` 提供。
- 当前依赖：Node24、现有zlib/zod/esbuild/vitest；无新增依赖或数据库迁移。来源构建入口为 `pnpm build:awin-feed`。修改共享Feed包时另需协调MCP构建，不与其他任务并发写同一bundle。
- FACT：生产常规刷新间隔360分钟；任何刷新异常均触发1→2→5→10分钟快速重试。每源5次/滚动小时硬限额来自本地 `source-cache.recordSourceRequest`；`SOURCE_RATE_LIMITED` 表示该本地拒绝，上游HTTP429另记 `SOURCE_HTTP_429`。
- FACT：528条生产脱敏日志记录5次 `DUPLICATE_PRODUCT_KEY`，随后3次本地 `SOURCE_RATE_LIMITED`；该窗口无上游429/5xx日志。成功下载和归一化的源缓存已写盘，但聚合失败前对应manifest未提交，导致下轮再次下载并耗尽自身预算。
- FACT：19:51Z真实Feed List选中53源，50有可用缓存、3无缓存；对应71,206行、70,676个merchant/product键、35商家。530个跨源重叠键含1,060行，0单源重复、0完全相同行组；493组价格不同、6组商品URL不同、5组库存不同。merchant ID纯数字，非字符串拼接分隔符碰撞。
- FACT：整源隔离会移除4源/1,450行/2个完整商家，保留69,756键；按冲突键隔离全部版本移除530组/1,060行，保留70,146键及全部35商家。旧已发布快照69,409行/32商家，最后完整成功15:58:37Z，该审计时已有3小时52分钟。以上规模仅描述当前选中来源的可用缓存，不声称每个缓存均为最新import。
- UNKNOWN：如何处置有实际价格/身份冲突的商品属于覆盖取舍，主任务正在向用户确认；不得先替用户选择来源、低价或合并版本。
- 证据：本地ignored `artifacts/nf02-awin-refresh/production-safe-logs.json`、`production-selected-cache.json`；只保存hash、字段差异名、计数和时间，不保存Feed私有URL、token或用户数据。第一次只读诊断使用历史48MiB聚合上限失败，核对当前源码80MiB后完成；运行时限额未改。

## Propose

| 问题 | 方案A | 方案B | 选择/边界 |
| --- | --- | --- | --- |
| 成功源缓存元数据丢失 | 在聚合前单独提交已验证源entry，保留旧全局快照元数据；聚合失败后可重用 | 按内容hash新增不可变源文件与逐源事务manifest | A解决确定缺陷，兼容既有格式；B更强但需迁移/清理，超出最小修复 |
| 无效输入引发快速重试 | 只对可恢复网络/读取故障快速重试；验证/本地预算失败等常规周期 | 维持全量快速重试，新增每源冷却状态与调度队列 | A不变更配额/常规360分钟，防止无效输入反复下载；B新增状态合同与持久化负担 |
| 重复商品冲突 | 按merchant/product键隔离全部冲突版本，单源重复仍拒绝；公开保留过滤分母 | 隔离所有涉冲突源，保留其余源；或人工审核canonical-feed优先级 | 仅比较方案，**尚未批准实施**；严禁静默择低价或覆盖不同身份 |

## Plan v1（确定缺陷，实现前冻结）

授权依据：用户要求继续修复全部确定问题，主任务明确允许先修缓存元数据与退避缺陷。冲突处置仍等待用户决策；与本计划独立。

| 步骤 | 模块/接口 | 最小实现与独立断言 | 立即构建/验证 |
| --- | --- | --- | --- |
| C1 | `service.ts`，现有manifest合同 | 成功源entry在聚合前落盘，snapshot字段仍指向旧可用全局archive；跨源合并失败后同进程/重启重试不重复下载未变化源，旧查询及时间不变 | 新controller行为断言先红；`pnpm build:awin-feed`；源缓存/服务定向回归 |
| C2 / C1 | `runtime.ts`调度 | 验证失败/本地请求预算失败不安排快速重试；网络超时/429/5xx等原可恢复故障保留有界重试；常规定时器与关闭行为不变 | 真实runtime入口+受控时间断言先红；`pnpm build:awin-feed`；runtime及controller回归 |
| C3 / C1-C2 | 集成 | 相关Awin来源服务与共享Feed包现有回归、类型/静态检查；保留每次失败及退出码 | 来源包最终构建与相关断言 |

不变：源GET-only、下载/解压/索引验证、每源5次/小时、默认360分钟、旧全局快照及原始时间、跨源冲突拒绝。没有生产运营参数变更。回滚为上述模块源码回退；manifest仍v1兼容，不宣称已解决任意写入时点崩溃一致性。

## Implement / Test

C1/C2/C4/C5实现已完成；C3来源回归通过，共享MCP最终构建和全库类型检查由主任务集成。

## Plan v1.1 / A2（用户批准后冻结）

用户已明确批准：仅隔离冲突商品键全部版本，保留其他商品和商家，不整feed隔离、不自行择价格。530组为原故障证据，运行时每刷新重新计算，禁止硬编码。字段冲突统计可重叠。

- C4：共享Feed包新增显式冲突隔离合并入口，两遍流式扫描，仅保存键集合/计数；第一遍每个源独立拒绝重复，跨源重复键标记隔离，第二遍排除全部版本并沿用原压缩/大小/归一化约束。既有严格merge入口不改变；只在Feed List最终聚合调用新入口。
- C5：服务快照、manifest和health公开输入行数、冲突键组数、隔离行数；保留源数量/排除原因、旧快照回退及其原始时间。全部键冲突无剩余商品仍拒绝发布；冲突过滤是明确的覆盖缩减，不冒充来源下载故障。
- 断言：不同价格/URL/库存及完全相同跨源重复均排除所有版本；3源同键计数正确；保留无冲突键和商家；源顺序不影响保留集合；单源重复失败；全部隔离失败且旧快照保留；重启诊断保留。逐模块红测试→来源构建→定向回归。共享Feed包改动告知MCP构建负责者。
- 运营参数不变，无依赖新增。manifest增加可选计数字段以读取旧v1；旧程序的strict schema不接受新字段，源码回滚时须备份并删除新增诊断字段后再读取manifest，不能宣称双向无条件兼容。生产部署由主任务执行。

## 实施与验证（2026-09-09 20:06Z）

| 步骤/业务规则 | 首次失败，未隐藏 | 实现及立即局部验证 |
| --- | --- | --- |
| C1 源成功不依赖聚合成功 | 新controller回归1/1红，失败时manifest仍00:30而成功源已更新至01:30，exit1 | 聚合前checkpoint已验证entry；来源build exit0，缓存/服务回归25/25绿；同进程和重启重试均不再下载未变源，旧archive/查询/最后成功时间保留 |
| C2 无效输入不反复消耗预算 | runtime6断言中无效archive及本地quota两项红，实际1分钟后发生第2次刷新，exit1 | 快速重试只允许超时、HTTP429/5xx和网络/读取OTHER；来源build exit0，6/6绿；补充旧缓存降级resolve路径后runtime8/8绿 |
| C4 动态冲突键隔离 | 新4断言因新入口不存在全红；实现后两项测试构造错误：snapshotAt误传对象、零价被既有Awin归一化过滤 | 修正测试为实际string合同及正常正价，不改零价规则；来源build exit0，4/4绿，3源同键/完全相同重复/顺序反转/单源拒绝/全部冲突边界覆盖 |
| C5 分母持久化/恢复 | controller新断言初次仍抛duplicate aggregate error，1红1绿，exit1 | Feed List最终聚合调用显式隔离入口；snapshot、manifest及health增加可选`productCoverage`；来源build exit0，相关12/12绿，重启显示原过滤分母，下一轮重新计算 |

- 最终来源服务和共享Feed包回归：`pnpm exec vitest run apps/awin-feed-service/test packages/awin-feed/test --reporter=json --outputFile=artifacts/nf02-awin-refresh/source-regression.json`，exit0，**27文件/1,200断言通过**。相关6文件/41断言回归也通过，包含既有大源流式处理、每源预算、超时、旧源恢复和新的隔离逻辑。
- 改动7个TS文件的定向ESLint exit0；`git diff --check` exit0。全库`pnpm typecheck`第一次exit1，仅其他并行任务的`coffee-query-compatibility-search.test.ts`四处类型错误（缺brandMode三处、可选string一处），已通知负责者；不能据此写全库类型通过。
- 两遍扫描遵守现有80MiB归一化输入预算、每源64MiB流式解压和8MiB聚合gzip限制；只保留键/计数，不保留完整CSV行数组。每源原归一化和已批准商家/价格/URL索引验证保留，strict同步/流式入口仍拒绝重复；新隔离入口仅用于Feed List聚合。
- `productCoverage.inputRows`为参加聚合的已归一化、合格源商品行数，不包含已排除源/上游被归一化过滤的行。`excludedProductGroups`为跨源冲突键组数，`excludedProductRows`为这些组的全部版本行数。商家/源覆盖和过滤商品分母独立报告，不把过滤行说成选出的低价商品。

## 真实源只读回放

- 读取先前已选中50个生产源缓存gzip（合计6,089,547字节），保存ignored `artifacts/nf02-awin-refresh/source-caches/`并逐文件校验SHA。无上游Feed下载、无生产刷新/发布、未复制凭证配置、原69,409行快照未覆盖。
- 本地候选代码对真实缓存重放：**71,206输入行 → 隔离530组/1,060行 → 70,146/70,146有效行，保留35商家**。输出archive SHA256 `e15dbc9f74b943a3f5aadcacd232d71021961dc20fee4817945a7d356490f17d`。这些缓存与原审计一致，不声称当前所有源已fresh。
- 第一次默认Node/tsx回放5.27秒，峰值RSS约1,113MiB。额外512MiB heap压力回放发生Node heap OOM，exit1；保留此失败，不能宣称支持512MiB。
- 只读核实生产配置为`--max-old-space-size=4096`、cgroup memory.max=8,000,000,000字节。用同4GiB heap本地回放通过，5.52秒、峰值RSS约1,115MiB；不修改运营参数，不等同于生产部署后的持续资源验收。
- 证据：`real-cache-replay.json`、`real-cache-replay-heap4096.json`、`downloaded-cache-hashes.json`、`source-regression.json`及`validation-summary.json`，均ignored，仅脱敏计数/hash诊断用于提交说明。

## 交付边界

确定缺陷和用户批准A2已编码、来源构建/1,200自动断言及真实缓存回放通过。总设计同步、共享MCP最终构建、最终全库类型、提交/推送/部署/安装与原生会话由主任务继续。**未在本分支工作中部署生产，不能把本地回放当线上已修复。** 原图/40+40人工验收仍按用户要求暂缓。

## 发布文档附注（独立文档步骤，写入前冻结）

主任务另授权v0.18.6发布草稿及两份README当前版本段。方案A：保留历史release，新增v0.18.6草稿作为本次范围/验证状态入口，README只更新已有当前段及发布链接。方案B：在两份README另加完整发布变更段，独立维护相同状态；可直接阅读，但容易造成三处事实不同步。采用A；不修改旧发布记录、运行版本、主计划或总设计。NF05指商品版次证据（FAQ中的其他Mild商品不能确定当前SKU版次），不是软件运行版本trace。

草稿仅描述现有工程日志证实的实现与局部验证。全套集成、提交/推送/发布、生产、安装及正式原生矩阵均待主任务填写；当前运行版本尚未调整时，README标v0.18.6候选。Woo准入仍在核验，暂不固定新总数。纯文档无需运行包构建，验证相对链接、保留历史、状态及git diff。

文档步骤完成：新增`docs/releases/v0.18.6.md`，两份README只更新当前候选介绍/链接，旧v0.18.5记录保留。3文件40个本地引用自动检查通过，`git diff --check`退出0。未改运行版本、总设计、主计划或发布状态；最终证据由主任务补齐。

## Plan v1.2 / B（“仅冲突”范围纠偏，实现前冻结）

主任务独立审查指出：v1.1把完全相同的跨源记录也隔离，虽在我冻结的C4断言中明写，但用户直接批准的是“仅冲突商品”，不能把实施细化当作额外覆盖损失的用户决定。当前真实530组均有差异，不影响原实证分母；未来完全一致记录仍应可用。

方案A保留v1.1，所有重复键隔离，代码最少但会隐藏无冲突商品。方案B对所有规范化compact字段计算有界指纹：完全一致只保留1份，任何版本不一致则该键全部隔离；不择价，同一源重复仍失败。主任务批准B作为原授权范围纠偏。

- B1：先红原完全相同重复案例及controller分母；补3源先同后冲突/先冲突后同、字段变化、顺序独立、同源重复和全部冲突失败。保留v1.1原失败与结果，不删除历史证据；controller旧“相同键即冲突”测试改用实际价格冲突，符合当前明确合同。
- B2：只改共享Feed扫描/收集器、service快照type、manifest可选`deduplicatedProductRows`及对应测试。输入行数=发布行数+全部冲突隔离行数+完全一致去重行数；去重行不得算作冲突行。保留80MiB扫描上限，仅存SHA256/键/计数，原严格merge入口不变。
- B3：取得source构建时隙后原子改动并立即source build，相关回归；共享MCP必须重建并由主任务最终串行集成。复跑同一50缓存，不重新下载生产或上游；真实分母应仍530/1060/70146，新增dedup=0。
- B4：修正release中“任何跨源重复”表述，README仅有“冲突隔离”无需改写；最终验证记录追加，不冒称部署通过。期间运行版本由主任务升至0.18.6，本步骤不改版本或图片资料。

### B5 调度终态与测试时钟竞态（新增冻结）

完整并行套件复现runtime旧缓存恢复测试失败。测试等manifest失败计数写盘即推进60秒，但控制器之后仍有缓存清理/refresh lock释放/Promise完成，runtime可能在推进后才注册补偿timer，造成假阴性。固定100×10ms轮询不是runtime完成凭据。

两案：A在runtime refresh.finally中清除active引用后发脱敏`awin_feed_refresh_settled`，提供feedStatus、quickRetryScheduled、consecutiveRefreshFailures，测试等原生终态信号再推进时钟；B仅spy setTimeout，但无重试阴性路径缺少明确结束信号。主任务批准A；生产延时、预算和重试选择不变。关闭时实际清除quickRetry引用，事件不能声称已安排；事件不含token、URL、商品或用户内容。先红终态测试→立即source构建→定向回归，根任务再跑完整套件。

### v1.2 / B 实施与复核

- B1先红：14项中10失败/4通过，真实完全一致条目被误删、全部相同时错误无商品，以及去重分母缺失；`identical-record-red.json`保存原结果。
- B2每行完整规范化compact字段按固定CSV序列计算SHA256；只保存键、指纹和数量。相同记录保留一份，有差异整键隔离，单源重复仍拒绝。快照/manifest的可选`deduplicatedProductRows`向后读取兼容，缺省不伪造历史分母。立即source build exit0，4文件24断言PASS，`identical-record-green.json`。
- 独立全库类型检查发现exactOptionalPropertyTypes拒绝schema可选number|undefined赋给窄快照属性。按旧manifest可能缺字段的真实合同补`number | undefined`，不改变运行值/序列化；再次立即source build及16相关断言PASS。最终全库typecheck由主任务重跑。
- 同一50份真实缓存按4GiB heap回放PASS：input71206、excludedGroups530、excludedRows1060、deduplicatedRows0、published/valid70146、35商家，严格守恒。archive SHA仍为`e15dbc9f74b943a3f5aadcacd232d71021961dc20fee4817945a7d356490f17d`。本次21.998秒、峰值RSS1,145,948KiB；与其他验证并行运行，不能据此证明串行性能或总体SLO。新证据为`real-cache-replay-policy-b-heap4096.json`，旧回放和512MiB失败保留。
- B修订后一次来源全模块30文件/1230断言中1229通过、1项runtime旧缓存快速重试失败；根任务同期全库207文件/4067断言中4062通过、5失败，其中2个runtime旧缓存案例与本竞态相关，其余3项由根及其他模块负责者处理。原文件分别为`policy-b-source-regression.json`和`remaining-completion/final-tests.json`，未覆盖。
- B5新增终态事件缺失的定向断言先红（1执行失败，其余7按筛选未运行），`runtime-settled-red.json`；生产finally先清active、在已确定调度后发终态日志，关闭清timer引用。立即source build及22项（runtime8+controller2+shared12）PASS；后补关闭期间503的负例，runtime最终9/9 PASS。删除提前读manifest/固定轮询同步，等待真实runtime终态再推进时钟，未增加生产延时或测试超时。
- B5后源码稳定交给主任务独立全库集成；release和README最终事实修正已移交主任务，需写“完全一致去重，真正冲突隔离”及已核实Woo1003，不再沿用初稿的任意重复隔离。图片准备已移交其他子任务，不在本步骤继续下载或建原生任务。
