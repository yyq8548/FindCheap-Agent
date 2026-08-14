import type { CanonicalProduct, MerchantOffer, PriceQuote } from "../../../contracts/src/index.js";
import {
  requireOfferShape,
  requireQuoteShape
} from "../../../merchant-sdk/src/index.js";
import {
  decideProductPromotion,
  normalizeGtin,
  normalizeToken,
  type ProductPromotionDecision
} from "../../../product-identity/src/index.js";
import type { PublishedQuote } from "../../../../apps/ingestion-worker/src/jobs/refresh-price.js";
import type { PublishedOffer } from "../../../../apps/ingestion-worker/src/jobs/refresh-product.js";
import {
  canonicalHash,
  normalizeMemberships,
  normalizeZipCode,
  quoteContextKey
} from "../../../../apps/ingestion-worker/src/jobs/refresh-identity.js";
import type { Database, SqlExecutor } from "../client.js";

const MAX_CANDIDATES = 20;

export type PromotionStatus =
  | "EXACT_PROMOTED"
  | "SIMILAR"
  | "NEEDS_CLARIFICATION"
  | "NO_MATCH"
  | "AMBIGUOUS"
  | "PENDING_EXACT_OFFER"
  | "QUOTE_PROMOTED";

export type PromotionResult = {
  decisionId: string;
  status: PromotionStatus;
  offerId?: string;
  quoteId?: string;
  offerPromotionDecisionId?: string;
  offerRevision?: number;
  canonicalProductId?: string;
};

export type PromotionOptions = {
  decisionVersion?: number;
  decidedBy?: string;
  expectedCurrentOfferPromotionDecisionId?: string;
};

export interface PromotionRepository {
  promoteProduct(stagingId: string, options?: PromotionOptions): Promise<PromotionResult>;
  promoteQuote(stagingId: string, options?: PromotionOptions): Promise<PromotionResult>;
  promotePendingQuotes(merchantId: string, merchantProductId: string): Promise<PromotionResult[]>;
}

type ProductStagingRow = {
  id: string;
  source_identity_key: string;
  merchant_id: string;
  merchant_product_id: string;
  source_version: string;
  payload: PublishedOffer;
  primary_evidence_id: string;
  external_evidence_refs: string[];
  checked_at: Date;
  expires_at: Date;
};

type QuoteStagingRow = {
  id: string;
  source_identity_key: string;
  merchant_id: string;
  merchant_product_id: string;
  source_version: string;
  zip_code: string;
  memberships: string[];
  context_hash: string;
  delivered_price_cents: string;
  payload: PublishedQuote;
  primary_evidence_id: string;
  external_evidence_refs: string[];
  checked_at: Date;
  expires_at: Date;
};

type IngestionEvidenceRow = {
  id: string;
  source_identity_key: string;
  merchant_id: string;
  merchant_product_id: string;
  source_version: string;
  quote_context: { zipCode: string; memberships: string[] } | null;
  source_url: string;
  source_type: string;
  content_hash: string;
  captured_at: Date;
  metadata: Record<string, string>;
};

type ProductRow = {
  id: string;
  brand: string;
  manufacturer_part_number: string | null;
  gtins: string[];
  title: string;
  category_path: string[];
  attributes: CanonicalProduct["attributes"];
  variant_dimensions: Record<string, string>;
};

type ExistingDecisionRow = {
  id: string;
  input_hash: string;
  status: PromotionStatus;
  canonical_product_id: string | null;
  promoted_offer_id: string | null;
  promoted_quote_id: string | null;
  offer_promotion_decision_id: string | null;
  offer_revision: string | null;
};

type DecisionWrite = {
  entityKind: "OFFER" | "QUOTE";
  sourceIdentityKey: string;
  decisionVersion: number;
  stagingRecordId: string;
  merchantId: string;
  merchantProductId: string;
  sourceVersion: string;
  status: PromotionStatus;
  canonicalProductId?: string;
  offerId?: string;
  quoteId?: string;
  offerPromotionDecisionId?: string;
  offerRevision?: number;
  evidence: IngestionEvidenceRow;
  externalEvidenceRefs: string[];
  matchBasis?: "GTIN" | "BRAND_MPN";
  matchEvidence: MerchantOffer["matchEvidence"];
  reason: string;
  questions: string[];
  candidateProductIds: string[];
  zipCode?: string;
  memberships?: string[];
  contextHash?: string;
  stagedCheckedAt: Date;
  stagedExpiresAt: Date;
  stagedRecordHash: string;
  decidedBy: string;
  inputHash: string;
};

export function createPromotionRepository(
  db: Database,
  clock: { now(): Date } = { now: () => new Date() }
): PromotionRepository {
  const promoteProduct = async (
    stagingId: string,
    options: PromotionOptions = {}
  ): Promise<PromotionResult> => {
    const control = normalizeOptions(options);
    return db.transaction(async (transaction) => {
      await lock(transaction, `offer:${stagingId}`);
      const staging = await selectProductStaging(transaction, stagingId);
      await lock(
        transaction,
        `offer-sku:${staging.merchant_id}:${staging.merchant_product_id}`
      );
      const inputHash = canonicalHash({
        entityKind: "OFFER",
        stagingRecordId: staging.id,
        payload: staging.payload,
        decisionVersion: control.decisionVersion,
        expectedCurrentOfferPromotionDecisionId:
          control.expectedCurrentOfferPromotionDecisionId ?? null
      });
      const reused = await existingDecision(
        transaction,
        "OFFER",
        staging.source_identity_key,
        control.decisionVersion,
        inputHash
      );
      if (reused !== undefined) return reused;
      requireFresh(staging.expires_at, clock.now());
      if (control.expectedCurrentOfferPromotionDecisionId !== undefined && !control.explicitReview) {
        throw new Error("expected current offer revision requires an explicit reviewed decision");
      }

      validateProductStaging(staging);
      const evidence = await requirePromotionEvidence(transaction, staging, null);
      await copyCoreEvidence(transaction, evidence);
      const candidates = await findCandidates(transaction, staging.payload);
      let decision: ProductPromotionDecision = candidates.overflow
        ? {
          status: "AMBIGUOUS",
          reason: `canonical candidate lookup exceeded the bounded limit of ${MAX_CANDIDATES}`,
          questions: ["Select the independently verified canonical product."],
          candidateProductIds: candidates.products.map((product) => product.productId)
        }
        : decideProductPromotion(
          {
            ...(staging.payload.brand === undefined ? {} : { brand: staging.payload.brand }),
            ...(staging.payload.mpn === undefined ? {} : { mpn: staging.payload.mpn }),
            title: staging.payload.title,
            gtins: staging.payload.gtins.flatMap((value) => normalizeGtin(value) ?? []),
            variantDimensions: staging.payload.variantDimensions,
            coreSimilarity: 0
          },
          candidates.products
        );

      if (decision.status === "EXACT") {
        const existingOffer = await selectOfferByMerchantSku(
          transaction,
          staging.merchant_id,
          staging.merchant_product_id
        );
        const currentPromotion = existingOffer === undefined
          ? undefined
          : await selectCurrentOfferPromotion(transaction, existingOffer.id);
        const baselineProductId = currentPromotion?.canonical_product_id ?? existingOffer?.product_id;
        if (
          control.expectedCurrentOfferPromotionDecisionId !== undefined &&
          currentPromotion?.promotion_decision_id !== control.expectedCurrentOfferPromotionDecisionId
        ) {
          decision = {
            status: "NEEDS_CLARIFICATION",
            reason: "reviewed offer revision is stale; review the current revision",
            questions: ["Review the current canonical product revision."],
            candidateProductIds: [
              decision.canonicalProductId,
              ...(baselineProductId === null || baselineProductId === undefined ? [] : [baselineProductId])
            ].filter((value, index, values) => values.indexOf(value) === index).sort()
          };
        }
        if (
          decision.status === "EXACT" &&
          existingOffer !== undefined &&
          (
            staging.checked_at < existingOffer.checked_at ||
            (
              baselineProductId !== null &&
              baselineProductId !== undefined &&
              baselineProductId !== decision.canonicalProductId &&
              (
                !control.explicitReview ||
                control.expectedCurrentOfferPromotionDecisionId === undefined
              )
            )
          )
        ) {
          decision = {
            status: "NEEDS_CLARIFICATION",
            reason: staging.checked_at < existingOffer.checked_at
              ? "older staging cannot replace a newer canonical offer revision"
              : control.explicitReview
                ? "reviewed canonical reassignment requires the current offer revision"
                : "changing the canonical product requires an explicit reviewed decision version",
            questions: ["Review a current canonical product revision."],
            candidateProductIds: [...new Set([
              decision.canonicalProductId,
              ...(baselineProductId === null || baselineProductId === undefined ? [] : [baselineProductId])
            ])].sort()
          };
        }
      }

      if (decision.status !== "EXACT") {
        const status = decisionStatus(decision.status);
        const write: DecisionWrite = {
          ...baseDecision(staging, evidence, control, inputHash),
          entityKind: "OFFER",
          status,
          matchEvidence: [],
          reason: decision.reason,
          questions: decision.questions,
          candidateProductIds: decision.candidateProductIds
        };
        const decisionId = await insertDecision(transaction, write);
        return { decisionId, status };
      }

      let matchEvidence: MerchantOffer["matchEvidence"];
      if (decision.method === "GTIN" && "gtin" in decision.fields) {
        matchEvidence = [{
          type: "GTIN",
          gtin: decision.fields.gtin,
          source: evidenceSource(evidence.source_type)
        }];
      } else if (decision.method === "BRAND_MPN" && "brand" in decision.fields) {
        matchEvidence = [{
          type: "BRAND_MPN",
          brand: decision.fields.brand,
          manufacturerPartNumber: decision.fields.manufacturerPartNumber,
          source: evidenceSource(evidence.source_type)
        }];
      } else {
        throw new Error("exact decision fields do not match its identity method");
      }
      const decisionId = decisionRecordId("OFFER", staging.source_identity_key, control.decisionVersion);
      const offer = await upsertExactOffer(
        transaction,
        staging,
        decision.canonicalProductId,
        matchEvidence,
        control.explicitReview
      );
      const offerRevision = offer.revision;
      const write: DecisionWrite = {
        ...baseDecision(staging, evidence, control, inputHash),
        entityKind: "OFFER",
        status: "EXACT_PROMOTED",
        canonicalProductId: decision.canonicalProductId,
        offerId: offer.id,
        offerRevision,
        matchBasis: decision.method,
        matchEvidence,
        reason: `deterministic ${decision.method} identity and required variants match`,
        questions: [],
        candidateProductIds: decision.candidateProductIds
      };
      await insertDecision(transaction, write);
      await transaction.query(
        `INSERT INTO merchant_offer_current_promotions (
           offer_id, promotion_decision_id, revision, canonical_product_id,
           source_identity_key, source_version, promoted_checked_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (offer_id) DO UPDATE SET
           promotion_decision_id = EXCLUDED.promotion_decision_id,
           revision = EXCLUDED.revision,
           canonical_product_id = EXCLUDED.canonical_product_id,
           source_identity_key = EXCLUDED.source_identity_key,
           source_version = EXCLUDED.source_version,
           promoted_checked_at = EXCLUDED.promoted_checked_at`,
        [offer.id, decisionId, offerRevision, decision.canonicalProductId,
          staging.source_identity_key, staging.source_version, staging.checked_at]
      );
      return {
        decisionId,
        status: "EXACT_PROMOTED",
        offerId: offer.id,
        offerRevision,
        canonicalProductId: decision.canonicalProductId
      };
    });
  };

  const promoteQuote = async (
    stagingId: string,
    options: PromotionOptions = {}
  ): Promise<PromotionResult> => {
    const control = normalizeOptions(options);
    return db.transaction(async (transaction) => {
      await lock(transaction, `quote:${stagingId}`);
      const staging = await selectQuoteStaging(transaction, stagingId);
      const inputHash = canonicalHash({
        entityKind: "QUOTE",
        stagingRecordId: staging.id,
        payload: staging.payload,
        decisionVersion: control.decisionVersion
      });
      const reused = await existingDecision(
        transaction,
        "QUOTE",
        staging.source_identity_key,
        control.decisionVersion,
        inputHash
      );
      if (reused !== undefined) return reused;
      requireFresh(staging.expires_at, clock.now());

      validateQuoteStaging(staging);
      const quoteContext = {
        zipCode: normalizeZipCode(staging.zip_code),
        memberships: normalizeMemberships(staging.memberships)
      };
      const evidence = await requirePromotionEvidence(transaction, staging, quoteContext);
      await copyCoreEvidence(transaction, evidence);
      const exact = await transaction.query<{
        id: string;
        product_id: string;
        promotion_decision_id: string;
        revision: string;
      }>(
        `SELECT o.id, o.product_id, c.promotion_decision_id, c.revision::text
         FROM merchant_offers o
         JOIN merchant_offer_current_promotions c ON c.offer_id = o.id
         WHERE o.merchant_id = $1 AND o.merchant_product_id = $2
           AND o.match_status = 'EXACT' AND o.product_id IS NOT NULL
           AND c.canonical_product_id = o.product_id
           AND c.promoted_checked_at = o.checked_at
           AND o.expires_at > $3
           AND c.promoted_checked_at <= $4
         FOR UPDATE OF o`,
        [staging.merchant_id, staging.merchant_product_id, clock.now(), staging.checked_at]
      );
      const offer = exact.rows[0];
      if (offer === undefined) {
        const write: DecisionWrite = {
          ...baseDecision(staging, evidence, control, inputHash),
          entityKind: "QUOTE",
          status: "PENDING_EXACT_OFFER",
          matchEvidence: [],
          reason: "no fresh exact-promoted offer exists for this merchant product",
          questions: [],
          candidateProductIds: [],
          zipCode: quoteContext.zipCode,
          memberships: quoteContext.memberships,
          contextHash: staging.context_hash
        };
        return {
          decisionId: await insertDecision(transaction, write),
          status: "PENDING_EXACT_OFFER"
        };
      }

      const offerRevision = Number(offer.revision);
      const quoteId = await upsertQuote(
        transaction,
        staging,
        offer.id,
        offer.promotion_decision_id,
        offerRevision
      );
      const write: DecisionWrite = {
        ...baseDecision(staging, evidence, control, inputHash),
        entityKind: "QUOTE",
        status: "QUOTE_PROMOTED",
        canonicalProductId: offer.product_id,
        offerId: offer.id,
        quoteId,
        offerPromotionDecisionId: offer.promotion_decision_id,
        offerRevision,
        matchEvidence: [],
        reason: "quote context and provenance match an exact-promoted offer",
        questions: [],
        candidateProductIds: [offer.product_id],
        zipCode: quoteContext.zipCode,
        memberships: quoteContext.memberships,
        contextHash: staging.context_hash
      };
      return {
        decisionId: await insertDecision(transaction, write),
        status: "QUOTE_PROMOTED",
        offerId: offer.id,
        quoteId,
        offerPromotionDecisionId: offer.promotion_decision_id,
        offerRevision,
        canonicalProductId: offer.product_id
      };
    });
  };

  return {
    promoteProduct,
    promoteQuote,
    async promotePendingQuotes(merchantId, merchantProductId) {
      const rows = await db.query<{ id: string; next_version: number }>(
        `SELECT s.id,
                COALESCE((
                  SELECT max(history.decision_version)
                  FROM merchant_promotion_decisions history
                  WHERE history.entity_kind = 'QUOTE'
                    AND history.source_identity_key = s.source_identity_key
                ), 0)::integer + 1 AS next_version
         FROM merchant_quote_staging s
         JOIN merchant_offers o
           ON o.merchant_id = s.merchant_id
          AND o.merchant_product_id = s.merchant_product_id
          AND o.match_status = 'EXACT'
          AND o.product_id IS NOT NULL
         JOIN merchant_offer_current_promotions current_promotion
           ON current_promotion.offer_id = o.id
          AND current_promotion.canonical_product_id = o.product_id
          AND current_promotion.promoted_checked_at = o.checked_at
         WHERE s.merchant_id = $1
           AND s.merchant_product_id = $2
           AND s.expires_at > $3
           AND o.expires_at > $3
           AND s.checked_at >= current_promotion.promoted_checked_at
           AND NOT EXISTS (
             SELECT 1
             FROM merchant_promotion_decisions promoted
             WHERE promoted.entity_kind = 'QUOTE'
               AND promoted.source_identity_key = s.source_identity_key
               AND promoted.status = 'QUOTE_PROMOTED'
               AND promoted.offer_promotion_decision_id = current_promotion.promotion_decision_id
               AND promoted.offer_revision = current_promotion.revision
           )
         ORDER BY s.checked_at ASC, s.id COLLATE "C" ASC`,
        [merchantId, merchantProductId, clock.now()]
      );
      const results: PromotionResult[] = [];
      for (const row of rows.rows) {
        results.push(await promoteQuote(row.id, {
          decisionVersion: row.next_version,
          decidedBy: "system:pending-quote-drain"
        }));
      }
      return results;
    }
  };
}

function requireFresh(expiresAt: Date, now: Date): void {
  if (!Number.isFinite(now.getTime()) || expiresAt <= now) {
    throw new Error("staged merchant data is expired and cannot be promoted");
  }
}

function normalizeOptions(options: PromotionOptions): {
  decisionVersion: number;
  decidedBy: string;
  explicitReview: boolean;
  expectedCurrentOfferPromotionDecisionId?: string;
} {
  const decisionVersion = options.decisionVersion ?? 1;
  const decidedBy = options.decidedBy ?? "system:ingestion-worker";
  if (!Number.isSafeInteger(decisionVersion) || decisionVersion < 1) {
    throw new Error("decision version must be a positive safe integer");
  }
  if (decidedBy.trim().length === 0 || decidedBy.length > 200) {
    throw new Error("decision actor is invalid");
  }
  const expectedCurrentOfferPromotionDecisionId = options.expectedCurrentOfferPromotionDecisionId;
  if (
    expectedCurrentOfferPromotionDecisionId !== undefined &&
    !/^[a-f0-9]{64}$/u.test(expectedCurrentOfferPromotionDecisionId)
  ) {
    throw new Error("expected current offer promotion decision ID is invalid");
  }
  return {
    decisionVersion,
    decidedBy,
    explicitReview: decisionVersion > 1 && !decidedBy.startsWith("system:"),
    ...(expectedCurrentOfferPromotionDecisionId === undefined
      ? {}
      : { expectedCurrentOfferPromotionDecisionId })
  };
}

async function lock(transaction: SqlExecutor, key: string): Promise<void> {
  await transaction.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [key]);
}

async function selectProductStaging(
  transaction: SqlExecutor,
  id: string
): Promise<ProductStagingRow> {
  const result = await transaction.query<ProductStagingRow>(
    "SELECT * FROM merchant_product_staging WHERE id = $1 FOR UPDATE",
    [id]
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error("product staging record not found");
  return row;
}

async function selectQuoteStaging(
  transaction: SqlExecutor,
  id: string
): Promise<QuoteStagingRow> {
  const result = await transaction.query<QuoteStagingRow>(
    `SELECT id, source_identity_key, merchant_id, merchant_product_id, source_version,
            zip_code, memberships, context_hash, delivered_price_cents::text,
            payload, primary_evidence_id, external_evidence_refs, checked_at, expires_at
     FROM merchant_quote_staging WHERE id = $1 FOR UPDATE`,
    [id]
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error("quote staging record not found");
  return row;
}

function validateProductStaging(row: ProductStagingRow): void {
  requireOfferShape(row.payload);
  if (
    row.payload.offerId !== row.id ||
    row.payload.sourceIdentityKey !== row.source_identity_key ||
    row.payload.merchantId !== row.merchant_id ||
    row.payload.merchantProductId !== row.merchant_product_id ||
    row.payload.sourceVersion !== row.source_version ||
    row.payload.primaryEvidenceId !== row.primary_evidence_id ||
    canonicalHash(row.payload.externalEvidenceRefs) !== canonicalHash(row.external_evidence_refs) ||
    Date.parse(row.payload.checkedAt) !== row.checked_at.getTime() ||
    Date.parse(row.payload.expiresAt) !== row.expires_at.getTime()
  ) {
    throw new Error("product staging payload does not match its provenance columns");
  }
}

function validateQuoteStaging(row: QuoteStagingRow): void {
  requireQuoteShape(row.payload);
  const context = {
    zipCode: normalizeZipCode(row.zip_code),
    memberships: normalizeMemberships(row.memberships)
  };
  const delivered = row.payload.itemPriceCents + row.payload.shippingCents +
    row.payload.taxCents + row.payload.mandatoryFeeCents;
  if (
    !Number.isSafeInteger(delivered) ||
    row.payload.quoteId !== row.id ||
    row.payload.sourceIdentityKey !== row.source_identity_key ||
    row.payload.merchantId !== row.merchant_id ||
    row.payload.merchantProductId !== row.merchant_product_id ||
    row.payload.sourceVersion !== row.source_version ||
    row.payload.primaryEvidenceId !== row.primary_evidence_id ||
    canonicalHash(row.payload.externalEvidenceRefs) !== canonicalHash(row.external_evidence_refs) ||
    canonicalHash(row.payload.quoteContext) !== canonicalHash(context) ||
    row.context_hash !== quoteContextKey(context) ||
    Number(row.delivered_price_cents) !== delivered ||
    Date.parse(row.payload.checkedAt) !== row.checked_at.getTime() ||
    Date.parse(row.payload.expiresAt) !== row.expires_at.getTime()
  ) {
    throw new Error("quote staging payload does not match its provenance columns");
  }
}

async function requirePromotionEvidence(
  transaction: SqlExecutor,
  staging: ProductStagingRow | QuoteStagingRow,
  quoteContext: { zipCode: string; memberships: string[] } | null
): Promise<IngestionEvidenceRow> {
  const result = await transaction.query<IngestionEvidenceRow>(
    "SELECT * FROM ingestion_evidence WHERE id = $1 FOR SHARE",
    [staging.primary_evidence_id]
  );
  const row = result.rows[0];
  if (
    row === undefined ||
    row.source_identity_key !== staging.source_identity_key ||
    row.merchant_id !== staging.merchant_id ||
    row.merchant_product_id !== staging.merchant_product_id ||
    row.source_version !== staging.source_version ||
    canonicalHash(row.quote_context) !== canonicalHash(quoteContext)
  ) {
    throw new Error("promotion primary evidence provenance mismatch");
  }
  if (staging.external_evidence_refs.length > 0) {
    const known = await transaction.query<{ id: string; merchant_id: string }>(
      "SELECT id, merchant_id FROM ingestion_evidence WHERE id = ANY($1::text[])",
      [staging.external_evidence_refs]
    );
    if (known.rows.some((external) => external.merchant_id !== staging.merchant_id)) {
      throw new Error("cross-merchant external evidence is not allowed in promotion");
    }
  }
  return row;
}

async function copyCoreEvidence(transaction: SqlExecutor, row: IngestionEvidenceRow): Promise<void> {
  await transaction.query(
    `INSERT INTO evidence (
       id, merchant_id, source_url, source_type, content_hash, captured_at, metadata
     ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
     ON CONFLICT (id) DO NOTHING`,
    [row.id, row.merchant_id, row.source_url, row.source_type, row.content_hash,
      row.captured_at, JSON.stringify(row.metadata)]
  );
  const copied = await transaction.query<{
    merchant_id: string;
    source_url: string;
    source_type: string;
    content_hash: string;
    captured_at: Date;
    metadata: Record<string, string>;
  }>("SELECT * FROM evidence WHERE id = $1 FOR SHARE", [row.id]);
  const core = copied.rows[0];
  if (
    core === undefined || core.merchant_id !== row.merchant_id ||
    core.source_url !== row.source_url || core.source_type !== row.source_type ||
    core.content_hash !== row.content_hash || core.captured_at.getTime() !== row.captured_at.getTime() ||
    canonicalHash(core.metadata) !== canonicalHash(row.metadata)
  ) {
    throw new Error("core evidence conflicts with immutable ingestion provenance");
  }
}

async function findCandidates(
  transaction: SqlExecutor,
  offer: PublishedOffer
): Promise<{ products: CanonicalProduct[]; overflow: boolean }> {
  const gtins = [...new Set(offer.gtins.flatMap((value) => normalizeGtin(value) ?? []))].sort();
  const brandKey = offer.brand === undefined ? null : normalizeToken(offer.brand);
  const mpnKey = offer.mpn === undefined ? null : normalizeToken(offer.mpn);
  const result = await transaction.query<ProductRow>(
    `SELECT id, brand, manufacturer_part_number, gtins, title, category_path,
            attributes, variant_dimensions
     FROM products
     WHERE (cardinality($1::text[]) > 0 AND gtins && $1::text[])
        OR ($2::text IS NOT NULL AND $3::text IS NOT NULL
            AND identity_brand_key = $2 AND identity_mpn_key = $3)
     ORDER BY id COLLATE "C" LIMIT $4`,
    [gtins, brandKey, mpnKey, MAX_CANDIDATES + 1]
  );
  return {
    overflow: result.rows.length > MAX_CANDIDATES,
    products: result.rows.slice(0, MAX_CANDIDATES).map((row) => ({
      productId: row.id,
      brand: row.brand,
      ...(row.manufacturer_part_number === null
        ? {}
        : { manufacturerPartNumber: row.manufacturer_part_number }),
      gtins: row.gtins,
      title: row.title,
      categoryPath: row.category_path,
      attributes: row.attributes,
      variantDimensions: row.variant_dimensions
    }))
  };
}

async function selectOfferByMerchantSku(
  transaction: SqlExecutor,
  merchantId: string,
  merchantProductId: string
): Promise<{ id: string; product_id: string | null; checked_at: Date; snapshot: Record<string, unknown> } | undefined> {
  const result = await transaction.query<{
    id: string;
    product_id: string | null;
    checked_at: Date;
    snapshot: Record<string, unknown>;
  }>(
    `SELECT id, product_id, checked_at,
            jsonb_build_object(
              'productId', product_id, 'sellerName', seller_name, 'condition', condition,
              'matchStatus', match_status, 'inventoryStatus', inventory_status,
              'merchantUrl', merchant_url, 'evidenceRefs', evidence_refs,
              'matchEvidence', match_evidence, 'expiresAt', expires_at
            ) AS snapshot
     FROM merchant_offers WHERE merchant_id = $1 AND merchant_product_id = $2 FOR UPDATE`,
    [merchantId, merchantProductId]
  );
  return result.rows[0];
}

async function selectCurrentOfferPromotion(
  transaction: SqlExecutor,
  offerId: string
): Promise<{
  promotion_decision_id: string;
  canonical_product_id: string;
} | undefined> {
  const result = await transaction.query<{
    promotion_decision_id: string;
    canonical_product_id: string;
  }>(
    `SELECT promotion_decision_id, canonical_product_id
     FROM merchant_offer_current_promotions
     WHERE offer_id = $1
     FOR UPDATE`,
    [offerId]
  );
  return result.rows[0];
}

async function upsertExactOffer(
  transaction: SqlExecutor,
  staging: ProductStagingRow,
  productId: string,
  matchEvidence: MerchantOffer["matchEvidence"],
  explicitReview: boolean
): Promise<{ id: string; revision: number }> {
  const offer = staging.payload;
  const existing = await selectOfferByMerchantSku(
    transaction,
    staging.merchant_id,
    staging.merchant_product_id
  );
  const offerId = existing?.id ?? canonicalHash({
    kind: "commerce-offer",
    merchantId: staging.merchant_id,
    merchantProductId: staging.merchant_product_id
  });
  const snapshot = {
    productId,
    sellerName: offer.sellerName,
    condition: offer.condition,
    matchStatus: "EXACT",
    inventoryStatus: offer.inventoryStatus,
    merchantUrl: offer.merchantUrl,
    evidenceRefs: [staging.primary_evidence_id],
    matchEvidence,
    expiresAt: staging.expires_at.toISOString()
  };
  if (existing !== undefined && existing.checked_at.getTime() === staging.checked_at.getTime()) {
    if (canonicalHash(existing.snapshot) !== canonicalHash(snapshot)) {
      if (!explicitReview || existing.product_id === productId) {
        throw new Error("equal-timestamp offer promotion conflicts with persisted Commerce state");
      }
    } else {
      return { id: existing.id, revision: await nextOfferRevision(transaction, existing.id) };
    }
  }
  if (existing !== undefined && existing.checked_at > staging.checked_at) {
    throw new Error("older staging cannot change a newer Commerce offer");
  }
  if (existing === undefined) {
    await transaction.query(
      `INSERT INTO merchant_offers (
         id, merchant_id, merchant_product_id, product_id, seller_name, condition,
         match_status, inventory_status, merchant_url, evidence_refs, match_evidence,
         checked_at, expires_at
       ) VALUES ($1, $2, $3, $4, $5, $6, 'EXACT', $7, $8, $9, $10::jsonb, $11, $12)`,
      [offerId, staging.merchant_id, staging.merchant_product_id, productId,
        offer.sellerName, offer.condition, offer.inventoryStatus, offer.merchantUrl,
        [staging.primary_evidence_id], JSON.stringify(matchEvidence), staging.checked_at,
        staging.expires_at]
    );
  } else {
    await transaction.query(
      `UPDATE merchant_offers SET product_id = $2, seller_name = $3, condition = $4,
         match_status = 'EXACT', inventory_status = $5, merchant_url = $6,
         evidence_refs = $7, match_evidence = $8::jsonb, checked_at = $9, expires_at = $10
       WHERE id = $1`,
      [offerId, productId, offer.sellerName, offer.condition, offer.inventoryStatus,
        offer.merchantUrl, [staging.primary_evidence_id], JSON.stringify(matchEvidence),
        staging.checked_at, staging.expires_at]
    );
  }
  await replaceEvidence(transaction, "offer_evidence", "offer_id", offerId, staging.primary_evidence_id);
  return { id: offerId, revision: await nextOfferRevision(transaction, offerId) };
}

async function nextOfferRevision(transaction: SqlExecutor, offerId: string): Promise<number> {
  const result = await transaction.query<{ revision: string }>(
    `SELECT COALESCE(max(offer_revision), 0)::text AS revision
     FROM merchant_promotion_decisions
     WHERE entity_kind = 'OFFER' AND status = 'EXACT_PROMOTED' AND promoted_offer_id = $1`,
    [offerId]
  );
  const revision = Number(result.rows[0]?.revision ?? "0") + 1;
  if (!Number.isSafeInteger(revision)) throw new Error("offer revision overflow");
  return revision;
}

async function upsertQuote(
  transaction: SqlExecutor,
  staging: QuoteStagingRow,
  offerId: string,
  offerPromotionDecisionId: string,
  offerRevision: number
): Promise<string> {
  const quote = staging.payload;
  const context = {
    memberships: normalizeMemberships(staging.memberships)
  };
  const existing = await transaction.query<{
    id: string;
    checked_at: Date;
    snapshot: Record<string, unknown>;
  }>(
    `SELECT id, checked_at,
            jsonb_build_object(
              'status', status, 'deliveredPriceCents', delivered_price_cents,
              'lineItems', line_items, 'eligibilityConditions', eligibility_conditions,
              'evidenceRefs', evidence_refs, 'expiresAt', expires_at
            ) AS snapshot
     FROM price_quotes WHERE offer_id = $1 AND zip_code = $2 AND context_hash = $3
       AND offer_revision = $4 FOR UPDATE`,
    [offerId, staging.zip_code, staging.context_hash, offerRevision]
  );
  const current = existing.rows[0];
  const quoteId = current?.id ?? canonicalHash({
    kind: "commerce-quote",
    offerId,
    offerRevision,
    zipCode: staging.zip_code,
    contextHash: staging.context_hash
  });
  const lineItems = quoteLineItems(quote);
  const snapshot = {
    status: quote.status,
    deliveredPriceCents: Number(staging.delivered_price_cents),
    lineItems,
    eligibilityConditions: quote.conditions,
    evidenceRefs: [staging.primary_evidence_id],
    expiresAt: staging.expires_at.toISOString()
  };
  if (current !== undefined && current.checked_at.getTime() === staging.checked_at.getTime()) {
    if (canonicalHash(current.snapshot) !== canonicalHash(snapshot)) {
      throw new Error("equal-timestamp quote promotion conflicts with persisted Commerce state");
    }
    return current.id;
  }
  if (current !== undefined && current.checked_at > staging.checked_at) {
    throw new Error("older quote staging cannot replace a newer Commerce quote");
  }
  if (current === undefined) {
    await transaction.query(
      `INSERT INTO price_quotes (
         id, offer_id, zip_code, membership_context, status, delivered_price_cents,
         line_items, eligibility_conditions, evidence_refs, checked_at, expires_at, context_hash
         , offer_promotion_decision_id, offer_revision
       ) VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7::jsonb, $8::jsonb, $9, $10, $11, $12, $13, $14)`,
      [quoteId, offerId, staging.zip_code, JSON.stringify(context), quote.status,
        Number(staging.delivered_price_cents), JSON.stringify(lineItems),
        JSON.stringify(quote.conditions), [staging.primary_evidence_id], staging.checked_at,
        staging.expires_at, staging.context_hash, offerPromotionDecisionId, offerRevision]
    );
  } else {
    await transaction.query(
      `UPDATE price_quotes SET membership_context = $2::jsonb, status = $3,
         delivered_price_cents = $4, line_items = $5::jsonb,
         eligibility_conditions = $6::jsonb, evidence_refs = $7,
         checked_at = $8, expires_at = $9, offer_promotion_decision_id = $10,
         offer_revision = $11 WHERE id = $1`,
      [quoteId, JSON.stringify(context), quote.status, Number(staging.delivered_price_cents),
        JSON.stringify(lineItems), JSON.stringify(quote.conditions),
        [staging.primary_evidence_id], staging.checked_at, staging.expires_at,
        offerPromotionDecisionId, offerRevision]
    );
  }
  await replaceEvidence(transaction, "quote_evidence", "quote_id", quoteId, staging.primary_evidence_id);
  return quoteId;
}

function quoteLineItems(quote: PublishedQuote): PriceQuote["lineItems"] {
  const money = (amountCents: number) => ({ amountCents, currency: "USD" as const });
  return [
    { kind: "ITEM" as const, amount: money(quote.itemPriceCents), label: "Item price" },
    { kind: "SHIPPING" as const, amount: money(quote.shippingCents), label: "Shipping" },
    { kind: "TAX" as const, amount: money(quote.taxCents), label: "Tax" },
    { kind: "MANDATORY_FEE" as const, amount: money(quote.mandatoryFeeCents), label: "Mandatory fee" }
  ];
}

async function replaceEvidence(
  transaction: SqlExecutor,
  table: "offer_evidence" | "quote_evidence",
  key: "offer_id" | "quote_id",
  recordId: string,
  evidenceId: string
): Promise<void> {
  await transaction.query(`DELETE FROM ${table} WHERE ${key} = $1`, [recordId]);
  await transaction.query(
    `INSERT INTO ${table} (${key}, evidence_id) VALUES ($1, $2)`,
    [recordId, evidenceId]
  );
}

async function existingDecision(
  transaction: SqlExecutor,
  entityKind: "OFFER" | "QUOTE",
  sourceIdentityKey: string,
  decisionVersion: number,
  inputHash: string
): Promise<PromotionResult | undefined> {
  const result = await transaction.query<ExistingDecisionRow>(
    `SELECT id, input_hash, status, canonical_product_id, promoted_offer_id, promoted_quote_id,
            offer_promotion_decision_id, offer_revision::text
     FROM merchant_promotion_decisions
     WHERE entity_kind = $1 AND source_identity_key = $2 AND decision_version = $3`,
    [entityKind, sourceIdentityKey, decisionVersion]
  );
  const row = result.rows[0];
  if (row === undefined) return undefined;
  if (row.input_hash !== inputHash) throw new Error("promotion decision idempotency conflict");
  return {
    decisionId: row.id,
    status: row.status,
    ...(row.canonical_product_id === null ? {} : { canonicalProductId: row.canonical_product_id }),
    ...(row.promoted_offer_id === null ? {} : { offerId: row.promoted_offer_id }),
    ...(row.promoted_quote_id === null ? {} : { quoteId: row.promoted_quote_id }),
    ...(row.offer_promotion_decision_id === null
      ? {}
      : { offerPromotionDecisionId: row.offer_promotion_decision_id }),
    ...(row.offer_revision === null ? {} : { offerRevision: Number(row.offer_revision) })
  };
}

async function insertDecision(transaction: SqlExecutor, write: DecisionWrite): Promise<string> {
  const id = decisionRecordId(write.entityKind, write.sourceIdentityKey, write.decisionVersion);
  await transaction.query(
    `INSERT INTO merchant_promotion_decisions (
       id, input_hash, entity_kind, source_identity_key, decision_version,
       staging_record_id, merchant_id, merchant_product_id, source_version, status,
       canonical_product_id, promoted_offer_id, promoted_quote_id, primary_evidence_id,
       offer_promotion_decision_id, offer_revision,
       source_url, source_type, source_content_hash, source_captured_at,
       external_evidence_refs, match_basis, match_evidence, reason, questions,
       candidate_product_ids, zip_code, memberships, context_hash, staged_checked_at,
       staged_expires_at, staged_record_hash, decided_by
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
       $15, $16, $17, $18, $19, $20, $21::jsonb, $22, $23::jsonb, $24, $25::jsonb,
       $26::jsonb, $27, $28::jsonb, $29, $30, $31, $32, $33
     )`,
    [id, write.inputHash, write.entityKind, write.sourceIdentityKey,
      write.decisionVersion, write.stagingRecordId, write.merchantId,
      write.merchantProductId, write.sourceVersion, write.status,
      write.canonicalProductId ?? null, write.offerId ?? null, write.quoteId ?? null,
      write.evidence.id, write.offerPromotionDecisionId ?? null, write.offerRevision ?? null,
      write.evidence.source_url, write.evidence.source_type,
      write.evidence.content_hash, write.evidence.captured_at,
      JSON.stringify(write.externalEvidenceRefs), write.matchBasis ?? null,
      JSON.stringify(write.matchEvidence), write.reason, JSON.stringify(write.questions),
      JSON.stringify(write.candidateProductIds), write.zipCode ?? null,
      write.memberships === undefined ? null : JSON.stringify(write.memberships),
      write.contextHash ?? null, write.stagedCheckedAt, write.stagedExpiresAt,
      write.stagedRecordHash, write.decidedBy]
  );
  return id;
}

function decisionRecordId(
  entityKind: "OFFER" | "QUOTE",
  sourceIdentityKey: string,
  decisionVersion: number
): string {
  return canonicalHash({
    kind: "merchant-promotion-decision",
    entityKind,
    sourceIdentityKey,
    decisionVersion
  });
}

function baseDecision(
  staging: ProductStagingRow | QuoteStagingRow,
  evidence: IngestionEvidenceRow,
  control: ReturnType<typeof normalizeOptions>,
  inputHash: string
): Omit<DecisionWrite,
  "entityKind" | "status" | "matchEvidence" | "reason" | "questions" | "candidateProductIds"
> {
  return {
    sourceIdentityKey: staging.source_identity_key,
    decisionVersion: control.decisionVersion,
    stagingRecordId: staging.id,
    merchantId: staging.merchant_id,
    merchantProductId: staging.merchant_product_id,
    sourceVersion: staging.source_version,
    evidence,
    externalEvidenceRefs: staging.external_evidence_refs,
    stagedCheckedAt: staging.checked_at,
    stagedExpiresAt: staging.expires_at,
    stagedRecordHash: canonicalHash(staging.payload),
    decidedBy: control.decidedBy,
    inputHash
  };
}

function decisionStatus(status: Exclude<ProductPromotionDecision["status"], "EXACT">): PromotionStatus {
  return status;
}

function evidenceSource(sourceType: string): "MERCHANT_PAGE" | "RETAILER_FEED" {
  return sourceType === "feed" ? "RETAILER_FEED" : "MERCHANT_PAGE";
}
