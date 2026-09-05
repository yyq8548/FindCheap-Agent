import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { productReferenceKey } from "../apps/mcp-server/src/product-reference.js";
import { CodexVisualVerdictSchema } from "../apps/mcp-server/src/search-products.js";

const Hash = z.string().regex(/^[a-f0-9]{64}$/u);
const Id = z.string().regex(/^[A-Za-z0-9_.:-]{1,160}$/u);
const Artifact = z.object({ path: z.string().min(1).max(500), sha256: Hash }).strict();
const Release = z.object({ version: z.string().min(1).max(100), commit: z.string().regex(/^[a-f0-9]{40}$/u) }).strict();
const Modes = ["WITH_BRAND", "WITHOUT_BRAND"] as const;
const Mode = z.enum(Modes);
const RecordPair = z.object({ capture: Artifact, review: Artifact }).strict();
const Eligibility = z.enum(["SUPPORTED_RETRIEVABLE", "UNAVAILABLE", "OUT_OF_SCOPE", "EXPECTED_NO_MATCH"]);
const FrozenCohort = z.object({
  kind: z.literal("FROZEN_VISUAL_EVALUATION_COHORT"), frozenAt: z.string().datetime({ offset: true }), reviewerId: Id,
  cases: z.array(z.object({
    id: Id, imageSha256: Hash, labelSha256: Hash, styleFamilyId: Id,
    split: z.enum(["DEVELOPMENT", "HELD_OUT"]), priorExposure: z.enum(["UNSEEN", "DEVELOPMENT"]), eligibility: Eligibility
  }).strict()).max(1_000)
}).strict();
// Previously inspected user PDF images: hashes only, never acceptance hold-out.
const KNOWN_DEVELOPMENT_IMAGES = new Set([
  "4f431c93a1f2eeaa56f8811b14a9e3f44681dd8be940ea726f5713616194ea95",
  "23e8d3a4216f73a9a76078fe77c72dd251e74f22a1b553ea909547c78488f903",
  "1925de67d4361323c6b79874b8353b95e9891c52c43817ddc7a07978350bcfc1",
  "29f3eabceb338661499571b34fe1dcab0a58f3a9dee569f1e64e6b7836bb51b4",
  "2d053daac6c2bd3901330d2aa5b97b943345d7dcb986532f9e0b7d3def06ebbb",
  "dce97ea15b9ebac67ed33ce2f9dade67c49e2cdd55f143ea5b72b155f1e7fb21"
]);
const Manifest = z.object({
  schemaVersion: z.literal(2), baseline: Release, candidate: Release, cohort: Artifact,
  cases: z.array(z.object({
    id: Id, image: Artifact, imageOrigin: z.enum(["REAL_USER_IMAGE", "REAL_PUBLIC_IMAGE", "SYNTHETIC"]),
    split: z.enum(["DEVELOPMENT", "HELD_OUT"]), label: Artifact,
    runs: z.array(z.object({ brandMode: Mode, baseline: RecordPair, candidate: RecordPair }).strict()).max(2)
  }).strict()).max(1_000)
}).strict();
const Human = { reviewerId: Id, reviewedAt: z.string().datetime({ offset: true }) };
const TargetLabel = z.object({
  kind: z.literal("HUMAN_TARGET_LABEL"), caseId: Id, imageSha256: Hash, ...Human,
  eligibility: Eligibility,
  expectedProductHash: Hash.optional(), expectedProductHashes: z.array(Hash).min(1).max(10).optional(),
  reason: z.string().min(1).max(300).optional()
}).strict();
const Review = z.object({
  kind: z.literal("HUMAN_RUN_REVIEW"), caseId: Id, captureSha256: Hash, ...Human,
  referenceExtractionReviewed: z.literal(true), captureOriginReviewed: z.literal(true),
  verdictOriginReviewed: z.literal("ACTIVE_MODEL_IMAGE_REVIEW"), answerIsolationReviewed: z.literal(true),
  productLabels: z.array(z.object({ productHash: Hash, relevant: z.boolean() }).strict()).max(20),
  expectedPrimaryProductHash: Hash.nullable(),
  violations: z.array(z.enum(["IDENTITY_OVERWRITE", "CROSS_SNAPSHOT_REFERENCE", "UNSUPPORTED_EXACT", "FALSE_NONEXISTENCE", "PRIMARY_ORDER_CONFLICT", "POLICY_VIOLATION"])).max(20)
}).strict();
const EvaluationTrace = z.object({
  version: z.literal(1), traceId: Id, retrievedProductHashes: z.array(Hash).max(200),
  reviewedCandidates: z.array(z.object({ candidateId: Id, productHash: Hash, imageSha256: Hash, imageUrlHash: Hash.optional() }).strict()).max(9),
  finalProductHashes: z.array(Hash).max(3).optional(), primaryProductHash: Hash.optional()
});
const Capture = z.object({
  kind: z.literal("LIVE_CODEX_MCP_CAPTURE"), origin: z.literal("LIVE"),
  caseId: Id, threadId: Id, runId: Id, imageSha256: Hash, brandMode: Mode,
  startedAt: z.string().datetime({ offset: true }), cohortSha256: Hash,
  ...Release.shape,
  referenceExtraction: z.object({ modelId: Id, messageId: Id, visualInput: z.record(z.unknown()) }).strict(),
  calls: z.array(z.object({
    toolName: z.enum(["search_visual_candidates", "finalize_visual_search"]),
    arguments: z.record(z.unknown()), result: z.record(z.unknown())
  }).strict()).min(1).max(3)
}).strict();
const CardReference = z.object({
  merchantId: z.string(), sourceHost: z.string(), handle: z.string(), selectionId: Id,
  sourceKind: z.enum(["AWIN_PRODUCT_FEED", "SHOPIFY_GLOBAL_CATALOG", "EBAY_BROWSE"]).optional()
}).passthrough();
const InitialTerminalFailure = z.object({ code: z.enum([
  "OFFICIAL_SOURCE_UNAVAILABLE", "OFFICIAL_ZERO_RESULTS", "NO_CATALOG_CANDIDATES", "NO_LOADABLE_IMAGES",
  "IMAGE_PROCESSING_LIMIT", "SEARCH_BUDGET_EXHAUSTED"
]) });

export type VisualEvaluationManifest = z.infer<typeof Manifest>;
type ScoreRow = { mode: typeof Modes[number]; release: "baseline" | "candidate"; split: "DEVELOPMENT" | "HELD_OUT";
  eligible: boolean; targetExpected: boolean; retrieved: boolean; reviewed: boolean; hit: boolean; cards: number; relevant: number; primaryCorrect: boolean; violations: number };
type ArtifactLoader = (path: string) => Promise<Uint8Array>;
const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

/** Read-only scoring of independently recorded artifacts, never a model simulator. */
export async function evaluateVisualSearch(raw: unknown, load: ArtifactLoader) {
  const parsed = Manifest.safeParse(raw);
  const issues: Array<{ caseId?: string; code: string }> = [];
  const rows: ScoreRow[] = [];
  let completeCases = 0;
  let heldOutCases = 0;
  let completeSupportedCases = 0;
  let heldOutSupportedCases = 0;
  const hashes = new Set<string>();
  const ids = new Set<string>();
  const captureHashes = new Set<string>();
  const runIds = new Set<string>();
  const exclusions: Array<{ caseId: string; eligibility: string; reason: string }> = [];
  const read = async (artifact: z.infer<typeof Artifact>, image = false) => {
    if (isAbsolute(artifact.path) || artifact.path.split(/[\\/]/u).includes("..")) throw new Error("ARTIFACT_PATH_INVALID");
    const bytes = await load(artifact.path);
    if (bytes.byteLength > (image ? 20 : 4) * 1024 * 1024) throw new Error("ARTIFACT_SIZE_LIMIT");
    if (sha256(bytes) !== artifact.sha256) throw new Error("ARTIFACT_HASH_MISMATCH");
    return bytes;
  };
  const json = async (artifact: z.infer<typeof Artifact>): Promise<unknown> => JSON.parse(Buffer.from(await read(artifact)).toString("utf8"));
  if (!parsed.success) issues.push({ code: "INVALID_MANIFEST" });
  let cohort: z.infer<typeof FrozenCohort> | undefined;
  if (parsed.success) {
    try {
      cohort = FrozenCohort.parse(await json(parsed.data.cohort));
      const frozenIds = new Set(cohort.cases.map((entry) => entry.id));
      const frozenImages = new Set(cohort.cases.map((entry) => entry.imageSha256));
      if (frozenIds.size !== cohort.cases.length || frozenImages.size !== cohort.cases.length) issues.push({ code: "DUPLICATE_COHORT_CASE_OR_IMAGE" });
      if (frozenIds.size !== parsed.data.cases.length || parsed.data.cases.some((entry) => !frozenIds.has(entry.id))) issues.push({ code: "COHORT_CASE_SET_MISMATCH" });
      const families = new Map<string, string>();
      for (const entry of cohort.cases) {
        if (families.has(entry.styleFamilyId) && families.get(entry.styleFamilyId) !== entry.split) issues.push({ caseId: entry.id, code: "STYLE_FAMILY_SPLIT_LEAKAGE" });
        families.set(entry.styleFamilyId, entry.split);
        if (entry.split === "HELD_OUT" && (entry.priorExposure !== "UNSEEN" || KNOWN_DEVELOPMENT_IMAGES.has(entry.imageSha256))) {
          issues.push({ caseId: entry.id, code: "DEVELOPMENT_CASE_IN_HELD_OUT" });
        }
      }
    } catch { issues.push({ code: "FROZEN_COHORT_UNAVAILABLE_OR_INVALID" }); }
  }
  if (parsed.success && cohort !== undefined) for (const entry of parsed.data.cases) {
    try {
      const frozen = cohort.cases.find((item) => item.id === entry.id);
      if (frozen === undefined || frozen.imageSha256 !== entry.image.sha256 || frozen.split !== entry.split) throw new Error("COHORT_CASE_CHANGED");
      if (frozen.labelSha256 !== entry.label.sha256) throw new Error("COHORT_LABEL_CHANGED");
      if (ids.has(entry.id) || hashes.has(entry.image.sha256)) throw new Error("DUPLICATE_CASE_OR_IMAGE");
      ids.add(entry.id); hashes.add(entry.image.sha256);
      if (entry.imageOrigin === "SYNTHETIC") throw new Error("SYNTHETIC_NOT_ACCEPTANCE_EVIDENCE");
      const bytes = Buffer.from(await read(entry.image, true));
      if (!(bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
        (bytes[0] === 255 && bytes[1] === 216) || (bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP"))) {
        throw new Error("REFERENCE_IMAGE_INVALID");
      }
      const label = TargetLabel.parse(await json(entry.label));
      if (label.caseId !== entry.id || label.imageSha256 !== entry.image.sha256) throw new Error("LABEL_REFERENCE_MISMATCH");
      if (label.eligibility !== frozen.eligibility) throw new Error("COHORT_ELIGIBILITY_CHANGED");
      if (Date.parse(label.reviewedAt) > Date.parse(cohort.frozenAt)) throw new Error("LABEL_NOT_FROZEN_BEFORE_RUN");
      const eligible = label.eligibility === "SUPPORTED_RETRIEVABLE";
      const targets = new Set(label.expectedProductHashes ?? (label.expectedProductHash === undefined ? [] : [label.expectedProductHash]));
      if (eligible && targets.size === 0) throw new Error("TARGET_IDENTITY_MISSING");
      if (!eligible && label.reason === undefined) throw new Error("EXCLUSION_REASON_MISSING");
      if (entry.runs.length !== 2 || new Set(entry.runs.map((run) => run.brandMode)).size !== 2) throw new Error("BRAND_PAIR_MISSING");
      const caseRows: ScoreRow[] = [];
      for (const run of entry.runs) for (const release of ["baseline", "candidate"] as const) {
        const record = run[release];
        if (captureHashes.has(record.capture.sha256)) throw new Error("CAPTURE_REUSED");
        captureHashes.add(record.capture.sha256);
        const capture = Capture.parse(await json(record.capture));
        const review = Review.parse(await json(record.review));
        if (Date.parse(capture.startedAt) <= Date.parse(cohort.frozenAt)) throw new Error("COHORT_NOT_FROZEN_BEFORE_RUN");
        if (capture.cohortSha256 !== parsed.data.cohort.sha256) throw new Error("RUN_COHORT_MISMATCH");
        if (Date.parse(review.reviewedAt) < Date.parse(capture.startedAt)) throw new Error("REVIEW_PREDATES_RUN");
        if (runIds.has(capture.runId)) throw new Error("RUN_ID_REUSED");
        runIds.add(capture.runId);
        if (capture.caseId !== entry.id || capture.imageSha256 !== entry.image.sha256 || capture.brandMode !== run.brandMode ||
          capture.version !== parsed.data[release].version || capture.commit !== parsed.data[release].commit ||
          review.caseId !== entry.id || review.captureSha256 !== record.capture.sha256) throw new Error("RUN_PROVENANCE_MISMATCH");
        if (Object.keys(capture.referenceExtraction.visualInput).length === 0) throw new Error("REFERENCE_EXTRACTION_MISSING");
        if (capture.calls[0]?.toolName !== "search_visual_candidates" || capture.calls.slice(1).some((call) => call.toolName !== "finalize_visual_search")) {
          throw new Error("INVALID_TOOL_TRAJECTORY");
        }
        const firstArguments = capture.calls[0]!.arguments;
        if (stableJson(firstArguments.visualInput) !== stableJson(capture.referenceExtraction.visualInput)) throw new Error("REFERENCE_EXTRACTION_MISMATCH");
        const forbiddenHints = ["sourcePageUrl", "productUrl", "suspectedProductName"];
        if ([firstArguments, capture.referenceExtraction.visualInput].some((input) => forbiddenHints.some((key) => input[key] !== undefined))) {
          throw new Error("ANSWER_GUIDED_CAPTURE_NOT_ACCEPTANCE");
        }
        const requiredBrand = typeof firstArguments.brand === "string" && (firstArguments.brandMode === undefined || firstArguments.brandMode === "REQUIRED");
        if ((capture.brandMode === "WITH_BRAND") !== requiredBrand) throw new Error("BRAND_SEGMENT_MISMATCH");
        const retrieved = new Set<string>();
        const reviewed = new Set<string>();
        const knownIds = new Map<string, string>();
        let sessionId: string | undefined;
        let roundIds: string[] = [];
        let finalHashes: string[] | undefined;
        let primary: string | undefined;
        for (const call of capture.calls) {
          if (finalHashes !== undefined) throw new Error("CALL_AFTER_TERMINAL_RESULT");
          if (call.result.isError === true) throw new Error("FAILED_MCP_CALL");
          const structured = z.record(z.unknown()).parse(call.result.structuredContent);
          if (call.toolName === "finalize_visual_search") {
            const verdicts = z.array(z.object({ candidateId: Id, verdict: CodexVisualVerdictSchema })).min(1).max(6).parse(call.arguments.verdicts);
            if (sessionId === undefined || call.arguments.visualSessionId !== sessionId ||
              verdicts.length !== roundIds.length || new Set(verdicts.map((verdict) => verdict.candidateId)).size !== verdicts.length ||
              verdicts.some((verdict) => !roundIds.includes(verdict.candidateId))) throw new Error("VERDICT_OUTSIDE_CAPTURED_SESSION");
            verdicts.forEach((verdict) => reviewed.add(knownIds.get(verdict.candidateId)!));
          }
          const meta = z.object({ "findcheap/visualEvaluation": EvaluationTrace }).parse(call.result._meta)["findcheap/visualEvaluation"];
          if (meta.traceId !== capture.runId) throw new Error("TRACE_ID_MISMATCH");
          meta.retrievedProductHashes.forEach((hash) => retrieved.add(hash));
          const next = structured.visualReview === undefined ? structured : z.record(z.unknown()).parse(structured.visualReview);
          const descriptors = z.array(z.object({ candidateId: Id })).max(6).parse(next.candidates ?? []);
          roundIds = descriptors.map((descriptor) => descriptor.candidateId);
          if (new Set(roundIds).size !== roundIds.length || roundIds.length !== meta.reviewedCandidates.length ||
            meta.reviewedCandidates.some((item) => !roundIds.includes(item.candidateId))) throw new Error("DISPLAYED_CANDIDATE_METADATA_MISMATCH");
          sessionId = roundIds.length === 0 ? undefined : Id.parse(next.visualSessionId);
          const content = z.array(z.record(z.unknown())).parse(call.result.content ?? []);
          const images = content.filter((block) => block.type === "image");
          if (images.length !== meta.reviewedCandidates.length) throw new Error("CANDIDATE_IMAGES_MISSING");
          for (const item of meta.reviewedCandidates) {
            if (!retrieved.has(item.productHash)) throw new Error("REVIEW_OUTSIDE_RETRIEVED_POOL");
            const existing = knownIds.get(item.candidateId);
            if (existing !== undefined && existing !== item.productHash) throw new Error("CANDIDATE_IDENTITY_CHANGED");
            knownIds.set(item.candidateId, item.productHash);
          }
          for (const [index, item] of meta.reviewedCandidates.entries()) {
            const data = z.string().min(1).max(400_000).parse(images[index]?.data);
            if (sha256(Buffer.from(data, "base64")) !== item.imageSha256) throw new Error("CANDIDATE_IMAGE_HASH_MISMATCH");
          }
          if (meta.finalProductHashes !== undefined) {
            const workflow = structured.workflow === undefined ? undefined : z.record(z.unknown()).parse(structured.workflow);
            const initialFailure = meta.finalProductHashes.length === 0 &&
              (structured.status === "NO_IMAGE_CANDIDATES" || InitialTerminalFailure.safeParse(structured.visualSearchFailure).success);
            if (roundIds.length > 0 || structured.visualReview !== undefined || workflow?.finalAnswerAllowed === false ||
              (call.toolName === "search_visual_candidates" && !initialFailure)) throw new Error("NONTERMINAL_RESULT_HAS_FINAL_METADATA");
            if (meta.finalProductHashes.some((hash) => !reviewed.has(hash))) throw new Error("FINAL_OUTSIDE_REVIEWED_POOL");
            const cards = z.array(CardReference).max(3).parse(structured.products ?? []);
            const cardHashes = cards.map((card) => sha256(Buffer.from(productReferenceKey(card))));
            if (stableJson(cardHashes) !== stableJson(meta.finalProductHashes)) throw new Error("FINAL_CARD_IDENTITY_MISMATCH");
            const recommendation = structured.recommendation === undefined ? undefined : z.object({ primarySelectionId: Id.optional() }).parse(structured.recommendation);
            const selected = cards.find((card) => card.selectionId === recommendation?.primarySelectionId);
            const selectedHash = selected === undefined ? undefined : sha256(Buffer.from(productReferenceKey(selected)));
            if (selectedHash !== meta.primaryProductHash || (recommendation?.primarySelectionId !== undefined && selected === undefined)) throw new Error("PRIMARY_METADATA_MISMATCH");
            finalHashes = meta.finalProductHashes;
            primary = meta.primaryProductHash;
          }
        }
        if (finalHashes === undefined) throw new Error("TERMINAL_CAPTURE_MISSING");
        if (primary !== undefined && !finalHashes.includes(primary)) throw new Error("PRIMARY_OUTSIDE_FINAL_PRODUCTS");
        const labels = new Map(review.productLabels.map((item) => [item.productHash, item.relevant]));
        if (labels.size !== review.productLabels.length || finalHashes.some((hash) => !labels.has(hash))) throw new Error("FINAL_HUMAN_LABELS_INCOMPLETE");
        caseRows.push({ mode: run.brandMode, release, split: entry.split, eligible,
          targetExpected: eligible || label.eligibility === "UNAVAILABLE",
          retrieved: [...targets].some((hash) => retrieved.has(hash)), reviewed: [...targets].some((hash) => reviewed.has(hash)),
          hit: finalHashes.slice(0, 3).some((hash) => targets.has(hash)), cards: finalHashes.length,
          relevant: finalHashes.filter((hash) => labels.get(hash)).length,
          primaryCorrect: (primary ?? null) === review.expectedPrimaryProductHash, violations: review.violations.length });
      }
      rows.push(...caseRows); completeCases += 1;
      if (entry.split === "HELD_OUT") heldOutCases += 1;
      if (eligible) {
        completeSupportedCases += 1;
        if (entry.split === "HELD_OUT") heldOutSupportedCases += 1;
      }
      if (!eligible) exclusions.push({ caseId: entry.id, eligibility: label.eligibility, reason: label.reason! });
    } catch (error) {
      issues.push({ caseId: entry.id, code: error instanceof z.ZodError ? "ARTIFACT_SCHEMA_INVALID" :
        error instanceof Error && /^[A-Z_]+$/u.test(error.message) ? error.message : "ARTIFACT_UNAVAILABLE_OR_INVALID" });
    }
  }
  const planned = (cohort?.cases ?? []);
  const denominatorsFor = (cases: typeof planned) => ({
    plannedCases: cases.length,
    supportedCases: cases.filter((entry) => entry.eligibility === "SUPPORTED_RETRIEVABLE").length,
    targetCases: cases.filter((entry) => entry.eligibility === "SUPPORTED_RETRIEVABLE" || entry.eligibility === "UNAVAILABLE").length
  });
  const denominators = denominatorsFor(planned);
  const heldOutDenominators = denominatorsFor(planned.filter((entry) => entry.split === "HELD_OUT"));
  const segments = Object.fromEntries(Modes.map((mode) => [mode, {
    baseline: score(rows.filter((row) => row.mode === mode && row.release === "baseline"), denominators),
    candidate: score(rows.filter((row) => row.mode === mode && row.release === "candidate"), denominators)
  }])) as Record<typeof Modes[number], { baseline: ReturnType<typeof score>; candidate: ReturnType<typeof score> }>;
  const heldOut = Object.fromEntries(Modes.map((mode) => [mode, {
    baseline: score(rows.filter((row) => row.mode === mode && row.release === "baseline" && row.split === "HELD_OUT"), heldOutDenominators),
    candidate: score(rows.filter((row) => row.mode === mode && row.release === "candidate" && row.split === "HELD_OUT"), heldOutDenominators)
  }])) as typeof segments;
  if (completeSupportedCases < 40) issues.push({ code: "AT_LEAST_40_COMPLETE_SUPPORTED_REAL_IMAGES_REQUIRED" });
  if (heldOutSupportedCases < 10) issues.push({ code: "AT_LEAST_10_SUPPORTED_HELD_OUT_IMAGES_REQUIRED" });
  const incomplete = issues.length > 0;
  const gates = [...Object.values(segments), ...Object.values(heldOut)].every(({ baseline, candidate }) =>
    candidate.eligibleRuns > 0 && candidate.candidateRecall >= 0.95 && candidate.top3HitRate >= 0.9 && candidate.precision >= 0.95 &&
    candidate.violations === 0 && candidate.primaryCorrectRate === 1 &&
    candidate.candidateRecall >= baseline.candidateRecall && candidate.reviewRecall >= baseline.reviewRecall &&
    candidate.top3HitRate >= baseline.top3HitRate && candidate.precision >= baseline.precision
  );
  return { decision: incomplete ? "INCOMPLETE" as const : gates ? "PASS_RECORDED_EVIDENCE" as const : "FAIL" as const,
    evidenceBasis: "HASH_VERIFIED_CAPTURE_WITH_HUMAN_ATTESTATION" as const,
    cohortSha256: parsed.success ? parsed.data.cohort.sha256 : undefined,
    denominators, heldOutDenominators,
    completeCases, heldOutCases, completeSupportedCases, heldOutSupportedCases, segments, heldOut, exclusions, issues };
}

function score(rows: ScoreRow[], planned: { plannedCases: number; supportedCases: number; targetCases: number }) {
  const eligible = rows.filter((row) => row.eligible);
  const fraction = (value: number, count: number): number => count === 0 ? 0 : value / count;
  const cards = rows.reduce((sum, row) => sum + row.cards, 0);
  return { runs: rows.length, eligibleRuns: eligible.length,
    candidateRecall: fraction(eligible.filter((row) => row.retrieved).length, planned.supportedCases),
    reviewRecall: fraction(eligible.filter((row) => row.reviewed).length, planned.supportedCases),
    top3HitRate: fraction(eligible.filter((row) => row.hit).length, planned.supportedCases),
    allSampleTop3Coverage: fraction(rows.filter((row) => row.targetExpected && row.hit).length, planned.targetCases),
    runCompletion: fraction(rows.length, planned.plannedCases),
    precision: fraction(rows.reduce((sum, row) => sum + row.relevant, 0), cards),
    primaryCorrectRate: fraction(rows.filter((row) => row.primaryCorrect).length, rows.length),
    violations: rows.reduce((sum, row) => sum + row.violations, 0), cards };
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (typeof value === "object" && value !== null) return `{${Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  return JSON.stringify(value) ?? "undefined";
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const path = resolve(process.argv[2] ?? "");
    const base = await realpath(dirname(path));
    const load: ArtifactLoader = async (name) => {
      const target = await realpath(resolve(base, name));
      const within = relative(base, target);
      if (isAbsolute(within) || within.startsWith("..")) throw new Error("ARTIFACT_PATH_INVALID");
      if ((await stat(target)).size > 20 * 1024 * 1024) throw new Error("ARTIFACT_SIZE_LIMIT");
      return readFile(target);
    };
    if ((await stat(path)).size > 4 * 1024 * 1024) throw new Error("MANIFEST_SIZE_LIMIT");
    const result = await evaluateVisualSearch(JSON.parse(await readFile(path, "utf8")), load);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exitCode = result.decision === "PASS_RECORDED_EVIDENCE" ? 0 : result.decision === "FAIL" ? 1 : 2;
  } catch { process.stderr.write("VISUAL_EVALUATION_INPUT_UNAVAILABLE\n"); process.exitCode = 2; }
}
