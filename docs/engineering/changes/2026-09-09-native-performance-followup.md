# 原生回合性能验收方案

## Research

总设计第7、13节要求包含模型、宿主、工具的完整回合，并区分主动处理和用户等待。以往只有5个场景和单次最终回归，不能推断P95。实际Desktop rollout提供 `event_msg.task_started`、`task_complete.started_at/completed_at/duration_ms/time_to_first_token_ms` 和每个MCP `item_completed` 的真实耗时、trace版本。已经只读核对 `01a0879d-ceb1-7c30-bb54-4bcecc88132c`，完整回合64,109ms。

新任务不等于生产来源冷缓存；无法从任务创建推断上游cache状态。应分别记录“新任务首回合”“同任务后续回合”和观测到的cache状态，未知不伪标COLD。初次模型首token通常只是操作说明，不默认算有业务价值的阶段结果。任务卡片的首次真实产品结果与最终回复分别计时。

## Propose

| 路线 | 优点 | 局限/成本 |
| --- | --- | --- |
| A：固定原生任务矩阵 | 正式App创建任务、Astra Ultra、真实来源；可读取同一宿主回执和计时，不替换宿主。新任务和同任务独立商品请求分别采样，另跑并发2。 | 耗时较长；不能强制清除共享生产缓存或把结果解释为所有负载的SLO。 |
| B：长期真实回合自然采样 | 不额外施加负载；覆盖正常用户模型与选择行为，可按真实cache状态分层。 | 等待足够正常流量，样本/任务复杂度不可控，无法在本轮确定完成；可保留作为后续生产观测。 |

采用A，原生任务矩阵属于用户已授权的自动实测。不创建购买、Watch或Cart副作用；授权弹窗等待另在专门验收任务记录。B不作为本次小样本的替代成功证据。

## Plan P1（采样前冻结）

- 固定最终候选版本、包SHA、生产source SHA、Astra Ultra、当前本机权限、来源开关。实现仍变更时不开始正式候选计时；先完成单项原生回归。
- 文字：三组各10回合，共30个完整原生回合。S组新任务顺序执行；W组使用对应任务的下一回合但搜索不同商品；C组另外10个新任务并发2。每组同一5个查询各2次。默认不手工清上游缓存；因此只在证据确认时使用缓存冷/暖标签。
- 查询冻结：①黑色全新Sony WH-1000XM5，350美元以内；②Nespresso Original兼容胶囊咖啡，40美元以内，不要散装咖啡粉；③中度烘焙整豆咖啡，30美元以内，不要磨好的咖啡粉；④蓝色Nalgene 32oz宽口水壶，全新，30美元以内；⑤原版Scrub Daddy海绵单个，10美元以内。W组循环移位使用下一种商品，以免重复重试终止的安全/授权目标。
- 每个请求正常执行技能和来源策略。保留澄清、零结果、来源失败、拒绝、超时、取消和未执行的原分母；不得为了计时重复申请授权、刷新预算或降低身份约束。初始search遇终止必须如实结束。
- 180秒图片路径另做开发样本计时，先冻结可访问的公开商品图片与校验值再执行；不使用暂缓的原medicube图、不将模型判断标成人工真值或算入40+40验收。
- 对每组输出完成数、失败数、版本符合数、P50、nearest-rank P95、最大值、90秒内最终回复比例、90秒内真实阶段结果比例。10个样本的P95等于该组最大值；这是固定矩阵的观察结果，不给没有统计依据的总体保证。
- 总墙钟由宿主started_at至completed_at；已确认用户等待另扣，并原样保留总墙钟。工具耗时有重叠时按区间并集，不直接相加；缺开始时刻时用结束减duration估计并显式标注。剩余墙钟包含模型和宿主调度，不能强行拆出不可观测部分。
- 验收收集器先用冻结的已完成历史回合验证时间字段和去重逻辑，再读正式任务。收集脚本不改变运行包，Node syntax检查及固定时间断言作为自身验证。
- 未达目标时定位最长回合真实阶段，在对应工程步骤修复后保留原样本另跑相同矩阵；不删除慢样本，也不把接口速度冒充回合速度。

## Implement / Test

尚未开始正式候选采样。图片开发计时样本仍待冻结，不计作已执行。

## 收集器 C1（实现前冻结，独立开发artifact）

- 只解析Desktop原始rollout的`event_msg.task_started/task_complete/item_completed`，MCP只认`item.type=McpToolCall`，不从模型文字或转述tool output推断计时。按thread/turn ID和call ID去重；保留文件末尾未写完整行，并标记未完成回合。
- 任务显式manifest须提供30个文字样本位置（S/W/C各10）、threadId、从1开始turnIndex、queryId、预期版本和包SHA。未创建threadId可空，仍计NOT_RUN。实际包SHA需独立安装证据`observedPackageSha256`，缺失则UNKNOWN，不用expected冒充observed；每次搜索trace的buildVersion另核对。
- 优先精确host item起止毫秒，缺起点时以结束减`duration.secs+nanos/1e9`估计并标注。工具duration与区间并集分开；task_complete.duration_ms为完整回合时长依据。首token、首次MCP实际商品结果、最终AgentMessage完成分别保留，零结果不伪记为商品阶段成功。
- 只扣manifest中明确已验证的用户等待区间；未观测等待标UNKNOWN。重叠工具算并集，剩余模型/宿主不可再拆。完整回合P50/P95以有完整时长样本计算并同时公开原计划分母与完成时长分母；每组完整10个时nearest-rank P95=max，不构造总体SLO。
- 自测先固定重叠/重复/末尾partial/未完成/错误版本例，再以历史`01a0879d-ceb1-7c30-bb54-4bcecc88132c`断言完整64109ms、search duration6.1548266秒。开发artifact只跑Node syntax和self-test；不会创建任务或改变产品运行包。

### 收集器 C1 实现与验证

`artifacts/remaining-completion/native-performance-collector.mjs`已实现。`node --check`、`--self-test`的15类固定断言和`--historical`全部exit0。固定断言还涵盖失败工具和未运行样本保留分母、非MCP原生CommandExecution/FunctionCallOutput区间与MCP区间合并，未从任何命令内容/模型文本推断耗时。

历史核验结果：完整回合64,109ms，首token3,933ms，最终回复完成63,967ms，真实search duration **6.1548266秒**；该回合0商品/3项来源失败，因此首次商品结果为null，不把工具完成或开场白当商品阶段成功。历史真实trace为0.18.5，但无该回合独立安装包SHA证据，packageHashMatch及已知用户等待均标UNKNOWN。输出只含时间、状态、计数、标识和版本/cache信息，无提示词、凭证或商品内容。

正式输入合同：顶层`{samples:[...]}`，可选`sessionsRoot`；每条为`{threadId,cohort,turnIndex,queryId,expectedVersion,expectedPackageSha256}`。`turnIndex`从1开始，cohort仅S/W/C；每组固定10条、5个queryId各2条，原样保留未创建任务（threadId=null）。独立安装校验后可填`observedPackageSha256`，工具trace buildVersion仍独立检查；不把该manifest提供的hash说成MCP每回合自报hash。

确认用户等待时，可提供`userWait:{status:"KNOWN",intervals:[{startMs,endMs,evidenceId}]}`，时间为绝对epoch毫秒、evidenceId为对应人工或宿主确认记录标识。缺省为UNKNOWN，不自动扣trace内部预算或模型自述等待。工具统计输出MCP并集和全部已观测原生工具并集，缺耗时保留未知；剩余墙钟为未分类模型/宿主/未知等待，不宣称进一步拆分。

执行：`node artifacts/remaining-completion/native-performance-collector.mjs --manifest <显式manifest.json> <计时输出.json>`。未完成/无法读取/版本不符均留在原30位置；完整时长百分位另给timingDenominator，90秒比例使用计划thresholdDenominator。尚未执行正式30回合，不把历史验证算入候选性能结果。

## 图片开发计时 I1（准备前冻结）

根任务授权从已保存真实公开商品证据准备3图，每图2个独立原生回合，总6回合，180秒目标；本步骤只准备，不创建任务。选用已经观察到的PNG URL：Sony黑色WH-1000XM5零售卡图片、Glossier Espresso所选变体图片、Allbirds Natural Grey商品图片。第三图采用已有明确商品JSON的Allbirds，避免为了凑Scrub Daddy新增未知图片请求；Allbirds图片不证明尺码5。

方案A：新任务提示给本地图片绝对路径，要求先调用宿主view_image获得实际视觉内容，再走search_visual_candidates/finalize_visual_search；可用已有create_thread的prompt合同，计时包括读图，但不代表原生附件上传测试。方案B：由真实支持附件的宿主输入创建图片任务；可核验附件UI路径，但当前create_thread工具schema只有prompt/target等字段，没有附件字段。采用A作为独立开发计时，B保留宿主附件输入依赖。

分发compare skill要求先观察图像、visualInput只传观察/softClues，通常省略imageUrl；工具schema不要求attachment ID，明确禁止将本地路径放入imageUrl。因view_image会把真实本地图像送入模型上下文，A在成功读图后可满足视觉证据合同；这仍是需在正式回合核对的推论，不冒称附件已存在或该宿主已通过。读图失败不得以文件名、来源说明或预置商品身份替代视觉观察。

下载仅使用已记录URL、现有safeFetch的DNS/host/大小/超时守卫，每URL一次，保留失败而不绕过；不改图、不转换格式、不清共享缓存。记录来源JSON、公开商品URL、图片SHA、PNG尺寸及获取时间。商品源事实与图像模型观察分开，不能当作人工标注真值、F09原图或F15的40+40集。

### 图片准备 I2 修订（新图片获取前冻结）

I01 Sony、I02 Glossier 已由安全读取取得 PNG 并固定哈希；本子任务实际 view_image 均成功读入模型上下文，仅证明本机图像可读，不是原生新任务验收或人工真值。I03 Allbirds 首次读取失败，旧脚本仅保存泛化 IMAGE_READ_OR_VALIDATION_FAILED，未保留错误细节或 HTTP 回执，原因未知；不重试该 URL、不改DNS／代理／请求头或同商品替代路径。

主任务批准选择独立公开商品图补第三个开发输入。新 I04 取已有 `artifacts/release-v0.18.4/installed-live/coffee.json` 的 Purity FLOW Original Medium Roast Whole Bean Coffee 产品卡图片，URL 和来源哈希按原记录固定。它是另一商品的资料准备，不是重试 Allbirds 或之前失败购物目标。仍使用 safeFetch 的原安全策略，一次 GET，不调整图片。

原 6 个位置及 I03 的两个 NOT_RUN 位置完整保留，另增加 I04 两位置；准备记录共 4 图、最多 8 个曾计划位置。只有三张可读图和输入合同核对完成后，再列出本轮拟执行的 6 个开发回合（I01／I02／I04各2）；同时公开 I03 的准备失败及未运行位置，不能称其已执行或删除原分母。若一次原生回合安全／授权拒绝，不能利用第二个新任务重试同一图像目标；第二位置保持未运行并记录前次终止原因。

### 图片 I2 准备完成与输入合同

三张成功 PNG 的下载均为原 URL 的单次 safeFetch GET、HTTP200，未经编辑或转码；本准备任务随后实际调用 view_image 显示三图。新 I04 是 Purity 独立商品，首次获取成功；未重新读取失败的 Allbirds 图片。

| 图 | 尺寸 | SHA-256 | 准备结果 |
| --- | --- | --- | --- |
| I01 Sony | 1200×1050 | f55a9858fb8a0032cf2f094739012c741619c893027daaeafe3c36d0e46dc018 | READY；view_image 已实际显示 |
| I02 Glossier | 1374×1722 | 5a3e5979a50a1bebe622935be33b1ed3f166a85c8f1f4a0420697b087298496c | READY；view_image 已实际显示 |
| I03 Allbirds | 未取得 | 无 | PREPARATION_FAILED，原因未知，未重试 |
| I04 Purity | 2048×2048 | 2776294089bd59aecf2e5418944bb3a0a6e2849b39fd7bb417e0613e3e18aa8c | READY；view_image 已实际显示 |

工具合同核对：分发 compare skill 要求先观察图片，调用 search_visual_candidates 后复核返回图片并 finalize。`VisualProductInputSchema` 要求至少一个真实观察属性，imageUrl 可省略，不需要 attachment ID；其 URL 字段只能用公开 HTTPS，不能传本地路径。`create_thread` 只有 prompt／target 等字段，没有附件字段；因此输入方式明确标作 LOCAL_PATH_VIEW_IMAGE。实际本地 read→image 输出支持当前准备方案，但新原生任务仍必须出现自己的真实 view_image 输出，才可进入视觉搜索。读取失败时不能根据文件名、来源商品信息或预置观察继续；不能称原生附件上传通过。

`image-development-manifest-v2.json` 保留原文件，追加 I04，冻结六条不含商品名的提示及顺序：I01-R1、I02-R1、I04-R1、I01-R2、I02-R2、I04-R2；Astra Ultra、并发1，每回合目标180秒。原8个曾计划位置全部保留，其中6拟执行、2因准备失败NOT_RUN，目前原生执行数0。源URL、源JSON及哈希、图片文件及哈希独立记录，正式提示不给这些商品身份事实，不作人工真值。

正式执行前仍需绑定最终安装的 `installedCompareSkillPath`、预期／独立实测包SHA、生产source SHA。每回合计时包含宿主读图、视觉检索、逐图复核／finalize、最终答复；澄清、零候选、来源失败、拒绝、超时或取消均保留。六个小样本可报告本矩阵耗时分布和180秒内比例，不推断总体P95，也不计入F09原图或F15人工40+40集。现有文字C1收集器只接受S/W/C矩阵，不能不加说明地把图片位置塞进文字分母；图片回执另列六个执行位置及两个保留未运行位置。

准备脚本与冻结器仅为 ignored artifact。`node --check`、固定三图SHA／PNG尺寸检查、原失败位置保留及提示无预置商品名断言均通过；未创建原生任务，未改运行代码或分发包。

### 图片收集器 I3（实现前冻结）

方案A：为图片建立独立入口，复用C1的`analyzeTurn`时间、原始MCP事件与版本核对，再增加图片读取及视觉工作流的可观察回执。方案B：将图片加入C1文字分组；会改变已冻结S／W／C分母和90秒目标，故不采用。选择A，仅改ignored收集artifact和本小节，不改运行包，不创建任务。

输入固定为`image-development-manifest-v2.json`的8个位置，6拟执行和2准备失败NOT_RUN全部保留。180,000ms同时报告全部8个保留位置与6个计划执行位置的阈值分母；完整时长分布仅采用有宿主完成时长的回合，并公开该分母。图片结果不并入文字矩阵，不给总体P95、人工正确率或F09／F15验收分数。

只按显式threadId／turnIndex流式筛取原始宿主任务、工具完成事件及必要工具回执；不输出提示词、聊天文本、商品字段、图片字节或URL。`view_image`必须有同一回合实际工具执行与图像内容回执，调用文字／模型自述／准备任务成功均不能替代。宿主未保存图像输出时标为未观察到，不推断图像读取成功。`search_visual_candidates`与`finalize_visual_search`只认原始`McpToolCall`完成事件，按callId去重，分别记录调用、失败、候选图输出计数和工作流状态；只有search而无finalize、没有图像输出、澄清、零候选、来源失败、拒绝、未完成及未执行各保留原因。

总回合、首token、首次真实商品结果和最终回复分开；工具区间复用C1并集规则，只有明确等待证据才扣除等待。独立安装包SHA与实际搜索trace版本分别判定，缺证据标UNKNOWN，错误版本不计为合格候选。先固定时间自测未运行／准备失败／无图像回执／仅search／正常finalize／失败／重复／跨回合／错误版本边界，再跑Node语法检查和无threadId的manifest演练；正式采集等待主任务提供真实任务ID。

### 图片 I3 收集器实现与验证

独立入口`artifacts/remaining-completion/native-image-performance-collector.mjs`已实现，复用C1的`analyzeTurn`与区间并集；没有修改文字收集器或运行包。宿主真实读图格式另按两个明确callId核对：I04的原始`custom_tool_call exec`只有一个顶层`await tools.view_image`，随后把该常量的`image_url`发射；相同callId的原始output有1个图像块。I01／I02同一次exec有2个读图和2个图像块，只证明组级输出，单图归属标UNKNOWN。此处使用现有TypeScript AST解析开发脚本，不执行脚本，也不把输入文字含有工具名当作调用证明；动态或不支持的包装形式保持未确认。

同一正式回合的单图路径绑定、实际图像输出和先于视觉搜索的顺序分别记录。参考图读取采用宿主原始调用／输出时间区间，并与C1已观测工具区间求并集，避免重叠或双计；图像显示可能由宿主缩放，输出像素不强行与输入PNG哈希相等。`qualifiedTimedCompletion`仅表示版本／包证据匹配、图像链路与最终答复可观察且没有失败工具，不是图像匹配正确率或人工业务验收。

固定自测26类和`node --check`通过，包括包装文本不算调用、多图归属未知、未执行／准备失败、无图像输出、仅search无finalize、候选图缺失、错误版本、缺包证据、重复／跨回合、180秒边界、流式回合选择、末尾partial、忽略compacted历史、后续聊天不读取和错误session拒绝。完整清单演练保留8个NOT_RUN（其中6拟执行、2准备失败），完成时长分母为0；正式原生执行仍未开始。

首次辅助宿主格式核验失败保留：脚本最初只按callId筛行，误命中之后的`compacted`历史行，未捕获的JSON解析错误使该行片段进入工具错误输出。未将原聊天／图片写入证据工件。辅助脚本已改为先限定外层`response_item`、收齐指定两对即停、所有错误脱敏；正式收集器同时明确跳过compacted历史，并加入固定反例。修正后的真实格式核验通过，不能描述为全程无误。脱敏失败摘要与最终验证记录在`image-collector-validation.json`。

执行入口：`node artifacts/remaining-completion/native-image-performance-collector.mjs --manifest <已绑定真实任务的图片manifest.json> <图片计时报告.json>`。输入仍须保留原8个位置；已运行条目要求明确threadId／turnIndex／预期包和输入图哈希，独立实测包哈希缺失则UNKNOWN。报告只保留标识、哈希、时间、状态、计数及原因，不复制提示词、商品、路径、URL或图片内容。全部8位置与6计划执行位置各自给180秒阈值分母，失败原因单独计数；图片不进入S／W／C文字统计，也不计算总体P95。
