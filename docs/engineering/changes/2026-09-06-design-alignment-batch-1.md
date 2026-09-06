# 总设计对齐：首批确定性合同修复

## 目标、授权与基线

- 目标：按总设计第 4、6、8、9、10 节修复已确认的身份、选择、隐式写入和 Watch 合同缺口。
- 用户于 2026-09-06 授权开始 Research、Propose、Plan、Implement、Test；没有授权本轮提交、发布、部署或替换缓存。
- 基线：`main` / `748e1428c43c7436db11051296decf9498da1022`，运行版本 0.17.22，初始工作区干净。
- 本文冻结首批范围，不表示整个总设计已完成。业务负责人 Chris，实施与证据负责人为本任务维护者。
- 风险：本地代码变更 R1；所控制的购物车外部写入和通知行为属于 R2。验证仅使用离线来源替身和临时测试目录，不操作真实购物车或调度。

## Research：事实底稿

### 活跃拓扑与依赖

`stdio.ts` 创建现有 Backend adapters、JSON WatchStore 和 `createShoppingServer`；工具经 `execution/tool-registry.ts`、`ToolExecutor.execute` 校验 schema/capability/输出后进入领域逻辑。检索经 `searchProducts` 和现有 Awin、Shopify、eBay、官网 ports；卡片、选择、比较由 server 快照及 UI 消费。Railway 来源服务独立维护 Feed/registry；不会存储当前购物会话。`archive/commercial-platform` 已退出工作区与构建，不纳入本次改动。

FACT：根 package.json 要求 Node >=24 <25、pnpm 10.34.5；MCP SDK 固定 1.30.0、esbuild 0.28.2、zod 3.25.76，锁文件一致。`pnpm build:mcp` 从 stdio 生成分发 bundle、metafile、图像 worker 和 notices。共享接口无新增依赖。ADR 0001 针对 PostgreSQL；本批不改 DB，也不复活旧 Commerce 平台。

| 合同 / 接口与消费者 | FACT（基线位置） | 影响 |
| --- | --- | --- |
| `finalizeCodexVisualCandidates`，由 `finalize_visual_search`、卡片映射和推荐消费 | search-products.ts:331–340 仅凭旧 candidate EXACT 保留标签；server.ts:1119、1450 等还消费源商品 matchStatus | 新视觉冲突可能与旧 EXACT 同时输出；仅改候选单一字段不够 |
| 卡片 render、选择同步、比较返回 | product-card-ui.ts:652 返回旧输出；:861–862 重置 Set 和 revision；server.ts:4626–4635 拒绝旧 revision | 返回原卡片后新选择可能无法同步，自然语言比较继续读旧选择 |
| `search_products` / legacy search / `researchSelectedProductDeal` | server.ts:1881–1892、2364–2367、3385；deal-concierge.ts:74–89 因 ZIP 调 cart quote | 普通研究隐式发生 cartCreate/cartSelectedDeliveryOptionsUpdate |
| `evaluateWatch`，由 MCP check_watch 消费 | watch-service.ts:115 接受任何非 IN_STOCK 前态；:252–261 没有 merchantId/sourceHost/handle/variantDimensions | UNKNOWN 或不同变体/商家可拼成错误补货转变 |
| `WatchStore.create/get/list/save`，内存和 JSON 两个 adapters | watch-store.ts:56–57 只有 60 分钟默认，expiresAt 可省略；create 按整个 spec 去重 | 无默认 30 天；若在 parse/read 或去重之前生成默认截止会重启续期或重复创建 |
| SearchRun / executor / 图像与网页恢复 | SearchRun 30 秒活跃 I/O，executor 无聚合 deadline，模型复核空档不计入 | 当前实现不是完整 90/180 秒体验预算 |
| 任务恢复与生命周期 | server.ts:2127–2158 为进程 Map；stdio.ts:30 仅 Watch JSON；没有可信宿主 task scope 或 archive/delete 接入 | 不允许先保存全局购物快照并跨任务自动恢复 |
| Watch 调度 / 报价资格 | Watch 只有模型回传 automationId；cart quote port 没有已审核不预留库存资格 | 不能用本地触发/停止或存在 port 证明真实调度/报价合规 |

以上路径均相对 `apps/mcp-server/src/`。动态调用中没有读到的宿主身份、事件、审批和调度执行结果保持 UNKNOWN。既有 Awin 信任、三层分组、价格口径、外部数据隔离保留，不扩商家审核集合，不增加付费来源或上传图片。

### 基线验证

2026-09-06 04:18 EDT，`pnpm test --silent`，退出 0：91 文件、1,351 断言通过。旧测试并未断言本批所有新规则。只读核对还运行了视觉/预算 73 项、引用/比较/权限 105 项，均通过；这些是离线合同，不是真实图片或宿主验收。

`pnpm test` 排除 `*.integration.test.ts`。独立 integration 套件使用 DATABASE_URL 并执行迁移/清理；本批不改 DB，不运行它，不将其记为通过。

## Propose：两案比较

| 维度 | A：现有接口内逐项收紧 | B：先提取独立策略和持久状态机 |
| --- | --- | --- |
| 架构 | 保留现有 adapters、工具 schema 和引用，局部修正身份/状态/调用条件 | 增策略模块集中身份转换、quote 授权、Watch 状态及待办，再接现有 adapters |
| 收益 | 最短路径阻止确定性误报和隐式写入，每项可独立断言 | 长期生命周期和崩溃补偿集中，更便于统一扩展 |
| 风险 | 首批不消除全部分散状态；必须保留宿主未知项 | 更多接口/消费者及持久 schema 迁移；提取本身不能证明宿主能力 |
| 代价 | 小到中，无新依赖，不改生产配置 | 中到高，需额外迁移、兼容、集成与恢复测试 |
| 回滚 | 单项来源变更可撤回；可选证据字段保持旧数据可读 | 需要格式迁移边界，防止终态被回滚成活跃 |

选择 A。用户授权自主按总设计实施，首批不改变批准业务规则。完整预算、宿主恢复与调度协调另作前置能力核验后的独立计划。

## Plan v1：冻结原子步骤

公共测试接口沿用已有 `finalizeCodexVisualCandidates`、MCP handlers、实际卡片 UI、`researchSelectedProductDeal`、`evaluateWatch`、WatchStore；不测试私有实现，也不以模拟权限替代宿主证明。

| 步骤 / 前置 | 最小行为与范围 | 自动断言 | 局部构建 / 通过条件 |
| --- | --- | --- | --- |
| S1 / Research+Propose+Plan | 视觉复核冲突时同时修正 candidate 和规范化源商品的 EXACT，不变更 SIMILAR 推荐门槛 | 颜色/图案差异不保留 EXACT，正例身份不变；源对象不被原地污染，卡片/徽章/推荐不残留同款结论 | `pnpm build:mcp`；视觉相关断言通过 |
| S2 / S1 | 同 renderId 卡片返回保留选择及递增同步版本，新快照不继承旧选择 | 实际 UI 选择、进入比较、返回、重选、同步；新 renderId 隔离；旧 revision 仍拒绝 | `pnpm build:mcp`；UI及服务端选择断言通过 |
| S3a / S2 | 普通/图片/legacy 搜索仅因 ZIP 不调用 cart quote，显式报价工具保持独立 | ZIP 保留检索条件；研究路径 cart 调用为 0；显式选择报价仍有效；商品价/未报价状态准确 | `pnpm build:mcp`；MCP server相关断言通过 |
| S3b / S3a | Coupon 研究仅因 ZIP 不调用 cart quote；引导明确到手价请求使用独立报价工具 | `researchSelectedProductDeal` 和真实 MCP 优惠入口均不调用 cart；优惠/商品价证据保留 | `pnpm build:mcp`；deal-concierge和MCP相关断言通过 |
| S4 / S3b | 补货必须同 merchantId/sourceHost/handle/变体/condition 的可靠 OUT_OF_STOCK 前态，再确认 IN_STOCK | UNKNOWN、首次有货、失败、旧无证据、换商家/变体/尺寸均不触发；同键正常转变触发 | `pnpm build:mcp`；evaluateWatch 与 MCP check_watch断言通过 |
| S5 / S4 | WatchStore 新建默认30天；先去重，重复创建保持原截止；显式截止和旧记录不静默改写 | 两个 store一致；精确30天、重复调用、跨实例恢复、显式截止、旧记录、到期边界 | `pnpm build:mcp`；store和Watch消费者断言通过 |
| S6 / S1–S5 | 总设计状态与事实证据更新；集成验证 | 全部必选命令全绿；不降低断言，记录首次失败和修复 | typecheck、lint、build:mcp、默认全套、stdio smoke、diff检查 |

运行模块修改与 bundle 构建串行；子任务可以独立只读研究或复核，不同时覆盖相同 bundle。每个切片先确认新断言在原行为上失败，再修改一个模块并立即构建/测试。断言失败时留在当前步骤；新增事实改变方案时记录 Plan 修订，再继续。

执行协调补充：S1 与 S2 没有业务接口依赖，表中的顺序用于串行交接运行代码/构建。S1 源码、局部构建和消费者运行断言通过后，可交接给 S2；独立测试文件的类型完善可并行，最终类型检查仍为必选门槛。若前一步再需修改运行源码，先暂停下一步并重新建立构建边界。

S3a 与 S2 同样不共享行为接口：允许在独立测试文件先复现普通检索隐式报价，之后仍等待 S2 释放构建锁才修改 server。一次只新增当前切片断言，不预写后续 Watch 实现假设。

S4 前态策略：UNKNOWN、空返回、请求失败不建立或升级缺货基线。保留最后可靠同键观察时，必须保留原检查时间并验证来源键；如果现有结构不足以安全保留，采用不触发的保守结果，不臆造转变。首次旧数据缺稳定键时先建立新基线。

S5 默认期限仅在新建时按注入 now 计算，绝不在读取/parse 时续期。持久字段兼容旧文件，不迁移用户现有 Watch。到期不会自动证明宿主调度已经停止。

Plan v1.1（S4 独立复核后的同范围修订）：发现多个合法候选同时返回时，先选任意有货项再核对前态，会漏掉后面的同键补货，也可能抹掉仍缺货的原基线。方案A只优先同键有货，方案B优先同键的可靠观察（含仍缺货）；选择B，既恢复正确补货又保持缺货证据。未找到同键时仍不拼接转变，不增加多源持久状态。新增两个公开回归：异商家有货在前／同键有货在后，以及同键仍缺货／异商家有货。实施顺序为完成当前S5原子模块的构建测试后，回到S4红绿及即时构建，再进入S6；仍只有一个运行代码／构建持有者。

同轮只读复核补充时序事实：较旧的OUT观察仍可能在15分钟新鲜窗口内，被回写后与更早的IN拼成伪补货。S4时序合同必须保证同键可靠观察不倒退；旧于最后可靠观察的输入不覆盖、不触发，包括已知IN之后迟到的旧OUT。方案A仅检查发生触发时的两个时间，仍丢失已经见过的更新证据；方案B在同键观察写入前检查时间单调性，选择B。新增相应公开轨迹断言；不新增持久格式或跨源历史表。

### 禁止范围与后续里程碑

本批不改版本、安装缓存、Railway、真实 Automation、真实购物车、数据库、商家信任集合。不给模型新增授权布尔值以冒充审批。不生成新商品目录，不保存原图或完整聊天。

后续仍需独立完成：图片同款/相似自动转入与硬条件、相似 primary；90/180秒全主动流程预算与取消传播；可信宿主绑定后最少持久化和归档删除；Watch可靠来源准入、一次通知后真实停止、跨进程状态一致性；匿名cart显式授权及已审核不预留资格。完整真实验收使用总设计第13节既有门槛，未获得样本/宿主证据时不宣称达标。

## Implement 与 Test

计划已冻结；后续逐项记录真实红/绿断言、构建和验证证据，不预填通过。

### S1 事实补正（实施中）

首个新断言复现 candidate 和 Shopify 嵌套源保留 EXACT。初次局部构建及24项断言通过，但额外类型检查发现方案假设不准确：AwinProduct/EbayProduct 源合同只允许 DISCOVERY_MATCH，不允许构造嵌套源 EXACT。保留原研究判断作为错误来源记录，不把无效 fixture 当真实来源。

S1 在原范围内修订：三来源 candidate 的身份仍按有效视觉冲突降级；嵌套源仅克隆真正可携带 EXACT 的 Shopify/官网商品，保持判别联合及真实来源合同。测试按合法来源构造；不扩权限、模块范围或推荐门槛。修订后重新构建、类型检查和消费者回归。

S1 实施结果：有效颜色/图案冲突使 candidate 和 Shopify/官网嵌套源降为 DISCOVERY_MATCH；保留真实ID、变体、价格、信任及差异证据，不原地修改源对象。04:23:54 局部构建退出0；04:24:37 包括MCP消费者的10文件292项运行断言通过；最终 typecheck、局部 eslint、diff检查均退出0。新增10项断言。无brand入口也验证卡片matchStatus/matchBadge及推荐理由不残留EXACT。Awin fixture condition 必须遵循真实 UNKNOWN 合同，类型完善不能虚构 NEW。

### S3a 红灯证据（S2 运行模块构建期间的独立测试）

04:25 首轮两项测试：普通统一搜索准确复现 attempted=1；legacy fixture 误传不支持的 productType，先修正测试输入。04:25:34 两种合法输入均准确复现 attempted=1。04:26:05 增加真实视觉 search/finalize 流程后，3项均因隐式购物车 attempted=1 而失败；不是无效参数或网络环境导致。尚未修改 server，等待 S2 构建交接。

### S2 主切片及同范围复核

实际 PRODUCT_CARD_HTML 在 VM 中点击，同步/比较交给真实 InMemory MCP。红灯：04:25:22 比较返回丢选择；04:26:14 foreign ID未过滤；04:26:51 同/异render迟到比较覆盖；04:27:36 迟到报价覆盖。修复后保存同render选择与单调revision，新render及缺render隔离，并绑定异步响应到对应视图版本。

04:27:51 即时构建、4文件70项断言通过，typecheck/局部lint/diff通过。只读复核发现 hydrateFromInput 也可用迟到响应覆盖新卡，属于已冻结旧响应隔离合同，尚待补红绿。S3完成后交回S2该单一边界；不扩大成 iframe重建或跨进程记忆。

S2 收尾：hydrate 的迟到响应回归先红，再绑定初始视图版本与render范围。04:30:14 即时构建及4文件71项断言通过，局部eslint退出0。S2 共新增6项断言；未证明 iframe 重建或跨 MCP 重启恢复。

### S3a 与 S3b 完成

S3a：删除普通检索的 cart enrichment，保留检索ZIP和源商品价。04:27:39 将旧“ZIP自动报价”用例改为已批准的显式选择报价轨迹，原行为准确失败；金额、税费、选择绑定断言保留。04:28:19 修改server后即时构建、3文件85项断言通过。

S3b：04:28:47 `researchSelectedProductDeal` 新断言准确暴露一次cart调用（1失败/8通过）。仅删除Coupon研究的隐式cart路径，ZIP输入继续兼容，但输出NOT_REQUESTED及商品价。04:29:03 即时构建和88项断言通过；随后增加CURRENT_DEALS/CHEAPEST_PATH真实MCP消费者回归。04:29:21 三文件90项断言通过，typecheck退出0。

显式报价、批量报价和到手价Watch仍是独立路径；本批不宣称它们已获得可信宿主授权或已审核无预留资格。未执行任何真实购物车请求。

独立只读复核确认：普通、视觉和网页统一响应以及legacy入口均无隐式cart路径，ZIP仍透传；报价函数零调用有直接断言，不依赖异常是否被吞。04:31:12 复跑3文件90项通过；没有新增源码、构建或网络请求。

### S4 可靠补货前态基础切片

04:30:40 首个公开 evaluateWatch 断言复现 UNKNOWN→IN_STOCK 被错误触发。04:31:12 merchantId、sourceHost、handle、尺寸和condition五项分别复现错误拼接。每次修改 watch-service 后即时构建及局部断言通过。

04:31:59 进一步复现两类不可靠观察：未来时间，以及只证明颜色层库存的 PRODUCT_COLOR。它们无法证明指定变体补货，属于冻结的可靠前态合同；只对RESTOCKED收紧，不修改其他Watch类型的既有行为。修复后，UNKNOWN、空结果、来源失败、未来／过期观察及颜色层聚合库存不覆盖可靠基线；原检查时间不重写。一小时前的同键有效缺货仍可用于与本次新有货观察比较，不能误要求历史缺货也在15分钟内。

新观察保存merchantId/sourceHost/handle/variantDimensions/condition。旧文件缺稳定证据先建立基线，不触发；来源时间必须有效且前态不晚于新观察。04:32:48 2文件96项通过（含既有真实MCP消费者），typecheck退出0。首次局部lint只指出测试格式，修正后04:33:10 lint退出0及新文件20项通过。真实库存、调度停止和通知能力没有执行验收。

### S4 复核修订与 S5 完成

独立复核发现并按Plan v1.1补齐两种真实缺陷。04:34:40 多候选遮蔽补货／擦掉同键缺货基线，两项红；修改后04:34:50即时构建及局部26项通过。04:35:18 迟到库存覆盖更新前态，两项红；改为同键可靠观察时间不倒退后重新构建和回归通过。原“前态晚于当前观察”测试由NOT_TRIGGERED改为精确DATA_SOURCE_UNAVAILABLE，表明当前来源观察被拒绝，不能写回；没有改成接受任意非触发状态。

S5：04:33:43 内存新建缺默认期限、04:34:04 默认期限导致重复创建分别红；按新建时赋值、先去重分别修改与即时构建。04:36:14 JSON新建缺默认期限准确红；两个adapter复用同一去重判断，04:36:23即时构建通过。默认期为注入now之后精确30天，不在schema解析或读取时补写；显式截止保留，重复创建不续期、不恢复暂停，已过期规则不被误用为活跃重复项。旧无期限文件保持原样，不迁移用户数据。

04:37:30 Watch共41项断言、typecheck和局部lint通过；04:37:48 五文件130项通过，diff检查退出0。S4/S5新增39项（service24、store新增13、MCP期限2）。MCP期限回归验证有／无绑定均在截止时返回EXPIRED，不再查询来源，不接受重新绑定；不把模型传入测试Automation ID视为真实宿主绑定证明。

### S6 最终核验与交付边界

最终仅六个运行模块有变更：search-products、product-card-ui、server、deal-concierge、watch-service、watch-store。现有adapters、工具输入schema、商家信任集合、来源权限和版本保持不变。主任务复读运行diff及新增MCP期限测试；独立复核暴露的问题已经补红绿，不用之前的绿灯覆盖后来发现的缺陷。

| 最终命令 / 核验 | 结果 |
| --- | --- |
| `pnpm typecheck` | 退出0 |
| `pnpm lint` | 退出0 |
| `pnpm build:mcp` | 退出0，重新生成分发bundle、metafile及对应notices |
| `pnpm test --silent`，04:38:26 EDT | 96文件、1,412项通过；相对基线新增61项，失败0 |
| `pnpm test:mcp-stdio --silent`，04:38:42 EDT | 1文件、4项通过；测试本仓库新bundle，不是安装缓存替换证明 |

总设计第11节更新本地实现与剩余差距，README同步“ZIP不等于自动报价”；不把目标规则改低。文档收尾后核对56个本地链接，无缺失；6个新增文件无行尾空白，`git diff --check`退出0。Git的LF／CRLF提示为现有Windows换行规范提示，不是测试失败或新增格式错误。

未执行：独立数据库integration套件、真实图片／真实库存准确率验收、宿主授权／重启／归档删除／真实Automation停止验收。未创建真实Watch或购物车，未提交、推送、升版本、部署Railway、发布registry或替换Codex缓存。当前运行版本号仍为0.17.22；本地未发布修改不代表已安装版本有这些修复。

回滚边界：改动均未发布且没有迁移用户持久数据。后续若获发布授权，固定源码和bundle证据，并保留上一版本产物；新写入的可选Watch证据及expiresAt仍兼容现有记录schema。不要通过删除Watch文件来“回滚”，不得恢复已停止调度或静默延长截止时间。
