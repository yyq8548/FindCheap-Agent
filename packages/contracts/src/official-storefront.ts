import { z } from "zod";

const HostSchema = z.string().trim().toLowerCase().regex(
  /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/u
).max(253).refine((host) => !host.startsWith("www."), "officialHost must omit www");

const StorefrontHostSchema = z.string().trim().toLowerCase().regex(
  /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/u
).max(253);

const PathPrefixSchema = z.string().trim().regex(/^\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]*$/u).max(200);

export const OfficialStorefrontRecordSchema = z.object({
  brand: z.string().trim().min(1).max(100),
  aliases: z.array(z.string().trim().min(1).max(100)).max(20)
    .refine((values) => new Set(values.map(normalizeBrand)).size === values.length, "aliases must be unique")
    .default([]),
  officialHost: HostSchema,
  storefrontHost: StorefrontHostSchema.optional(),
  platform: z.enum(["SHOPIFY", "GENERIC_JSON_LD"]),
  productPathPrefixes: z.array(PathPrefixSchema).min(1).max(10),
  searchPathTemplate: z.string().trim().regex(/^\/[A-Za-z0-9._~!$&'()*+,;=:@%/?{}-]*\{query\}[A-Za-z0-9._~!$&'()*+,;=:@%/?{}-]*$/u)
    .max(300)
    .optional(),
  imageHosts: z.array(StorefrontHostSchema).max(20)
    .refine((values) => new Set(values).size === values.length, "imageHosts must be unique")
    .default([]),
  evidenceUrl: z.string().url().max(2_000),
  reviewedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
  status: z.literal("APPROVED")
}).strict().superRefine((record, context) => {
  const evidence = new URL(record.evidenceUrl);
  if (evidence.protocol !== "https:" || evidence.username !== "" || evidence.password !== "" || evidence.port !== "") {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["evidenceUrl"], message: "evidenceUrl must be credential-free HTTPS" });
  }
  const aliases = [record.brand, ...record.aliases].map(normalizeBrand);
  if (new Set(aliases).size !== aliases.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["aliases"], message: "brand and aliases must be unique" });
  }
});

export const OfficialStorefrontRegistrySchema = z.object({
  version: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/u),
  stores: z.array(OfficialStorefrontRecordSchema).max(2_000)
}).strict().superRefine((registry, context) => {
  const hosts = new Set<string>();
  const aliases = new Set<string>();
  registry.stores.forEach((store, index) => {
    if (hosts.has(store.officialHost)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["stores", index, "officialHost"], message: "officialHost must be unique" });
    }
    hosts.add(store.officialHost);
    for (const value of [store.brand, ...store.aliases]) {
      const normalized = normalizeBrand(value);
      if (aliases.has(normalized)) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["stores", index, "aliases"], message: "brand aliases must be globally unique" });
      }
      aliases.add(normalized);
    }
  });
});

export type OfficialStorefrontRecord = z.infer<typeof OfficialStorefrontRecordSchema>;
export type OfficialStorefrontRegistry = z.infer<typeof OfficialStorefrontRegistrySchema>;

function normalizeBrand(value: string): string {
  return value.normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/gu, "");
}
