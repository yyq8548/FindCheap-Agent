# 9/9 剩余问题继续实施

## 当前状态：R3 本地集成完成，交付待执行

最终候选包 `0.18.6+codex.20260909214736` 已完成构建、typecheck、lint 和默认全套验证：`final-tests-r5.json` 为 **209 文件／4097 PASS／0 FAIL**。MCP SHA256 为 `af828bf8d1a821d535b7207e2ca69c81f73e9db812a0e1c2ccce9d0fc9c05502`；source bundle 未变化，SHA256 为 `9981ab1dc9c751c55e8092ea0eb4b3fd5b9d26888793847707f62fe087131ff0`。R3 运行代码／测试／包已提交推送 `3d6ac6e`；最终安装、CI 和原生验收尚待，下方 R2 安装／原生证据保留为历史，不代表该候选已安装验收。

NF08 精确链接身份及审查新增回归已修：显式替代仍是研究替代、跨店已确认同款可在原商家同父商品显式换规格、Shopify 源 ID 与 URL variant 矛盾拒绝；Woo 私有锚点严格持久恢复通过，公共输入不能注入身份。29 项新增、11 文件 199 项相关断言及两次独立复核 7＋1 项全通过。F02 的 Woo 服务重建缺陷已修，真实桌面勾选／重启仍待验收；NF08 原生验证仍待最终安装。NF09 已补原有视觉参数限制说明，不放宽校验。NF07 用户未答，不实施策略变化。

来源生产已经闭环：自然配额恢复后一次同 SHA 部署 `58ce1060-5b38-4876-840e-a08df5f57d20` 在 `2026-09-09T21:09:58.718Z` 发布新 Awin 快照，70,146 商品／35 商家；71,206 输入减 1,060 冲突行，530 冲突组、50 源、stale 0、连续刷新失败 0。首次配额失败保留，未改配额／账本；R3 无须再次部署未变化的来源服务。

## Research

- 基线 main `7401b6d8a4e31b7b7b68cfbd2381f642ac334736`，v0.18.5，开始时工作树干净。用户要求继续全部完成并在不确定决策时确认；2026-09-09 再次明确 F09 原图与 F15 40+40 人工标注继续暂缓。此前提交、推送、部署、安装和独立原生 Astra Ultra 测试授权继续有效。
- 范围：主计划 F03/F04/F07/F08/F10/F11/F13/F16、NF01–NF03，以及 F02 原生恢复和 Windows 安装升级问题。F07 涉及原图的分支随 F09 暂缓，但可独立核对公开 SKU 证据。
- 总设计第 4–10、13 节保持有效：身份、预算、信任、来源拒绝、实际用户同意及宿主权威回执均不能通过降级门槛核销。
- 查询、Awin 刷新、宿主合同分别在独立工程记录研究和冻结方案；本记录负责依赖和最终交付。
- FACT：安装器 `installers/windows/Install-FindCheap-Agent.ps1` 直接执行 `plugin add`，失败即退出，没有备份与恢复；`Get-InstalledPluginVersion` 以最近修改的任意缓存 manifest 判断安装版本。既有真实 CLI 失败证据见上一轮工程记录。当前 `plugin list --marketplace findcheap-agent --json` 提供 installed/pluginId/version/enabled；读得当前版本 `0.18.5+codex.20260909191446`。
- FACT：入口 CMD 下载单个 PS1；Windows CI 目前只有解析与 DryRun。安装器修改不得要求额外运行依赖；应保留单文件分发。
- UNKNOWN：运行中 Desktop 是否自动刷新路径；当前没有可调用的 Desktop reload API。缓存一致、CLI 成功与 stdio 成功不能证明宿主已加载。

## Propose

| 方案 | 行为与收益 | 风险、代价、回滚 |
| --- | --- | --- |
| A：安装器内保护 | 调用官方 CLI 前精确备份本插件原缓存；调用后恢复丢失的旧文件，不覆盖发生变化的文件；按 CLI installed 状态验证当前版本及分发内容。保留单文件入口。 | 多一次有限文件复制；备份留存可恢复；不能修复外部 Codex 内部实现或替代重启。修改集中在安装器及 Windows 测试。 |
| B：先隔离下载，再由安装器完整分发 | 在隔离 CODEX_HOME 中用官方 CLI 准备新包，检验后复制新版本，再在用户环境注册。避免下载与旧缓存共用阶段。 | 两套 marketplace/config 和注册流程；用户环境注册仍可能触发相同外部 bug，因此仍需备份。增加状态迁移和维护成本。可回滚至原入口。 |

选择 A。用户已授权修复和缓存替换，不改变插件权限、宿主策略或用户数据；不将旧路径自动改写成新版本，不把恢复过程称为成功升级。

## Plan（冻结 R1）

| 步骤/依赖 | 最小增量、接口和不变量 | 构建与断言 | 通过条件 |
| --- | --- | --- | --- |
| I1 / 无 | 单文件安装器增加受限路径的备份/缺失恢复和安装包装函数。仅本插件版本目录；拒绝重解析路径；保留旧字节，不覆盖已变化文件。 | PowerShell Parser + CMD/PS1 DryRun；PowerShell 行为测试先红：CLI 清空旧包并失败、成功升级后旧入口丢失、已有变化文件、越界/链接。 | 原文件可恢复；失败仍失败；新文件不被旧版本覆盖。 |
| I2 / I1 | 以 `plugin list` 精确 installed/enabled/version 记录核验 canonical manifest 和 marketplace 分发文件哈希，移除 mtime 推断。 | 同一安装器构建；断言旧 manifest 更新时间更近、禁用/缺文件/哈希差异不报安装成功。 | 真实安装状态与包内容一致；宿主加载仍单独验收。 |
| Q / 独立 | NF01 按独立冻结计划修复 query/兼容性。 | 由 sony_fix 独占 MCP build；相关回归后交还锁。 | 原反例及身份负例通过。 |
| A / 独立 | NF02 按独立冻结计划修复 Awin 刷新。 | woo_price 独占 source build；来源回归。 | 原错误被解释并修复，生产刷新新快照或如实保留外部阻塞。 |
| H / 独立研究 | F02/F03/F04/F13 核对真实宿主合同、准备目标和可执行测试。 | 禁止模型伪造用户/宿主 ACK。实现步骤另行冻结。 | 可支持部分有真实回执；改变合同必须先取得用户选择。 |
| B / Q、A 与空闲执行槽 | 同规格跨店、Woo 相关类别/来源故障、Peet’s 定向原生回归。 | 固定查询、版本、来源与失败分母；不绕安全拒绝/授权。 | 取得实际候选/比较证据，或确切说明缺失事实以便用户决策。 |
| P / 最终运行候选 | 冻结 F16 原生重复样本、冷暖/并发条件与时钟边界后执行。 | 全部采样含失败，不以 API 计时替代用户回合。 | 输出分组 P95、90/180 秒达标情况与未执行范围。 |
| R / 集成通过 | 更新主计划、总设计实现状态、README、release；按既有授权提交/推送/部署/替换缓存。 | 最终构建、typecheck/lint/相关完整测试、CI、生产 SHA/健康、缓存逐文件/stdio/原生版本。 | 各交付独立证据齐全；不将暂缓或宿主阻塞写作完成。 |

## Implement / Test

下列为先前 R1／R2 实施和交付过程；当前候选以开头 R3 状态及后文 R3 门禁为准。首次失败与每次修正保存在 `artifacts/remaining-completion/`。

### v0.18.6 R1／R2 本地门禁（历史）

统一版本为 `0.18.6`，包 `0.18.6+codex.20260909202818`。版本模块立即 MCP 构建及231相关断言通过；最终两包构建通过。首次全库 typecheck 暴露可选去重字段类型与两个 JSON import attribute，已最小修正；首次默认 suite 为207文件、4062 PASS／5 FAIL，三个旧版本/商家数/canonical断言和两个 runtime测试时钟竞态均保留。runtime测试改为等待真实脱敏 `awin_feed_refresh_settled` 终态后推进时钟，关闭时不报已安排重试，不增加生产重试/预算。最终 typecheck、全库lint加后续变更定向lint、207文件／4068断言全部通过；Windows PowerShell5.1安装行为测试通过。

最终日志为 `final-*-r2`；初次 `final-tests.json` 与 `final-typecheck.log` 保留。MCP SHA256 `8eb0247d61adaafe3bb67608f48d582ffbd296ae00001db4161696c984a03b8d`，source SHA256 `9981ab1dc9c751c55e8092ea0eb4b3fd5b9d26888793847707f62fe087131ff0`。外部PostgreSQL integration不在默认分母，本轮未改数据库或迁移。原生30文字回合、图片开发回合、部署与安装仍独立执行；当前门禁不核销这些项。

### R3 门禁与新增反例记录

URL 身份修复及独立审查范围、两案、红绿保存在 [NF08 记录](2026-09-09-shopify-url-identity-followup.md)。真实 Glossier 精确 URL 的 Trio／Quintet 错误研究卡仍保留原生失败分母；本地修复不能替代最终安装后的原生复验。Woo 真实注册 MCP 搜索→SQLite 保存→关闭服务→同可信任务重建→render 原引用已通过，跨任务读取拒绝，不等于 UI 选中或桌面重启通过。

全库 `final-tests-r3.json` 为 208 文件、4083 PASS／2 FAIL，均为新增技能说明超出原字数预算；压缩后的 `final-tests-r4.json` 为 209 文件、4095 PASS／2 FAIL，均为等义连接语 via／using 与静态合同锁定的 through／with each 不同，安全规则未删除。恢复合同原文后技能为 7177 UTF-8 字节，没有改预算或测试断言。`final-tests-r5.json` 为 209 文件、4097 PASS／0 FAIL；`final-typecheck-r4.log`、`final-lint-r4.log` 通过，两个分发 bundle 的 SHA 与预期一致。早期 r3/r4 和局部失败不删除，也不计作原生结果。默认分母不含外部 PostgreSQL integration，未修改数据库迁移。

R3 运行代码／测试／包及 URL 工程记录已由主任务提交推送 `3d6ac6e`，本阶段四份发布文档另行提交；安装逐文件验证、安装版 stdio、CI、新任务版本和购物原生验收待主任务执行。F09/F15 用户暂缓、F03/F04 宿主依赖、F13 真实授权表单、F16 最终候选固定性能矩阵仍分别保留；NF07 用户待决策不能默认批准。

### 现场安装 R2（改动前冻结）

运行提交 `a5659136bea8255c11925eeafd06cd94ddcaf35c` 已推送。实际安装的marketplace升级已经把installed状态和canonical缓存更新到18.6，再进入原备份步骤；因此本次备份仅含新18.6的14文件，不能保护升级前宿主旧路径。后续plugin add仍Access denied，错误保留。扩大保护至首次marketplace mutation前由独立Windows步骤修复，不强制关闭应用。

此外，当前工作树与官方marketplace在plugin.json及三个技能reference文件仅换行不同，字节哈希仍确实不一致。方案A将已存在的LF分发合同扩大到本插件所有文本文件；方案B按平台生成不同校验值，无法实现跨平台同一分发字节。采用A：`.gitattributes`仅限定本插件路径为`text=auto eol=lf`，统一14个现有文本分发文件；自动文本识别不把未来二进制当文本。更新包cachebuster，运行模块构建和分发/stdio合同；不改变脚本语义、权限、来源数据或降低哈希检查。原哈希差异与CLI错误保留，发布后再由官方marketplace重新获取并逐文件验证。

### 后续用户决策

现场R2后续真实交付：`bea1c85`已由主任务提交推送，installer1.2.1于21:01Z真实成功。先备份 `23b9e7cb4f274e098c0377c160d70a23`，再marketplace upgrade；严格验证新包 `0.18.6+codex.20260909204729` 后跳过冗余plugin add，finally恢复R1旧入口全部14文件，末尾installed/enabled和全量分发哈希再次通过。`actual-installer-r2.log`与原 `actual-installer.log`分别保存成功／首次失败。主任务随后独立兼容同步3目录42文件为R2，原安装备份留存；`installed-cache-verification.json`逐文件一致，`installed-stdio-r2.json` 5／5 PASS。兼容同步不是安装器自动覆盖行为，stdio不是原生UI验收。详细顺序及独立审查见[安装保护记录](2026-09-09-installer-marketplace-cache-guard.md)。

原生功能任务21:02Z已使用searchTrace.buildVersion0.18.6：Sony同款比较任务 `01a087fa-648c-7783-ac92-5f904a1909d0` 已取得两个真实商家及SAME_PRODUCT_OFFERS、199美分价差；Glossier报价准备任务 `01a087fa-8793-7201-a995-d4b25d9dc0cf` 精确Espresso检查成功，尚未触发报价/购物车/授权表单。后者同时暴露精确URL锚点未保留导致Trio/Quintet两张研究卡混入，独立记录并修复；不能把本任务整体写为F13全PASS。两个回合66.563／69.142秒是功能回合事实，不并入尚未启动的正式文字性能矩阵。

- 用户明确选择：自动删除与通知送达确认保留原设计目标，标为宿主依赖；完成所有插件可控修复。独立连接未收到其他连接删除事件的实证不能用 not-loaded 猜测替代。
- 用户明确选择：Awin 只隔离跨 Feed 冲突商品的全部版本，保留其他商品与商家。当前审计530组不是硬编码上限或固定名单；每次刷新按实际冲突重算，单 Feed 内重复仍遵守原严格校验。证据和实施见 Awin 独立记录。

### Windows I1/I2 局部结果

- I1 首次行为测试退出1：旧安装器没有受保护安装入口。补备份/恢复包装后，立即 PS1 DryRun（PowerShell 解析及完整入口加载）退出0、恢复行为测试退出0。覆盖失败与成功 CLI 均删除旧入口、恢复保留精确旧字节、不同版本不覆盖、并发改变不覆盖、路径越界拒绝。
- I2 首次测试退出1：原安装器没有 installed 状态/分发校验入口。补精确 pluginId/installed/enabled/version 与 marketplace 文件 SHA256 后，立即 DryRun退出0、完整 Windows PowerShell 5.1 行为断言退出0。覆盖缺文件、哈希差异、非法版本、目录 junction。CMD DryRun退出0。CI 新增同一行为脚本。
- 后续补强：发现首个文件冲突不能阻止其他缺失文件恢复；改为保留并汇总冲突，完成其余恢复后仍退出失败。立即 DryRun及完整测试再次退出0。
- 独立审查补强：新增额外 skill 文件的反例先退出1（旧校验错误接受），再补完整文件清单数量及既有逐文件验证；立即 DryRun和完整行为断言退出0。未知额外文件不会被自动删除。
- 真实只读核验当前安装18.5：精确版本读取正确，但 marketplace 与手工修复缓存的 `deals-and-watch/SKILL.md` 哈希不同，因此正确拒绝报完整一致。已核实源工作树/兼容缓存为3688字节（27个CR），marketplace为3661字节（LF），同一7401b6d源版本。下一版分发时统一 Git 属性规定的 LF 后再逐字节核验，不削弱哈希检查。没有在本步骤改运行缓存或声称Desktop刷新成功。

### 业务来源事实更新（只读，未算原生验收）

- 2026-09-09：[medicube美国官网原版页面](https://medicube.us/products/zero-pore-pad-1) 明示 AHA/BHA、70 Pads、SINGLE选项；页面 FAQ 提到 Mild 是另一款。现读文本没有原版净重。不能因为描述推荐 Mild 就把原版判为 Mild，也不能从共享描述或运输重量推断155g。
- [Ulta原版页面](https://www.ulta.com/p/zero-pore-pad-pimprod2053434?sku=2645351) 明示70ct、item2645351、原版AHA/BHA配方，为同款零售来源线索；净重仍需对应包装证据。网页研究不自动注入已冻结搜索快照，也不证明插件已完成跨店比较。
- [QVC包装PDF](https://static.qvc.it/p/media/temp/manuali/217319_medicube.pdf) 后续已用本地Poppler完整渲染并目视确认：原版ZERO PORE PAD、AHA/BHA、155g/70pads、EAN8800256119066。源PDF SHA256为 `66f2ef6ad7d996dd7aeca5eba68f0b2c8ddbd796ef1f01bfeaa55afcd06ed329`。美国官网当前SINGLE变体40542710825008/SKU PMEUS10002A00/EAN8809921779215与该欧洲包装条码不同；不能跨SKU借净重，也不能把JSON的weight318当净重。证明原版155g/70pads确实存在，不证明用户暂缓的原图或当前美国每个SKU已对应核验。
- [Best Buy黑色WH-1000XM5页面](https://www.bestbuy.com/product/sony-wh-1000xm5-wireless-noise-canceling-over-the-ear-headphones-black/6505727) 明示型号WH1000XM5/B、SKU6505727、Sold by Best Buy，为F08第二商家线索；必须经正式读取和同快照比较取得当前价格/货况，网页研究不等于已完成原生比较。

### R3 实际安装与 CI

运行提交 `3d6ac6e6f2ec00c1d80cebe997a5f0fd2b1a4057` 的 plugin CI `34409785468` 与 Windows CI `34409785463` 均成功。installer1.2.1 于21:58:40Z先备份 `528b48ead21646efa9fecb58a5552cb6`，再 marketplace upgrade；21:58:45Z核验 R3 安装启用、跳过冗余 add，并恢复3个旧入口。随后按既有授权兼容同步4入口56文件，与源及marketplace每个分发文件逐字节一致。R2证据另存 `installed-cache-verification-r2.json`；R3为 `installed-cache-verification-r3.json`，未覆盖原失败。

实际 canonical R3 路径经 FINDCHEAP_PLUGIN_ROOT 传入 stdio，21:59:10–21:59:18Z执行5/5 PASS；命令、环境绑定、包/MCP SHA、起止时间和退出码记录在 `installed-stdio-r3-binding.json`。原生新连接及UI/表单继续独立验证；本步骤不强制退出桌面，也不改宿主审批配置。source bundle未变，不重复部署。
