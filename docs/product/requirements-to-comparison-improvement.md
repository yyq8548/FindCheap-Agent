# Requirements-to-comparison implementation

Approved scope: September 5, 2026. Baseline: `56d670a` / 0.17.16.

## Contract

Keep the existing Backend adapters, execution boundary, SearchRun budgets and
immutable selection snapshots. No persistent product directory, new crawler or
checkout is authorized. The original implementation approval was local-only;
Chris separately authorized commit, push, Railway production deployment and
installed-cache replacement on September 5, 2026, for release 0.17.17.
Chris owns product acceptance. Production checks remain separate from local tests.

Milestones:

1. Bind continued requests to bounded, expiring requirement contexts; never use
   a process-global latest request. A budget update must not erase requirements.
2. Normalize size by category, reject explicit hair/style conflicts, distinguish
   missing evidence, and inspect up to four exact products at concurrency two
   inside the existing search budget before publishing variant-specific cards.
3. Replenish based on qualified candidates, not unknown cards. Carry bounded
   Awin requirement evidence through the existing API without a second index.
4. Gate the official tier on requested brand; reserve the trusted tier for
   independently verified merchants. Ratings never establish merchant trust.
5. Keep requirements, variants, prices and evidence together in immutable
   snapshots consumed by cards and comparisons. Never silently remap selections.
6. Add conversation, contract, failure, safety, visual and performance regression
   checks; report live-source limitations separately from deterministic results.

## Gates and recovery

- Zero hard-conflicting recommendations, wrong-variant price/link combinations,
  or unverified merchants labeled trusted in the regression set.
- Preserve same-source identity, host checks, budgets, comparison price basis,
  coupon scope, locale, immutable references and visual review boundaries.
- Same fixed workload: P95 and feed memory candidate/baseline ratio <= 1.20;
  measure before claiming performance acceptance. No second resident feed index.
- Known six-image development examples are not held-out accuracy evidence.
- Failures preserve valid old snapshots. Unknown data remains unknown; exhausted
  bounded search does not prove absence. A release requires separate approval.
- Rollback uses 0.17.16, which does not read the rejected local catalog.

## 实施与核验记录 — 2026-09-05

本地实现已完成；真实商品覆盖与生产发布不等于代码验收。

| 项目 | 已实施 | 核验 |
| --- | --- | --- |
| 需求继承 | 显式 parentRenderId；预算续问保留大类、长短、直卷等条件；可显式撤回或替换；澄清也保留快照 | 两个原对话的合成回放、缺失引用、旧快照、澄清续问通过 |
| 规格证据 | 区分鞋码/屏幕；选中规格优先于商品系列描述；MATCHED/CONTRADICTED/UNKNOWN/CONFLICT | US/EU/裸数字、长短/直卷、颜色、超预算规格通过 |
| 有界补检 | 最多 4 个商品、并发 2，使用原 SearchRun；按满足要求的数量补充结果 | 并发、次数、超时、原始数据不被修改通过 |
| Awin | 最多 1200 字符证据；长短/直卷筛选先于返回上限；首轮协商能力，兼容旧 API | 新旧客户端、真实本地 HTTP 服务、廉价短发占位反例通过；未增加第二份索引 |
| 分层 | 无指定品牌不显示官网层；人工核验的已批准 Awin 商家保留可信资格；其他来源只按唯一的同域商家证据关联 | 不按商家名称、子域或商品评分认证；QVR 不再标可信；待核验单列 |
| 快照与对比 | 单一明确规格更新生成完整新比较快照；多个规格仍需选择；旧 ID 不改写；比较继承需求版本 | UI 选择、换规格、价格/链接、旧引用可用、混用 ID 拒绝通过 |

换规格还会清除旧 SKU/GTIN、旧 Cart 报价及不适用图片。商品 JSON
没有币种时，仅接受原商品页面对应规格的 USD 报价；不把其他币种
数字标成美元。商家没有证据时保持未知，不使用按国家猜码或换算表。

真实接口检查发现并修复：文本经 Unicode 规范化后可能超过证据字段
上限，触发 TOOL_OUTPUT_REJECTED。现先规范化/隔离再截断；执行层仍
严格校验，并只记录 schema 字段路径和原因码，不记录原始商品文本。

### 自动检查

- 全量测试：941 项通过，0 失败，包含执行安全边界、旧图片流程、
  商家域名验证、Cart/优惠口径、快照隔离及 stdio 冒烟测试。
- `pnpm typecheck`、`pnpm lint`、`pnpm build:mcp`、
  `pnpm build:awin-feed`、`git diff --check` 通过。
- 最终卡片/对比页面已在本地浏览器检查：需求摘要、中文核验状态、
  待核验分组、高评分但商家未核验标签均显示。商品图片加载未在此
  UI 预览中测试；预览主动禁止外网图片请求。
- 本地测试报告：`artifacts/requirements/tests.json`。

### 性能检查

命令：`node --expose-gc scripts/benchmark-requirements.mjs 56d670a`。
两个独立进程，66,000 条合成 Feed 行；15 轮预热后 100 轮相同的
wig / ballet flats 查询组合。不是生产延迟或真实图片召回率测试。

| 指标 | 基线 | 本轮 | 比率 |
| --- | ---: | ---: | ---: |
| 查询组合 P95 | 328.15 ms | 205.48 ms | 0.626 |
| 索引常驻堆 | 97,584,016 B | 97,579,608 B | 1.000 |
| 进程峰值 RSS | 476,024,832 B | 522,338,304 B | 1.097 |

均在 1.20 上限内。新增长直发筛选单独测得 P95 742.40 ms；候选
进程峰值还包含这组额外查询。不能据此声称生产网络搜索变快。

### 真实接口结果与剩余边界

使用本轮本地构建的 stdio 插件，调用现有只读 Awin/Shopify 接口。
最后一次三次调用均成功，约 1.03–2.59 秒；记录位于
`artifacts/requirements/live.json`，不包含任何用户图片。

- 长发 + 直发 + $100，随后只改成 $30：两个属性继续保留；达标
  属性与待核验商品分开，未核验商家不生成购买首选。
- ballet flats + US 7：当前有界召回仍未取得足够的 US 尺码证据，
  结果仅为待核验线索，未生成购买推荐。这证明误推荐被挡住，
  **不证明真实 US 7 商品已找齐**。
- 上述接口检查发生在部署前；新增服务端筛选上线前不能计入线上效果。
- 无完整目录覆盖保证；六张已见图片不是留出集，本轮没有重新完成
  六张图的人工视觉验收，也不声称满足总体图片准确率目标。
- 上述实施验收时尚无 commit/push、版本提升、部署或缓存替换。
  随后的独立发布请求已授权 0.17.17；交付结果以该次发布验证为准。
