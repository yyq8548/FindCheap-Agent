# 精确 Shopify 商品链接的身份保留

## Research

基线为v0.18.6已安装R2分发，主任务已授权完成可控缺陷。实际原生任务 `01a087fa-8793-7201-a995-d4b25d9dc0cf` 输入 Glossier单支Espresso的已审核官网URL，allowAlternatives=false。search与inspect后的3卡分别为目标 `/products/balm-dotcom?variant=46731565826293`、Trio另一商品路径及variant46731770429685、Quintet另一商品路径及variant45782337126645。目标USD16及库存核验成功、唯一首选正确；两套装Espresso UNKNOWN，仅RESEARCH_ONLY，但requestIdentityStatus错误CONFIRMED，且仍可选。不得把正确目标检查掩盖此独立缺陷。

已读AGENTS、研发协议及总设计4／5／6／8／13节。已知链接应建立身份；不自动放宽其他型号，初次与派生快照共用资格。search-products已先按同host/path/variant找到实际官方sourceProduct，随后resolvedRequest只保留品牌+标题及选定属性，丢失URL身份。共享matcher以请求词子集判断名称CONFIRMED，Trio/Quintet含全词便通过。当前公共函数离线调用三标题均DISCOVERY_MATCH+CONFIRMED，非模型文案推断。

已有Woo服务端私有anchor和merge/候选过滤可参考；新字段不得进入公开MCP输入。renderSnapshot持久codec目前公开request schema，需最小内部schema支持新字段且兼容无锚点旧快照。inspect及quote等记忆快照共用rememberSnapshot最终展示资格。跨店本地商品ID无全局意义；不是所有同名项都能作为已核实同款。

## Propose

| 方案 | 行为 | 成本／限制 |
| --- | --- | --- |
| A：保留已实际读取的Shopify商品URL锚点 | 私有请求保留规范商品path、选定variant、对应全球标识及所选属性；搜索／恢复／派生共用核验。同店其他path或选定variant冲突排除；跨店沿用全球GTIN或品牌MPN加所选属性证据。 | 小范围请求、持久codec、候选与最终快照改变；不会把本地ID互比，需明确纠正释放旧锚点。 |
| B：扩展套装／包装词表 | 标题Trio/Quintet等与单品默认冲突，覆盖部分名称搜索。 | 更宽语义和误伤风险；仍未解决未命名套装／其他同名路径及URL锚点丢失。 |

主任务选择A。不扩包装词表、不修改普通文本搜索、预算、价格、商家信任或网络策略；不修改版本／release／安装缓存，不提交。

## Plan（实现前冻结）

1. 公共搜索入口红测试保留真实单款／Trio／Quintet反例；验证同商品正确variant保留、同店不同路径／冲突variant排除、跨店全球身份正例、无全球身份不伪确认。MCP输入注入锚点拒绝。
2. 锚点仅从当前安全官方读取创建，公开schema不增加字段。私有parse与持久codec验证新增字段，旧快照无锚点继续可读，不凭旧标题伪造已核实URL身份。CONTINUE继承已验证锚点；CORRECT／NEW释放，其他硬条件继续保留；显式换variant依既有目标修订或经实际原商品inspection验证，不永久钉死旧选择。
3. 共用候选过滤与最终rememberSnapshot资格覆盖搜索、恢复及派生inspect。inspect不得借其它商品返回更新锚点；只允许同源原商品经验证的显式所选变体变化，源失败／冲突不生成新可选卡。
4. 每次实现后立即独占MCP build、相关搜索／快照／inspection／恢复回归与类型检查。保留红绿，独立复核后交主任务，原生复验单独执行。正式性能矩阵延期，不用本地响应代替原生通过。

## Implement / Test

首轮新增12项中9 FAIL／3 PASS，保留 `shopify-url-anchor-red.json`。公共搜索与MCP均复现套装／错误variant可选；两个跨店全球身份正例和旧请求无锚点兼容为原先通过项。不是只有私有helper失败。

最小实现新增 `shopify-product-anchor.ts`；SearchProductsInput公开schema仍严格拒绝shopifyAnchor，内部Stored schema及parse只接受服务端状态。官方实际读取同host/path/URLvariant后才能建锚点。搜索与恢复候选过滤、rememberSnapshot最终卡资格及inspect输出共用同一函数。同店path／已选variant／选项冲突拒绝；跨店仅全球GTIN或品牌MPN加选中选项，商品URL本地ID不互比。普通文本请求没有锚点，行为保持。

CONTINUE继承，CORRECT／NEW清除锚点，预算及其他硬条件依原合并规则保留。只有显式inspection选项在同一原商家商品上得到唯一、对应实际选项的结果时才替换variant锚点，并按已选字段更新其旧值；其他商品或未经请求的variant不能借检查转正。无锚点旧快照继续可读，没有从标题补造锚点；SQLite内存库跨两个真实MCP服务实例的保存／读取回归通过，但不是原生宿主重启验收。

每次实现后立即MCP build及notice通过。第一轮相关51项50 PASS／1 FAIL：新增恢复fixture未标为WEB_PRODUCT_PAGE，被原有入口拒绝；按真实入口补fixture来源后通过，没有放宽生产恢复资格。首次typecheck两个exactOptionalPropertyTypes错误已修正，原日志保留。

目前新增17／17 PASS，10个相关文件187／187 PASS；MCP tsc --noEmit与5个涉及源码／测试ESLint通过。测试增加公共字段注入无来源调用、显式变体更新后继续锁定新变体及预算、不同商品不能借相同选项替换、旧快照原样保留、新旧请求重建服务兼容。`shopify-url-anchor-build-r2.log`已纳入另一独立步骤的视觉参数说明，schema不变。证据位于 `artifacts/remaining-completion/shopify-url-anchor-*`，独立审查及最终交接继续。

## 独立审查补充 Plan（修订前冻结）

Sony 真实公共接口反例：CONTINUE 显式 allowAlternatives 仍被 URL 锚点全部排除；全球 GTIN 已确认的零售卡，显式同父商品换 Flavor 仍锁原官网 host；Woo 真实搜索后保存含 wooAnchor，重建同 trusted thread render 却 TASK_STATE_UNAVAILABLE。保留独立红证据 url-anchor-review-red.log 及 woo-anchor-recreation-red.log，自动通过不能覆盖这些新增分母。

方案 A 保留目标锚点并将显式允许的非同款标为 ALTERNATIVE/SIMILAR/NEEDS_VERIFICATION；inspection 以实际所选卡及 provider 同父路径核验，已确认同款的显式选项更新才重锚；独立 strict WooAnchor schema 仅用于私有存储。方案 B 删除锚点或绕过持久校验会伪确认套装／失去验证，拒绝。主任务批准 A。新增同链替代检查仍不能转正、跨店换规格正例／非显式和异父负例、Woo 真实双服务实例恢复与跨 thread 拒绝；公共模型 schema 继续不接受锚点。

## 审查修订实现与验证

自审先补 Default Title 不作为真实选项及明确 MPN 冲突不能借共享 GTIN 转正，两例各自红后修复，早期新增增至 21 PASS。仍沿用现有 GTIN 或品牌＋MPN 的全球身份证据路径，没有引入另一套 GTIN 冲突政策。

独立审查三项永久回归首跑 27 项中 21 PASS／6 FAIL：其中三个重复 inspect 调用计数包含搜索自动补充读，测试在实际待测调用前清空计数；纠正夹具后 23 PASS／4 FAIL，分别是替代、跨店显式换规格、Woo codec、Woo 真实重建。两份原红记录均保留。修订后 26 PASS／1 FAIL 是测试撤回替代时只传默认 false，没有使用已有 clearConstraints 撤回合同；补为 clearConstraints:['allowAlternatives']，没有改合并语义。

候选和最终快照保留明确允许的非同款，但标 SIMILAR／ALTERNATIVE／NEEDS_VERIFICATION，因此只能作研究卡；检查实际选中的替代卡仍保留目标锚点、不能借标题转正。显式撤回替代后原单款继续保留。已全球确认的跨店同款，只有实际所选 merchant/path 的唯一、请求选项一致的 provider 变体响应才能重锚，未请求 sibling 和另一商品／host 拒绝。预算及未改硬条件保留。

Woo 私有持久 schema 复用 source DTO 的有界字段和只读 URL，再核 host、URL 选项／ID、variation 关系；严格拒绝额外字段和畸形值，公共模型输入不增加 wooAnchor 或 shopifyAnchor。真实注册 MCP 搜索取得 Woo DTO→存入 SQLite→关闭→同可信 thread 重建→render 原快照通过，跨 thread 读取拒绝。此为双服务实例合同，不是原生 UI 选择或宿主重启验收。

Woo reviewer 另在公共 searchProducts 复现同店 Shopify handle 与所复制 URL variant 相反的行被保留。新增 alternatives=false/true 两红，随后只在 Shopify 自有来源同 host 绑定处拒绝矛盾，恢复网页、Awin、Woo 本地 handle 不套。最终卡与派生 inspect 保持同护栏。证据 `shopify-url-anchor-handle-red.json` 保留 2 FAIL。

最终模块状态：`shopify-url-anchor-green-r7.json` 29／29 PASS；`shopify-url-anchor-related-r2.json` 11 个文件 199／199 PASS；MCP build r6、tsc --noEmit r4、7 个源码／测试文件 ESLint r2 全通过。构建纳入视觉参数说明及技能字数修订。Sony 独立 public MCP 7／7 PASS（`artifacts/sony-review/url-anchor-review-green-attempt-r1.log`），原四红已消失，含替代 inspect 不转正和跨店错误 parent／host 拒绝。原生最终安装版本的复验交主任务执行，先前原生发现的套装缺陷仍保留分母，不用本地绿覆盖。

最终独立静态复核均无新增已复现问题：Sony `artifacts/sony-review/url-anchor-review-final.json`；Woo 原 handle 公共反例复跑 1 PASS／0 FAIL，保留初始 1 FAIL，receipt `artifacts/remaining-completion/shopify-anchor-independent-review-final.json`。交接时未改版本的 MCP bundle 为 1,412,041 bytes，SHA256 `af828bf8d1a821d535b7207e2ca69c81f73e9db812a0e1c2ccce9d0fc9c05502`；这是本地源码构建证据，不代表最终安装／原生版本。构建锁交还主任务统一交付。
