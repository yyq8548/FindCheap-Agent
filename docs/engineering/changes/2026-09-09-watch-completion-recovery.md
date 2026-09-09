# Watch 补货事件恢复

## Research

用户要求继续完成 9/9 改进计划。基线仍为 v0.18.3 / `be989855`，工作区包含上一轮尚未发布的修复；保留全部已有改动。适用总设计第 8、9、13 节。

- FACT：`evaluateWatch` 先在 `watch-store` 原子保存 COMPLETED、completionEventId 和 STOP_REQUIRED，再返回补货消息；再次读取 COMPLETED 时不返回原通知内容。进程在保存后、返回前退出会留下无法恢复的通知内容。
- FACT：内存及 JSON 存储共享 `WatchRecordSchema` 和 `nextRevision`，已有 CAS、删除墓碑和文件大小限制。`check_watch`、`list_watches` 是相关 MCP 消费者；默认构建入口为 `pnpm build:mcp`。
- FACT：RESTOCKED 是一次性任务，每个 Watch 最多一个完成事件；其他条件持续检查，不改变其行为。原子事件可与终态放入同一记录，无需独立数据库事务。
- UNKNOWN：目前没有在插件 MCP 中可验证的宿主消息送达 ACK 或调度停止 ACK。模型返回一个事件 ID 不证明已送达，不能提供模型可调用的伪确认接口。

## Propose

| 维度 | A：单独的待交付事件文件 | B：事件与一次性完成记录一起保存 |
| --- | --- | --- |
| 崩溃一致性 | 需额外事务或写前日志协调两个文件 | 复用现有一次原子写入和 CAS |
| 状态及删除 | 额外扫描、保留和删除规则 | 跟随已有 Watch 记录及删除墓碑 |
| 代价与范围 | 可扩展通用事件队列，当前不需要 | 仅补齐一次性补货事件，不增加依赖 |
| 宿主限制 | 仍需要真实交付 ACK | 同样需要真实交付 ACK |

选择 B。持久化事件 ID、生成时间、原消息及原观察，状态明确为 DELIVERY_UNCONFIRMED。后续检查可恢复同一事件，但不再次发出 TRIGGERED、不当作新的库存事实、不宣称已通知或已停止。不引入 ACK 权限、自动通知或重复重建任务。

## Plan v1（实施前冻结）

1. 存储合同：新增可选 completionNotification，只允许与 COMPLETED、RESTOCKED 和相同 completionEventId 绑定。已有事件不可删除、修改或换 ID；旧记录缺字段继续可读，不伪造历史事件。先公共存储反例，立即 MCP 构建与存储回归。
2. 评估模块：补货触发时同次保存终态和通知；后续检查保留终态，恢复原事件及历史时间。先保存后丢回执的反例，再修改，立即 MCP 构建与 Shopify/Woo Watch 回归。
3. MCP 消费者：check_watch 暴露可恢复事件，list_watches 仅增加交付未确认状态。事件内容是历史来源数据，不是通知指令。同步分发说明，先合同反例，再实现、立即构建和合同回归。
4. 最终：typecheck、lint、默认完整测试、stdio 冒烟、diff 检查；更新计划和总设计的部分完成状态。实际宿主送达、去重和停止仍需真实证据，F04 不整体勾选。

兼容和回滚：新读者接受无事件的旧记录；旧版严格读者不认识新字段，禁止旧写入器与新版并行。回滚须保留有事件的状态文件，不删除字段以换取旧程序启动。不修改用户已有 Watch 文件，仅在隔离测试目录验证。

## Implement / Test

- 存储合同：新增 8 项反例在旧合同上全部失败；增加事件绑定与不可变校验后，MCP 构建通过，5 文件 53 项存储测试通过。
- 评估模块：两个丢回执/原子事件反例先失败；修复后 MCP 构建通过，4 文件 70 项回归通过，包括 Woo 的固定商品/变体来源。
- MCP：原事件回执反例先失败；修复后构建通过，4 文件 42 项回归通过，包括本地 bundle stdio 冒烟。
- 真实进程故障注入：隔离目录中在 `store.save` 返回后直接 `process.exit(23)`，未返回 TRIGGERED；随后启动两个新的仓库 bundle 进程，均从 `check_watch` 恢复相同事件 ID、原消息和原时间，状态保持 COMPLETED / DELIVERY_UNCONFIRMED。来源夹具是合成数据；进程退出、磁盘读取和 bundle MCP 回执是真实执行。见 `artifacts/qa-9-9/watch-crash-recovery.jsonl` 及同目录脚本。
- 最终 typecheck、lint 通过；默认完整测试 **187 文件、3834 项通过**，不包含 integration 套件。日志前缀 `artifacts/qa-9-9/watch-notification-`。
- 没有运行真实通知、停止调度、报价授权或归档删除；没有改动已安装缓存、生产服务或真实用户 Watch。F04 更新为部分完成，仍未通过整体验收。

## F01 调查更正

上轮仅检查启动配置及 SDK 类型就写“没有可信任务身份注入”，证据不足。2026-09-09 进一步读取 [Codex 官方 MCP 调用实现](https://github.com/openai/codex/blob/main/codex-rs/core/src/mcp_tool_call.rs)：`with_mcp_tool_call_ids_meta` 把服务端会话的线程 ID 写入请求 `_meta.threadId`，与模型传入工具参数中的 threadId 不同。该函数被实际 MCP 调用链使用，不只存在于日志层。

本机可执行程序报告 `codex-cli 0.153.4`。尚未采集目标桌面插件的实际入站请求，也未验证同任务重启和不同任务的元数据稳定性。最新上游源码不能单独证明本机宿主已具备该行为；F01 应记为“发现正式候选接口、目标运行时待核验”，而非“宿主没有接口”。归档/删除事件、可信状态查询及通知/停止 ACK 仍需分别验证。

前述事实更正不允许直接把模型参数、环境变量或测试客户端传入的 ID 当作宿主认证。没有部署诊断版缓存或建立临时新任务；当前修复依然只作用于仓库源码。
