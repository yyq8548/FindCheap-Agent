# 原生补搜授权：无弹窗即时拒绝的定位

状态：V5 只读诊断与记录完成；未修补 Codex 客户端，未通过原生弹窗正向验收。

适用总设计：[预算与授权](../../architecture/agent-design.md#7-预算补搜与结束条件)、第 10 节执行安全、第 13 节真实宿主验收。研发过程遵循[五阶段协议](../agent-development-protocol.md)。本记录补充[高评分、价格与选择改进计划](2026-09-07-high-rating-price-selection-followup.md)，不更改购物授权合同。

## Research：基线与事实

- 诊断日期：2026-09-07，美国东部时间；部分日志时间为次日 UTC。
- FindCheap 源码基线：`c8320e41a915b4ac2eb752cb7da4de3cca215cdc`，运行版本 `0.17.32`。同轮其他模块改动由主执行者推进，不属于本诊断的写入范围。
- 目标任务：[比较 medicube Zero Pore Pad 价格](codex://threads/01a07ec8-ed08-7460-843d-043b4052c840)。用户确认两次都没有看到授权弹窗。
- 实际桌面包：`OpenAI.Codex 26.901.6511.0`；该任务记录和当前运行 CLI 均为 `0.153.4`。
- 仅查询指定任务、对应时段诊断日志、安装代码与公开源码；没有复制完整聊天、用户图片、配置或凭据到仓库。

### 可复查证据

| 证据 | 观察 |
| --- | --- |
| 目标任务本地 JSONL 第 8、157 行 `turn_context` | 两个发生补搜的用户回合均为 `approval_policy=never`、`approvals_reviewer=user`、`sandbox_policy.type=danger-full-access`。其余回合策略相同。 |
| 同记录第 1 行元数据 | `source=vscode`、`thread_source=user`、`originator=Codex Desktop`、`cli_version=0.153.4`；不是自动化或子智能体任务。 |
| 同记录第 46、172 行工具输出 | 两个不同目标各一次：`PERMISSION_DENIED`、`formSupported=true`、`hostAction=DECLINE`、`durationMs=2`。 |
| FindCheap `server.ts` 的 `begin_web_search` | 使用标准 `mode=form`、必填 boolean `approved`，携带当前 `relatedRequestId`、取消信号和 25 秒超时。只有宿主实际接受且字段为 true 才签发短期许可。 |
| SDK `1.30.0` 的 `Server.elicitInput` | 标准 form 请求经 `elicitation/create` 发送；能力缺失或错误不会在本地被转换成 `action=decline`。 |
| 安装桌面主进程初始化函数 `hK` | `extensions` 只声明 `io.modelcontextprotocol/ui`；另有旧的 `mcpServerOpenaiFormElicitation` 布尔开关。没有声明 `openai/standard-form-input`。 |
| 安装桌面表单解析函数 `_S` | 普通 `mode=form` 可以进入 `formElicitation`，不是只能渲染私有 `openai/form`。 |
| 对应时段桌面日志与诊断数据库 | FindCheap MCP 正常 ready；没有记录该次拒绝的内部 guard 名称。缺少日志不是“没有执行”的证明。 |

安装产物 SHA-256（只用于版本绑定，不是运行时权限凭据）：

| 产物 | SHA-256 |
| --- | --- |
| 桌面 `app.asar` | `E75BAE2B8A02F174C7CEEED6D631AAFF355E44F8AF5C798FA3628089F11D659E` |
| 实际运行的 CLI `codex.exe` | `E5AA76D19C7C94E2E9EF9B707D590206A73AC0E97C8DDC8382181242494BEF75` |

ASAR 内容仅在内存读取，没有解包或修改。以下偏移是对应成员字符串的零基偏移，不是整个 ASAR 的绝对偏移：

- `.vite/build/src-VqXTPopo.js`：`hK` 初始化函数偏移 `956473`；`AC` 扩展常量偏移 `414888`，值为 `io.modelcontextprotocol/ui`。
- `webview/assets/app-initial-f87238153a19.js`：`_S` 表单分类函数偏移 `2492069`；全访问预设偏移 `2021841`，映射 `approvalPolicy=never`。
- 整个 ASAR 中精确字符串 `openai/standard-form-input` 不存在。初始化函数本身的字段检查是主要证据；不能仅凭字符串缺失认定运行行为。

### 同版本宿主源码链路

官方标签 `rust-v0.153.4` 经 GitHub tag/ref 解析到固定 commit `3d2ee51ca2d5db578f328aa75e20aa22c0197c9a`。以下均按固定提交核对，不以当前主分支代替安装版本：

1. [初始化处理器，74–77 行](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/app-server/src/request_processors/initialize_processor.rs#L74) 将客户端扩展及旧表单布尔传给规范化函数。
2. [客户端扩展规范化，16–45 行](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/codex-mcp/src/client_capabilities.rs#L16)：旧布尔只加入 `openai/form`，不会补出 `openai/standard-form-input`。
3. [协议常量，30–31、79–80 行](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/protocol/src/mcp.rs#L30)：标准输入扩展属于客户端内部能力，不向 MCP 服务端下发。插件不能替客户端声明。
4. [用户任务启动，2026–2035 行](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/core/src/thread_manager.rs#L2026)：只有客户端声明该标准输入扩展、任务来源为用户且非子智能体，才启用 Full Access 标准表单输入例外。
5. [授权路由，313–350 行](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/codex-mcp/src/elicitation.rs#L313)：非空普通表单必须先满足该例外；否则进入策略检查。该文件 [472–477 行](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/codex-mcp/src/elicitation.rs#L472) 将 `Never` 判为拒绝，在向 UI 发送请求前返回 `Decline`。
6. [官方 Full Access 表单测试，169–195 行](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/app-server/tests/suite/v2/mcp_server_elicitation.rs#L169) 覆盖必填 boolean；该测试在 [704–725 行](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/app-server/tests/suite/v2/mcp_server_elicitation.rs#L704) 显式声明标准输入扩展。因此 boolean 字段本身不是排除条件。这里只阅读官方测试，没有在本机运行其 Rust 套件。

### 根因判断与三个假设

| 排序 / 假设 | 预测与核对 | 结论 |
| --- | --- | --- |
| H1：全访问预设的非交互策略与桌面握手缺口组合阻断 | 若桌面未声明标准输入扩展，用户任务的非空 form 在 `never` 下于 UI 事件前被拒绝。实际任务策略、桌面初始化代码、同版宿主 guard 全部吻合。 | 已定位高置信度的具体兼容性原因，不再仅由 2 毫秒推测。 |
| H2：FindCheap boolean schema / 关联请求不合法 | 预期出现 SDK/协议错误，或宿主没有普通 form 渲染路径。实际为合法 DECLINE；同版官方测试支持 required boolean，当前代码也传关联请求。 | 当前证据不支持；不能靠改成私有表单协议猜修。 |
| H3：任务映射、UI 接收或用户点击造成拒绝 | 预期有错误任务身份、未就绪 MCP 或用户等待/操作证据。实际是正常用户根任务与 ready MCP；用户明确没见弹窗。 | 不能完全排除其他并发宿主问题，但无须它即可解释本次阻断。缺分支日志，保留原生正向复验。 |

结论：这版桌面能画普通表单，但没有为 Full Access 用户任务打开 CLI 所需的标准表单输入通道。任务又使用 `never`，因此请求在到达弹窗前被自动拒绝。`formSupported=true` 只证明 MCP 协议能力，不证明宿主策略允许展示。这不是用户点了拒绝，也不是 Awin、Railway 或商品链接造成。

边界：上述结论由安装代码、同版本官方源码和历史运行回执交叉定位；尚未拿到历史调用的内部 guard 事件，也没有进行交互策略 A/B 或实际弹窗正向测试。不能写成“已修复宿主”或“已确认下次会弹”。

## Propose：两条可实施的宿主修复路线

| 维度 | A：用户为测试任务选择交互授权策略 | B：修复该握手的官方桌面版本 |
| --- | --- | --- |
| 做法 | 用户手动选择允许 MCP 询问的任务模式；`on-request` 或明确允许该类提示的 granular 策略，仍由用户逐次批准。 | 官方客户端在兼容版本中正确声明标准输入扩展并完成自身 UI 接线。 |
| 收益 | 不改 FindCheap 协议；避开当前 `never` 拒绝路径，便于验证。 | 在 Full Access 下保留正常用户输入体验，无需为购物临时切模式。 |
| 风险 / 代价 | 模式可能同时改变其他权限提示或沙箱行为；必须让用户了解并自行选择，不能批量改全局设置。 | 新版可用性和是否包含修复本次未验证；升级也需真实验收，不能承诺安装任意最新版就解决。 |
| 回滚 | 用户恢复原任务设置；不把以前的拒绝转成授权。 | 按官方客户端发布与回滚机制；不手工篡改签名应用。 |
| 本轮执行 | 未执行；需用户选择与原生测试。 | 未执行；不修改或重打包 Codex。 |

推荐 A 作为最小验证步骤；B 为长期宿主解决路径。当前[官方配置参考](https://learn.chatgpt.com/docs/config-file/config-reference)确认 granular MCP 提示可以单独控制；[审批说明](https://learn.chatgpt.com/docs/agent-approvals-security#run-without-approval-prompts)说明 `never` 禁用交互提示。二者不能替代上述同版本分支证据。

不采用：删除必填确认字段以触发自动接受、冒充私有审批元数据、把聊天“同意”变成服务端许可、强行打开 Chrome、自动重试被拒目标、修改全局配置或签名桌面包。尤其不能把表单改为空对象：宿主存在空表单自动接受路径，无法证明用户作过确认。

## Plan / Implement：冻结 V5 的执行范围

| 步骤 | 范围与验证 | 结果 |
| --- | --- | --- |
| V5.1 | 从指定历史输出构造确定性的只读 RED 分类；只提取状态、能力、动作和耗时。 | 两次均定位 2 毫秒 DECLINE，诊断断言返回 RED。未向商家或原任务重新请求授权。 |
| V5.2 | 核对安装客户端握手、同版 CLI 源码及官方文档；逐项排除假设。 | 找到缺失标准输入扩展与 `never` 拒绝的完整静态调用链。 |
| V5.3 | 保留事实、两案与未验证边界，仅新增本记录。 | 本文件；无运行源码、配置或安装产物写入。 |
| V5.4 | 运行既有授权回归、文档结构/链接/空白检查。 | 见下表。 |

纯文档局部构建：N/A，无运行产物。本子任务只写本文件；不覆盖同轮其他智能体的源码、测试或构建改动。

## Test：证据与未完成项

| 验证 | 结果 / 能证明什么 |
| --- | --- |
| 历史回放分类，Node 读取指定 JSONL 行 46、172 | RED，可稳定检测“支持 form 却立即 DECLINE”；历史回放不是修复后的活体测试。 |
| `pnpm exec vitest run apps/mcp-server/test/web-product-recovery.test.ts apps/mcp-server/test/snapshot-identity-consent-regression.test.ts` | 2026-09-07 22:54 NY，2 文件 / 51 项通过，退出码 0。证明插件对拒绝、取消、能力缺失及派生目标停止的处理；不证明原生弹窗。 |
| 同版官方 Rust 表单正向测试 | 只读了测试与初始化条件，未运行。 |
| 原生交互策略 A/B / 用户实际看到弹窗 | 未执行；待用户选择测试任务模式后验证。 |
| 实际 Chrome 补搜 / 报价 / 商家副作用 | 未执行，不在本诊断范围。 |
| 文档结构、本地相对链接、末尾空白检查 | Node 自动断言通过：四个协议章节、本地链接、空白与未验收边界；`git diff --check` 退出码 0。未跟踪新文件的空白由 Node 独立检查。 |

没有提交、推送、版本升级、Railway 部署、安装缓存替换、宿主配置修改或真实授权自动接受。本轮主改进的发布状态由主记录另行报告。
