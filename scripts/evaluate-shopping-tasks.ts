import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { productReferenceKey } from "../apps/mcp-server/src/product-reference.js";
import { evaluateVisualSearch } from "./evaluate-visual-search.js";

const Hash = z.string().regex(/^[a-f0-9]{64}$/u);
const Id = z.string().regex(/^[A-Za-z0-9_.:-]{1,160}$/u);
const Time = z.string().datetime({ offset: true });
const Artifact = z.object({ path: z.string().min(1).max(500), sha256: Hash }).strict();
const Release = z.object({ version: Id, commit: z.string().regex(/^[a-f0-9]{40}$/u), bundleSha256: Hash }).strict();
const Pair = z.object({ capture: Artifact, review: Artifact }).strict();
const Split = z.enum(["DEVELOPMENT", "HELD_OUT"]);
const Modality = z.enum(["TEXT", "IMAGE"]);
const Eligibility = z.enum(["VERIFIED_RECOMMENDABLE", "UNAVAILABLE", "OUT_OF_SCOPE", "EXPECTED_NO_MATCH"]);
const Human = { reviewerId: Id, reviewedAt: Time };
const Label = z.object({ kind: z.literal("HUMAN_SHOPPING_TARGET"), caseId: Id, inputSha256: Hash, ...Human,
  eligibility: Eligibility, targetProductHashes: z.array(Hash).max(20), exclusionReason: z.string().min(1).max(300).optional() }).strict();
const Cohort = z.object({ kind: z.literal("FROZEN_SHOPPING_COHORT"), frozenAt: Time, ...Human,
  cases: z.array(z.object({ id: Id, inputSha256: Hash, labelSha256: Hash, familyId: Id, category: Id,
    split: Split, modality: Modality, priorExposure: z.enum(["UNSEEN", "DEVELOPMENT"]), eligibility: Eligibility }).strict()).max(1_000) }).strict();
export const ShoppingEvaluationManifestSchema = z.object({ schemaVersion: z.literal(1), baseline: Release, candidate: Release,
  cohort: Artifact, visualManifest: Artifact.optional(),
  cases: z.array(z.object({ id: Id, input: Artifact, label: Artifact, baseline: Pair, candidate: Pair }).strict()).max(1_000),
  hostRuns: z.array(Pair).max(100) }).strict();
const Card = z.object({ merchantId: z.string(), sourceHost: z.string(), handle: z.string(), selectionId: Id,
  sourceKind: z.enum(["AWIN_PRODUCT_FEED", "SHOPIFY_GLOBAL_CATALOG", "EBAY_BROWSE", "WEB_PRODUCT_PAGE"]).optional() }).passthrough();
const Capture = z.object({ kind: z.literal("LIVE_CODEX_SHOPPING_CAPTURE"), origin: z.literal("LIVE"), ...Release.shape,
  caseId: Id, inputSha256: Hash, cohortSha256: Hash, runId: Id, threadId: Id, startedAt: Time,
  retrieval: z.object({ origin: z.literal("SERVER_TRACE"), productHashes: z.array(Hash).max(2_000),
    order: z.literal("SOURCE_OBSERVATION_ORDER").optional(), truncated: z.boolean().optional(),
    revalidatedProductHashes: z.array(Hash).max(200).optional() }).strict(),
  finalResult: z.object({ products: z.array(Card).max(24), recommendation: z.object({ primarySelectionId: Id.optional() }).passthrough().optional() }).passthrough()
}).strict();
const Review = z.object({ kind: z.literal("HUMAN_SHOPPING_REVIEW"), caseId: Id, captureSha256: Hash, ...Human,
  captureOriginReviewed: z.literal(true), retrievalOrderReviewed: z.literal(true), answerIsolationReviewed: z.literal(true),
  products: z.array(z.object({ productHash: Hash, relevant: z.boolean(), requirementsSatisfied: z.boolean(),
    merchantVerified: z.boolean(), requiredQualityEvidence: z.boolean() }).strict()).max(24),
  violations: z.array(Id).max(32) }).strict();
const HostScenarios = ["ACCEPTED", "DENIED", "CANCELLED", "UNSUPPORTED", "TIMEOUT", "EXPIRED", "DUPLICATE"] as const;
const HostCapture = z.object({ kind: z.literal("LIVE_CODEX_HOST_RECOVERY_CAPTURE"), origin: z.literal("LIVE"), ...Release.shape,
  runId: Id, threadId: Id, startedAt: Time, scenario: z.enum(HostScenarios), permissionStatus: Id,
  browserActions: z.number().int().nonnegative(), completedWebSearch: z.boolean(), nativeCardsReturned: z.number().int().nonnegative() }).strict();
const HostReview = z.object({ kind: z.literal("HUMAN_HOST_RECOVERY_REVIEW"), captureSha256: Hash, ...Human,
  hostOriginReviewed: z.literal(true), scenarioOutcomeCorrect: z.boolean() }).strict();
type Loader = (path: string) => Promise<Uint8Array>;
type Row = { id: string; split: "DEVELOPMENT" | "HELD_OUT"; modality: "TEXT" | "IMAGE"; category: string;
  release: "baseline" | "candidate"; eligible: boolean; targets: number; recalled: number; cards: number;
  correct: number; recommended: boolean; success: boolean; violations: number };
const digest = (value: Uint8Array | string) => createHash("sha256").update(value).digest("hex");
const fraction = (count: number, total: number): number | null => total === 0 ? null : count / total;

/** Offline scorer only. Hashes provide integrity; human attestations, not a
 * cryptographic host signature, establish real-run origin and product truth. */
export async function evaluateShoppingTasks(raw: unknown, load: Loader) {
  const issues: Array<{ caseId?: string; code: string }> = [];
  const rows: Row[] = [];
  const ids = new Set<string>();
  const inputs = new Set<string>();
  const runIds = new Set<string>();
  const captures = new Set<string>();
  const hostScenarios = new Set<string>();
  const acceptedThreads = new Set<string>();
  const targetCounts = new Map<string, number>();
  let hostViolations = 0;
  let cohort: z.infer<typeof Cohort> | undefined;
  let visualDecision: string | undefined;
  const read = async (artifact: z.infer<typeof Artifact>, maxBytes = 4 * 1024 * 1024) => {
    if (isAbsolute(artifact.path) || artifact.path.split(/[\\/]/u).includes("..")) throw new Error("ARTIFACT_PATH_INVALID");
    const bytes = await load(artifact.path);
    if (bytes.byteLength > maxBytes) throw new Error("ARTIFACT_SIZE_LIMIT");
    if (digest(bytes) !== artifact.sha256) throw new Error("ARTIFACT_HASH_MISMATCH");
    return bytes;
  };
  const json = async (artifact: z.infer<typeof Artifact>): Promise<unknown> => JSON.parse(Buffer.from(await read(artifact)).toString("utf8"));
  const issue = (error: unknown, caseId?: string) => issues.push({ ...(caseId === undefined ? {} : { caseId }),
    code: error instanceof z.ZodError ? "ARTIFACT_SCHEMA_INVALID" : error instanceof Error && /^[A-Z_]+$/u.test(error.message)
      ? error.message : "ARTIFACT_UNAVAILABLE_OR_INVALID" });
  const manifest = ShoppingEvaluationManifestSchema.safeParse(raw);
  if (!manifest.success) issues.push({ code: "INVALID_MANIFEST" });
  if (manifest.success) {
    try {
      cohort = Cohort.parse(await json(manifest.data.cohort));
      if (new Set(cohort.cases.map(entry => entry.id)).size !== cohort.cases.length ||
        cohort.cases.length !== manifest.data.cases.length || manifest.data.cases.some(entry => !cohort!.cases.some(item => item.id === entry.id))) throw new Error("COHORT_CASE_SET_MISMATCH");
      const families = new Map<string, string>();
      for (const entry of cohort.cases) {
        if (families.has(entry.familyId) && families.get(entry.familyId) !== entry.split) issues.push({ caseId: entry.id, code: "FAMILY_SPLIT_LEAKAGE" });
        else if (entry.split === "HELD_OUT" && families.has(entry.familyId)) issues.push({ caseId: entry.id, code: "DUPLICATE_HELD_OUT_FAMILY" });
        families.set(entry.familyId, entry.split);
        if (entry.split === "HELD_OUT" && entry.priorExposure !== "UNSEEN") issues.push({ caseId: entry.id, code: "DEVELOPMENT_IN_HELD_OUT" });
      }
    } catch (error) { issue(error); }
    for (const entry of manifest.data.cases) {
      try {
        const frozen = cohort?.cases.find(item => item.id === entry.id);
        if (frozen === undefined || frozen.inputSha256 !== entry.input.sha256 || frozen.labelSha256 !== entry.label.sha256) throw new Error("COHORT_CASE_CHANGED");
        if (ids.has(entry.id) || inputs.has(entry.input.sha256)) throw new Error("DUPLICATE_CASE_OR_INPUT");
        ids.add(entry.id); inputs.add(entry.input.sha256);
        await read(entry.input, 20 * 1024 * 1024);
        const label = Label.parse(await json(entry.label));
        if (label.caseId !== entry.id || label.inputSha256 !== entry.input.sha256 || label.eligibility !== frozen.eligibility) throw new Error("LABEL_REFERENCE_MISMATCH");
        if (Date.parse(label.reviewedAt) > Date.parse(cohort!.frozenAt)) throw new Error("LABEL_NOT_FROZEN_BEFORE_RUN");
        const eligible = label.eligibility === "VERIFIED_RECOMMENDABLE";
        const targets = new Set(label.targetProductHashes);
        if (targets.size !== label.targetProductHashes.length || eligible && targets.size === 0) throw new Error("TARGET_LABEL_INVALID");
        if (!eligible && label.exclusionReason === undefined) throw new Error("EXCLUSION_REASON_MISSING");
        targetCounts.set(entry.id, eligible ? targets.size : 0);
        const caseRows: Row[] = [];
        for (const release of ["baseline", "candidate"] as const) {
          const pair = entry[release];
          if (captures.has(pair.capture.sha256)) throw new Error("CAPTURE_REUSED");
          captures.add(pair.capture.sha256);
          const capture = Capture.parse(await json(pair.capture));
          const review = Review.parse(await json(pair.review));
          if (runIds.has(capture.runId)) throw new Error("RUN_REUSED");
          runIds.add(capture.runId);
          if (capture.caseId !== entry.id || capture.inputSha256 !== entry.input.sha256 || capture.cohortSha256 !== manifest.data.cohort.sha256 ||
            capture.commit !== manifest.data[release].commit || capture.version !== manifest.data[release].version || capture.bundleSha256 !== manifest.data[release].bundleSha256 || review.caseId !== entry.id ||
            review.captureSha256 !== pair.capture.sha256) throw new Error("RUN_PROVENANCE_MISMATCH");
          if (Date.parse(capture.startedAt) <= Date.parse(cohort!.frozenAt) || Date.parse(review.reviewedAt) < Date.parse(capture.startedAt)) throw new Error("RUN_REVIEW_ORDER_INVALID");
          const final = capture.finalResult.products.map(card => ({ hash: digest(productReferenceKey(card)), selectionId: card.selectionId }));
          if (new Set(final.map(item => item.hash)).size !== final.length || new Set(final.map(item => item.selectionId)).size !== final.length) throw new Error("DUPLICATE_FINAL_PRODUCT");
          const retrieved = [...new Set(capture.retrieval.productHashes)];
          const finalPool = new Set([...retrieved, ...(capture.retrieval.revalidatedProductHashes ?? [])]);
          if (final.some(item => !finalPool.has(item.hash))) throw new Error("FINAL_OUTSIDE_RETRIEVED_POOL");
          const labels = new Map(review.products.map(item => [item.productHash, item]));
          if (labels.size !== review.products.length || final.some(item => !labels.has(item.hash))) throw new Error("FINAL_LABELS_INCOMPLETE");
          const acceptable = (hash: string) => { const item = labels.get(hash)!;
            return item.relevant && item.requirementsSatisfied && item.merchantVerified && item.requiredQualityEvidence; };
          const primaryId = capture.finalResult.recommendation?.primarySelectionId;
          const primary = final.find(item => item.selectionId === primaryId);
          if (primaryId !== undefined && primary === undefined) throw new Error("PRIMARY_OUTSIDE_FINAL_PRODUCTS");
          caseRows.push({ id: entry.id, split: frozen.split, modality: frozen.modality, category: frozen.category, release, eligible,
            targets: eligible ? targets.size : 0, recalled: eligible ? retrieved.slice(0, 20).filter(hash => targets.has(hash)).length : 0,
            cards: Math.min(final.length, 3), correct: final.slice(0, 3).filter(item => acceptable(item.hash)).length,
            recommended: primary !== undefined, success: eligible && primary !== undefined && acceptable(primary.hash),
            violations: review.violations.length + (primary !== undefined && !acceptable(primary.hash) ? 1 : 0) });
        }
        rows.push(...caseRows);
      } catch (error) { issue(error, entry.id); }
    }
    for (const pair of manifest.data.hostRuns) {
      try {
        if (captures.has(pair.capture.sha256)) throw new Error("HOST_CAPTURE_REUSED");
        captures.add(pair.capture.sha256);
        const capture = HostCapture.parse(await json(pair.capture));
        const review = HostReview.parse(await json(pair.review));
        if (runIds.has(capture.runId)) throw new Error("HOST_RUN_REUSED");
        runIds.add(capture.runId);
        if (capture.commit !== manifest.data.candidate.commit || capture.version !== manifest.data.candidate.version || capture.bundleSha256 !== manifest.data.candidate.bundleSha256 ||
          review.captureSha256 !== pair.capture.sha256 || Date.parse(review.reviewedAt) < Date.parse(capture.startedAt)) throw new Error("HOST_PROVENANCE_MISMATCH");
        if (capture.scenario === "ACCEPTED") {
          if (review.scenarioOutcomeCorrect && capture.permissionStatus === "READY" && capture.browserActions > 0 && capture.completedWebSearch && capture.nativeCardsReturned > 0) acceptedThreads.add(capture.threadId);
          else hostViolations += 1;
        } else if (!review.scenarioOutcomeCorrect || capture.browserActions !== 0 || capture.completedWebSearch) hostViolations += 1;
        hostScenarios.add(capture.scenario);
      } catch (error) { issue(error); }
    }
    if (cohort?.cases.some(entry => entry.modality === "IMAGE")) {
      try {
        if (manifest.data.visualManifest === undefined) throw new Error("VISUAL_EVIDENCE_REQUIRED");
        const visual = await json(manifest.data.visualManifest);
        const linked = z.object({ candidate: Release.pick({ commit: true, version: true }), cases: z.array(z.object({ image: Artifact, split: Split })) }).parse(visual);
        if (linked.candidate.commit !== manifest.data.candidate.commit || linked.candidate.version !== manifest.data.candidate.version ||
          cohort.cases.filter(entry => entry.modality === "IMAGE").some(entry => !linked.cases.some(item => item.image.sha256 === entry.inputSha256 && item.split === entry.split))) throw new Error("VISUAL_COHORT_MISMATCH");
        visualDecision = (await evaluateVisualSearch(visual, load)).decision;
        if (visualDecision !== "PASS_RECORDED_EVIDENCE") issues.push({ code: "VISUAL_ACCEPTANCE_NOT_MET" });
      } catch (error) { issue(error); }
    }
  }
  const planned = cohort?.cases ?? [];
  const score = (subset: typeof planned, selected: Row[]) => {
    const eligibleCount = subset.filter(item => item.eligibility === "VERIFIED_RECOMMENDABLE").length;
    const targets = subset.reduce((sum, entry) => sum + (targetCounts.get(entry.id) ?? 0), 0);
    const cards = selected.reduce((sum, row) => sum + row.cards, 0);
    return { plannedTasks: subset.length, completedTasks: selected.length, eligibleTasks: eligibleCount,
      recallAt20: subset.every(entry => targetCounts.has(entry.id)) ? fraction(selected.reduce((sum, row) => sum + row.recalled, 0), targets) : null,
      precisionAt3: fraction(selected.reduce((sum, row) => sum + row.correct, 0), cards),
      recommendationCoverage: fraction(selected.filter(row => row.recommended).length, subset.length),
      taskSuccessRate: fraction(selected.filter(row => row.success).length, eligibleCount),
      completionCoverage: fraction(selected.length, subset.length), cards,
      violations: selected.reduce((sum, row) => sum + row.violations, 0) };
  };
  const segment = (subset: typeof planned) => Object.fromEntries((["baseline", "candidate"] as const).map(release =>
    [release, score(subset, rows.filter(row => row.release === release && subset.some(item => item.id === row.id)))])) as Record<"baseline" | "candidate", ReturnType<typeof score>>;
  const heldOutCases = planned.filter(item => item.split === "HELD_OUT");
  const development = segment(planned.filter(item => item.split === "DEVELOPMENT"));
  const heldOut = segment(heldOutCases);
  const modalities = Object.fromEntries((["TEXT", "IMAGE"] as const).map(mode => [mode, segment(heldOutCases.filter(item => item.modality === mode))]));
  const categories = Object.fromEntries([...new Set(heldOutCases.map(item => item.category))].map(category => [category, segment(heldOutCases.filter(item => item.category === category))]));
  const completedHeldOut = rows.filter(row => row.release === "candidate" && row.split === "HELD_OUT");
  if (new Set(completedHeldOut.map(row => planned.find(item => item.id === row.id)!.familyId)).size < 40) issues.push({ code: "AT_LEAST_40_INDEPENDENT_COMPLETE_HELD_OUT_TASKS_REQUIRED" });
  if (completedHeldOut.filter(row => row.modality === "TEXT").length < 20 || completedHeldOut.filter(row => row.modality === "IMAGE").length < 20) issues.push({ code: "AT_LEAST_20_TEXT_AND_20_IMAGE_TASKS_REQUIRED" });
  if (Object.keys(categories).length < 4) issues.push({ code: "AT_LEAST_FOUR_CATEGORIES_REQUIRED" });
  if (acceptedThreads.size < 3) issues.push({ code: "THREE_INDEPENDENT_LIVE_HOST_ACCEPTANCES_REQUIRED" });
  if (HostScenarios.some(scenario => !hostScenarios.has(scenario))) issues.push({ code: "HOST_SCENARIOS_INCOMPLETE" });
  const requiredSegments = [heldOut, ...Object.values(modalities), ...Object.values(categories)];
  const gates = requiredSegments.every(({ baseline, candidate }) => candidate.recallAt20 !== null && candidate.recallAt20 >= 0.9 &&
    candidate.precisionAt3 !== null && candidate.precisionAt3 >= 0.95 && candidate.taskSuccessRate !== null && candidate.taskSuccessRate >= 0.85 &&
    candidate.completionCoverage === 1 && candidate.recallAt20 >= (baseline.recallAt20 ?? 0) &&
    candidate.precisionAt3 >= (baseline.precisionAt3 ?? 0) && candidate.taskSuccessRate >= (baseline.taskSuccessRate ?? 0));
  const safetyFailure = hostViolations > 0 || rows.some(row => row.release === "candidate" && row.violations > 0);
  return { decision: safetyFailure ? "FAIL" : issues.length > 0 ? "INCOMPLETE" : gates ? "PASS_RECORDED_EVIDENCE" : "FAIL",
    evidenceBasis: "HASH_VERIFIED_CAPTURE_WITH_HUMAN_ATTESTATION",
    recallBasis: "FIRST_20_UNIQUE_SOURCE_OBSERVATIONS_NOT_GLOBAL_RANK", development, heldOut, modalities, categories,
    host: { independentAcceptedThreads: acceptedThreads.size, scenarios: [...hostScenarios], violations: hostViolations }, visualDecision, issues };
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const path = resolve(process.argv[2] ?? "");
    const base = await realpath(dirname(path));
    const load: Loader = async name => {
      const target = await realpath(resolve(base, name));
      const within = relative(base, target);
      if (isAbsolute(within) || within.startsWith("..")) throw new Error("ARTIFACT_PATH_INVALID");
      if ((await stat(target)).size > 20 * 1024 * 1024) throw new Error("ARTIFACT_SIZE_LIMIT");
      return readFile(target);
    };
    if ((await stat(path)).size > 4 * 1024 * 1024) throw new Error("MANIFEST_SIZE_LIMIT");
    const report = await evaluateShoppingTasks(JSON.parse(await readFile(path, "utf8")), load);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exitCode = report.decision === "PASS_RECORDED_EVIDENCE" ? 0 : report.decision === "FAIL" ? 1 : 2;
  } catch { process.stderr.write("SHOPPING_EVALUATION_INPUT_UNAVAILABLE\n"); process.exitCode = 2; }
}
