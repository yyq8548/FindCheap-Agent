import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

import { createAwinFeedIndex } from "../packages/awin-feed/src/index.js";
import {
  EMBEDDED_MERCHANT_TRUST_REGISTRY,
  ManagedMerchantTrustRecordSchema,
  OfficialStorefrontRecordSchema
} from "../packages/contracts/src/index.js";
import { createDatabase, type SqlExecutor } from "../packages/db/src/client.js";
import {
  listRegistryCandidates,
  publishApprovedRegistrySnapshot,
  recordRegistryEvidence,
  reviewRegistryCandidate,
  upsertRegistryCandidate,
  type RegistryCandidateKind,
  type RegistryEvidenceKind
} from "../packages/db/src/repositories/registry-repository.js";
import { collectAwinMerchantCandidates, probeTechnicalStorefront } from "../packages/registry-builder/src/index.js";
import { DEFAULT_OFFICIAL_STOREFRONT_REGISTRY } from "../apps/awin-feed-service/src/official-storefront-registry.js";

const EvidenceUrlSchema = z.string().url().max(2_000).superRefine((value, context) => {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "" || url.port !== "") {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "evidenceUrl must be credential-free HTTPS" });
  }
});

const ApprovalSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("OFFICIAL_STOREFRONT"),
    record: OfficialStorefrontRecordSchema,
    note: z.string().trim().min(1).max(2_000),
    evidenceKind: z.enum(["BRAND_DOMAIN", "MANUAL_REVIEW"]),
    evidenceUrl: EvidenceUrlSchema
  }).strict(),
  z.object({
    kind: z.literal("MERCHANT_TRUST"),
    record: ManagedMerchantTrustRecordSchema,
    note: z.string().trim().min(1).max(2_000),
    evidenceKind: z.enum(["BRAND_DOMAIN", "AUTHORIZED_RETAILER", "BUSINESS_IDENTITY", "POLICY_AND_SUPPORT", "MANUAL_REVIEW"]),
    evidenceUrl: EvidenceUrlSchema
  }).strict()
]);

const ApprovalBatchSchema = z.object({
  approvals: z.array(ApprovalSchema).min(1).max(2_000)
}).strict().superRefine((batch, context) => {
  const keys = new Set<string>();
  batch.approvals.forEach((approval, index) => {
    const host = approval.kind === "OFFICIAL_STOREFRONT" ? approval.record.officialHost : approval.record.host;
    const key = `${approval.kind}:${host}`;
    if (keys.has(key)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["approvals", index], message: "approval keys must be unique" });
    }
    keys.add(key);
  });
});

const CuratedExpansionSchema = z.object({
  reviewedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
  officialStorefronts: z.array(z.object({
    brand: z.string().trim().min(1).max(100),
    aliases: z.array(z.string().trim().min(1).max(100)).max(20).default([]),
    officialHost: z.string().trim().toLowerCase(),
    storefrontHost: z.string().trim().toLowerCase().optional()
  }).strict()).max(2_000),
  additionalTrustedMerchants: z.array(z.object({
    host: z.string().trim().toLowerCase(),
    level: z.enum(["OFFICIAL", "ESTABLISHED_RETAILER"]),
    evidenceUrl: EvidenceUrlSchema.optional()
  }).strict()).max(5_000)
}).strict();

const CandidateImportSchema = z.object({
  source: z.enum(["SHOPIFY_CATALOG", "SEARCH_OBSERVATION", "MANUAL"]),
  candidates: z.array(z.object({
    kind: z.enum(["OFFICIAL_STOREFRONT", "MERCHANT_TRUST"]),
    host: z.string().trim().toLowerCase().regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/u)
      .refine((host) => !host.startsWith("www."), "host must omit www"),
    sourceReference: z.string().trim().min(1).max(1_000).optional(),
    payload: z.record(z.unknown())
  }).strict()).min(1).max(5_000)
}).strict();

export async function runRegistryBuilder(
  argv: readonly string[],
  environment: Readonly<Record<string, string | undefined>> = process.env
): Promise<Record<string, unknown>> {
  const [command, ...arguments_] = argv;
  if (command === undefined) throw new Error("registry command is required");
  const databaseUrl = environment.FINDCHEAP_REGISTRY_DATABASE_URL ?? environment.DATABASE_URL;
  if (databaseUrl === undefined || databaseUrl.trim() === "") throw new Error("FINDCHEAP_REGISTRY_DATABASE_URL or DATABASE_URL is required");
  const database = createDatabase(databaseUrl, {
    statementTimeoutMs: 10_000,
    queryTimeoutMs: 12_000,
    connectionTimeoutMs: 5_000
  });
  try {
    await database.connect();
    if (command === "seed") {
      for (const store of DEFAULT_OFFICIAL_STOREFRONT_REGISTRY.stores) {
        await upsertRegistryCandidate(database, {
          kind: "OFFICIAL_STOREFRONT",
          key: store.officialHost,
          source: "MANUAL",
          sourceReference: store.evidenceUrl,
          payload: store
        });
        await recordRegistryEvidence(database, {
          kind: "OFFICIAL_STOREFRONT",
          key: store.officialHost,
          evidenceKind: "MANUAL_REVIEW",
          evidenceUrl: store.evidenceUrl,
          result: "PASS",
          details: { embeddedReviewedSeed: true }
        });
        await reviewRegistryCandidate(database, {
          kind: "OFFICIAL_STOREFRONT",
          key: store.officialHost,
          status: "APPROVED",
          record: store,
          note: "Imported from reviewed embedded official-storefront registry."
        });
      }
      for (const merchant of EMBEDDED_MERCHANT_TRUST_REGISTRY.merchants) {
        await upsertRegistryCandidate(database, {
          kind: "MERCHANT_TRUST",
          key: merchant.host,
          source: "MANUAL",
          sourceReference: merchant.evidenceUrl,
          payload: merchant
        });
        await recordRegistryEvidence(database, {
          kind: "MERCHANT_TRUST",
          key: merchant.host,
          evidenceKind: "MANUAL_REVIEW",
          evidenceUrl: merchant.evidenceUrl,
          result: "PASS",
          details: { embeddedReviewedSeed: true }
        });
        await reviewRegistryCandidate(database, {
          kind: "MERCHANT_TRUST",
          key: merchant.host,
          status: "APPROVED",
          record: merchant,
          note: "Imported from reviewed embedded merchant-trust registry."
        });
      }
      return {
        seededOfficialStorefronts: DEFAULT_OFFICIAL_STOREFRONT_REGISTRY.stores.length,
        seededTrustedMerchants: EMBEDDED_MERCHANT_TRUST_REGISTRY.merchants.length
      };
    }
    if (command === "collect-awin") {
      const feedPath = requiredOption(arguments_, "--feed");
      const archive = await readFile(resolve(feedPath));
      const candidates = collectAwinMerchantCandidates(createAwinFeedIndex(archive, new Date().toISOString()));
      for (const candidate of candidates) {
        await upsertRegistryCandidate(database, {
          kind: "MERCHANT_TRUST",
          key: candidate.host,
          source: "AWIN_JOINED_FEED",
          sourceReference: `awin:${candidate.merchantIds.join(",")}`,
          payload: candidate
        });
      }
      return { collected: candidates.length };
    }
    if (command === "collect-json") {
      const file = requiredOption(arguments_, "--file");
      const imported = CandidateImportSchema.parse(JSON.parse(await readFile(resolve(file), "utf8")));
      for (const candidate of imported.candidates) {
        await upsertRegistryCandidate(database, {
          kind: candidate.kind,
          key: candidate.host,
          source: imported.source,
          ...(candidate.sourceReference === undefined ? {} : { sourceReference: candidate.sourceReference }),
          payload: candidate.payload
        });
      }
      return { collected: imported.candidates.length, source: imported.source };
    }
    if (command === "collect-reviewed") {
      const file = requiredOption(arguments_, "--file");
      const approvals = parseRegistryApprovalBatch(JSON.parse(await readFile(resolve(file), "utf8")));
      for (const approval of approvals) {
        const key = approval.kind === "OFFICIAL_STOREFRONT" ? approval.record.officialHost : approval.record.host;
        await upsertRegistryCandidate(database, {
          kind: approval.kind,
          key,
          source: "MANUAL",
          sourceReference: approval.evidenceUrl,
          payload: approval.record
        });
      }
      return {
        collected: approvals.length,
        officialStorefronts: approvals.filter((approval) => approval.kind === "OFFICIAL_STOREFRONT").length,
        merchantTrustCandidates: approvals.filter((approval) => approval.kind === "MERCHANT_TRUST").length
      };
    }
    if (command === "probe") {
      const limit = optionalIntegerOption(arguments_, "--limit", 100, 1, 500);
      const concurrency = optionalIntegerOption(arguments_, "--concurrency", 6, 1, 12);
      const candidates = await listRegistryCandidates(database, { status: "CANDIDATE", limit });
      const results = await mapWithConcurrency(candidates, concurrency, async (candidate) => {
        const probe = await probeTechnicalStorefront(candidate.key);
        await recordRegistryEvidence(database, {
          kind: candidate.kind,
          key: candidate.key,
          evidenceKind: "TECHNICAL_STOREFRONT",
          evidenceUrl: probe.evidenceUrl,
          result: probe.result,
          details: probe.details
        });
        return probe.result;
      });
      return {
        probed: candidates.length,
        passed: results.filter((result) => result === "PASS").length,
        failed: results.filter((result) => result === "FAIL").length,
        unknown: results.filter((result) => result === "UNKNOWN").length,
        concurrency
      };
    }
    if (command === "approve" || command === "approve-batch") {
      const file = requiredOption(arguments_, "--file");
      const input = JSON.parse(await readFile(resolve(file), "utf8"));
      const approvals = command === "approve"
        ? [ApprovalSchema.parse(input)]
        : parseRegistryApprovalBatch(input);
      await database.transaction(async (transaction) => {
        for (const approval of approvals) await approveReviewedCandidate(transaction, approval);
      });
      return command === "approve"
        ? { approved: approvalKey(approvals[0]!) }
        : {
            approved: approvals.length,
            officialStorefronts: approvals.filter((approval) => approval.kind === "OFFICIAL_STOREFRONT").length,
            merchantTrustApprovals: approvals.filter((approval) => approval.kind === "MERCHANT_TRUST").length
          };
    }
    if (command === "reject" || command === "suspend") {
      const kind = requiredKindOption(arguments_, "--kind");
      const key = requiredOption(arguments_, "--host");
      const note = requiredOption(arguments_, "--note");
      await reviewRegistryCandidate(database, {
        kind,
        key,
        status: command === "reject" ? "REJECTED" : "SUSPENDED",
        note
      });
      return { status: command === "reject" ? "REJECTED" : "SUSPENDED", candidate: `${kind}:${key}` };
    }
    if (command === "publish") {
      const version = requiredOption(arguments_, "--version");
      const snapshot = await publishApprovedRegistrySnapshot(database, version);
      return {
        version: snapshot.version,
        officialStorefronts: snapshot.officialStorefronts.stores.length,
        trustedMerchants: snapshot.merchantTrust.merchants.length
      };
    }
    if (command === "list") {
      const status = optionalOption(arguments_, "--status") as "CANDIDATE" | "APPROVED" | "SUSPENDED" | "REJECTED" | undefined;
      if (status !== undefined && !new Set(["CANDIDATE", "APPROVED", "SUSPENDED", "REJECTED"]).has(status)) {
        throw new Error("--status is invalid");
      }
      const candidates = await listRegistryCandidates(database, {
        ...(status === undefined ? {} : { status }),
        limit: optionalIntegerOption(arguments_, "--limit", 100, 1, 2_000)
      });
      return { candidates };
    }
    throw new Error("unsupported registry command");
  } finally {
    await database.close();
  }
}

export type RegistryApproval = z.infer<typeof ApprovalSchema>;

async function approveReviewedCandidate(executor: SqlExecutor, approval: RegistryApproval): Promise<void> {
  const key = approval.kind === "OFFICIAL_STOREFRONT" ? approval.record.officialHost : approval.record.host;
  await upsertRegistryCandidate(executor, {
    kind: approval.kind,
    key,
    source: "MANUAL",
    sourceReference: approval.evidenceUrl,
    payload: approval.record
  });
  await recordRegistryEvidence(executor, {
    kind: approval.kind,
    key,
    evidenceKind: approval.evidenceKind as RegistryEvidenceKind,
    evidenceUrl: approval.evidenceUrl,
    result: "PASS",
    details: { reviewed: true }
  });
  await reviewRegistryCandidate(executor, {
    kind: approval.kind,
    key,
    status: "APPROVED",
    record: approval.record,
    note: approval.note
  });
}

function approvalKey(approval: RegistryApproval): string {
  const host = approval.kind === "OFFICIAL_STOREFRONT" ? approval.record.officialHost : approval.record.host;
  return `${approval.kind}:${host}`;
}

export function parseRegistryApprovalBatch(input: unknown): RegistryApproval[] {
  const direct = ApprovalBatchSchema.safeParse(input);
  if (direct.success) return direct.data.approvals;
  const expansion = CuratedExpansionSchema.parse(input);
  const approvals: RegistryApproval[] = [];
  for (const store of expansion.officialStorefronts) {
    const evidenceUrl = `https://${store.storefrontHost ?? store.officialHost}/`;
    approvals.push(ApprovalSchema.parse({
      kind: "OFFICIAL_STOREFRONT",
      record: {
        ...store,
        platform: "SHOPIFY",
        productPathPrefixes: ["/products/"],
        imageHosts: ["cdn.shopify.com"],
        evidenceUrl,
        reviewedAt: expansion.reviewedAt,
        status: "APPROVED"
      },
      note: "Brand-controlled Shopify domain reviewed after technical storefront collection.",
      evidenceKind: "BRAND_DOMAIN",
      evidenceUrl
    }));
    approvals.push(ApprovalSchema.parse({
      kind: "MERCHANT_TRUST",
      record: {
        host: store.officialHost,
        level: "OFFICIAL",
        evidenceUrl,
        reviewedAt: expansion.reviewedAt,
        status: "APPROVED"
      },
      note: "Brand-controlled official merchant domain reviewed.",
      evidenceKind: "BRAND_DOMAIN",
      evidenceUrl
    }));
  }
  for (const merchant of expansion.additionalTrustedMerchants) {
    const evidenceUrl = merchant.evidenceUrl ?? `https://${merchant.host}/`;
    approvals.push(ApprovalSchema.parse({
      kind: "MERCHANT_TRUST",
      record: {
        host: merchant.host,
        level: merchant.level,
        evidenceUrl,
        reviewedAt: expansion.reviewedAt,
        status: "APPROVED"
      },
      note: merchant.level === "OFFICIAL"
        ? "Brand-controlled official merchant domain reviewed."
        : "Established retailer identity and public storefront reviewed.",
      evidenceKind: merchant.level === "OFFICIAL" ? "BRAND_DOMAIN" : "BUSINESS_IDENTITY",
      evidenceUrl
    }));
  }
  ApprovalBatchSchema.parse({ approvals });
  return approvals;
}

function requiredKindOption(arguments_: readonly string[], name: string): RegistryCandidateKind {
  const value = requiredOption(arguments_, name);
  if (value !== "OFFICIAL_STOREFRONT" && value !== "MERCHANT_TRUST") throw new Error(`${name} is invalid`);
  return value;
}

function requiredOption(arguments_: readonly string[], name: string): string {
  const value = optionalOption(arguments_, name);
  if (value === undefined || value === "") throw new Error(`${name} is required`);
  return value;
}

function optionalOption(arguments_: readonly string[], name: string): string | undefined {
  const index = arguments_.indexOf(name);
  if (index < 0) return undefined;
  const value = arguments_[index + 1];
  if (value === undefined || value.startsWith("--")) throw new Error(`${name} requires a value`);
  return value;
}

function optionalIntegerOption(
  arguments_: readonly string[],
  name: string,
  fallback: number,
  minimum: number,
  maximum: number
): number {
  const value = optionalOption(arguments_, name);
  if (value === undefined) return fallback;
  if (!/^\d+$/u.test(value)) throw new Error(`${name} is invalid`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) throw new Error(`${name} is invalid`);
  return parsed;
}

async function mapWithConcurrency<Input, Output>(
  values: readonly Input[],
  concurrency: number,
  worker: (value: Input) => Promise<Output>
): Promise<Output[]> {
  const output = new Array<Output>(values.length);
  let next = 0;
  async function run(): Promise<void> {
    while (next < values.length) {
      const index = next;
      next += 1;
      output[index] = await worker(values[index]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, run));
  return output;
}

const entryPath = process.argv[1];
if (entryPath !== undefined && resolve(entryPath) === fileURLToPath(import.meta.url)) {
  const result = await runRegistryBuilder(process.argv.slice(2));
  console.log(JSON.stringify(result, null, 2));
}
