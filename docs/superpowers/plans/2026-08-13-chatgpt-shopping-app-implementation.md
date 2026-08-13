# ChatGPT Shopping App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付可在 ChatGPT 中使用的自然语言比价 MCP 工具、用户 ZIP/会员偏好、动态比较卡片和安全 Affiliate 跳转。

**Architecture:** MCP v2 Server 通过 Streamable HTTP 暴露小而明确的工具；数据工具与渲染工具分离。React UI 仅显示已由 Commerce Core 验证的数据，持久偏好保存在服务端，外跳通过受控 redirect endpoint 完成。

**Tech Stack:** Node.js 22 LTS、TypeScript、Fastify 5、MCP TypeScript SDK v2 (`@modelcontextprotocol/server`, `@modelcontextprotocol/fastify`)、`@modelcontextprotocol/ext-apps`、Zod 4、JOSE、React 18、Vite、Vitest、Playwright。

## Global Constraints

- 工具必须在无 UI 客户端中仍可完成比价。
- 数据工具不绑定 widget；只有 `render_comparison` 绑定 UI resource。
- 所有工具使用明确输入/输出 schema 和准确安全注解。
- 搜索/比较/详情为只读开放世界操作；保存/删除偏好需要用户身份。
- 不向模型或 UI 返回 access token、商家密钥、内部 DB ID 或原始抓取页面。
- ZIP 和会员状态只有用户明确请求保存时才持久化。
- 普通价与会员价同时展示；无会员价格不参与默认排序。
- Similar results 单独展示，不出现“同款最低价”措辞。
- Affiliate 披露贴近每个外跳 CTA；佣金不影响排序。
- 不暴露购买、结账、支付或自动下单工具。

---

## File Map

```text
apps/mcp-server/src/server.ts                     # MCP server 定义
apps/mcp-server/src/transport.ts                  # Fastify Streamable HTTP
apps/mcp-server/src/auth/*.ts                     # JWT/JWKS 验证与用户上下文
apps/mcp-server/src/tools/*.ts                    # 数据、偏好、render 工具
apps/mcp-server/src/resources/comparison.ts       # ui:// HTML resource
apps/plugin-ui/src/*.tsx                          # 比较卡片和桥接
apps/commerce-api/src/routes/preferences.ts       # 用户偏好 API
apps/commerce-api/src/routes/outbound.ts          # 安全外跳
packages/contracts/src/mcp.ts                     # MCP 公开 DTO
tests/e2e/chatgpt-shopping.spec.ts                # 用户旅程
docs/product/plugin-review/*                      # 提交材料
```

### Task 1: Add OAuth Token Verification and User Context

**Files:**
- Create: `apps/mcp-server/src/auth/auth-config.ts`
- Create: `apps/mcp-server/src/auth/verify-access-token.ts`
- Create: `apps/mcp-server/src/auth/user-context.ts`
- Test: `apps/mcp-server/test/auth.test.ts`

**Interfaces:**
- Consumes: bearer JWT, `AUTH_ISSUER`, `AUTH_AUDIENCE`, issuer JWKS
- Produces: `verifyAccessToken(token): Promise<UserContext>`

- [ ] **Step 1: Write failing issuer, audience, expiry, and scope tests**

```ts
it("rejects a validly signed token for the wrong audience", async () => {
  const token = await signer.token({ sub: "u1", aud: "other", scope: "shopping:read" });
  await expect(verifyAccessToken(token, config, jwks)).rejects.toThrow(/audience/i);
});

it("returns only the stable user subject and scopes", async () => {
  const token = await signer.token({ sub: "u1", aud: "shopping", scope: "shopping:read preferences:write" });
  await expect(verifyAccessToken(token, config, jwks)).resolves.toEqual({
    userId: "u1", scopes: new Set(["shopping:read", "preferences:write"])
  });
});
```

- [ ] **Step 2: Run and verify failure**

Run: `pnpm vitest run apps/mcp-server/test/auth.test.ts`

Expected: FAIL because verifier is missing.

- [ ] **Step 3: Implement strict JWT verification**

```ts
import { createRemoteJWKSet, jwtVerify } from "jose";

export async function verifyAccessToken(
  token: string, config: AuthConfig, jwks = createRemoteJWKSet(new URL(config.jwksUri))
): Promise<UserContext> {
  const { payload } = await jwtVerify(token, jwks, {
    issuer: config.issuer, audience: config.audience,
    algorithms: ["RS256", "ES256"], clockTolerance: 5
  });
  if (typeof payload.sub !== "string") throw new Error("subject required");
  const scopes = new Set(typeof payload.scope === "string" ? payload.scope.split(" ") : []);
  return { userId: payload.sub, scopes };
}
```

- [ ] **Step 4: Add scope guard and rerun**

```ts
export function requireScope(user: UserContext, scope: string): void {
  if (!user.scopes.has(scope)) throw new AuthorizationError(`missing scope: ${scope}`);
}
```

Run: `pnpm vitest run apps/mcp-server/test/auth.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/mcp-server/src/auth apps/mcp-server/test/auth.test.ts
git commit -m "feat: verify shopping app access tokens"
```

### Task 2: Store, Read, and Delete ZIP and Membership Preferences

**Files:**
- Create: `infra/migrations/0002_user_preferences.sql`
- Create: `packages/db/src/repositories/preference-repository.ts`
- Create: `apps/commerce-api/src/routes/preferences.ts`
- Test: `apps/commerce-api/test/preferences.test.ts`

**Interfaces:**
- Consumes: authenticated `UserContext`
- Produces: `GET/PUT/DELETE /v1/preferences`, `PreferenceRepository`

- [ ] **Step 1: Write failing consent and deletion tests**

```ts
it("does not persist preferences without explicit save", async () => {
  await app.inject({ method: "POST", url: "/v1/comparisons", payload: comparisonWithZip });
  expect(await preferences.get("u1")).toBeNull();
});

it("deletes all stored shopping preferences", async () => {
  await preferences.put("u1", { zipCode: "33433", memberships: ["costco"] });
  await app.inject({ method: "DELETE", url: "/v1/preferences", headers: auth("u1") });
  expect(await preferences.get("u1")).toBeNull();
});
```

- [ ] **Step 2: Run and verify failure**

Run: `pnpm vitest run apps/commerce-api/test/preferences.test.ts`

Expected: FAIL with missing repository/route.

- [ ] **Step 3: Create the minimal encrypted-at-rest record shape**

```sql
CREATE TABLE user_preferences (
  user_id_hash text PRIMARY KEY,
  encrypted_payload bytea NOT NULL,
  key_version integer NOT NULL,
  consented_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
```

```ts
const PreferenceInputSchema = z.object({
  zipCode: z.string().regex(/^\d{5}$/).optional(),
  memberships: z.array(z.string().regex(/^[a-z0-9-]{1,50}$/)).max(30).default([]),
  save: z.literal(true)
});
```

- [ ] **Step 4: Implement authorized PUT and idempotent DELETE**

```ts
app.put("/v1/preferences", { preHandler: requireAuth("preferences:write") }, async (request, reply) => {
  const input = PreferenceInputSchema.parse(request.body);
  await preferences.put(request.user.userId, input, clock.now());
  return reply.code(204).send();
});

app.delete("/v1/preferences", { preHandler: requireAuth("preferences:write") }, async (request, reply) => {
  await preferences.delete(request.user.userId);
  return reply.code(204).send();
});
```

Run: `pnpm vitest run apps/commerce-api/test/preferences.test.ts`

Expected: PASS; comparison ZIP remains ephemeral unless `save: true` is sent through preference route.

- [ ] **Step 5: Commit**

```bash
git add infra/migrations/0002_user_preferences.sql packages/db/src/repositories/preference-repository.ts apps/commerce-api/src/routes/preferences.ts apps/commerce-api/test/preferences.test.ts
git commit -m "feat: manage consented shopping preferences"
```

### Task 3: Register Data-First MCP Tools

**Files:**
- Create: `packages/contracts/src/mcp.ts`
- Create: `apps/mcp-server/src/tools/search-products.ts`
- Create: `apps/mcp-server/src/tools/compare-exact-offers.ts`
- Create: `apps/mcp-server/src/tools/get-offer-details.ts`
- Create: `apps/mcp-server/src/tools/preferences.ts`
- Create: `apps/mcp-server/src/server.ts`
- Test: `apps/mcp-server/test/tools.test.ts`

**Interfaces:**
- Consumes: Commerce API client and `UserContext`
- Produces: MCP tools `search_products`, `compare_exact_offers`, `get_offer_details`, `set_shopping_preferences`, `delete_shopping_preferences`

- [ ] **Step 1: Write failing tool discovery and no-secret tests**

```ts
it("publishes only the five approved data tools", async () => {
  const tools = await mcpClient.listTools();
  expect(tools.tools.map((tool) => tool.name).sort()).toEqual([
    "compare_exact_offers", "delete_shopping_preferences", "get_offer_details",
    "search_products", "set_shopping_preferences"
  ]);
});

it("never returns credentials or internal database ids", async () => {
  const result = await mcpClient.callTool({ name: "compare_exact_offers", arguments: validInput });
  expect(JSON.stringify(result)).not.toMatch(/access_token|api_key|database_id|raw_html/i);
});
```

- [ ] **Step 2: Run and verify failure**

Run: `pnpm vitest run apps/mcp-server/test/tools.test.ts`

Expected: FAIL because MCP server/tools are missing.

- [ ] **Step 3: Define public DTOs and register read-only tools**

```ts
import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

const server = new McpServer(
  { name: "ai-transaction-agent", version: "0.1.0" },
  { instructions: "Compare only supported merchants. Never call a similar item an exact match. Ask for model or variant when identity evidence is insufficient." }
);

server.registerTool("compare_exact_offers", {
  title: "Compare exact product offers",
  description: "Compare verified exact matches after product/model, ZIP, and memberships are known.",
  inputSchema: z.object({
    productRef: z.string().min(1), zipCode: z.string().regex(/^\d{5}$/),
    memberships: z.array(z.string()).max(30).default([])
  }),
  outputSchema: ComparisonResultPublicSchema,
  annotations: { readOnlyHint: true, openWorldHint: true, destructiveHint: false }
}, async (input, context) => {
  requireScope(context.user, "shopping:read");
  const comparison = await commerce.compareExactOffers(input);
  return { structuredContent: toPublicComparison(comparison), content: [{ type: "text", text: summarize(comparison) }] };
});
```

Public schema allows only opaque `productRef`/`offerRef`, product display data, price components, status, timestamps, merchant/seller, URLs and reasons.

- [ ] **Step 4: Register preference tools with correct annotations**

```ts
server.registerTool("delete_shopping_preferences", {
  title: "Delete shopping preferences",
  description: "Delete the signed-in user's saved ZIP code and membership list.",
  inputSchema: z.object({ confirm: z.literal(true) }),
  outputSchema: z.object({ deleted: z.boolean() }),
  annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: true }
}, async (_input, context) => {
  requireScope(context.user, "preferences:write");
  await commerce.deletePreferences(context.user.userId);
  return { structuredContent: { deleted: true }, content: [{ type: "text", text: "Saved shopping preferences deleted." }] };
});
```

- [ ] **Step 5: Run tool tests and schema snapshots**

Run: `pnpm vitest run apps/mcp-server/test/tools.test.ts -u && pnpm typecheck`

Expected: PASS; no buy/payment tool; all schemas and annotations match snapshot.

- [ ] **Step 6: Commit**

```bash
git add packages/contracts/src/mcp.ts apps/mcp-server
git commit -m "feat: expose shopping comparison mcp tools"
```

### Task 4: Serve the UI Resource Through a Separate Render Tool

**Files:**
- Create: `apps/mcp-server/src/resources/comparison.ts`
- Create: `apps/mcp-server/src/tools/render-comparison.ts`
- Create: `apps/mcp-server/src/transport.ts`
- Test: `apps/mcp-server/test/render-tool.test.ts`

**Interfaces:**
- Consumes: final `ComparisonResultPublic`
- Produces: `render_comparison`, resource `ui://shopping/comparison.html`, Streamable HTTP endpoint `/mcp`

- [ ] **Step 1: Write failing separation tests**

```ts
it("attaches UI metadata only to render_comparison", async () => {
  const tools = await mcpClient.listTools();
  for (const tool of tools.tools) {
    const resource = tool._meta?.ui?.resourceUri;
    expect(resource).toBe(tool.name === "render_comparison" ? "ui://shopping/comparison.html" : undefined);
  }
});
```

- [ ] **Step 2: Run and verify failure**

Run: `pnpm vitest run apps/mcp-server/test/render-tool.test.ts`

Expected: FAIL because render tool/resource are missing.

- [ ] **Step 3: Register the resource and presentation-only tool**

```ts
const TEMPLATE_URI = "ui://shopping/comparison.html";

import { RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";

server.registerResource("shopping-comparison", TEMPLATE_URI, {}, async () => ({
  contents: [{
    uri: TEMPLATE_URI, mimeType: RESOURCE_MIME_TYPE, text: builtWidgetHtml,
    _meta: {
      ui: {
        prefersBorder: false,
        domain: config.publicOrigin,
        csp: {
          connectDomains: [config.publicOrigin],
          resourceDomains: [config.assetOrigin]
        }
      }
    }
  }]
}));

server.registerTool("render_comparison", {
  title: "Render product comparison",
  description: "Call only after compare_exact_offers; renders the final exact and similar offer lists.",
  inputSchema: ComparisonResultPublicSchema,
  outputSchema: ComparisonResultPublicSchema,
  annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
  _meta: { ui: { resourceUri: TEMPLATE_URI } }
}, async (input) => ({ structuredContent: input, content: [{ type: "text", text: "Comparison ready." }] }));
```

- [ ] **Step 4: Mount authenticated Streamable HTTP**

```ts
app.all("/mcp", { preHandler: authenticateBearer }, async (request, reply) => {
  return handleMcpRequest({ request, reply, server, user: request.user });
});
```

Run: `pnpm vitest run apps/mcp-server/test/render-tool.test.ts`

Expected: PASS; data tools remain usable without resource metadata.

- [ ] **Step 5: Commit**

```bash
git add apps/mcp-server/src/resources apps/mcp-server/src/tools/render-comparison.ts apps/mcp-server/src/transport.ts apps/mcp-server/test/render-tool.test.ts
git commit -m "feat: add decoupled comparison render tool"
```

### Task 5: Build the Accessible Comparison Card

**Files:**
- Create: `apps/plugin-ui/package.json`
- Create: `apps/plugin-ui/src/bridge.ts`
- Create: `apps/plugin-ui/src/ComparisonApp.tsx`
- Create: `apps/plugin-ui/src/ExactOfferCard.tsx`
- Create: `apps/plugin-ui/src/SimilarOffers.tsx`
- Create: `apps/plugin-ui/src/PriceBreakdown.tsx`
- Create: `apps/plugin-ui/src/styles.css`
- Test: `apps/plugin-ui/test/ComparisonApp.test.tsx`

**Interfaces:**
- Consumes: `ui/notifications/tool-result` containing `ComparisonResultPublic`
- Produces: inline comparison card with regular/member price, evidence status, disclosure and CTA

- [ ] **Step 1: Write failing rendering and language tests**

```tsx
it("shows regular and eligible member price with conditions", () => {
  render(<ComparisonApp result={comparisonFixture()} />);
  expect(screen.getByText("Regular price")).toBeVisible();
  expect(screen.getByText("Your Costco member price")).toBeVisible();
  expect(screen.getByText(/checked/i)).toBeVisible();
});

it("keeps similar items outside exact results", () => {
  render(<ComparisonApp result={comparisonFixture()} />);
  expect(screen.getByRole("region", { name: "Similar items" })).toBeVisible();
  expect(screen.getByRole("region", { name: "Exact matches" })).not.toContainElement(screen.getByTestId("similar-offer"));
});
```

- [ ] **Step 2: Run and verify failure**

Run: `pnpm vitest run apps/plugin-ui/test/ComparisonApp.test.tsx`

Expected: FAIL because components are missing.

- [ ] **Step 3: Implement explicit status and dual-price card**

```tsx
export function ExactOfferCard({ offer }: { offer: PublicComparisonOffer }) {
  return <article aria-labelledby={`offer-${offer.offerRef}`}>
    <header><span className="badge">Exact match</span><h3 id={`offer-${offer.offerRef}`}>{offer.merchantName}</h3></header>
    <dl>
      <PriceRow label="Regular price" value={offer.regularDeliveredPrice} />
      {offer.memberDeliveredPrice && <PriceRow
        label={offer.memberEligible ? `Your ${offer.membershipName} member price` : `${offer.membershipName} member price`}
        value={offer.memberDeliveredPrice}
        note={offer.memberEligible ? undefined : "Not used in default ranking"} />}
    </dl>
    <PriceBreakdown items={offer.priceLineItems} />
    <p>{quoteStatusCopy(offer.quoteStatus)} · Checked {formatTime(offer.checkedAt)}</p>
    <ul>{offer.recommendationReasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
    <p className="disclosure">We may earn a commission if you buy through this link. This does not raise your price or affect ranking.</p>
    <a className="cta" href={offer.outboundUrl} rel="sponsored noopener noreferrer">Go to merchant</a>
  </article>;
}
```

- [ ] **Step 4: Add the standard MCP Apps bridge**

```ts
window.addEventListener("message", (event) => {
  if (event.source !== window.parent || event.data?.jsonrpc !== "2.0") return;
  if (event.data.method === "ui/notifications/tool-result") {
    renderComparison(ComparisonResultPublicSchema.parse(event.data.params?.structuredContent));
  }
}, { passive: true });
```

- [ ] **Step 5: Test accessibility and bundle size**

Run: `pnpm vitest run apps/plugin-ui/test/ComparisonApp.test.tsx && pnpm --filter plugin-ui build && pnpm ui:a11y`

Expected: tests pass; keyboard CTA reachable; headings/regions named; production JS+CSS gzip ≤ 150 KB.

- [ ] **Step 6: Commit**

```bash
git add apps/plugin-ui
git commit -m "feat: render transparent shopping comparison cards"
```

### Task 6: Add Validated Affiliate Redirect and Normal-Link Fallback

**Files:**
- Create: `infra/migrations/0003_outbound_links.sql`
- Create: `apps/commerce-api/src/routes/outbound.ts`
- Create: `apps/commerce-api/src/services/outbound-link.ts`
- Test: `apps/commerce-api/test/outbound.test.ts`

**Interfaces:**
- Consumes: opaque signed `offerRef`, stored approved merchant/affiliate URL
- Produces: `GET /out/:token` → audited 302 redirect

- [ ] **Step 1: Write failing tamper, expiry, and fallback tests**

```ts
it("rejects a tampered outbound token", async () => {
  const response = await app.inject({ method: "GET", url: `/out/${validToken}x` });
  expect(response.statusCode).toBe(400);
});

it("uses normal merchant URL when affiliate validation fails", async () => {
  const response = await app.inject({ method: "GET", url: `/out/${tokenForBrokenAffiliate}` });
  expect(response.headers.location).toBe("https://approved-merchant.example/product/1");
});
```

- [ ] **Step 2: Run and verify failure**

Run: `pnpm vitest run apps/commerce-api/test/outbound.test.ts`

Expected: FAIL because route/service are missing.

- [ ] **Step 3: Resolve tokens only to stored allowlisted URLs**

```ts
export async function resolveOutbound(token: string, deps: OutboundDeps): Promise<URL> {
  const claims = await deps.signer.verify(token, { audience: "shopping-outbound", maxAgeSeconds: 900 });
  const link = await deps.links.find(claims.offerRef);
  if (!link) throw new InvalidOutboundToken();
  const affiliate = link.affiliateUrl && deps.policy.isApproved(link.merchantId, new URL(link.affiliateUrl))
    ? new URL(link.affiliateUrl) : undefined;
  const target = affiliate ?? new URL(link.merchantUrl);
  if (!deps.policy.isApproved(link.merchantId, target)) throw new BlockedOutboundUrl();
  return target;
}
```

- [ ] **Step 4: Record click without storing query text or ZIP**

```ts
await clicks.record({ merchantId: link.merchantId, offerRef: claims.offerRef,
  linkKind: affiliate ? "AFFILIATE" : "NORMAL", occurredAt: clock.nowIso() });
return reply.redirect(target.toString(), 302);
```

Run: `pnpm vitest run apps/commerce-api/test/outbound.test.ts`

Expected: PASS; arbitrary URL cannot be encoded in token; failed affiliate link falls back.

- [ ] **Step 5: Commit**

```bash
git add infra/migrations/0003_outbound_links.sql apps/commerce-api/src/routes/outbound.ts apps/commerce-api/src/services/outbound-link.ts apps/commerce-api/test/outbound.test.ts
git commit -m "feat: add safe affiliate outbound redirects"
```

### Task 7: Add End-to-End ChatGPT Flow and Review Package

**Files:**
- Create: `tests/e2e/chatgpt-shopping.spec.ts`
- Create: `tests/e2e/fixtures/chatgpt-host.ts`
- Create: `docs/product/plugin-review/test-prompts.md`
- Create: `docs/product/plugin-review/data-disclosure.md`
- Create: `docs/product/plugin-review/tool-inventory.md`
- Create: `docs/product/plugin-review/privacy-checklist.md`

**Interfaces:**
- Consumes: running Commerce API, MCP Server, plugin UI
- Produces: `pnpm test:e2e:plugin`, reviewer-ready evidence

- [ ] **Step 1: Write the failing complete-user-journey test**

```ts
test("asks for variant, compares exact offers, and renders transparent prices", async ({ host }) => {
  await host.say("Compare AirPods prices");
  await expect(host.assistant()).toContainText(/model|型号/i);
  await host.say("AirPods Pro 2 USB-C, ZIP 33433, I have Costco membership");
  const card = host.widget();
  await expect(card.getByText("Exact matches")).toBeVisible();
  await expect(card.getByText("Regular price")).toBeVisible();
  await expect(card.getByText(/member price/i)).toBeVisible();
  await expect(card.getByText(/commission/i)).toBeVisible();
});
```

- [ ] **Step 2: Run and verify failure**

Run: `pnpm test:e2e:plugin -- tests/e2e/chatgpt-shopping.spec.ts`

Expected: FAIL until local MCP host fixture and all prior tasks are wired.

- [ ] **Step 3: Implement the local MCP Apps host fixture and complete journeys**

Add fixtures for: exact match; similar-only; missing ZIP; missing model; eligible member; ineligible member; Coupon conditional; estimated tax; stale merchant; affiliate fallback; saved preference deletion.

```ts
export const requiredJourneys = [
  "exact", "similar-only", "missing-zip", "missing-model", "eligible-member",
  "ineligible-member", "conditional-coupon", "estimated-tax", "stale-merchant",
  "affiliate-fallback", "delete-preferences"
] as const;
```

- [ ] **Step 4: Produce exact review artifacts**

`tool-inventory.md` must list tool name, purpose, input data, output data, scopes, annotations and UI resource. `data-disclosure.md` must list ZIP, membership state, retention, encryption, deletion route and non-collected fields. `test-prompts.md` must include one expected prompt/response path per required journey.

- [ ] **Step 5: Run full app verification**

Run: `pnpm test:e2e:plugin && pnpm ui:a11y && pnpm test -- apps/mcp-server apps/plugin-ui apps/commerce-api`

Expected: all 11 journeys pass; no payment/checkout tool appears; review docs contain no blank required field.

- [ ] **Step 6: Commit**

```bash
git add tests/e2e docs/product/plugin-review
git commit -m "test: verify chatgpt shopping app journeys"
```

## ChatGPT App Exit Check

Run:

```bash
pnpm typecheck
pnpm test -- apps/mcp-server apps/plugin-ui apps/commerce-api
pnpm test:e2e:plugin
pnpm ui:a11y
```

Expected: all commands exit 0; data tools work without UI; UI shows exact/similar separation, regular/member prices, status, timestamp, reasons, disclosure and safe CTA.

## Official Implementation References

- [Build an MCP server](https://developers.openai.com/plugins/build/mcp-server)
- [Add UI to your MCP server](https://developers.openai.com/plugins/build/chatgpt-ui)
- [Security and Privacy](https://developers.openai.com/plugins/guides/security-privacy)
- [App review requirements](https://developers.openai.com/plugins/deploy/app-review)
- [MCP TypeScript SDK v2](https://github.com/modelcontextprotocol/typescript-sdk)
