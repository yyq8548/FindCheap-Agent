import { z } from "zod";

const MerchantHostSchema = z.string().trim().toLowerCase().regex(
  /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/u
).max(253).refine((host) => !host.startsWith("www."), "host must omit www");

export const ManagedMerchantTrustRecordSchema = z.object({
  host: MerchantHostSchema,
  level: z.enum(["OFFICIAL", "AUTHORIZED_RETAILER", "ESTABLISHED_RETAILER"]),
  evidenceUrl: z.string().url().max(2_000),
  reviewedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
  status: z.literal("APPROVED")
}).strict().superRefine((record, context) => {
  const evidence = new URL(record.evidenceUrl);
  if (evidence.protocol !== "https:" || evidence.username !== "" || evidence.password !== "" || evidence.port !== "") {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["evidenceUrl"],
      message: "evidenceUrl must be credential-free HTTPS"
    });
  }
});

export const ManagedMerchantTrustRegistrySchema = z.object({
  version: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/u),
  merchants: z.array(ManagedMerchantTrustRecordSchema).min(1).max(5_000)
}).strict().superRefine((registry, context) => {
  const hosts = new Set<string>();
  registry.merchants.forEach((merchant, index) => {
    if (hosts.has(merchant.host)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["merchants", index, "host"],
        message: "host must be unique"
      });
    }
    hosts.add(merchant.host);
  });
});

export type ManagedMerchantTrustRecord = z.infer<typeof ManagedMerchantTrustRecordSchema>;
export type ManagedMerchantTrustRegistry = z.infer<typeof ManagedMerchantTrustRegistrySchema>;

export const EMBEDDED_MERCHANT_TRUST_REGISTRY: ManagedMerchantTrustRegistry = ManagedMerchantTrustRegistrySchema.parse({
  version: "merchant-trust-2026-08-28",
  merchants: [
    official("electronics.sony.com", "https://electronics.sony.com/", "2026-08-20"),
    official("shopdoen.com", "https://www.shopdoen.com/", "2026-08-20"),
    official("skims.com", "https://skims.com/", "2026-08-27"),
    official("deathwishcoffee.com", "https://www.deathwishcoffee.com/", "2026-08-27"),
    official("blkandbold.com", "https://blkandbold.com/", "2026-08-27"),
    official("vervecoffee.com", "https://www.vervecoffee.com/", "2026-08-27"),
    official("fashionnova.com", "https://www.fashionnova.com/", "2026-08-20"),
    official("stevemadden.com", "https://www.stevemadden.com/", "2026-08-27"),
    official("apple.com", "https://www.apple.com/", "2026-08-24"),
    official("samsung.com", "https://www.samsung.com/us/", "2026-08-24"),
    official("microsoft.com", "https://www.microsoft.com/en-us/store/b/home", "2026-08-24"),
    official("dell.com", "https://www.dell.com/en-us", "2026-08-24"),
    official("hp.com", "https://www.hp.com/us-en/shop", "2026-08-24"),
    official("lenovo.com", "https://www.lenovo.com/us/en/", "2026-08-24"),
    official("nike.com", "https://www.nike.com/", "2026-08-24"),
    official("adidas.com", "https://www.adidas.com/us/", "2026-08-24"),
    official("patagonia.com", "https://www.patagonia.com/", "2026-08-24"),
    official("thenorthface.com", "https://www.thenorthface.com/", "2026-08-24"),
    official("allbirds.com", "https://www.allbirds.com/", "2026-08-27"),
    official("bombas.com", "https://bombas.com/", "2026-08-24"),
    official("brooklinen.com", "https://www.brooklinen.com/", "2026-08-27"),
    official("gymshark.com", "https://www.gymshark.com/", "2026-08-24"),
    official("glossier.com", "https://www.glossier.com/", "2026-08-27"),
    official("colourpop.com", "https://colourpop.com/", "2026-08-27"),
    official("freepeople.com", "https://www.freepeople.com/", "2026-08-28"),
    authorized("expercom.com", "https://expercom.com/"),
    authorized("clemsontigertechshop.com", "https://hdkb.clemson.edu/phpkb/article.php?id=1730"),
    authorized("svacampusstore.com", "https://assets.sva.edu/download/welcome-week-schedule-sp22-v9-1639607385.pdf"),
    established("bestbuy.com", "https://www.bestbuy.com/"),
    established("target.com", "https://www.target.com/"),
    established("walmart.com", "https://www.walmart.com/"),
    established("costco.com", "https://www.costco.com/"),
    established("bhphotovideo.com", "https://www.bhphotovideo.com/find/b2b/AboutUs.jsp"),
    established("adorama.com", "https://www.adorama.com/g/about-adorama"),
    established("microcenter.com", "https://www.microcenter.com/"),
    established("homedepot.com", "https://www.homedepot.com/"),
    established("lowes.com", "https://www.lowes.com/"),
    established("wayfair.com", "https://www.wayfair.com/"),
    established("nordstrom.com", "https://www.nordstrom.com/"),
    established("macys.com", "https://www.macys.com/"),
    established("rei.com", "https://www.rei.com/"),
    established("chewy.com", "https://www.chewy.com/"),
    established("petsmart.com", "https://www.petsmart.com/"),
    established("sephora.com", "https://www.sephora.com/"),
    established("ulta.com", "https://www.ulta.com/"),
    established("staples.com", "https://www.staples.com/"),
    established("officedepot.com", "https://www.officedepot.com/"),
    established("barnesandnoble.com", "https://www.barnesandnoble.com/")
  ]
});

function official(host: string, evidenceUrl: string, reviewedAt: string) {
  return { host, level: "OFFICIAL" as const, evidenceUrl, reviewedAt, status: "APPROVED" as const };
}

function authorized(host: string, evidenceUrl: string) {
  return { host, level: "AUTHORIZED_RETAILER" as const, evidenceUrl, reviewedAt: "2026-08-24", status: "APPROVED" as const };
}

function established(host: string, evidenceUrl: string) {
  return { host, level: "ESTABLISHED_RETAILER" as const, evidenceUrl, reviewedAt: "2026-08-24", status: "APPROVED" as const };
}
