# Windows 安装器：保护范围覆盖 marketplace 变更

## Research

基线为已推送的 v0.18.6 提交 `a565913`。本轮只修改 Windows Install／Test PS1、安装器 README 和本文；不修改运行 bundle、主工程记录，不再次真实安装、重启宿主或更改权限。开始时另有图片性能文档未提交改动，保留。

已读 AGENTS、研发协议及总设计第8节的任务重启恢复约束。实际安装日志 `artifacts/remaining-completion/actual-installer.log` 显示：16:43:04 先执行 marketplace upgrade，16:43:09 才备份 cache，然后 plugin add 因 Access denied 失败。主任务同时确认 marketplace upgrade 已切换 installed 到18.6、新建 canonical 并清除旧 cache；备份只剩14个新版文件，旧18.4宿主入口已空。日志本身证明先后顺序；目录变化为同轮主任务实际检查结果，不根据命令名字推断。

调用链：CMD→PS1主入口→独立 marketplace upgrade／fallback add→计算 CacheRoot→Install-CodexPlugin 内备份→plugin add→finally恢复。保护开始过晚。现有行为测试仅把 Invoke-Codex 当作单次 plugin add，不区分 marketplace 与插件阶段，未覆盖此真实路径。

备份／恢复现有不变量保留：精确旧文件哈希、拒绝越界和 reparse point、只恢复缺失文件、保留并报告并发修改、不覆盖新版本；CLI失败不是安装成功。安装器为 PowerShell5.1可直接执行脚本，无 MCP 构建消费者。构建验证采用 PS5.1语法解析和 PS1／CMD DryRun；行为测试只从 AST 载入函数，使用新隔离临时目录及按命令分派的 CLI 替身。

## Propose

| 方案 | 保护范围 | 成本与限制 |
| --- | --- | --- |
| A：单一备份及恢复范围 | 先计算CacheRoot并备份，随后在同一 try/finally 内 marketplace upgrade／fallback add／plugin add | 一个原始快照覆盖首次变更，改动小；中途失败仍恢复，保留CLI与恢复错误 |
| B：每个变更分别备份恢复 | 每次 marketplace 或 plugin 命令前后单独保护 | 多次复制和恢复，容易在后阶段只保留已经变更的快照；实现与失败分支更多 |

主任务已批准 A。无业务或权限变化、无新依赖。恢复既有旧入口保护的是当前运行宿主，不代表它已加载新版本；成功仍须原 installed/enabled 与分发哈希校验及用户重启新任务。

## Plan（实现前冻结）

1. 扩展 Test-Installer：按完整 CLI 子命令分派，模拟 marketplace 阶段删除旧配置／runtime及创建新目录，然后插件成功／非零失败；另验证 fallback add失败、命令异常、恢复冲突不覆盖主CLI错误。旧行为必须出现对应红失败，不能用任意异常满足预期。
2. CacheRoot计算前移；将 marketplace 与 plugin add 纳入 Install-CodexPlugin 的同一备份及 finally范围。保留每段CLI输出与非零错误，不把所有 upgrade 非零错误解释成未安装。若恢复也失败，同时报告原操作和恢复错误。
3. 立即 PS5.1解析、隔离行为测试及 PS1/CMD DryRun；不执行真实安装。README同步先备份再变更顺序；installer补丁版本更新，不改变产品版本或MCP产物。
4. 保留红/绿日志；git diff --check，交主任务第二提交。本子任务不提交、不推送，不清理或覆盖用户实际缓存。

## Implement / Test

首次红测试已记录 `artifacts/remaining-completion/installer-marketplace-guard-red.log`，PS5.1 exit1：预期 plugin exit13，实际明确报 plugin add 未经过受保护 marketplace 阶段。CLI替身按完整命令分派；未把无关异常当通过。

### Plan A 修订：跳过已经完成且严格验真的重复安装（实现前冻结）

主任务补充实际证据：marketplace upgrade 自己已安装并启用当前包，重复 plugin add 才触发锁错误。沿用 A 的同一备份／finally：marketplace 操作返回成功后先调用现有 Get-InstalledPluginVersion，只有 installed/enabled、版本 manifest、分发完整清单及逐文件SHA全部通过才跳过 plugin add。校验失败记录原原因，再执行原安装路径；不使用目录标签、版本号相等或模型布尔代替哈希证据。最终主入口仍再次校验，不把 CLI失败说成成功。新增测试以真实 Test-InstalledPlugin 校验隔离旧包／坏hash／disabled与精确新包，只有精确新包允许跳过。此变更无真实安装操作，由主任务后续验收。

### 实现与结果

- Installer 1.2.1：CacheRoot 在主入口任何 marketplace 操作前计算。Install-CodexPlugin 一次备份覆盖 upgrade、fallback add、严格状态验真及必要 plugin add；任一阶段异常执行缺失文件恢复。primary CLI错误保留；若恢复冲突或失败，也在同一错误中报告，不覆盖新目录或并发修改。
- marketplace upgrade 非零时保留 exit值并写入 WARN，再尝试已配置 GitHub marketplace add；不再把所有非零错误解释为未安装。严格验真失败同样保留其具体原因。最终 installed/enabled 与全量哈希校验保持。
- Windows PowerShell **5.1.26100.9444**：AST解析及隔离行为测试 exit0。新增11场景：插件 exit13／成功、fallback成功／exit9失败、upgrade／plugin原生异常、插件失败叠加恢复冲突、精确最新包跳过add、旧版／坏hash／disabled不跳过。原恢复、并发文件、清单、哈希、状态、越界和junction断言同时通过。
- PS1 `-DryRun` 和 CMD `--dry-run` 均 exit0，展示 installer1.2.1及新顺序。CMD原有“Installation complete”尾文也会在 DryRun显示；这只是脚本输出，不记录为真实安装成功。
- `git diff --check` 通过（仅既有Git换行提示）。未执行 MCP构建、真实CLI安装、宿主重启、权限修改或真实cache写入；真实新包安装及运行版本验证由主任务继续。

证据均为 ignored artifact：`installer-marketplace-guard-red.log`（exit1）、`installer-marketplace-guard-green.log`、`installer-marketplace-guard-ps1-dryrun.log`、`installer-marketplace-guard-cmd-dryrun.log`，位于 `artifacts/remaining-completion/`。实际旧失败 `actual-installer.log` 原样保留，未以修后隔离测试替换。

独立审查 `/root/sony_fix` 只读核对，无新增可复现缺陷：确认备份覆盖首次变更、异常均恢复、双错误保留，旧版本／disabled／清单哈希不匹配不会跳过，真实入口末尾仍再校验。证明范围是升级后本地 marketplace 分发一致；远端更新仍依赖 marketplace CLI，不能凭本地哈希声称 GitHub远端最新。审查未安装或修改文件。
