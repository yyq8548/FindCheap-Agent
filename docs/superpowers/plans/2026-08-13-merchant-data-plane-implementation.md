# Merchant Data Plane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立可审计的商家选择、统一接入、后台刷新和证据链，并让至少 10 家商家通过上线质量门。

**Architecture:** MerchantAdapter 隔离商家差异；Feed/API、JSON-LD 和 HTTP parser 运行在 TypeScript ingestion worker；动态页面只通过隔离 Python Crawl4AI worker。所有采集结果先验证、规范化、保存 evidence，再进入 Commerce Store。

**Tech Stack:** Node.js 22 LTS、TypeScript、Zod、BullMQ、Redis 7.4、PostgreSQL 17、Undici、Vitest、Python 3.12、FastAPI、pytest、Crawl4AI `0.9.2` 初始审核候选、Docker Compose。

## Global Constraints

- 首批只启用 10–20 家通过质量门的美国主流商家。
- 不绕过登录、CAPTCHA、robots/访问控制或商家条款。
- 数据源优先级固定：授权 Feed/API → JSON-LD/公开 JSON → HTTP → Crawl4AI。
- 外部 URL 不由用户或模型直接提供；只允许 catalog 中审核过的 HTTPS host。
- DNS 解析出的 loopback、private、link-local、multicast 和 metadata IP 全部拒绝。
- Crawl4AI 不在同步查询链路，不执行任意 JavaScript，不持有 Commerce DB 凭据。
- 每条 Offer/Quote 必须带 `checkedAt`、`expiresAt` 和 `evidenceRefs`。
- 未验证 Coupon 不计入到手价；过期或异常价格不进入结果。
- 商家和数据源均具备 feature flag、熔断与 kill switch。

---

## File Map

```text
config/merchants/catalog.yaml                    # 候选、评分、审批和开关
config/merchants/schema.ts                       # catalog schema
packages/merchant-sdk/src/types.ts               # MerchantAdapter 合同
packages/merchant-sdk/src/contract-suite.ts      # 所有 adapter 共用测试
packages/merchant-adapters/src/configured/*.ts   # Feed/JSON-LD/HTTP 配置型 adapter
apps/ingestion-worker/src/jobs/*.ts               # 搜索、刷新、报价任务
apps/ingestion-worker/src/network/safe-fetch.ts   # SSRF/redirect/size 防护
services/crawl4ai-worker/app/*.py                 # 隔离动态页面提取
infra/docker/crawl4ai.Dockerfile                  # 非 root、只读容器
tests/security/crawler-egress.test.ts             # SSRF 与 allowlist 测试
tests/contract/enabled-merchants.test.ts          # 启用商家质量门
```

### Task 1: Create the Merchant Audit Catalog and Gate

**Files:**
- Create: `config/merchants/catalog.yaml`
- Create: `config/merchants/schema.ts`
- Create: `scripts/score-merchants.ts`
- Test: `config/merchants/catalog.test.ts`
- Create: `docs/product/merchant-audit-runbook.md`

**Interfaces:**
- Consumes: 人工完成的数据许可、Affiliate、字段完整度和 PoC 证据
- Produces: `MerchantCatalog`, `pnpm merchants:score`, `selectedForBuild[]`

- [ ] **Step 1: Seed the approved candidate universe and write a failing gate test**

```yaml
version: 1
candidates:
  - { id: amazon, name: Amazon, segment: general, auditState: required }
  - { id: walmart, name: Walmart, segment: general, auditState: required }
  - { id: target, name: Target, segment: general, auditState: required }
  - { id: best-buy, name: Best Buy, segment: specialist, auditState: required }
  - { id: costco, name: Costco, segment: general, auditState: required }
  - { id: sams-club, name: Sam's Club, segment: general, auditState: required }
  - { id: home-depot, name: Home Depot, segment: specialist, auditState: required }
  - { id: lowes, name: Lowe's, segment: specialist, auditState: required }
  - { id: macys, name: Macy's, segment: specialist, auditState: required }
  - { id: nordstrom, name: Nordstrom, segment: specialist, auditState: required }
  - { id: sephora, name: Sephora, segment: promotion-heavy, auditState: required }
  - { id: ulta, name: Ulta, segment: promotion-heavy, auditState: required }
  - { id: walgreens, name: Walgreens, segment: promotion-heavy, auditState: required }
  - { id: cvs, name: CVS, segment: promotion-heavy, auditState: required }
  - { id: chewy, name: Chewy, segment: specialist, auditState: required }
  - { id: wayfair, name: Wayfair, segment: specialist, auditState: required }
  - { id: newegg, name: Newegg, segment: specialist, auditState: required }
  - { id: bh-photo, name: B&H Photo, segment: specialist, auditState: required }
  - { id: rei, name: REI, segment: specialist, auditState: required }
  - { id: dicks, name: Dick's Sporting Goods, segment: specialist, auditState: required }
```

```ts
it("does not select unaudited merchants", () => {
  const result = selectForBuild(seedCatalog);
  expect(result).toEqual([]);
});
```

- [ ] **Step 2: Run and verify missing selector**

Run: `pnpm vitest run config/merchants/catalog.test.ts`

Expected: FAIL because catalog parser/selector is missing.

- [ ] **Step 3: Define exact audit fields and selection rule**

```ts
export const MerchantCandidateSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  segment: z.enum(["general", "specialist", "promotion-heavy"]),
  auditState: z.enum(["required", "in_review", "approved", "rejected"]),
  legalReview: z.enum(["not_started", "approved", "rejected"]).default("not_started"),
  affiliateStatus: z.enum(["not_applied", "pending", "approved", "normal_link_only"]).default("not_applied"),
  provenSource: z.enum(["feed", "api", "jsonld", "http", "crawl4ai"]).optional(),
  allowedHosts: z.array(z.string().min(1)).default([]),
  identityCompleteness: z.number().min(0).max(1).default(0),
  weightedScore: z.number().min(0).max(100).default(0),
  enabled: z.boolean().default(false)
});

export function selectForBuild(catalog: MerchantCatalog): MerchantCandidate[] {
  return catalog.candidates.filter((merchant) =>
    merchant.auditState === "approved" && merchant.legalReview === "approved" &&
    merchant.provenSource !== undefined && merchant.allowedHosts.length > 0 &&
    merchant.identityCompleteness >= 0.9 && merchant.weightedScore >= 70);
}

export function weightedScore(score: {
  data: number; identity: number; priceAndZip: number; legal: number;
  stability: number; coverage: number; maintenance: number;
}): number {
  const dimensions = [
    [score.data, 25], [score.identity, 20], [score.priceAndZip, 15],
    [score.legal, 15], [score.stability, 10], [score.coverage, 10],
    [score.maintenance, 5]
  ] as const;
  return dimensions.reduce((total, [value, weight]) => total + value * weight, 0);
}
```

- [ ] **Step 4: Write the audit runbook and score command**

```text
For each candidate, record: official/affiliate data path proof URL; legal review decision;
affiliate/deep-link state; 100-SKU identity-field sample; ZIP quote capability;
Coupon/member-price semantics; access-control constraints; expected maintenance hours/month.
Each dimension is scored from 0 to 1. Score = data 25 + identity 20 + price/ZIP 15 + legal 15 + stability 10 + coverage 10 + maintenance 5.
Reject any merchant requiring login/CAPTCHA bypass regardless of score.
```

Run: `pnpm merchants:score -- --catalog config/merchants/catalog.yaml`

Expected: prints zero selected merchants until real audit evidence is entered; never invent approval.

- [ ] **Step 5: Commit**

```bash
git add config/merchants scripts/score-merchants.ts docs/product/merchant-audit-runbook.md
git commit -m "feat: gate merchants through evidence based audit"
```

### Task 2: Define MerchantAdapter and Its Contract Suite

**Files:**
- Create: `packages/merchant-sdk/src/types.ts`
- Create: `packages/merchant-sdk/src/contract-suite.ts`
- Create: `packages/merchant-sdk/src/index.ts`
- Test: `packages/merchant-sdk/test/contract-suite.test.ts`

**Interfaces:**
- Consumes: commerce contracts
- Produces: `MerchantAdapter`, `runMerchantContractSuite(adapterFactory, fixtures)`

- [ ] **Step 1: Write a failing test against a deliberately invalid adapter**

```ts
it("rejects offers without evidence and freshness", async () => {
  const report = await runMerchantContractSuite(() => invalidAdapter(), fixtureContext());
  expect(report.failures).toContain("offer evidenceRefs must not be empty");
  expect(report.failures).toContain("expiresAt must be after checkedAt");
});
```

- [ ] **Step 2: Run and verify failure**

Run: `pnpm vitest run packages/merchant-sdk/test/contract-suite.test.ts`

Expected: FAIL because suite is missing.

- [ ] **Step 3: Define the exact adapter contract**

```ts
export type SearchProductsInput = { query: string; limit: number };
export type MerchantProductCandidate = {
  merchantId: string; merchantProductId: string; title: string; brand?: string; mpn?: string;
  gtins: string[]; variantDimensions: Record<string, string>; currency: "USD";
  merchantUrl: string; evidenceRefs: string[]; checkedAt: string; expiresAt: string;
};
export type RawMerchantOffer = MerchantProductCandidate & {
  sellerName: string; condition: "NEW" | "REFURBISHED" | "USED";
  inventoryStatus: "IN_STOCK" | "OUT_OF_STOCK" | "UNKNOWN";
  itemPriceCents: number;
};
export type QuoteDeliveredPriceInput = {
  merchantProductId: string; zipCode: string; memberships: string[];
};
export type RawPriceQuote = {
  merchantProductId: string; itemPriceCents: number; shippingCents: number;
  taxCents: number; mandatoryFeeCents: number; currency: "USD";
  status: "VERIFIED" | "ESTIMATED" | "CONDITIONAL";
  conditions: string[]; evidenceRefs: string[]; checkedAt: string; expiresAt: string;
};
export type CouponQuery = { merchantProductId: string; memberships: string[] };
export type RawCoupon = {
  couponId: string; code?: string; amountCents: number;
  verificationStatus: "VERIFIED" | "UNVERIFIED" | "EXPIRED";
  eligibility: string[]; validFrom: string; validTo: string;
};
export type AffiliateLinkInput = { merchantProductId: string; merchantUrl: string; campaignId: string };
export type AffiliateLinkResult = { url: string; kind: "AFFILIATE" | "NORMAL" };
export type RefreshResult = {
  merchantProductId: string; sourceUrl: string; rawEvidence: string;
  metadata: Record<string, string>; checkedAt: string;
};
export type EvidenceRecord = {
  id: string; merchantId: string; sourceUrl: string; sourceType: string;
  contentHash: string; capturedAt: string; metadata: Record<string, string>;
};

export interface MerchantAdapter {
  readonly merchantId: string;
  searchProducts(input: SearchProductsInput): Promise<MerchantProductCandidate[]>;
  getOffer(merchantProductId: string): Promise<RawMerchantOffer | null>;
  quoteDeliveredPrice(input: QuoteDeliveredPriceInput): Promise<RawPriceQuote>;
  getCoupons(input: CouponQuery): Promise<RawCoupon[]>;
  buildAffiliateLink(input: AffiliateLinkInput): Promise<AffiliateLinkResult>;
  refreshProduct(merchantProductId: string): Promise<RefreshResult>;
  healthCheck(): Promise<MerchantHealth>;
  evidence(entityId: string): Promise<EvidenceRecord[]>;
}

export type MerchantHealth = {
  status: "healthy" | "degraded" | "disabled";
  source: "feed" | "api" | "jsonld" | "http" | "crawl4ai";
  checkedAt: string;
};
```

- [ ] **Step 4: Implement reusable contract assertions**

```ts
export async function runMerchantContractSuite(factory: () => MerchantAdapter, fx: ContractFixtures) {
  const adapter = factory();
  const offers = await adapter.searchProducts(fx.search);
  const failures: string[] = [];
  for (const offer of offers) {
    if (offer.evidenceRefs.length === 0) failures.push("offer evidenceRefs must not be empty");
    if (Date.parse(offer.expiresAt) <= Date.parse(offer.checkedAt)) failures.push("expiresAt must be after checkedAt");
    if (offer.currency !== "USD") failures.push("currency must be USD");
  }
  return { merchantId: adapter.merchantId, failures };
}
```

- [ ] **Step 5: Run and commit**

Run: `pnpm vitest run packages/merchant-sdk/test/contract-suite.test.ts`

Expected: PASS; invalid fixture returns the two expected failures.

```bash
git add packages/merchant-sdk
git commit -m "feat: define merchant adapter contract suite"
```

### Task 3: Build Safe Feed, JSON-LD, and HTTP Source Readers

**Files:**
- Create: `apps/ingestion-worker/src/network/safe-fetch.ts`
- Create: `packages/merchant-adapters/src/configured/feed-reader.ts`
- Create: `packages/merchant-adapters/src/configured/jsonld-reader.ts`
- Create: `packages/merchant-adapters/src/configured/http-reader.ts`
- Test: `packages/merchant-adapters/test/readers.test.ts`
- Test: `tests/security/safe-fetch.test.ts`

**Interfaces:**
- Consumes: catalog `allowedHosts`, source config
- Produces: `safeFetch(request, policy)`, `SourceReader.read(): RawMerchantRecord[]`

- [ ] **Step 1: Write failing SSRF and redirect tests**

```ts
it.each(["http://127.0.0.1/x", "http://169.254.169.254/latest/meta-data", "https://unlisted.example/x"])(
  "blocks forbidden target %s", async (url) => {
    await expect(safeFetch({ url }, policy({ allowedHosts: ["shop.example"] }))).rejects.toThrow(/blocked/i);
  });

it("revalidates every redirect host", async () => {
  await expect(safeFetch({ url: "https://shop.example/redirect-private" }, policy())).rejects.toThrow(/redirect/i);
});
```

- [ ] **Step 2: Run and verify failure**

Run: `pnpm vitest run tests/security/safe-fetch.test.ts packages/merchant-adapters/test/readers.test.ts`

Expected: FAIL because readers and network policy are missing.

- [ ] **Step 3: Implement HTTPS, host, DNS, redirect, timeout, and size checks**

```ts
export async function safeFetch(input: { url: string }, policy: FetchPolicy): Promise<Response> {
  let current = new URL(input.url);
  for (let hop = 0; hop <= 3; hop += 1) {
    if (current.protocol !== "https:" || !policy.allowedHosts.includes(current.hostname)) throw new Error("blocked host");
    const addresses = await policy.resolve(current.hostname);
    if (addresses.some((address) => isForbiddenIp(address.address))) throw new Error("blocked address");
    const response = await fetch(current, { redirect: "manual", signal: AbortSignal.timeout(8000) });
    if (isRedirect(response.status)) {
      const location = response.headers.get("location");
      if (!location) throw new Error("redirect without location");
      current = new URL(location, current);
      continue;
    }
    enforceContentLength(response.headers, 5_000_000);
    return response;
  }
  throw new Error("redirect limit exceeded");
}
```

- [ ] **Step 4: Parse only declared fields from each source type**

```ts
export function parseProductJsonLd(document: string): RawMerchantRecord[] {
  const nodes = extractJsonLd(document).flatMap(flattenGraph);
  return nodes.filter((node) => node["@type"] === "Product").map((node) => RawMerchantRecordSchema.parse({
    merchantProductId: String(node.sku), title: String(node.name),
    brand: readBrand(node.brand), gtins: readGtins(node), mpn: optionalString(node.mpn),
    imageUrl: firstImage(node.image), rawOffer: node.offers
  }));
}
```

Run: `pnpm vitest run tests/security/safe-fetch.test.ts packages/merchant-adapters/test/readers.test.ts`

Expected: PASS; redirect and private IP fixtures blocked; JSON-LD fixture parsed.

- [ ] **Step 5: Commit**

```bash
git add apps/ingestion-worker/src/network packages/merchant-adapters tests/security/safe-fetch.test.ts
git commit -m "feat: add safe structured merchant readers"
```

### Task 4: Add Refresh Queues, Evidence, Freshness, and Quarantine

**Files:**
- Create: `apps/ingestion-worker/src/queues.ts`
- Create: `apps/ingestion-worker/src/jobs/refresh-product.ts`
- Create: `apps/ingestion-worker/src/jobs/refresh-price.ts`
- Create: `apps/ingestion-worker/src/evidence/store-evidence.ts`
- Create: `apps/ingestion-worker/src/quality/quarantine.ts`
- Test: `apps/ingestion-worker/test/refresh-product.test.ts`

**Interfaces:**
- Consumes: `MerchantAdapter`, repositories, Redis
- Produces: queues `merchant-product-refresh`, `merchant-price-refresh`; `RefreshOutcome`

- [ ] **Step 1: Write failing freshness and anomaly tests**

```ts
it("stores evidence before publishing an offer", async () => {
  await refreshProduct(job("merchant-a", "sku-1"), deps);
  expect(deps.evidence.save).toHaveBeenCalledBefore(deps.offers.upsert);
});

it("quarantines a 90 percent price drop", async () => {
  const result = await refreshPrice(job("merchant-a", "sku-1"), depsWithHistory(10000, 1000));
  expect(result.status).toBe("QUARANTINED");
  expect(deps.quotes.save).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run and verify failure**

Run: `pnpm vitest run apps/ingestion-worker/test/refresh-product.test.ts`

Expected: FAIL because jobs do not exist.

- [ ] **Step 3: Implement evidence-first writes and explicit TTL**

```ts
export async function refreshProduct(job: RefreshJob, deps: RefreshDeps): Promise<RefreshOutcome> {
  if (!deps.flags.isEnabled(job.merchantId)) return { status: "DISABLED" };
  const adapter = deps.adapters.get(job.merchantId);
  const raw = await adapter.refreshProduct(job.merchantProductId);
  const evidence = await deps.evidence.save({
    merchantId: job.merchantId, sourceUrl: raw.sourceUrl,
    contentHash: sha256(raw.rawEvidence), capturedAt: deps.clock.nowIso(), metadata: raw.metadata
  });
  const normalized = normalizeMerchantRecord(raw, evidence.id, deps.clock.now());
  const anomaly = detectAnomaly(normalized, await deps.offers.history(normalized.offerId));
  if (anomaly) return deps.quarantine.save(normalized, anomaly);
  await deps.offers.upsert(normalized);
  return { status: "PUBLISHED", offerId: normalized.offerId };
}
```

- [ ] **Step 4: Configure retry without duplicate writes**

```ts
export const refreshQueue = new Queue<RefreshJob>("merchant-product-refresh", { connection });
export const refreshWorker = new Worker("merchant-product-refresh", handler, {
  connection, concurrency: 20, limiter: { max: 100, duration: 60_000 }
});

await refreshQueue.add("refresh", payload, {
  jobId: `${payload.merchantId}:${payload.merchantProductId}:${payload.sourceVersion}`,
  attempts: 3, backoff: { type: "exponential", delay: 1000 }, removeOnComplete: 1000
});
```

Run: `pnpm vitest run apps/ingestion-worker/test/refresh-product.test.ts`

Expected: PASS; retry preserves idempotency.

- [ ] **Step 5: Commit**

```bash
git add apps/ingestion-worker
git commit -m "feat: ingest merchant data with evidence and quarantine"
```

### Task 5: Implement a Configured Merchant Adapter and Three Source Fixtures

**Files:**
- Create: `packages/merchant-adapters/src/configured/configured-adapter.ts`
- Create: `packages/merchant-adapters/src/configured/source-config.ts`
- Create: `packages/merchant-adapters/test/fixtures/feed/*`
- Create: `packages/merchant-adapters/test/fixtures/jsonld/*`
- Create: `packages/merchant-adapters/test/fixtures/http/*`
- Test: `packages/merchant-adapters/test/configured-adapter.test.ts`

**Interfaces:**
- Consumes: `SourceReader`, catalog config, affiliate template
- Produces: `createConfiguredAdapter(config, deps): MerchantAdapter`

- [ ] **Step 1: Write a contract test for each source fixture**

```ts
it.each(["feed", "jsonld", "http"] as const)("passes adapter contract for %s", async (source) => {
  const report = await runMerchantContractSuite(
    () => createConfiguredAdapter(fixtureConfig(source), fixtureDeps(source)), fixtureContext());
  expect(report.failures).toEqual([]);
});
```

- [ ] **Step 2: Run and verify failure**

Run: `pnpm vitest run packages/merchant-adapters/test/configured-adapter.test.ts`

Expected: FAIL because factory is missing.

- [ ] **Step 3: Implement source routing and affiliate fallback**

```ts
export function createConfiguredAdapter(config: MerchantSourceConfig, deps: AdapterDeps): MerchantAdapter {
  const reader = deps.readers[config.source.type];
  return {
    merchantId: config.merchantId,
    async searchProducts(input) { return normalizeRecords(await reader.search(config, input)); },
    async getOffer(id) { return reader.get(config, id); },
    async quoteDeliveredPrice(input) { return reader.quote(config, input); },
    async getCoupons(input) { return reader.coupons(config, input); },
    async buildAffiliateLink(input) {
      if (!config.affiliateTemplate) return { url: input.merchantUrl, kind: "NORMAL" };
      const url = renderApprovedTemplate(config.affiliateTemplate, input);
      return deps.redirectValidator.isAllowed(url)
        ? { url, kind: "AFFILIATE" } : { url: input.merchantUrl, kind: "NORMAL" };
    },
    async refreshProduct(id) { return reader.refresh(config, id); },
    async healthCheck() { return reader.health(config); },
    async evidence(id) { return deps.evidence.find(config.merchantId, id); }
  };
}
```

- [ ] **Step 4: Run contract suite for all three fixtures**

Run: `pnpm vitest run packages/merchant-adapters/test/configured-adapter.test.ts`

Expected: PASS for Feed, JSON-LD and HTTP fixture.

- [ ] **Step 5: Commit**

```bash
git add packages/merchant-adapters
git commit -m "feat: add configured merchant adapters"
```

### Task 6: Isolate Crawl4AI Behind a Merchant-ID-Only Worker API

**Files:**
- Create: `services/crawl4ai-worker/requirements.txt`
- Create: `services/crawl4ai-worker/app/config.py`
- Create: `services/crawl4ai-worker/app/models.py`
- Create: `services/crawl4ai-worker/app/main.py`
- Create: `services/crawl4ai-worker/tests/test_security.py`
- Create: `infra/docker/crawl4ai.Dockerfile`
- Create: `infra/docker/crawl4ai-seccomp.json`
- Test: `tests/security/crawler-egress.test.ts`

**Interfaces:**
- Consumes: `{ merchantId, resourcePath, extractionProfile }`
- Produces: validated `DynamicPageEvidence`; never accepts full URL or JavaScript

- [ ] **Step 1: Write failing worker input-security tests**

```py
def test_rejects_unknown_merchant(client):
    response = client.post("/extract", json={"merchantId": "unknown", "resourcePath": "/p/1", "extractionProfile": "product"})
    assert response.status_code == 403

def test_schema_rejects_url_and_javascript(client):
    response = client.post("/extract", json={"merchantId": "shop", "url": "http://127.0.0.1", "javascript": "fetch('/secret')"})
    assert response.status_code == 422
```

- [ ] **Step 2: Run and verify failure before service exists**

Run: `python -m pytest services/crawl4ai-worker/tests/test_security.py -q`

Expected: FAIL with import/module not found.

- [ ] **Step 3: Pin dependencies and implement closed input schema**

```text
# requirements.txt
crawl4ai==0.9.2
fastapi==0.116.1
uvicorn==0.35.0
pydantic==2.11.7
pytest==8.4.1
```

```py
class ExtractRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    merchantId: str = Field(pattern=r"^[a-z0-9-]{1,80}$")
    resourcePath: str = Field(pattern=r"^/[A-Za-z0-9/_?&=.%+-]{1,500}$")
    extractionProfile: Literal["product", "offer", "coupon"]

@app.post("/extract")
async def extract(request: ExtractRequest) -> DynamicPageEvidence:
    if request.merchantId not in settings.merchants:
        raise HTTPException(status_code=403, detail="merchant not allowed")
    merchant = settings.merchants[request.merchantId]
    url = build_url(merchant.base_url, request.resourcePath)
    assert_allowed_url(url, merchant.allowed_hosts)
    async with AsyncWebCrawler(config=browser_config()) as crawler:
        result = await crawler.arun(url=url, config=run_config(request.extractionProfile))
    return validate_and_limit(result, max_bytes=2_000_000)
```

- [ ] **Step 4: Harden the container**

```dockerfile
FROM python:3.12-slim
RUN useradd --uid 10001 --create-home crawler
WORKDIR /app
COPY services/crawl4ai-worker/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY services/crawl4ai-worker/app ./app
USER 10001
ENV PYTHONDONTWRITEBYTECODE=1
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080", "--workers", "1"]
```

Runtime requirements: read-only root filesystem; tmpfs `/tmp`; `cap_drop: [ALL]`; no host mount; no Commerce DB/Redis secret; outbound firewall only to audited merchant hosts; CPU/memory/PID limits; 15-second request timeout.

- [ ] **Step 5: Run Python and external egress tests**

Run: `python -m pytest services/crawl4ai-worker/tests -q && pnpm vitest run tests/security/crawler-egress.test.ts`

Expected: PASS; unknown merchant, extra URL, JavaScript, localhost, metadata IP and redirect escape rejected.

- [ ] **Step 6: Commit**

```bash
git add services/crawl4ai-worker infra/docker tests/security/crawler-egress.test.ts
git commit -m "feat: isolate crawl4ai dynamic extraction"
```

### Task 7: Onboard the First Merchant Wave Through Configuration and Quality Gates

**Files:**
- Modify: `config/merchants/catalog.yaml`
- Create: `config/merchants/enabled/*.yaml`
- Create: `scripts/validate-enabled-merchants.ts`
- Test: `tests/contract/enabled-merchants.test.ts`
- Create: `docs/product/merchant-decisions/*.md`

**Interfaces:**
- Consumes: Task 1 audit outputs and Tasks 2–6 adapters
- Produces: 10–20 enabled merchant configs, quality report JSON

- [ ] **Step 1: Complete real audits and select the first 10**

For every selected merchant, store evidence in `docs/product/merchant-decisions/<merchant-id>.md` with these exact headings:

```markdown
# Merchant Decision: <merchant name>
## Data authorization and terms evidence
## Affiliate/deep-link status
## Source PoC and allowed hosts
## 100-SKU identity completeness sample
## ZIP, shipping, tax, Coupon, and membership behavior
## Maintenance and failure risks
## Approval signatures and date
```

Do not mark `auditState: approved` without evidence and named reviewer.

- [ ] **Step 2: Write the failing enabled-merchant gate**

```ts
it("requires at least ten fully approved enabled merchants", async () => {
  const report = await validateEnabledMerchants(loadCatalog());
  expect(report.enabledCount).toBeGreaterThanOrEqual(10);
  expect(report.failures).toEqual([]);
});
```

- [ ] **Step 3: Run and confirm the intentional gate failure**

Run: `pnpm vitest run tests/contract/enabled-merchants.test.ts`

Expected before audits complete: FAIL with exact list of missing approvals/configs. This is a business dependency, not a code defect.

- [ ] **Step 4: Add one config per genuinely approved merchant and run its adapter contract**

```yaml
merchantId: best-buy
enabled: true
source: { type: api, credentialRef: BEST_BUY_API_KEY }
allowedHosts: [api.bestbuy.com, www.bestbuy.com]
affiliate: { mode: approved_template, credentialRef: BEST_BUY_AFFILIATE_ID }
ttlSeconds: { product: 86400, price: 900, inventory: 300, coupon: 900 }
killSwitch: false
```

The example shows schema only; use it for Best Buy only if Phase 0 records real approval and correct endpoint/credential terms. For each actually selected merchant, run:

Run: `pnpm merchants:verify -- --merchant <selected-merchant-id> --sample-size 100`

Expected: contract pass; required field completeness ≥ 95%; no forbidden network target.

- [ ] **Step 5: Enable wave one and then wave two**

Run: `pnpm merchants:gate -- --minimum 10`

Expected: exit 0 only after ten merchants meet all gates. Expand toward 20 using the identical process; no core code changes required for configured sources.

- [ ] **Step 6: Commit only the audited merchants**

```bash
git add config/merchants docs/product/merchant-decisions tests/contract/enabled-merchants.test.ts scripts/validate-enabled-merchants.ts
git commit -m "feat: enable audited merchant wave one"
```

## Merchant Data Plane Exit Check

Run:

```bash
pnpm merchants:score -- --catalog config/merchants/catalog.yaml
pnpm merchants:gate -- --minimum 10
pnpm vitest run packages/merchant-sdk packages/merchant-adapters apps/ingestion-worker tests/security tests/contract
python -m pytest services/crawl4ai-worker/tests -q
```

Expected: at least 10 genuinely audited merchants enabled; all contract/security tests pass; disabling Crawl4AI leaves Feed/API/JSON-LD/HTTP merchants healthy.
