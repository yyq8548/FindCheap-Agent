# Commerce Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立可独立运行和测试的商品身份、到手价、排序、持久化与查询核心。

**Architecture:** 业务合同放在独立 Zod package；Product Identity、Pricing 和 Ranking 保持纯函数；PostgreSQL repositories 处理持久化；Fastify API 只做鉴权、校验和用例编排。全文搜索第一阶段使用 PostgreSQL，不引入 Elasticsearch。

**Tech Stack:** Node.js 22 LTS、TypeScript strict、pnpm、Fastify 5、Zod、PostgreSQL 17、Redis 7.4、Drizzle ORM、Vitest、Testcontainers、Docker Compose。

## Global Constraints

- 金额一律使用整数美分和 `USD`，禁止浮点运算。
- 时间一律为 UTC ISO 8601；测试使用注入式 Clock。
- LLM 不得单独产生 `EXACT` 匹配结论。
- 相似款不得进入精确同款排序。
- 只有用户已有资格的会员价进入默认排序。
- Affiliate 佣金不得进入任何 ranking 接口。
- 所有外部输入先经 Zod 解析。
- TypeScript 开启 `strict`、`noUncheckedIndexedAccess`、`exactOptionalPropertyTypes`。

---

## File Map

```text
package.json                         # 根命令和工具版本
pnpm-workspace.yaml                  # workspace 范围
tsconfig.base.json                   # 全局严格 TypeScript
docker-compose.yml                   # PostgreSQL、Redis 本地依赖
apps/commerce-api/src/app.ts         # Fastify 组装
apps/commerce-api/src/routes/compare.ts
packages/contracts/src/*.ts          # Zod 合同和类型
packages/db/src/schema.ts            # Drizzle schema
packages/db/src/repositories/*.ts    # 数据访问
packages/product-identity/src/*.ts   # 标准化和匹配
packages/pricing/src/*.ts            # 到手价计算
packages/ranking/src/*.ts            # 结果排序
packages/test-kit/src/*.ts           # Clock、fixture、DB helpers
infra/migrations/0001_core.sql       # 初始数据模型
data/gold-set/products.jsonl         # 人工验证样本
```

### Task 1: Bootstrap the Monorepo and CI Contract

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `vitest.workspace.ts`
- Create: `docker-compose.yml`
- Create: `.github/workflows/ci.yml`
- Test: `tests/smoke/workspace.test.ts`

**Interfaces:**
- Consumes: none
- Produces: 根命令 `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration`

- [ ] **Step 1: Write the workspace smoke test**

```ts
// tests/smoke/workspace.test.ts
import { describe, expect, it } from "vitest";

describe("workspace", () => {
  it("runs tests under Node 22", () => {
    expect(Number(process.versions.node.split(".")[0])).toBe(22);
  });
});
```

- [ ] **Step 2: Run it and verify the pre-bootstrap failure**

Run: `pnpm vitest run tests/smoke/workspace.test.ts`

Expected: FAIL because no root package/workspace exists.

- [ ] **Step 3: Create the minimal workspace configuration**

```json
{
  "name": "ai-transaction-agent",
  "private": true,
  "engines": { "node": ">=22 <23" },
  "packageManager": "pnpm@10",
  "scripts": {
    "lint": "eslint .",
    "typecheck": "tsc -b --pretty false",
    "test": "vitest run",
    "test:integration": "vitest run --config vitest.integration.ts"
  },
  "devDependencies": {
    "@types/node": "^22",
    "eslint": "^9",
    "typescript": "^5.9",
    "vitest": "^3"
  }
}
```

```yaml
# pnpm-workspace.yaml
packages:
  - apps/*
  - packages/*
```

```json
// tsconfig.base.json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "declaration": true,
    "skipLibCheck": true
  }
}
```

```yaml
# docker-compose.yml
services:
  postgres:
    image: postgres:17
    environment:
      POSTGRES_USER: shopping
      POSTGRES_PASSWORD: local-only
      POSTGRES_DB: shopping
    ports: ["5432:5432"]
  redis:
    image: redis:7.4-alpine
    ports: ["6379:6379"]
```

- [ ] **Step 4: Install, typecheck, and run the smoke test**

Run: `corepack enable && pnpm install && pnpm test -- tests/smoke/workspace.test.ts`

Expected: PASS, 1 test.

- [ ] **Step 5: Add CI using the same commands**

```yaml
# .github/workflows/ci.yml
name: ci
on: [push, pull_request]
jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: corepack enable
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck
      - run: pnpm test
```

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-workspace.yaml tsconfig.base.json vitest.workspace.ts docker-compose.yml .github/workflows/ci.yml tests/smoke/workspace.test.ts pnpm-lock.yaml
git commit -m "chore: bootstrap shopping agent workspace"
```

### Task 2: Define Stable Commerce Contracts

**Files:**
- Create: `packages/contracts/package.json`
- Create: `packages/contracts/src/money.ts`
- Create: `packages/contracts/src/product.ts`
- Create: `packages/contracts/src/offer.ts`
- Create: `packages/contracts/src/comparison.ts`
- Create: `packages/contracts/src/index.ts`
- Test: `packages/contracts/test/contracts.test.ts`

**Interfaces:**
- Consumes: Zod
- Produces: `Money`, `CanonicalProduct`, `MerchantOffer`, `PriceQuote`, `ComparisonResult`, corresponding schemas

- [ ] **Step 1: Write failing schema tests**

```ts
import { describe, expect, it } from "vitest";
import { MoneySchema, PriceQuoteSchema } from "../src/index.js";

describe("commerce contracts", () => {
  it("rejects fractional cents", () => {
    expect(() => MoneySchema.parse({ amountCents: 10.5, currency: "USD" })).toThrow();
  });

  it("requires evidence for a verified quote", () => {
    expect(() => PriceQuoteSchema.parse({
      quoteId: "q1", offerId: "o1", status: "VERIFIED",
      deliveredPrice: { amountCents: 1000, currency: "USD" },
      lineItems: [], eligibilityConditions: [], evidenceRefs: [],
      checkedAt: "2026-08-13T12:00:00.000Z",
      expiresAt: "2026-08-13T12:15:00.000Z"
    })).toThrow();
  });
});
```

- [ ] **Step 2: Run and verify missing exports**

Run: `pnpm vitest run packages/contracts/test/contracts.test.ts`

Expected: FAIL with module/export not found.

- [ ] **Step 3: Implement the minimum shared schemas**

```ts
// packages/contracts/src/money.ts
import { z } from "zod";
export const MoneySchema = z.object({
  amountCents: z.number().int(),
  currency: z.literal("USD")
});
export type Money = z.infer<typeof MoneySchema>;
```

```ts
// packages/contracts/src/product.ts
import { z } from "zod";
export const AttributeSchema = z.object({
  name: z.string().min(1), value: z.string().min(1),
  unit: z.string().min(1).optional(), source: z.string().min(1),
  confidence: z.number().min(0).max(1)
});
export const CanonicalProductSchema = z.object({
  productId: z.string().min(1), brand: z.string().min(1),
  manufacturerPartNumber: z.string().min(1).optional(),
  gtins: z.array(z.string().regex(/^\d{8,14}$/)),
  title: z.string().min(1), categoryPath: z.array(z.string().min(1)),
  attributes: z.array(AttributeSchema),
  variantDimensions: z.record(z.string(), z.string())
});
export type CanonicalProduct = z.infer<typeof CanonicalProductSchema>;
```

```ts
// packages/contracts/src/offer.ts
import { z } from "zod";
import { MoneySchema } from "./money.js";
export const MatchStatusSchema = z.enum(["EXACT", "NEEDS_CONFIRMATION", "SIMILAR", "INSUFFICIENT"]);
export const QuoteStatusSchema = z.enum(["VERIFIED", "ESTIMATED", "CONDITIONAL"]);
export const PriceLineItemSchema = z.object({
  kind: z.enum(["ITEM", "COUPON", "MEMBERSHIP", "SHIPPING", "TAX", "MANDATORY_FEE"]),
  amount: MoneySchema, label: z.string().min(1), condition: z.string().min(1).optional()
});
export const PriceQuoteSchema = z.object({
  quoteId: z.string().min(1), offerId: z.string().min(1),
  status: QuoteStatusSchema, deliveredPrice: MoneySchema,
  lineItems: z.array(PriceLineItemSchema),
  eligibilityConditions: z.array(z.string()), evidenceRefs: z.array(z.string()),
  checkedAt: z.string().datetime(), expiresAt: z.string().datetime()
}).superRefine((quote, ctx) => {
  if (quote.status === "VERIFIED" && quote.evidenceRefs.length === 0) {
    ctx.addIssue({ code: "custom", path: ["evidenceRefs"], message: "verified quote requires evidence" });
  }
  if (Date.parse(quote.expiresAt) <= Date.parse(quote.checkedAt)) {
    ctx.addIssue({ code: "custom", path: ["expiresAt"], message: "expiresAt must be after checkedAt" });
  }
});
export type PriceQuote = z.infer<typeof PriceQuoteSchema>;

export const MerchantOfferSchema = z.object({
  offerId: z.string().min(1), merchantId: z.string().min(1),
  merchantProductId: z.string().min(1), productId: z.string().min(1).optional(),
  sellerName: z.string().min(1), condition: z.enum(["NEW", "REFURBISHED", "USED"]),
  matchStatus: MatchStatusSchema,
  inventoryStatus: z.enum(["IN_STOCK", "OUT_OF_STOCK", "UNKNOWN"]),
  merchantUrl: z.string().url(), evidenceRefs: z.array(z.string()).min(1),
  checkedAt: z.string().datetime(), expiresAt: z.string().datetime()
});
export type MerchantOffer = z.infer<typeof MerchantOfferSchema>;
```

```ts
// packages/contracts/src/comparison.ts
import { z } from "zod";
import { MatchStatusSchema, PriceQuoteSchema } from "./offer.js";
export const ComparisonOfferSchema = z.object({
  offerId: z.string(), merchantId: z.string(), sellerName: z.string(),
  matchStatus: MatchStatusSchema,
  regularQuote: PriceQuoteSchema,
  memberQuote: z.object({
    programId: z.string(), programName: z.string(), eligible: z.boolean(),
    quote: PriceQuoteSchema
  }).optional(),
  rankingQuote: PriceQuoteSchema,
  affiliateUrl: z.string().url().optional(), merchantUrl: z.string().url(),
  recommendationReasons: z.array(z.string())
});
export const ComparisonResultSchema = z.object({
  productId: z.string(), exactOffers: z.array(ComparisonOfferSchema),
  similarOffers: z.array(ComparisonOfferSchema), questions: z.array(z.string())
});
export type ComparisonResult = z.infer<typeof ComparisonResultSchema>;
```

- [ ] **Step 4: Export, run tests, and typecheck**

```ts
// packages/contracts/src/index.ts
export * from "./money.js";
export * from "./product.js";
export * from "./offer.js";
export * from "./comparison.js";
```

Run: `pnpm vitest run packages/contracts/test/contracts.test.ts && pnpm typecheck`

Expected: PASS, 2 tests; typecheck exit 0.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts
git commit -m "feat: define commerce contracts"
```

### Task 3: Persist Products, Offers, Quotes, Coupons, and Evidence

**Files:**
- Create: `infra/migrations/0001_core.sql`
- Create: `packages/db/src/client.ts`
- Create: `packages/db/src/schema.ts`
- Create: `packages/db/src/repositories/offer-repository.ts`
- Create: `packages/db/src/repositories/product-repository.ts`
- Test: `packages/db/test/repositories.integration.test.ts`

**Interfaces:**
- Consumes: `CanonicalProduct`, `PriceQuote`
- Produces: `ProductRepository.upsert`, `OfferRepository.saveQuote`, `OfferRepository.findComparableOffers`

- [ ] **Step 1: Write the failing repository integration test**

```ts
it("stores quote evidence and returns only unexpired offers", async () => {
  await offers.saveQuote(fixtureQuote({ quoteId: "q1", expiresAt: clock.plusMinutes(5) }));
  await offers.saveQuote(fixtureQuote({ quoteId: "q2", expiresAt: clock.minusMinutes(1) }));
  const rows = await offers.findComparableOffers("product-1", clock.now());
  expect(rows.map((row) => row.quoteId)).toEqual(["q1"]);
  expect(rows[0]?.evidenceRefs).toEqual(["evidence-1"]);
});
```

- [ ] **Step 2: Start PostgreSQL and verify failure before migration**

Run: `docker compose up -d postgres && pnpm test:integration -- packages/db/test/repositories.integration.test.ts`

Expected: FAIL with relation `price_quotes` does not exist.

- [ ] **Step 3: Create the core migration**

```sql
CREATE TABLE products (
  id text PRIMARY KEY,
  brand text NOT NULL,
  manufacturer_part_number text,
  gtins text[] NOT NULL DEFAULT '{}',
  title text NOT NULL,
  category_path text[] NOT NULL,
  attributes jsonb NOT NULL,
  variant_dimensions jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX products_mpn_unique
  ON products (lower(brand), manufacturer_part_number)
  WHERE manufacturer_part_number IS NOT NULL;
CREATE INDEX products_gtins_gin ON products USING gin (gtins);

CREATE TABLE merchant_offers (
  id text PRIMARY KEY,
  merchant_id text NOT NULL,
  merchant_product_id text NOT NULL,
  product_id text REFERENCES products(id),
  seller_name text NOT NULL,
  condition text NOT NULL,
  match_status text NOT NULL,
  inventory_status text NOT NULL,
  merchant_url text NOT NULL,
  checked_at timestamptz NOT NULL,
  UNIQUE (merchant_id, merchant_product_id)
);

CREATE TABLE evidence (
  id text PRIMARY KEY,
  merchant_id text NOT NULL,
  source_url text NOT NULL,
  source_type text NOT NULL,
  content_hash text NOT NULL,
  captured_at timestamptz NOT NULL,
  metadata jsonb NOT NULL
);

CREATE TABLE price_quotes (
  id text PRIMARY KEY,
  offer_id text NOT NULL REFERENCES merchant_offers(id),
  zip_code text NOT NULL,
  membership_context jsonb NOT NULL,
  status text NOT NULL,
  delivered_price_cents integer NOT NULL,
  line_items jsonb NOT NULL,
  eligibility_conditions jsonb NOT NULL,
  evidence_refs text[] NOT NULL,
  checked_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX price_quotes_offer_expiry ON price_quotes (offer_id, expires_at DESC);
```

- [ ] **Step 4: Implement repositories with explicit expiry filtering**

```ts
export interface OfferRepository {
  saveQuote(input: StoredPriceQuote): Promise<void>;
  findComparableOffers(productId: string, now: Date): Promise<StoredPriceQuote[]>;
}

export function createOfferRepository(db: Db): OfferRepository {
  return {
    async saveQuote(input) { await db.insert(priceQuotes).values(input).onConflictDoUpdate({ target: priceQuotes.id, set: input }); },
    async findComparableOffers(productId, now) {
      return db.select().from(priceQuotes)
        .innerJoin(merchantOffers, eq(priceQuotes.offerId, merchantOffers.id))
        .where(and(eq(merchantOffers.productId, productId), gt(priceQuotes.expiresAt, now)));
    }
  };
}
```

- [ ] **Step 5: Run migration and integration tests**

Run: `pnpm db:migrate && pnpm test:integration -- packages/db/test/repositories.integration.test.ts`

Expected: PASS; expired quote absent.

- [ ] **Step 6: Commit**

```bash
git add infra/migrations/0001_core.sql packages/db
git commit -m "feat: persist commerce entities and evidence"
```

### Task 4: Implement Deterministic Product Matching

**Files:**
- Create: `packages/product-identity/src/normalize.ts`
- Create: `packages/product-identity/src/match.ts`
- Create: `packages/product-identity/src/index.ts`
- Test: `packages/product-identity/test/match.test.ts`

**Interfaces:**
- Consumes: `CanonicalProduct`, normalized merchant candidate
- Produces: `matchProduct(candidate, canonical): MatchDecision`

- [ ] **Step 1: Write failing exact/uncertain/similar tests**

```ts
it.each([
  [candidate({ gtins: ["012345678905"], color: "black" }), "EXACT"],
  [candidate({ gtins: ["012345678905"], color: "white" }), "NEEDS_CONFIRMATION"],
  [candidate({ gtins: [], mpn: undefined, title: "similar oled tv" }), "SIMILAR"]
])("classifies identity evidence", (input, expected) => {
  expect(matchProduct(input, canonicalTv()).status).toBe(expected);
});
```

- [ ] **Step 2: Run and verify failure**

Run: `pnpm vitest run packages/product-identity/test/match.test.ts`

Expected: FAIL because `matchProduct` is missing.

- [ ] **Step 3: Implement normalization and hard exact gates**

```ts
export type MatchDecision = {
  status: "EXACT" | "NEEDS_CONFIRMATION" | "SIMILAR" | "INSUFFICIENT";
  evidence: string[];
};

export type CandidateProduct = {
  brand: string;
  mpn?: string;
  gtins: string[];
  title: string;
  variantDimensions: Record<string, string>;
  coreSimilarity: number;
};

export function normalizeToken(value: string): string {
  return value.normalize("NFKC").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export function matchProduct(candidate: CandidateProduct, product: CanonicalProduct): MatchDecision {
  const sameGtin = candidate.gtins.some((id) => product.gtins.includes(id));
  const sameMpn = Boolean(candidate.mpn && product.manufacturerPartNumber &&
    normalizeToken(candidate.brand) === normalizeToken(product.brand) &&
    normalizeToken(candidate.mpn) === normalizeToken(product.manufacturerPartNumber));
  if (!sameGtin && !sameMpn) {
    return candidate.coreSimilarity >= 0.75
      ? { status: "SIMILAR", evidence: ["core attributes similar; identity absent"] }
      : { status: "INSUFFICIENT", evidence: ["identity absent"] };
  }
  const conflicts = Object.keys(product.variantDimensions).filter((key) =>
    candidate.variantDimensions[key] !== product.variantDimensions[key]);
  return conflicts.length === 0
    ? { status: "EXACT", evidence: [sameGtin ? "GTIN exact" : "brand and MPN exact"] }
    : { status: "NEEDS_CONFIRMATION", evidence: conflicts.map((key) => `variant conflict: ${key}`) };
}
```

- [ ] **Step 4: Run tests and add the no-LLM-exact invariant**

```ts
it("never upgrades semantic similarity to exact", () => {
  const result = matchProduct(candidate({ gtins: [], mpn: undefined, coreSimilarity: 1 }), canonicalTv());
  expect(result.status).not.toBe("EXACT");
});
```

Run: `pnpm vitest run packages/product-identity/test/match.test.ts`

Expected: PASS, including invariant.

- [ ] **Step 5: Commit**

```bash
git add packages/product-identity
git commit -m "feat: enforce evidence based product matching"
```

### Task 5: Calculate Delivered Price and Membership Eligibility

**Files:**
- Create: `packages/pricing/src/calculate-quote.ts`
- Create: `packages/pricing/src/coupon-eligibility.ts`
- Create: `packages/pricing/src/index.ts`
- Test: `packages/pricing/test/calculate-quote.test.ts`

**Interfaces:**
- Consumes: `QuoteInput`, `UserPriceContext`
- Produces: `calculatePriceOptions(input, user): PriceOptions`

- [ ] **Step 1: Write failing price rules**

```ts
it("uses member discount only when the user already has membership", () => {
  const eligible = calculatePriceOptions(offerWithMemberDiscount(1000, 200), user({ memberships: ["costco"] }));
  const ineligible = calculatePriceOptions(offerWithMemberDiscount(1000, 200), user({ memberships: [] }));
  expect(eligible.regularQuote.deliveredPrice.amountCents).toBe(1000);
  expect(eligible.memberQuote?.quote.deliveredPrice.amountCents).toBe(800);
  expect(eligible.rankingQuote.deliveredPrice.amountCents).toBe(800);
  expect(ineligible.memberQuote?.quote.deliveredPrice.amountCents).toBe(800);
  expect(ineligible.rankingQuote.deliveredPrice.amountCents).toBe(1000);
});

it("does not count unverified coupon or cashback", () => {
  const prices = calculatePriceOptions(offer({ item: 1000, coupon: { cents: 100, verified: false }, cashback: 500 }), user());
  expect(prices.rankingQuote.deliveredPrice.amountCents).toBe(1000);
});
```

- [ ] **Step 2: Run and verify failure**

Run: `pnpm vitest run packages/pricing/test/calculate-quote.test.ts`

Expected: FAIL because calculator is missing.

- [ ] **Step 3: Implement integer-cent price composition**

```ts
export type PriceOptions = {
  regularQuote: PriceQuote;
  memberQuote?: { programId: string; programName: string; eligible: boolean; quote: PriceQuote };
  rankingQuote: PriceQuote;
};

function composeQuote(input: QuoteInput, user: UserPriceContext, includeMemberDiscount: boolean): PriceQuote {
  const couponEligible = input.coupon?.verificationStatus === "VERIFIED" &&
    input.coupon.eligibility.every((rule) => ruleSatisfied(rule, user, input));
  const lines = [
    line("ITEM", input.itemPriceCents),
    ...(includeMemberDiscount ? [line("MEMBERSHIP", -input.membershipDiscount!.amountCents)] : []),
    ...(couponEligible ? [line("COUPON", -input.coupon!.amountCents)] : []),
    line("SHIPPING", input.shippingCents),
    line("TAX", input.taxCents),
    line("MANDATORY_FEE", input.mandatoryFeeCents)
  ];
  const delivered = lines.reduce((sum, item) => sum + item.amount.amountCents, 0);
  const status = input.taxVerified && input.shippingVerified && input.evidenceRefs.length > 0
    ? "VERIFIED" : "ESTIMATED";
  return PriceQuoteSchema.parse({ ...input.identity, lineItems: lines,
    deliveredPrice: { amountCents: delivered, currency: "USD" },
    status, eligibilityConditions: collectConditions(input),
    evidenceRefs: input.evidenceRefs, checkedAt: input.checkedAt });
}

export function calculatePriceOptions(input: QuoteInput, user: UserPriceContext): PriceOptions {
  const regularQuote = composeQuote(input, user, false);
  if (!input.membershipDiscount) return { regularQuote, rankingQuote: regularQuote };
  const eligible = user.memberships.includes(input.membershipDiscount.programId);
  const memberQuote = {
    programId: input.membershipDiscount.programId,
    programName: input.membershipDiscount.programName,
    eligible,
    quote: composeQuote(input, user, true)
  };
  return { regularQuote, memberQuote, rankingQuote: eligible ? memberQuote.quote : regularQuote };
}
```

- [ ] **Step 4: Add table tests for tax, shipping, fee, conditional coupon**

```ts
it.each([
  [{ item: 1000, shipping: 100, tax: 80, fee: 20 }, 1200, "VERIFIED"],
  [{ item: 1000, shipping: 0, tax: 70, fee: 0, taxVerified: false }, 1070, "ESTIMATED"]
])("calculates line items", (parts, total, status) => {
  const prices = calculatePriceOptions(offer(parts), user());
  expect([prices.rankingQuote.deliveredPrice.amountCents, prices.rankingQuote.status]).toEqual([total, status]);
});
```

Run: `pnpm vitest run packages/pricing/test/calculate-quote.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/pricing
git commit -m "feat: calculate eligible delivered prices"
```

### Task 6: Rank Exact Offers Without Affiliate Bias

**Files:**
- Create: `packages/ranking/src/rank-offers.ts`
- Create: `packages/ranking/src/index.ts`
- Test: `packages/ranking/test/rank-offers.test.ts`

**Interfaces:**
- Consumes: `ComparisonOffer[]`, `RankingContext`
- Produces: `rankExactOffers(offers, context): ComparisonOffer[]`

- [ ] **Step 1: Write failing ranking invariants**

```ts
it("excludes similar and unqualified member prices", () => {
  const ranked = rankExactOffers([
    offer({ id: "similar", match: "SIMILAR", total: 500 }),
    offer({ id: "member-preview", match: "EXACT", regularTotal: 900, memberTotal: 600, memberEligible: false }),
    offer({ id: "regular", match: "EXACT", regularTotal: 700 })
  ], { memberships: [] });
  expect(ranked.map((x) => x.offerId)).toEqual(["regular", "member-preview"]);
  expect(ranked[1]?.rankingQuote.deliveredPrice.amountCents).toBe(900);
  expect(ranked[1]?.memberQuote?.quote.deliveredPrice.amountCents).toBe(600);
});

it("has no commission input", () => {
  expect(rankExactOffers.length).toBe(2);
});
```

- [ ] **Step 2: Run and verify failure**

Run: `pnpm vitest run packages/ranking/test/rank-offers.test.ts`

Expected: FAIL because ranker is missing.

- [ ] **Step 3: Implement deterministic ranking**

```ts
export type RankingContext = { memberships: string[] };

export function rankExactOffers(offers: ComparisonOffer[], context: RankingContext): ComparisonOffer[] {
  return offers
    .filter((offer) => offer.matchStatus === "EXACT")
    .map((offer) => selectRankingQuote(offer, context.memberships))
    .sort((a, b) => {
      return a.rankingQuote.deliveredPrice.amountCents -
        b.rankingQuote.deliveredPrice.amountCents ||
        freshnessScore(b) - freshnessScore(a);
    });
}

function selectRankingQuote(offer: ComparisonOffer, memberships: string[]): ComparisonOffer {
  const memberEligible = offer.memberQuote !== undefined &&
    offer.memberQuote.eligible && memberships.includes(offer.memberQuote.programId);
  return { ...offer, rankingQuote: memberEligible ? offer.memberQuote!.quote : offer.regularQuote };
}
```

- [ ] **Step 4: Run tests and compile the public signature**

Run: `pnpm vitest run packages/ranking/test/rank-offers.test.ts && pnpm typecheck`

Expected: PASS; the exported function accepts no commission field.

- [ ] **Step 5: Commit**

```bash
git add packages/ranking
git commit -m "feat: rank exact offers without commission bias"
```

### Task 7: Expose the Commerce Comparison Use Case

**Files:**
- Create: `apps/commerce-api/package.json`
- Create: `apps/commerce-api/src/compare-products.ts`
- Create: `apps/commerce-api/src/routes/compare.ts`
- Create: `apps/commerce-api/src/app.ts`
- Test: `apps/commerce-api/test/compare.test.ts`

**Interfaces:**
- Consumes: repositories, `matchProduct`, `calculatePriceOptions`, `rankExactOffers`
- Produces: `POST /v1/comparisons`, `compareProducts(input): Promise<ComparisonResult>`

- [ ] **Step 1: Write the failing API test**

```ts
it("separates exact offers and similar offers", async () => {
  const response = await app.inject({
    method: "POST", url: "/v1/comparisons",
    payload: { query: "OLED65C4PUA", zipCode: "33433", memberships: ["costco"] }
  });
  expect(response.statusCode).toBe(200);
  expect(response.json().exactOffers.every((x: { matchStatus: string }) => x.matchStatus === "EXACT")).toBe(true);
  expect(response.json().similarOffers.every((x: { matchStatus: string }) => x.matchStatus === "SIMILAR")).toBe(true);
});
```

- [ ] **Step 2: Run and verify route-not-found**

Run: `pnpm vitest run apps/commerce-api/test/compare.test.ts`

Expected: FAIL with 404.

- [ ] **Step 3: Implement the use case and validated route**

```ts
const CompareInputSchema = z.object({
  query: z.string().min(2).max(300),
  zipCode: z.string().regex(/^\d{5}$/),
  memberships: z.array(z.string().min(1)).max(30).default([])
});

export async function compareProducts(input: CompareInput, deps: CompareDeps): Promise<ComparisonResult> {
  const candidates = await deps.offers.search(input.query);
  const classified = await Promise.all(candidates.map((candidate) => deps.classify(candidate)));
  const exact = classified.filter((x) => x.matchStatus === "EXACT");
  const quoted = await Promise.all(exact.map((offer) => deps.quote(offer, input)));
  return ComparisonResultSchema.parse({
    productId: resolveProductId(classified),
    exactOffers: rankExactOffers(quoted, { memberships: input.memberships }),
    similarOffers: classified.filter((x) => x.matchStatus === "SIMILAR"),
    questions: questionsFor(classified)
  });
}

app.post("/v1/comparisons", async (request, reply) => {
  const input = CompareInputSchema.parse(request.body);
  return reply.send(await compareProducts(input, deps));
});
```

- [ ] **Step 4: Add failure and stale-data tests**

```ts
it("returns a clarification question instead of guessing a variant", async () => {
  const result = await compareProducts({ query: "AirPods", zipCode: "33433", memberships: [] }, ambiguousDeps);
  expect(result.exactOffers).toEqual([]);
  expect(result.questions[0]).toMatch(/型号|model/i);
});
```

Run: `pnpm vitest run apps/commerce-api/test/compare.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/commerce-api
git commit -m "feat: expose comparison commerce api"
```

### Task 8: Add Gold Set Evaluation

**Files:**
- Create: `data/gold-set/schema.json`
- Create: `data/gold-set/products.jsonl`
- Create: `packages/test-kit/src/gold-set.ts`
- Create: `scripts/evaluate-matching.ts`
- Test: `packages/test-kit/test/gold-set.test.ts`

**Interfaces:**
- Consumes: `matchProduct`, JSONL human labels
- Produces: `pnpm eval:matching`, JSON metrics with precision and coverage

- [ ] **Step 1: Add three seed records and failing evaluator test**

```json
{"caseId":"tv-same","expected":"EXACT","canonical":{"brand":"LG","mpn":"OLED65C4PUA","variants":{"size":"65"}},"candidate":{"brand":"LG","mpn":"OLED65C4PUA","variants":{"size":"65"}}}
{"caseId":"tv-size-conflict","expected":"NEEDS_CONFIRMATION","canonical":{"brand":"LG","mpn":"OLED65C4PUA","variants":{"size":"65"}},"candidate":{"brand":"LG","mpn":"OLED65C4PUA","variants":{"size":"55"}}}
{"caseId":"tv-similar","expected":"SIMILAR","canonical":{"brand":"LG","mpn":"OLED65C4PUA","variants":{"size":"65"}},"candidate":{"brand":"Samsung","mpn":"QN65S90D","variants":{"size":"65"}}}
```

```ts
it("computes exact precision", async () => {
  const report = await evaluateGoldSet(seedCases());
  expect(report.exactPrecision).toBe(1);
  expect(report.total).toBe(3);
});
```

- [ ] **Step 2: Run and verify missing evaluator**

Run: `pnpm vitest run packages/test-kit/test/gold-set.test.ts`

Expected: FAIL because `evaluateGoldSet` is missing.

- [ ] **Step 3: Implement deterministic metrics**

```ts
export function evaluateGoldSet(cases: GoldCase[]): EvaluationReport {
  const rows = cases.map((item) => ({ expected: item.expected, actual: matchProduct(item.candidate, item.canonical).status }));
  const predictedExact = rows.filter((x) => x.actual === "EXACT");
  const trueExact = predictedExact.filter((x) => x.expected === "EXACT").length;
  return {
    total: rows.length,
    exactPrecision: predictedExact.length === 0 ? 0 : trueExact / predictedExact.length,
    coverage: rows.filter((x) => x.actual !== "INSUFFICIENT").length / rows.length,
    failures: rows.filter((x) => x.actual !== x.expected)
  };
}
```

- [ ] **Step 4: Run evaluation and enforce the initial precision gate**

Run: `pnpm vitest run packages/test-kit/test/gold-set.test.ts && pnpm eval:matching -- --min-exact-precision=0.98`

Expected: PASS for seed set; later Phase 0 expands file to at least 500 human-reviewed rows.

- [ ] **Step 5: Commit**

```bash
git add data/gold-set packages/test-kit scripts/evaluate-matching.ts package.json
git commit -m "test: add product matching gold set evaluation"
```

## Foundation Exit Check

Run:

```bash
pnpm lint
pnpm typecheck
pnpm test
docker compose up -d postgres redis
pnpm db:migrate
pnpm test:integration
pnpm eval:matching -- --min-exact-precision=0.98
```

Expected: all commands exit 0; fixed-fixture request returns exact and similar arrays separately; no ranking API accepts commission data.
