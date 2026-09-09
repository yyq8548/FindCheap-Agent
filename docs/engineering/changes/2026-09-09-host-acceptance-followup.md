# 宿主生命周期、Watch 与报价验收续项

## Research

目标：闭环 F02/F03/F04/F13 中可由本项目实施的部分，区分缺失的实现、宿主合同与必须由用户完成的界面操作。依据总设计第 8–10、13 节及研发协议。用户继续授权修复和真实验收；原参考图与 40 业务／40 图片人工标注仍暂缓。本文不代替其验收，不批准购物车、付款或批量操作已有 Watch。

研究基线：`7401b6d8a4e31b7b7b68cfbd2381f642ac334736`，开始时工作区无变更。本子任务独占本文及 `artifacts/host-acceptance-followup/`；暂未修改运行代码。MCP 构建与其他代理串行。

### FACT：入口、合同及消费者

- `server.ts` 的执行器通过可信 `codex-mcp-client` 入站 `_meta.threadId` 绑定 `TaskScope`；SQLite 保留原需求、快照、选择及证据时间。真实 bundle 进程重启测试已有证据，但完整原生卡片恢复尚未验收。
- `codex-task-metadata.ts` 开启官方 `codex app-server --stdio`，只请求 `thread/read`、`thread/list`。当前解析器忽略没有请求 ID 的通知。`task-lifecycle.ts` 只接受 `ACTIVE`／`ARCHIVED`／`UNKNOWN`；缺失、错误和 not-loaded 不是删除证明。
- `server.ts` 按调用及 30 秒轮询应用归档状态，暂停本任务 Watch 并保存 `STOP_REQUIRED`；取消归档不会自动恢复 Watch。并不因此停止宿主 Automation。
- 本机导出的官方 schema 确有 `thread/delete` 空成功响应及 `thread/deleted {threadId}` 通知。尚未证明桌面连接的删除事件会进入插件另启的 stdio 连接；不能仅因 schema 存在就增加自动删除。
- `watch-service.ts` 对补货触发原子保存 `COMPLETED` 和原消息／观察／事件 ID；`watch-store.ts` 固定为 `DELIVERY_UNCONFIRMED`，无模型可调用的确认入口。恢复同一事件避免新的触发，不证明原消息送达。持续型 Watch 尚无同等交付事件协议。
- 当前可调用应用工具有 `automation_update`、`set_thread_archived`、`read_thread`；没有独立的通知送达确认工具。官方 app-server schema 没有 Automation 送达或停止确认接口。`send_message_to_thread` 是发送新用户提示，不是 Watch 通知投递合同，不能替代。
- 报价已有标准 MCP `elicitation/create` 的 form 通道：`server.ts::authorizeQuote` 仅在 action=accept、严格 approved=true、引用重新校验后签发内存单次许可。`quote-authorization.ts` 对目标和 ZIP 绑定并原子消费，最长 5 秒；拒绝／取消／超时／能力缺失不报价。
- 先前原生网页补搜 2ms 返回 host DECLINE，不证明显示过表单或用户点击。当前只有浏览器 CUA，没有原生应用界面操作；不能代用户改审批策略或点击同意。

依赖：现有 Node24、MCP SDK1.30.0、Zod3、官方 Codex0.153.4；不新增依赖、权限、数据库格式或持久凭据。已有验证入口为 task-lifecycle/task-recovery/watch-completion-notification/quote-authorization-server 系列及 MCP bundle 构建；它们不能替代真实宿主验收。

### UNKNOWN 与只读／隔离探针

1. 通过两个独立官方 app-server 连接，在本轮新建且只用于该探针的空任务上验证删除响应、同连接和跨连接通知、读回结果。只删除本脚本刚创建的任务，不接触已有用户任务；不发起模型回合或购物调用。
2. 如存在明确属于 FindCheap 的既有 Automation，只读 `automation_update(view)`，检查是否返回可验证 status、目标任务与周期。没有记录时先报告，不凭空借用其他 Automation。
3. 从已批准报价能力及真实商品读取中准备合格目标，不请求购物车；给出用户可在可交互审批任务中执行的明确场景。

## Propose

方案 A：保留现有模块和标准接口，先验证本机实际可接收的权威事件。存在可信删除／调度回执时，在 `codex-task-metadata.ts`、`task-lifecycle.ts` 和现有执行边界接入，继续拒绝模型传入的 ACK。不存在的宿主能力明确保留；报价通过实际用户表单完成验收。本方案不改变业务或权限边界，推荐。

方案 B：定义独立宿主桥，由应用集成方提供带来源、作用域和幂等事件 ID 的删除、通知投递及调度停止回执；本项目通过窄适配器消费。可闭环跨进程交付，但需要宿主集成及真实接口，不能用自建模拟桥宣布 Codex 已通过。若改成其他真实通知渠道或手动清理产品模式，需要用户选择渠道／范围并更新总设计。

不采用读取私有聊天数据库、猜测内部 IPC、模型布尔确认或从“查询不到”推断删除；这些不满足现有可信证据合同。

## Plan v1：研究探针先行

1. 保留 schema、源码与旧真实证据。运行上述隔离官方协议探针并保存脱敏结果，不修改用户已有任务或 Watch。
2. 汇总实际可用与缺失合同，将可实施源码范围发给主任务避免冲突。只有足够权威证据后才冻结实现、先红断言、立即 MCP 构建及相关回归。
3. 准备报价目标和精确用户操作；拒绝／取消不自动重试，自动拒绝不计人工验收。
4. 纯研究文档的构建为 N/A；检查引用、状态与 `git diff --check`。本文件不核销 F03/F04/F13，后续结果逐条补充。

## Implement / Test

### 宿主探针结果

2026-09-09 19:47Z，两个独立官方 app-server 连接上新建空任务 `01a087b5-b976-7ce0-8ac4-3cf4e980f151`，未发模型回合。创建连接的 `thread/delete` 返回成功 `{}` 并收到 `thread/deleted`；独立元数据观察连接未收到事件。该观察连接在删除前、后均得到同样 `thread not loaded`。空任务尚未跨进程持久加载是此探针限制；它证明 not-loaded 不能区分未加载与删除，不能证明所有宿主集成均无删除接口。脚本仅删除其新建任务，结果在 ignored `deletion-notification-probe.json`。

当前 `$CODEX_HOME/automations` 存在，但只按 `FindCheap`／`check_watch` 筛选没有匹配项；未读取其他自动化内容，未停止已有自动化。应用工具视图的状态证据尚未采集，不虚构其字段。

用户后续决定保留自动删除、送达确认的设计目标，缺少权威跨连接合同的部分标记宿主依赖；不降低为模拟 ACK。本轮继续所有可控修复。报价原生表单与完整桌面恢复仍需要实际可交互任务及用户操作，不替代点击或修改审批设置。

## NF04：真实选中商品检查丢失价格

### Research

为 F13 准备目标时，原生读取 Allbirds 两个商品和 Glossier Balm Dotcom Espresso，均能搜索出报价支持卡，但 `inspect_selected_product` 返回 variants=[]，提示缺少可核实美元价。旧快照保留；没有请求购物车。原始回执在 ignored `selected-target-records.json`。

19:52–19:55Z 使用同一安全 fetch 和选中检查器读取实际 .js／PDP：Glossier Espresso variant46731565826293、product9150866882805、SKU `BDC-467-00-00`、available=true、price1600；Allbirds Cruiser size5 variant41243609661520、SKU `A11724W050`、available=true、price10500。两商家 .js 都没有货币字段。PDP 为 HTTP200；现有 JSON-LD 仅父商品 USD Offer，缺少可绑定的变体，拒绝继承父价是正确边界。

两个实际 PDP 都另有 Shopify Web Pixels `initData.productVariants`，逐项带当前商品 ID、商品路径、变体 ID、SKU、`price.amount` 和 `price.currencyCode=USD`。当前检查器没有读取这份精确变体证据，导致新版卡丢价。原始公开商品响应和脱敏摘要分别存 `nf04-inspect-source-evidence.json`、`nf04-allbirds-inspect-source-evidence.json`。未从全局 `Shopify.currency` 推断价格，未将订阅价格代替一次性价。

### Propose / Plan v2（实现前冻结）

- A（选择）：在选中检查器现有 PDP 读取中增加结构白名单解析，仅接受单个 Web Pixels initData 的直接 productVariants；绑定当前页面路径、.js 商品 ID、变体 ID、SKU 及金额。货币来自该变体对象；任何同变体冲突、多脚本、非 USD 或身份不符均保持未知。只解析 JSON，不执行页面脚本。已有精确 JSON-LD 与新增证据冲突时同样不出价。
- B：新增 tokenless Storefront 单变体读取端口。虽然可以得到强类型价格，但增加接口、请求和支持性依赖；当前商家是否支持尚未验证，范围大于本次漏读，故不选。

主任务已选择 A。独占 `shopify-selected-product.ts`、新增 `shopify-variant-price.ts` 及 `shopify-selected-variant-price.test.ts`；不修改公共 JSON-LD 解析器、报价许可、网络限制或 server.ts。新辅助模块只返回价格映射，不提升库存、状态、身份或信任。

1. 先对公共 inspector 新增真实 Glossier／Allbirds缩小夹具和拒绝边界，确认旧行为价格缺失的红断言。
2. 最小实现；取得共享 MCP 构建时隙后立即 `pnpm build:mcp`，运行 selected-product／新价格／quote-policy／quote-selection／quote-authorization 相关测试。
3. 重放本轮同一安全读取的公开响应，再做一次真实只读 inspect 复核。报价表单仍需新原生任务和用户操作；源码探针不替代原生回执。
4. 无状态迁移；回滚两个源文件和测试即可，不改旧快照。最终全套及交付由主任务串行负责。

### NF04 Implement / Test

实现只接受当前 wpmLoader 首层配置的单一 initData，读取直接 productVariants 的价格；JSON 对象上限 128KiB、最多 100 变体，拒绝重复 JSON key、重复变体、多个初始化、错商品路径／商品 ID／变体 ID／SKU、金额或币种冲突。现有精确 JSON-LD 仍保留状态反证；两份精确金额冲突不出价。未增加网络请求数量、执行 JS、借用全局货币或订阅价。

初次红测 3 FAIL／14 PASS；独立补测发现嵌套 analytics initData 被误取，追加首层限定后 19／19 PASS。最终相关 selected-product／quote 系列 5 文件 122／122 PASS，MCP build 两次 PASS，涉及文件 ESLint PASS。MCP 包 typecheck 初次遇到另一代理新增 coffee 测试的四处类型错误，已移交其修复；不记为全仓类型检查通过。

20:04Z 真实只读 .js／PDP 读取均 HTTP200：Glossier Espresso 同变体恢复 USD16、库存 IN_STOCK、NEW；Allbirds Cruiser size5 同变体恢复 USD105、IN_STOCK，但 condition=UNKNOWN。最终首层限定对这两份实际公开响应离线重放均 PASS，保留原失败与新回执，分别为 `nf04-*-inspect-source-evidence.json` 与 `nf04-final-public-replay.json`。这些是源检查器及公开响应证据，不能算原生宿主 UI 或报价验收。

F13 具体候选为 `https://www.glossier.com/products/balm-dotcom?variant=46731565826293`，Flavor Espresso、SKU `BDC-467-00-00`。最终安装后必须在新的可交互原生任务中重新搜索／inspect，获取新选择引用，再由用户实际接受一次性匿名总价表单；取消、拒绝或需完整地址均终止。现有自动审批拒绝不等于用户同意。本轮没有发起 Cart 或修改审批策略。

## F07：FAQ 版次误作当前商品排除证据

### Research / Propose

20:07Z 单次安全公开读取 `https://medicube.us/products/zero-pore-pad-1.js`，当前标题 Zero Pore Pads、variant40542710825008。实际描述 FAQ 建议敏感肌用户尝试 Zero Pore Pad Mild。离线 `evaluateProductRequirements` 在只有 excludedFeatures=[Mild] 时返回 CONFLICT；同一候选移除描述则不再冲突，证明通用排除路径误把其他商品建议当成本商品版次。源匹配 `shopify-match.ts` 已用 primaryProductTokens 防止 FAQ 建立命名版次，两个消费者有分叉。

真实完整要求仍是 70 pads MATCHED、155g UNKNOWN。原 F07 请求的 40 次观察／31 唯一候选／0 卡和排除分母保留；本探针不能认定其中全部 8 次要求排除均由此造成。没有重试安全拒绝的目标搜索，没有把其他国家不同条码的包装重量借到当前美国 SKU。

- A（推荐）：复用现有 PRODUCT_EDITIONS 与 primaryProductTokens，为命名商品的单独版次 required／excluded／preference 提供统一窄评估。FAQ 不建立版次；当前主证据明确 Mild 才形成该排除冲突，版次没有证据保留 UNKNOWN／待核验。普通 mild shampoo 和服装 mini／regular 语义不变。
- B：对所有描述功能词新增跨句商品归属分类。覆盖更广，但修改面和误伤风险高于本次，故不选。

### Plan v3（主任务已批准 A）

1. 用上述真实缩小 FAQ、明确 Mild、版次维度、缺证据、普通 shampoo／服装边界建立公共 requirements 红测试；保存真实探针和首次失败。
2. 独占 `shopify-match.ts` 的版次辅助函数与 `product-requirements.ts` 的对应三类消费者，新增专用测试。不改 query／ledger、身份、商品重量、网络或信任规则。
3. 实现后立即独占 MCP 构建，包含已经完成的共享 Awin feed 变更；运行新版次及原匹配／要求回归，再交还构建锁。以 UNKNOWN 修正误冲突，不以有卡或满足 155g 为验收标准。

### NF04 Plan v4：独立反例后的解析修订

独立审查确认注释／模板字符串内的假 wpmLoader 调用仍被草稿正则认作价格证据；扩充未调用函数、条件分支和 return 后调用，共 5 个反例全部红。前次通过不能作为最终安全结论。

主任务批准将锁文件现有 `acorn@8.18.0` 提升为 MCP 直接依赖，只增加 importer，不升级或新增包版本；使用离线安装。选择 AST 固定结构解析：只读取脚本顶层或立即执行匿名函数中的直接初始化及紧随的 wpmLoader 调用，literal initData 仍仅 JSON，拒绝评论、字符串、未调用函数、条件分支和异常结构。替换手写词法扫描，保留商品／变体／金额绑定。记录构建前后包体积，生成 notice，重新运行反例、实际公开响应重放及相关回归。不执行任何页面代码。

### 最终 Implement / Test

NF04：Acorn 固定 AST 位置及 literal 参数实现完成，支持本轮实际两商家的 5 参数调用和缩小夹具的单参数调用。初次 AST 对 5 参数真实响应产生 2 次 UNKNOWN，保留这次失败记录后按两份实际结构修正；并未放开到任意调用。直接数据、冲突和惰性脚本测试共 25／25 PASS。独立审查再次执行原注释／模板反例，两者均 ambiguous=true、prices=[]。

离线依赖提升命令 downloaded=0、added=0；package.json 新增精确版本，lockfile 只新增该 importer 的三行，未增加其他包版本。MCP build／notice PASS，notice 包含 acorn8.18.0 MIT 声明。该次包从 1,130,453 增为 1,253,054 bytes，增量 122,601 bytes（10.85%），数值与哈希在 `nf04-acorn-delivery-evidence.json`。

F07：公共 requirements 红测试 4 FAIL／6 PASS，最小共享版次证据修复后 10／10 PASS。真实美国 SKU 描述离线重放变为 NEEDS_VERIFICATION，70 pads MATCHED、155g 与 excluded Mild UNKNOWN、无虚假的 Mild 冲突。没有建立商品缺失净重或跨店同款证据，F07 人工／跨店原目标未因此核销。

最终本子任务涉及 11 测试文件 302／302 PASS，MCP 包 tsc --noEmit PASS，六个变更源码／测试文件 ESLint PASS；git diff --check PASS。源检查器最终 AST 再次真实读取 Glossier 和 Allbirds .js／PDP，各 HTTP200，仍分别返回精确 SKU 的 USD16／USD105；原生安装后新选择引用和实际报价表单交主任务继续。未提交、推送、部署、修改安装缓存或触发购物车。

最后按主任务批准补充 script 位置边界：data block、module、带 src 的内联配置不能作为执行位置证据。四个拒绝反例先红，再限制为实际观察的无属性 classic script 或仅有明确 JavaScript MIME 的内联 script；其他属性组合暂不支持。新增拒绝与显式 MIME 正例后 NF04 30／30 PASS，相关 11 文件更新为 307／307 PASS，MCP build／notice、涉及文件 ESLint 及两份真实响应重放均 PASS。最终 bundle 数值另存 `nf04-acorn-delivery-evidence.json.finalAfterScriptMime`；此前阶段性体积和失败记录保留。

宿主探针补充建议未执行：可单独新建 PAUSED Automation，view 核对真实返回的状态／任务／周期，再删除清理；这仅能证明配置回读，不能证明运行过的 Watch 已停止或通知已经送达。因为不直接闭环 F04，未为了取得勾选增加用户侧自动化状态。F03/F04 继续保留已同意的宿主依赖范围。

### NF04 Plan v5：HTML 上下文统一解析

主任务复核发现 comment／template 内 script 仍可被 HTML 正则抓取，新增含嵌套 template、raw script 伪闭合的 5 个反例均红。继续补手写剔除器还会遗漏 textarea、属性文本等 HTML 上下文，因此不选。选择成熟 HTML parser 识别实际 DOM 中的 classic inline script，并跳过 template／noscript 等惰性节点；Acorn 继续处理 JavaScript 固定调用结构。

主任务已批准必要依赖。官方 [parse5 仓库](https://github.com/inikulin/parse5) 和 [文档](https://parse5.js.org/) 说明其按 WHATWG HTML 解析；本轮 npm registry 核实 parse5 8.0.1、MIT、unpacked 337099 bytes、唯一运行依赖 entities ^8.0.0。新增精确 parse5 直接依赖及锁定的 entities，保留网络下载数量、许可与最终包体积；不执行脚本，不引入浏览器。原先无 HTML parser，故本次明确属于新增包；与此前 Acorn 离线提升区分记录。冻结该最小修改后统一验证上述上下文和实际两商家，不继续零散扩边界。

### 最终交接（DOM + AST）

parse5 8.0.1 及锁定 entities 8.1.0 已加入；entities 为 BSD-2-Clause、Node>=20.19，本仓 Node24 满足。安装有 registry 网络查询，新增 2 包，安装日志 downloaded=0（缓存复用），不能称整个依赖变更离线。生成 notice 已覆盖 parse5、entities、acorn 全部许可。

最终 HTML 读取使用 DOM，按 scriptingEnabled=true 解析；不遍历 template／noscript／非 HTML 命名空间，只取实际 script 文本，并排除 src／nomodule／非经典 JS MIME。脚本属性文本、HTML 注释、textarea 等文本不会形成 script 节点。四百万字符页面、256KiB 脚本、128KiB initData 上限；不改变网络许可或执行脚本。保留 AST 的固定声明／直接调用位置和 literal 参数约束，商品 ID／路径／变体 ID／SKU／币种及金额必须一致。

NF04 共 42／42 PASS；最终 11 个相关文件 319／319 PASS，MCP build／notice、MCP tsc --noEmit、六个源码／测试文件 ESLint 均 PASS。公开捕获重放 2／2 PASS；20:27Z 最终 DOM + AST 源检查器再次真实读取两商家 .js／PDP，各 HTTP200，Glossier Espresso 为 USD16／IN_STOCK／NEW，Allbirds size5 为 USD105／IN_STOCK／UNKNOWN condition。未做新原生验收或购物车请求。

此时 bundle 1,406,152 bytes，较引入解析器前增加 275,699 bytes，其中 DOM 修订相对上一 Acorn 阶段增加 152,915 bytes；哈希、许可和阶段性失败均存 `nf04-acorn-delivery-evidence.json.finalDom`。原生报价继续使用 Glossier 精确变体候选，由主任务在最终安装后建立新选择引用并等待真实用户表单。所有本子任务源码、依赖及构建修改停止，构建锁归还主任务。
