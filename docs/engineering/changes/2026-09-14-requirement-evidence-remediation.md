# 2026-09-14 要求证据与结果一致性修复

状态：**v0.18.8 本地候选代码与可自动验收范围通过；发布交付执行中。** 代码基于 `02db6fbd622d96c9f3e4319146ab4771d90fd12a` 开始修改。本记录不改变原始审查分母，也不把宿主依赖或暂缓人工验收记为通过。

v0.18.8 本地 MCP bundle SHA-256：`EFB0147CDA58A3B82D20E2948318DFCA7D982F88BDF217831D3065098E91430D`。

## 问题与结果

修复前公共 MCP 探针中，正例可通过，但三个负例被错误判为 `READY / SATISFIED`：明确 `not waterproof`、所选 8 片却借用父商品 70 片描述、16GB/256GB 却满足 16GB/512GB。修复后原四个样本 4/4 符合业务预期，三个负例均不再进入首选，正例仍可推荐。

本次实现的是共享规则，不是给三个商品加例外：

| 规则 | 权威实现 | 自动验收 |
| --- | --- | --- |
| 否定、AND/OR、多数量、单位类型 | `product-constraint-matcher.ts` | `requirement-evidence-contract.test.ts` |
| 所选规格优先、当前标题/描述边界、冲突保留 | `product-requirement-evidence.ts` | `requirement-evidence-contract.test.ts` |
| 必选、排除、偏好共用证据 | `product-requirements.ts` | 要求合同与来源一致性测试 |
| Shopify、Awin、Woo及恢复/比较一致 | 统一要求评估入口 | `source-requirement-parity.test.ts` |
| 返回计数、研究卡含义与模型回执一致 | `search-result-summary.ts`、`model-context.ts` | `model-context-replay.test.ts` |
| 快照投影与任务状态职责拆分 | `product-snapshot-projection.ts`、`product-snapshot-state.ts` | 全量快照、权限、并发与恢复回归 |

## Research → Implement

- **Research：** 保留修复前 `public-mcp-probe.json`；确认错误发生在通用条件解析、证据作用域及最终投影之间。
- **Propose：** 沿用现有产品事实、来源适配器和公共工具合同，只增加共享证据层并抽出两项纯快照职责。
- **Plan：** 按 P0–P6 顺序处理否定、组合、数量、所选规格、多来源复用、输出一致及职责整理。
- **Implement：** 数量不再只判断第一项；裸数字保持未知；所选规格优先于父商品可选项；矛盾保留 `CONFLICT`；研究卡结构化定义为“保留候选，并非已排除或已核验”。
- **Test：** 先固定原失败，再逐项红绿。真实 Woo 验收发现 `6-Pack` 海绵数量词未覆盖，先得到失败，再扩展共享 count 单位并验证 `6 pack` 通过、`1 sponge` 拒绝。

## 自动验收

| 范围 | 结果 | 证据 |
| --- | --- | --- |
| 要求与证据合同 | **PASS 20/20** | 否定、组合、多数量、单位、选中规格、冲突、排除与偏好 |
| 跨来源与全流程 | **PASS 4/4** | Shopify/Awin/Woo真实数据形状；搜索、恢复、比较 |
| 原公共 MCP 四样本 | **PASS 4/4** | `artifacts/architecture-review-2026-09-14/public-mcp-acceptance.json` |
| 真实 Woo 商品要求 | **PASS 2/2** | `live-woo-requirement-acceptance.json` |
| Woo Store API 实时集成 | **PASS 3/3** | 当前公开 Store API 搜索、查商品、价格与图片 |
| Woo 性能分段 | **PASS 1/1** | source-off P95 0.359ms；cold P95 1751.291ms；warm P95 0.722ms；9 次实际 GET，0 超时 |
| MCP stdio | **PASS 5/5** | 最终构建产物启动与工具合同 |
| 全量测试 | **PASS 215 files / 4184 tests** | `full-test-final.log` |
| build / typecheck / lint | **PASS** | 最终候选源码与分发包 |
| 原生性能采集器自检 | **PASS 15/15、32/32** | 文字与图片采集器结构/口径自检 |
| 通用数据库集成 | **BLOCKED** | 本机 `127.0.0.1:5432` 无 PostgreSQL，返回 `ECONNREFUSED`；相关 Woo 实时集成已单独通过 |

全量测试曾暴露三个既有回归并已修复：不同计量类型不再误判为同一组选项；14 英寸显示屏不再与机身宽高混淆；测试优惠券有效期改为固定远期日期，避免测试随日历失效。

## 尚未计为通过

- P8 已获用户明确授权，版本冻结为 `0.18.8+codex.20260915013729`；提交、推送、Release、Railway部署及安装缓存结果以发布记录为准。
- 最终安装候选尚未固定，原生 30 个文字任务与 6 张开发图片未运行；运行已安装的旧 v0.18.7 不能证明本次代码。
- 用户已要求继续暂缓 medicube 原参考图及 40 个业务任务＋40 张真实图片人工标注集。
- 任务删除事件和通知送达 ACK 仍依赖 Codex 宿主接口。
- 工具可约束结构化事实，宿主最终自由文本与真实 UI 动作仍需最终安装版原生验收。

## 结论

P0–P6及 P7 中可自动执行的代码、合同、真实 Woo 和采集器自检已完成。没有已知的可控代码失败。整体 Agent 仍不能称全部验收完成，原因是发布未授权、最终安装版原生矩阵未运行、人工集继续暂缓及两项宿主能力缺失。
