# Shopify 所选商品检查的跟踪参数兼容

## Research

基线 `d32f05b3900fb716eebbcf3f36fe5c06017bad27`，R3 包 `0.18.6+codex.20260909214736`，MCP SHA `af828bf8d1a821d535b7207e2ca69c81f73e9db812a0e1c2ccce9d0fc9c05502`。已读 AGENTS、研发协议、总设计第 4／7／8／13 节。主任务批准修复这一真实原生回归并复核，不批准重试原请求、扩大来源请求或修改版本／安装缓存。

原生 R3 任务 `01a0882f-5deb-7803-9d01-d7154421c095` 正确搜索到 Glossier Balm Dotcom Espresso 单支 USD16、NEW／IN_STOCK；另一身份问题的套装排除有效。22:00:47Z 的 inspect_selected_product 使用真实 renderId／selectionId／variantId46731565826293，没有 variantDimensions，失败为 INSPECTION_SCHEMA_INVALID，phase SOURCE_READ。原卡 merchantUrl 带 variant、_gsid、utm_source、utm_medium。R2 任务 `01a087fa-8793-7201-a995-d4b25d9dc0cf` 的原目标卡也含同一组参数，检查同样显式传 variantId、没有 variantDimensions，当时返回 OK／1 变体；不是调用者新增规格参数导致。

调用链：server inspectionHandler 读取实际 selected 并等待 provider.inspect 成功，新增 matchesSelectedShopifyInspection 用完整 selected URL 创建私有 ShopifyProductAnchor。私有 schema 只允许 variant，归因参数因此触发本地 ZodError；server 的统一 catch 把它分成 SOURCE_READ／SCHEMA_INVALID。真实上游响应正文没有保存，不能断言上游当时绝无另一错误；但离线用实际 URL、固定成功 provider 公共 MCP 入口已必现相同错误。证据 `artifacts/remaining-completion/glossier-r3-inspection-red.log`：3 项中 1 PASS、2 FAIL，其中 clean URL 通过、tracked helper 和完整注册 MCP 失败。没有额外 HTTP 或原生重试。

已有 known-product-url 使用明确归因键集合，offer-equivalence 另外认可 Shopify Global 的 _gsid；两者未暴露适合当前商家无关内部匹配的规范化 API。不能调用绑定官网信任的解析器来处理合法跨店 selected 商品，也不应为了一个匹配点修改所有公共 URL 入口。

## Propose

| 方案 | 收益与代价 | 身份／安全边界 |
| --- | --- | --- |
| A：检查 helper 内规范化身份 URL | 一个模块，不改变公开合同、保存的商品 URL 或 provider；复用已认可归因键规则。 | 只剔 srsltid/gclid/fbclid/_gsid 及现有明确 utm 键；其他 query 保留并拒绝。原 host/path/variant、全局同款及选项证明继续核验。 |
| C：来源 adapter 返回独立规范商品 URL，server 显式传入匹配 | 可分离展示 URL 与身份 URL，但新增内部接口并触及 provider/server/所有替身。 | 同样不允许语义参数被归为跟踪；需重新覆盖持久化、跨店和派生消费者。 |

采用主任务批准的 A。放宽私有 schema 以保存跟踪键的 B 被排除：跟踪数据不应成为持久身份字段，也不能通过接受任意参数消除错误。A 比 C 范围小，撤回只涉及本模块及定向测试。不会增加信任、补造商品价、转换币种或扩张请求权限。

## Plan（实现前冻结）

1. 新增专用测试，保留实际 R3 tracked URL 同形公共反例；覆盖普通检查、显式换规格、语义参数、重复或冲突 variant、错误父商品／host、无价格不造卡，以及真正 provider schema 错误仍保留 SOURCE_READ。先验证旧行为红测与原因。
2. 仅修改 shopify-product-anchor.ts。对 selected 和 observed 的内部身份视图剔除已认可跟踪键，验证原安全 URL 及 handle／sourceHost，未知或语义 query 不可删除。内部无效身份返回不匹配，局部 Zod 验证异常不冒充网络错误；不增加包围 provider 的宽 catch，不改变 provider 真失败分类。显式换规格的最终重锚复用同一严格规范化，不盲目剔所有 query。
3. 原子实现后立即独占 `pnpm build:mcp`，运行新测试、既有 URL anchor／selected product／inspection/reference／Woo context 相关回归，`pnpm typecheck`、定向 ESLint、diff 检查。source bundle 和版本不变；主任务后续统一完整验收、包版本与安装。
4. 独立审查由另一代理执行，复跑原 R3 probe 和关键负例。原生实际失败留在独立功能分母，R3 正式矩阵保持未执行；不能把本地公共 fixture 通过标为原生修复验收。

## Implement / Test

新增 `shopify-inspection-tracking.test.ts` 19 项，旧行为 16 FAIL／3 PASS，保留 `glossier-r3-tracking-regression-red.json`。公共测试证明 provider 成功之后出现本地错误；负例也覆盖两侧语义参数、重复／冲突 variant、错误 sourceHost／父路径。真实 R3 的原始失败及另外 3 项 probe 中 2 FAIL／1 PASS 仍保留。

仅在 `shopify-product-anchor.ts` 新增内部 inspectionProductAnchor。selected 与 observed 各自只剔明确十个跟踪键，再通过原严格 URL schema、sourceHost 和 URL variant／handle 核对。其余参数一律保留并被原 schema 拒绝，包括 selling_plan、currency、quantity、utm_variant；没有扩大任意 utm 前缀。局部 ZodError 仅变为不匹配，不包围 provider、不改变真正来源错误分类。显式变体重锚使用同一检查，删除旧有“所有非 variant 参数都剔除”的分支。原商品 merchantUrl、报价、币种、信任和其他硬条件未修改。

原子实现后立即 `pnpm build:mcp` exit 0；当前修复 bundle SHA `d1d09fa28d79fe06e2585a8c859c4302657d0090472e237da789941d6719531b`，source bundle 仍为 `9981ab1dc9c751c55e8092ea0eb4b3fd5b9d26888793847707f62fe087131ff0`。这是尚未重新打包安装的本地候选，不能用 R3 安装证据证明它已在宿主执行。

验证结果：

- 新增 19／19 PASS，包含 tracked 普通检查、显式 Flavor 修订及预算继承、历史 snapshot 不变；无价格检查不会复用原 USD16 造卡；真正 provider SyntaxError 仍为 SOURCE_READ／SCHEMA_INVALID。
- 九个 Shopify／selection／requirements／coffee 相关文件 216／216 PASS；三个 Woo anchor/context/persistence 文件 55／55 PASS。新增 19 已包含在 216 中，不重复计入总数。
- `pnpm typecheck`、定向 ESLint、`git diff --check` 均 exit 0。
- 另一代理独立复跑原真实 URL 三断言与六个公共 MCP 边界，9／9 PASS。独立证据 `artifacts/remaining-completion/shopify-tracking-independent-review.json`，所审源码 SHA `cb657f26753386a26f6df4673affd67e9b1f71f9aac9936d0382fe8d061b9af1`。

全部局部日志位于 `artifacts/remaining-completion/glossier-r3-tracking-*`。源码静态检查未发现新的可复现阻断。已释放 MCP 构建锁交主任务完成全套、下一候选版本／安装与独立原生验收；本步骤未提交、推送、安装、部署、联网重试或运行正式矩阵。原 R3 请求的失败不因本地修复变更为通过。

### R4 完整集成

主任务生成 R4 包 `0.18.6+codex.20260909221227` 并再次构建 MCP，bundle SHA 为 `d1d09fa28d79fe06e2585a8c859c4302657d0090472e237da789941d6719531b`；source SHA 仍为 `9981ab1dc9c751c55e8092ea0eb4b3fd5b9d26888793847707f62fe087131ff0`，无需重复部署。`final-tests-r6.json`：210文件／4,116 PASS／0 FAIL；`final-typecheck-r5.log`、`final-lint-r5.log`均通过。早期R3原生及红测保持原样，R3正式文字／图片矩阵均未执行；最终R4安装及原生复验继续独立交付。

### R4 原生与安装交付

最终包 `0.18.6+codex.20260909221227`，MCP SHA `d1d09fa28d79fe06e2585a8c859c4302657d0090472e237da789941d6719531b`，运行提交 `3228e2298d719574653e264a25ddfb377b0429d2`。两个CI均PASS（plugin 34411194008、Windows 34411194042）；installer1.2.1 于22:14:48Z实际成功，先备份 `f2b8028f41384e4faec2c39817d35785` 再升级。后续授权兼容同步5入口70文件，实际canonical stdio5/5，证据 `installed-cache-verification-r4.json`／`installed-stdio-r4-binding.json`。源服务bundle未变，不重复部署。

新任务 `01a0883d-a248-78d1-8a0b-cf0dbb269d5c`（v0.18.6 R4 实测：Glossier 精确变体）60.397秒完成。原始回执 line29 搜索1张Espresso单支卡，带variant/_gsid/utm_source/utm_medium；line36原variantId检查OK，派生1张同款卡，SKU BDC-467-00-00、USD16、IN_STOCK、variant46731565826293。运行trace版本0.18.6与独立安装SHA分开核对。R3失败保留在原业务receipt，R4为 `glossier-r4-business-receipt.json`。此次没有报价或购物车调用；quoteCapability表示支持，真实运税和用户表单仍属F13。

正式文字R4清单30位置已冻结，S01任务 `01a08841-a777-7001-a072-8eeb1242970e` 在首次search_products宿主审批处等待，尚无购物回执；并未创建其他待审批样本来绕过。R3原Sony/medicube功能任务也保留原权限等待；R3未执行矩阵不混入R4。图片R4清单8保留/6计划/2原准备失败/0执行，等待文字矩阵完成。审批等待时长未获独立确认，不能当纯工具耗时或随意扣除。
