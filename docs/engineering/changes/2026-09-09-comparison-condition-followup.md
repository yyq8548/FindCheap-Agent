# 同款比较中的重复货况字段

## Research

总设计第4、5、6、13节要求稳定商品身份、选定颜色及货况一致，不能以多卡数量替代真实同规格比较。2026-09-09 root真实来源诊断取得Sony官网和GRAMOPHONE两张黑色全新WH-1000XM5卡：两者GTIN均为027242923232、brand Sony、condition NEW、选定Color Black。第二张额外保留了`variantDimensions.Condition=New`；`product-value-evidence.ts:comparableSameProduct`比较所有维度的串，因一个来源重复记录货况而判非同款，最终`comparableMerchants=1`。

原回执：`artifacts/remaining-completion/cross-store-1788984346102/F08.json`。GRAMOPHONE为HIGH_RATED_UNVERIFIED，不是独立已审核商家；本修复不得改变商家信任、首选规则或把它升级为官网。官方库存仍UNKNOWN。第一轮本地诊断F08因脚本用了不支持的color/condition字段被输入校验拒绝（1ms、无来源调用）；修正为requiredFeatures/conditionPreference后得到上述有效回执，保留首次错误。

调用链：来源保留原选项 → shared comparableSameProduct/comparableUnitPrices → value costAdvantage、比较身份、ranking、最终计数和recovery。该模块有独立ValueProduct seam；修改需要MCP消费者构建和相关比较/摘要回归。持久快照原字段不变。

## Propose

| 方案 | 收益 | 风险/代价 |
| --- | --- | --- |
| A：比较时验证重复货况再投影 | 已有共享比较模块先验证选项货况与canonical condition一致，然后从比较键中省去这一重复字段；保留原字段供展示和快照。 | 必须拒绝未知/矛盾的货况选项，覆盖同款和单位价消费者。改动集中、可直接回滚。 |
| B：来源适配统一生成比较维度 | 每个adapter在原维度旁输出经验证的比较维度，后续消费者只使用它。 | 需要多源合同、持久化及全部消费者迁移；字段职责清晰但本问题改动面更大。 |

采用A。只合并与已确认货况完全对应的受控货况标签，不删除任意其他维度，不猜SKU、不改价格或信任。用户已授权完成剩余可控缺陷。

## Plan C1（冻结）

1. 公共seam新增原始Sony/GRAMOPHONE对及负例：同GTIN、同NEW、同Black，一个有Condition New；必须同款、两个商家、价差199美分。未知/矛盾/多重货况、不同颜色或包装仍不可比；原对象保持不变。先确认红。
2. 修改`product-value-evidence.ts`，验证重复货况一致并排除该冗余维度。单位价比较共用同一约束。MCP构建锁释放后立即`pnpm build:mcp`及定向测试。
3. 跑value、ranking、comparison、summary相关合同与最终主套件。之后最终候选新原生任务验证两张实际卡和比较回执；本地固定响应不冒称原生通过。

## Implement / Test

首次红：12项中11失败（既有错误既漏掉同款，也允许两个内部货况矛盾对象彼此比较）。C1最小修复后立即`pnpm build:mcp`退出0；6文件122项相关value/ranking/comparison/recommendation/summary断言全部通过。正式候选集成与原生比较尚未执行。

### 安装后真实原生比较（2026-09-09 21:02Z）

任务 `01a087fa-648c-7783-ac92-5f904a1909d0`（v0.18.6 实测：Sony 同款比较）完成66.563秒；原始rollout文件 `C:/Users/chris/.codex/sessions/2026/09/09/rollout-2026-09-09T17-02-09-01a087fa-648c-7783-ac92-5f904a1909d0.jsonl` 第27行search及37行compare的 `event_msg/item_completed.item.result`为实际回执。searchTrace.buildVersion0.18.6，要求Black／NEW／35000美分，renderId `ce9812f7-197b-41ce-a203-24d797a61334`。

Sony官网29999美分、NEW、Black、库存UNKNOWN；GRAMOPHONE29800美分、NEW、Black及原始Condition New、IN_STOCK。真实compare_selected_products返回OK、SAME_PRODUCT_OFFERS、priceComparability SAME_PRODUCT、ITEM_PRICE、价差199美分；primary仍Sony。GRAMOPHONE trust UNKNOWN／UNVERIFIED，商品评分不代替商家审核。运费／税／到手价未报价，未承诺到手预算。F08此次两家同规格商品价比较成立；不等于全部商家覆盖或UI勾选链验收。

sourceTrace为Awin COMPLETE、Shopify PARTIAL、Woo COMPLETE（累计6个店铺请求、0失败，不是1003全覆盖）、eBay SKIPPED；官方读取ACCEPTED。保持覆盖PARTIAL。原始首次失败与前版本固定响应证据保留。
