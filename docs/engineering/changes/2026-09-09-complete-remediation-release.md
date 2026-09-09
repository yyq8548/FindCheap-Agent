# 9/9 剩余修复与发布

## 授权与范围

用户已明确要求完成剩余修复后提交、推送、部署或替换安装缓存。后续答复“先不管这个”暂缓 medicube 原图及 40 业务/40 图片人工标注集，相关 F09/F15 验收不阻塞本轮工程交付，不伪造通过。其他代码、来源及可执行验证继续推进。保留工作区已有未提交修复。

基线：main `be989855`，已安装 v0.18.3。上轮默认测试 187 文件 3834 项；不能替代当前修改验证。遵循总设计及研发协议。

## Research / Propose

F01：本机 Codex CLI 为 0.153.4，对应官方标签源码在真实调用链使用 `with_mcp_tool_call_ids_meta` 注入请求 `_meta.threadId`，并非模型工具参数。源码证据需要补实际入站请求。

| 方案 | 验证能力 | 风险和代价 |
| --- | --- | --- |
| A：在完整购物插件中加入诊断后重载 | 覆盖目标插件 | 需改当前安装，容易混淆旧进程与新包 |
| B：同版本真实 Codex 运行最小只读 MCP 探针 | 独立验证宿主实际注入，空参数排除模型传入 ID | 仅是宿主协议测试，之后还需购物插件集成验证 |

先 B 后插件集成。测试宿主仅执行固定探针调用，不委派编码、调查或自主工作，不读取购物状态，不提交、不购物。独立临时工作目录，探针只保存客户端版本及 threadId/itemId/callId 元数据，不记录其他请求或环境。

## Plan v1（执行前冻结）

1. 运行只读真实宿主探针，核验元数据入口；然后冻结 F02 存储/恢复和 F03/F04 宿主合同。没有实际证据，不将假任务 ID 注入产品运行路径。
2. F02 在既有执行器和状态边界接入，保留并发、引用、短期授权、来源预算和最小本地数据。存储及消费者按独立模块先红测、实现、立即 `pnpm build:mcp` 与相关测试。
3. 来源准入/诊断逐模块验证，使用真实商家 API 和商品页，不授予未经审核的信任。完整保留失败分母。
4. 更新 README、版本/release 及计划状态；构建两包，typecheck、lint、默认完整测试、必要 integration/真实源和安装 stdio。
5. 提交、推送并核对远端/CI；部署现有 Railway 服务并核对运行 bundle 哈希与健康；更新版本化缓存、安装状态与文件一致性。真实宿主验收独立记录，暂缓材料不算通过。

后续模块的事实、替代方案及细节计划在修改前追加。

## F01 真实证据与 F02 冻结合同（Plan v2）

本机 bundled Codex 0.153.4 的空参数 MCP 探针真实收到 `_meta.threadId`。持久测试任务 `01a086a4-1fcf-7fb0-bad7-f04f740b75b6` 重新启动 MCP 进程后 ID 相同；另一个任务 ID 不同。客户端 `codex-mcp-client`。本机官方 app-server `thread/read(includeTurns=false)` 和按该测试 cwd、全部 sourceKinds 查询 `thread/list(archived=false/true,useStateDbOnly=true)` 可验证任务状态；默认 sourceKinds 不包含 exec，不能据默认查询误判删除。原始探针保存在忽略的 artifacts/qa-9-9/host-probe。

F02 两案：每个任务创建完整服务器实例会复制注册及传输层；在已有执行边界使用 AsyncLocalStorage 绑定任务容器，仅替换状态容器，不重写业务流程。采用后者。并发来源、同任务 UI 更新与报价撤销继续可执行；不同任务容器隔离。

持久层两案：每任务 JSON 需要跨进程锁与崩溃锁恢复；Node 24 内置 SQLite 可提供事务、修订 CAS、校验与删除墓碑。采用 SQLite（本机用户目录、WAL、版本 1、SHA-256、单任务 8 MiB、30 日保留、最多 500 任务）。不保存聊天、原图、授权 token、SearchRun、Promise 或运行预算。载入历史不重新生成引用，不延期价格有效期。旧短期卡片可作为需求续接历史；过期检查/报价仍拒绝并要求重新检索。恢复网页预算关闭，不能重新获得旧授权。

仅 stdio 入口启用可信 Codex 元数据绑定；未提供可信任务身份的连接仍使用独立易失容器，不读取任何持久任务。保存失败、格式损坏、CAS 冲突必须明确失败，不悄悄覆盖或宣称已保存。保存最少需求、快照、选择及比较；显式清理当前可信任务，不能以模型参数指定其他任务。先存储反例与重启/隔离集成，局部构建通过后再处理生命周期。

## F03/F04 合同边界与 Plan v3

真实 app-server 测试已完成正常、归档、取消归档、删除：归档标志在官方 `thread/list` 的 active/archived 结果间转移。删除后 `thread/read` 只给 `-32600 thread not loaded`；该错误本身不能区分删除、尚未持久化、索引故障。不能凭它自动删除用户数据。官方当前 JSON schema 没有 Automation 发送/送达 ACK/停止 API；应用 Automation view 只返回渲染卡片的文本，不提供可验证送达回执。故不得伪造 ACK 或通过模型参数确认送达。

生命周期两案：使用私有聊天数据库/未公开应用 IPC 猜测通知及删除，存在兼容与权限风险；使用当前官方 app-server 元数据查询，只对已验证状态采取动作，未知保持待核验。选择后一案。先实现新 Watch 的可信任务归属和跨任务隔离、已确认归档暂停及 STOP_REQUIRED；取消归档不自动恢复。无可靠删除证据时保留待清理状态，主动清理入口仅清当前任务购物历史。旧无归属 Watch 不根据某个模型传入 ID 自动迁移，也不删除原文件。正式发送/停止 ACK 仍需宿主支持，不能用本地状态当完成。

实际原生 MCP 搜索验收被宿主 `MCP tool call requires approval, but approval policy is never` 拦截；历史读取工具可调用。保留失败分母，不修改宿主审批策略绕过。工具内存/真实进程测试与原生宿主端到端结论分开。

## F10 真实来源检查与选项价格修复

12 个候选公开端点已检查：10 个不可准入（404、402、重定向、网络错误或非 JSON），Recool Hair 与 Silent Sound System 返回真实商品。Recool SKU 407531 的 Store API 声明 simple/has_options=false、174.70 USD；同一商品页实际要求 Length 16/18/20/22/24 inch，并单列 Total options，标题 200% 与详情 180% 也矛盾。这个来源不能把 API 起价当选定长度价格。

方案比较：排除整家可避免错价，但继续保留假发零相关来源；搜索准入且对已核实有额外选项的商家使用已有 UNKNOWN 价格/库存合同，可提供研究链接并阻止精确比价与可靠库存 Watch。采用第二案。注册表增加可选 requiresOptionSelection，明确商家覆盖和证据；原 API has_options=true 同样收敛。默认商家行为不变，未知证据不授予信任。先增加反例，再实现、立即来源构建及局部测试；最终使用默认安全 reader 验证，而不是用简单 fetch 的 200 当准入完成。

### Watch 崩溃锁补充

源码检查发现旧 `.watch-store.lock` 使用创建文件占锁，进程若在锁内退出，遗留锁无法可靠判断拥有者；不能按年龄偷锁。两案：给锁文件补 PID/时间仍可能误判复用 PID；新任务命名空间使用 SQLite 内核事务锁，进程退出自动释放。采用后者，仅用于新增 task-watches-v1/<可信任务ID>，旧无归属目录保留原协议，不混用锁协议或擅自迁移旧监控。新数据用原 JSON 原子保存及 CAS，SQLite 只承担跨进程互斥。新增崩溃及并发测试，构建 MCP 后验证。

## Release freeze

Choose v0.18.4 patch over v0.19.0: additive history tools and repairs keep existing shopping/source APIs. Freeze plugin 0.18.4+codex.20260909154800, product cards v45, comparison v15. Update explicit version expectations before consumers, build both consumers immediately, then full checks. Existing source-only history is retained below the current results. A native-model open-world search was blocked by host approval and is not bypassed using direct app-server UI calls. Official UI-call source also injects trusted threadId; actual UI rendering/approval acceptance remains separate.

The first bundled-stdio check found two failures: the expected tool inventory needed the two history tools, and the new lifecycle guard incorrectly rejected legacy non-Codex Watch clients. Restricted the host lifecycle guard to trusted task-bound calls, preserved legacy behavior, and added a real-process restart/clear test with explicitly synthetic host metadata. All 5 stdio checks passed after correction. This is not a real model approval or notification test.

## Final local verification

Both builds, typecheck and lint passed. Default suite: 194 files / 3857 assertions passed. Separately enabled real Woo integration: Root Science, Burrow Press and Scrub Daddy search + exact lookup, 3/3 passed. Bundled stdio 5/5 includes real process restart/clear with synthetic metadata. Default tests exclude PostgreSQL integration and source-performance probes; no unrelated database migrations were executed. Native metadata/lifecycle facts are summarized in [host-task-protocol.json](2026-09-09-host-task-protocol.json). Native-model search approval failure remains blocked, not passed. Original image/labeled acceptance sets remain deferred by the user.

The full candidate run initially had 3852 PASS / 5 FAIL: skill byte budget, fixed version regex, the merchant expansion denominator and a hardcoded tool index. Fixed the actual skill size by moving history instructions on demand; kept the original budget. Updated expectations and selected the actual search tool by name. Final 3857/3857 passed. Earlier abort test and non-Codex Watch compatibility failures are recorded above. Release/production/cache results follow in the version release record.
