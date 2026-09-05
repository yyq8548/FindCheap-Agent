import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { evaluateVisualSearch } from "./evaluate-visual-search.js";
import { productReferenceKey } from "../apps/mcp-server/src/product-reference.js";

// All artifacts here are synthetic unit fixtures. They test the evaluator's
// contract; they are never submitted as the real-image acceptance dataset.
function fixture(count = 40) {
  const artifacts = new Map<string, Uint8Array>();
  const artifact = (path: string, data: unknown) => {
    const bytes = Buffer.isBuffer(data) ? data : Buffer.from(JSON.stringify(data));
    artifacts.set(path, bytes);
    return { path, sha256: createHash("sha256").update(bytes).digest("hex") };
  };
  const baseline = { version: "0.17.12", commit: "a".repeat(40) };
  const candidate = { version: "candidate", commit: "b".repeat(40) };
  const cases = Array.from({ length: count }, (_, index) => {
    const id = `case-${index}`;
    const image = artifact(`${id}.png`, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.from(id)]));
    const product = { merchantId: "example", sourceHost: "example.com", handle: `product-${index}`, selectionId: "selection-1" };
    const productHash = createHash("sha256").update(productReferenceKey(product)).digest("hex");
    const label = artifact(`${id}-label.json`, { kind: "HUMAN_TARGET_LABEL", caseId: id, imageSha256: image.sha256,
      reviewerId: "fixture-human", reviewedAt: "2026-09-04T12:00:00Z", eligibility: "SUPPORTED_RETRIEVABLE", expectedProductHash: productHash });
    const runs = (["WITH_BRAND", "WITHOUT_BRAND"] as const).map((brandMode) => {
      const record = (release: typeof baseline, name: string) => {
        const session = `${id}-${name}-${brandMode}`;
        const capture = artifact(`${session}.json`, { kind: "LIVE_CODEX_MCP_CAPTURE", origin: "LIVE", ...release,
          caseId: id, threadId: session, runId: session, imageSha256: image.sha256, brandMode, startedAt: "2026-09-04T12:30:00Z",
          referenceExtraction: { modelId: "fixture-model", messageId: "reference", visualInput: { productType: "dress" } },
          calls: [{ toolName: "search_visual_candidates", arguments: { visualInput: { productType: "dress" },
            ...(brandMode === "WITH_BRAND" ? { brand: "Example", brandMode: "REQUIRED" } : {}) },
            result: { structuredContent: { visualSessionId: session, candidates: [{ candidateId: "candidate-1" }], workflow: { finalAnswerAllowed: false } },
              content: [{ type: "image", data: Buffer.from(artifacts.get(image.path)!).toString("base64") }], _meta: { "findcheap/visualEvaluation": {
              version: 1, traceId: session, retrievedProductHashes: [productHash], reviewedCandidates: [{ candidateId: "candidate-1", productHash, imageSha256: image.sha256 }]
            } } } }, { toolName: "finalize_visual_search", arguments: { visualSessionId: session, verdicts: [{ candidateId: "candidate-1", verdict: {
              classification: "HIGHLY_SIMILAR", matches: [{ attribute: "PRODUCT_TYPE", referenceEvidence: "dress", candidateEvidence: "dress" },
                { attribute: "DISTINCTIVE_DETAIL", referenceEvidence: "lace panels", candidateEvidence: "lace panels" }], conflicts: []
            } }] },
            result: { structuredContent: { products: [product], recommendation: { primarySelectionId: "selection-1" } }, _meta: { "findcheap/visualEvaluation": {
              version: 1, traceId: session, retrievedProductHashes: [productHash], reviewedCandidates: [], finalProductHashes: [productHash], primaryProductHash: productHash
            } } } }]
        });
        const review = artifact(`${session}-review.json`, { kind: "HUMAN_RUN_REVIEW", caseId: id,
          captureSha256: capture.sha256, reviewerId: "fixture-human", reviewedAt: "2026-09-04T13:00:00Z",
          referenceExtractionReviewed: true, captureOriginReviewed: true,
          verdictOriginReviewed: "ACTIVE_MODEL_IMAGE_REVIEW", answerIsolationReviewed: true,
          productLabels: [{ productHash, relevant: true }], expectedPrimaryProductHash: productHash, violations: [] });
        return { capture, review };
      };
      return { brandMode, baseline: record(baseline, "baseline"), candidate: record(candidate, "candidate") };
    });
    return { id, image, imageOrigin: "REAL_USER_IMAGE", split: index < 20 ? "DEVELOPMENT" : "HELD_OUT", label, runs };
  });
  const manifest = { schemaVersion: 2, baseline, candidate, cases, cohort: { path: "cohort.json", sha256: "" } };
  const freezeCohort = () => {
    manifest.cohort = artifact("cohort.json", { kind: "FROZEN_VISUAL_EVALUATION_COHORT",
      frozenAt: "2026-09-04T12:15:00Z", reviewerId: "fixture-human",
      cases: cases.map((entry) => ({ id: entry.id, imageSha256: entry.image.sha256, labelSha256: entry.label.sha256,
        styleFamilyId: `style-${entry.id}`, split: entry.split, priorExposure: entry.split === "HELD_OUT" ? "UNSEEN" : "DEVELOPMENT",
        eligibility: JSON.parse(Buffer.from(artifacts.get(entry.label.path)!).toString()).eligibility })) });
    // Unit fixtures simulate capture recording after the cohort is frozen.
    for (const entry of cases) for (const run of entry.runs) for (const release of ["baseline", "candidate"] as const) {
      const record = run[release];
      const capture = JSON.parse(Buffer.from(artifacts.get(record.capture.path)!).toString());
      capture.cohortSha256 = manifest.cohort.sha256;
      record.capture = artifact(record.capture.path, capture);
      const review = JSON.parse(Buffer.from(artifacts.get(record.review.path)!).toString());
      review.captureSha256 = record.capture.sha256;
      record.review = artifact(record.review.path, review);
    }
  };
  freezeCohort();
  const editCohort = (mutate: (value: Record<string, unknown>) => void) => {
    const value = JSON.parse(Buffer.from(artifacts.get(manifest.cohort.path)!).toString()) as Record<string, unknown>;
    mutate(value); manifest.cohort = artifact(manifest.cohort.path, value);
  };
  const load = async (path: string) => {
    const bytes = artifacts.get(path);
    if (bytes === undefined) throw new Error("missing artifact");
    return bytes;
  };
  const editCapture = (mutate: (value: Record<string, unknown>) => void) => {
    const record = manifest.cases[0]!.runs[0]!.candidate;
    const value = JSON.parse(Buffer.from(artifacts.get(record.capture.path)!).toString()) as Record<string, unknown>;
    mutate(value);
    record.capture = artifact(record.capture.path, value);
    const review = JSON.parse(Buffer.from(artifacts.get(record.review.path)!).toString()) as Record<string, unknown>;
    review.captureSha256 = record.capture.sha256;
    record.review = artifact(record.review.path, review);
  };
  const editReview = (mutate: (value: Record<string, unknown>) => void) => {
    const record = manifest.cases[0]!.runs[0]!.candidate;
    const value = JSON.parse(Buffer.from(artifacts.get(record.review.path)!).toString()) as Record<string, unknown>;
    mutate(value);
    record.review = artifact(record.review.path, value);
  };
  const editLabel = (index: number, mutate: (value: Record<string, unknown>) => void) => {
    const entry = manifest.cases[index]!;
    const value = JSON.parse(Buffer.from(artifacts.get(entry.label.path)!).toString()) as Record<string, unknown>;
    mutate(value);
    entry.label = artifact(entry.label.path, value);
  };
  return { manifest, load, artifacts, editCapture, editReview, editLabel, editCohort, freezeCohort };
}

type RecoveryCall = { toolName: string; startedAt?: string; finishedAt?: string; arguments: Record<string, unknown>;
  result: { content?: Array<Record<string, unknown>>; structuredContent: Record<string, unknown>; _meta?: Record<string, unknown> } };

/** Synthetic protocol fixture, not evidence that a real host granted permission. */
function webRecoveryFixture(afterFirstReview = false) {
  const f = fixture();
  const pair = f.manifest.cases[0]!.runs[0]!.candidate;
  const old = JSON.parse(Buffer.from(f.artifacts.get(pair.capture.path)!).toString()) as { calls: RecoveryCall[] };
  const oldCard = (old.calls[1]!.result.structuredContent.products as Array<Record<string, string>>)[0]!;
  const webCard = { ...oldCard, sourceKind: "WEB_PRODUCT_PAGE" as const };
  const webHash = createHash("sha256").update(productReferenceKey(webCard as { sourceKind: "WEB_PRODUCT_PAGE"; merchantId: string; sourceHost: string; handle: string })).digest("hex");
  f.editLabel(0, label => { label.expectedProductHashes = [label.expectedProductHash, webHash]; });
  f.freezeCohort();
  f.editCapture(capture => {
    const calls = capture.calls as RecoveryCall[];
    const first = calls[0]!;
    const terminal = structuredClone(calls[1]!);
    const firstMeta = first.result._meta!["findcheap/visualEvaluation"] as { reviewedCandidates: Array<Record<string, unknown>> };
    const parent = "00000000-0000-4000-8000-000000000010";
    const token = "00000000-0000-4000-8000-000000000011";
    const visualSession = "web-visual-session";
    const terminalFailure = { content: [], structuredContent: { status: "OK", products: [], renderId: parent,
      visualSearchFailure: { code: "NO_CATALOG_CANDIDATES" }, recovery: { action: "REQUEST_WEB_SEARCH" } },
      _meta: { "findcheap/visualEvaluation": { version: 1, traceId: capture.runId,
        retrievedProductHashes: [], reviewedCandidates: [], finalProductHashes: [] } } };
    const begin: RecoveryCall = { toolName: "begin_web_search", startedAt: "2026-09-04T12:31:00Z", finishedAt: "2026-09-04T12:31:01Z",
      arguments: { renderId: parent }, result: { structuredContent: { status: "READY", retryable: false, attempt: 1,
        diagnostics: { formSupported: true, hostAction: "ACCEPT_TRUE" }, webSessionId: token, expiresAt: "2026-09-04T12:32:01Z",
        queries: ["Example dress"], limits: { durationMs: 60000, merchantPages: 5, results: 3, discoveryQueries: 2 } } } };
    const complete: RecoveryCall = { toolName: "complete_web_search", startedAt: "2026-09-04T12:31:02Z", finishedAt: "2026-09-04T12:31:03Z",
      arguments: { renderId: parent, webSessionId: token, urls: ["https://example.com/products/dress"] },
      result: { content: structuredClone(first.result.content!), structuredContent: { products: [], visualReview: {
        stage: "RELAXED_REVIEW", terminal: false, finalAnswerAllowed: false, requiredNextTool: "finalize_visual_search",
        visualSessionId: visualSession, expiresAt: "2026-09-04T12:33:00Z", candidates: [{ candidateId: "web-candidate" }] } },
        _meta: { "findcheap/visualEvaluation": { version: 1, traceId: capture.runId, retrievedProductHashes: [webHash],
          reviewedCandidates: [{ ...firstMeta.reviewedCandidates[0]!, candidateId: "web-candidate", productHash: webHash }] } } } };
    terminal.startedAt = "2026-09-04T12:31:04Z"; terminal.finishedAt = "2026-09-04T12:31:05Z";
    terminal.arguments.visualSessionId = visualSession;
    (terminal.arguments.verdicts as Array<{ candidateId: string }>)[0]!.candidateId = "web-candidate";
    terminal.result.structuredContent.products = [webCard];
    terminal.result._meta = { "findcheap/visualEvaluation": { version: 1, traceId: capture.runId,
      retrievedProductHashes: [webHash], reviewedCandidates: [], finalProductHashes: [webHash], primaryProductHash: webHash } };
    if (afterFirstReview) {
      calls[1]!.result = terminalFailure;
      capture.calls = [first, calls[1]!, begin, complete, terminal];
    } else {
      first.result = terminalFailure;
      capture.calls = [first, begin, complete, terminal];
    }
  });
  f.editReview(review => { review.productLabels = [{ productHash: webHash, relevant: true }]; review.expectedPrimaryProductHash = webHash; });
  return f;
}

describe("recorded visual search evaluation gate", () => {
  it.each([false, true])("accepts authorized, image-reviewed web recovery without a third round (prior review: %s)", async afterFirstReview => {
    const f = webRecoveryFixture(afterFirstReview);
    const report = await evaluateVisualSearch(f.manifest, f.load);
    expect(report.issues).toEqual([]);
    expect(report.decision).toBe("PASS_RECORDED_EVIDENCE");
  });
  it.each(["denied", "no-ready", "forged-host-action", "wrong-lease", "wrong-parent", "expired", "missing-time", "direct-card", "unreviewed", "third-round"])("rejects unsafe visual web trajectory: %s", async kind => {
    const f = webRecoveryFixture();
    f.editCapture(capture => {
      const calls = capture.calls as RecoveryCall[];
      const begin = calls[1]!; const complete = calls[2]!; const final = calls[3]!;
      if (kind === "denied") begin.result.structuredContent.status = "PERMISSION_DENIED";
      if (kind === "no-ready") calls.splice(1, 1);
      if (kind === "forged-host-action") begin.result.structuredContent.diagnostics = { formSupported: true, hostAction: "ACCEPT_FALSE" };
      if (kind === "wrong-lease") complete.arguments.webSessionId = "00000000-0000-4000-8000-000000000012";
      if (kind === "wrong-parent") complete.arguments.renderId = "00000000-0000-4000-8000-000000000013";
      if (kind === "expired") complete.startedAt = "2026-09-04T12:33:00Z";
      if (kind === "missing-time") delete complete.startedAt;
      if (kind === "direct-card") complete.result = structuredClone(final.result);
      if (kind === "unreviewed") final.arguments.verdicts = [];
      if (kind === "third-round") { final.result = structuredClone(complete.result); calls.push(structuredClone(final)); }
    });
    expect((await evaluateVisualSearch(f.manifest, f.load)).decision).toBe("INCOMPLETE");
  });
  it("scores a correctly stopped denied recovery as a miss, not missing evidence", async () => {
    const f = webRecoveryFixture();
    f.editCapture(capture => {
      const calls = capture.calls as RecoveryCall[];
      calls[1]!.result.structuredContent = { status: "PERMISSION_DENIED", retryable: false, attempt: 1,
        diagnostics: { formSupported: true, hostAction: "DECLINE" } };
      capture.calls = calls.slice(0, 2);
    });
    f.editReview(review => { review.productLabels = []; review.expectedPrimaryProductHash = null; });
    const report = await evaluateVisualSearch(f.manifest, f.load);
    expect(report.issues).toEqual([]);
    expect(report.completeCases).toBe(40);
    expect(report.segments.WITH_BRAND.candidate.top3HitRate).toBe(39 / 40);
    expect(report.decision).toBe("FAIL");
  });
  it("accepts one typed transient consent retry without granting a second web admission", async () => {
    const f = webRecoveryFixture(true);
    f.editCapture(capture => {
      const calls = capture.calls as RecoveryCall[];
      const begin = calls[2]!;
      const timeout = structuredClone(begin);
      timeout.result.structuredContent = { status: "PERMISSION_TIMEOUT", retryable: true, attempt: 1,
        diagnostics: { formSupported: true, hostAction: "ERROR" } };
      begin.startedAt = "2026-09-04T12:31:01Z"; begin.finishedAt = "2026-09-04T12:31:01.500Z";
      begin.result.structuredContent.attempt = 2;
      calls.splice(2, 0, timeout);
    });
    expect((await evaluateVisualSearch(f.manifest, f.load)).decision).toBe("PASS_RECORDED_EVIDENCE");
  });
  it("records authorized recovery with no loadable images as an actual miss", async () => {
    const f = webRecoveryFixture();
    f.editCapture(capture => {
      const calls = capture.calls as RecoveryCall[];
      calls[2]!.result = { content: [], structuredContent: { products: [], visualSearchFailure: { code: "NO_LOADABLE_IMAGES" } },
        _meta: { "findcheap/visualEvaluation": { version: 1, traceId: capture.runId, retrievedProductHashes: [], reviewedCandidates: [], finalProductHashes: [] } } };
      capture.calls = calls.slice(0, 3);
    });
    f.editReview(review => { review.productLabels = []; review.expectedPrimaryProductHash = null; });
    const report = await evaluateVisualSearch(f.manifest, f.load);
    expect(report.issues).toEqual([]);
    expect(report.completeCases).toBe(40);
    expect(report.decision).toBe("FAIL");
  });
  it("never passes an empty dataset", async () => {
    const { manifest, load } = fixture(0);
    expect((await evaluateVisualSearch(manifest, load)).decision).toBe("INCOMPLETE");
  });
  it("never passes fewer than forty independent images", async () => {
    const { manifest, load } = fixture(39);
    expect((await evaluateVisualSearch(manifest, load)).decision).toBe("INCOMPLETE");
  });
  it("requires both brand segments and frozen held-out cases", async () => {
    const { manifest, load } = fixture();
    manifest.cases.forEach((entry) => { entry.runs = entry.runs.slice(0, 1); entry.split = "DEVELOPMENT"; });
    expect((await evaluateVisualSearch(manifest, load)).decision).toBe("INCOMPLETE");
  });
  it("does not pad the minimum real-target count with unavailable or out-of-scope images", async () => {
    const { manifest, load, editLabel, freezeCohort } = fixture();
    for (let index = 1; index < 40; index += 1) editLabel(index, (label) => {
      label.eligibility = "UNAVAILABLE"; label.reason = "Recorded provider outage";
    });
    freezeCohort();
    const result = await evaluateVisualSearch(manifest, load);
    expect(result.completeCases).toBe(40);
    expect(result.completeSupportedCases).toBe(1);
    expect(result.exclusions).toHaveLength(39);
    expect(result.decision).toBe("INCOMPLETE");
  });
  it("rejects synthetic images as real acceptance samples", async () => {
    const { manifest, load } = fixture();
    manifest.cases.forEach((entry) => { entry.imageOrigin = "SYNTHETIC"; });
    const result = await evaluateVisualSearch(manifest, load);
    expect(result.decision).toBe("INCOMPLETE");
    expect(result.completeCases).toBe(0);
  });
  it("requires human review and matching raw artifact hashes", async () => {
    const { manifest, load, artifacts } = fixture();
    artifacts.delete(manifest.cases[0]!.runs[0]!.candidate.review.path);
    artifacts.set(manifest.cases[1]!.runs[0]!.candidate.capture.path, Buffer.from("{}"));
    expect((await evaluateVisualSearch(manifest, load)).decision).toBe("INCOMPLETE");
  });
  it.each(["referenceExtraction", "calls"])("cannot pass without actual %s evidence", async (key) => {
    const { manifest, load, editCapture } = fixture();
    editCapture((capture) => { delete capture[key]; });
    expect((await evaluateVisualSearch(manifest, load)).decision).toBe("INCOMPLETE");
  });
  it("does not accept a synthetic capture or a different baseline/version", async () => {
    const { manifest, load, editCapture } = fixture();
    editCapture((capture) => { capture.origin = "SYNTHETIC"; });
    manifest.baseline.commit = "c".repeat(40);
    expect((await evaluateVisualSearch(manifest, load)).decision).toBe("INCOMPLETE");
  });
  it("does not count a displayed image as completed visual review", async () => {
    const { manifest, load, editCapture } = fixture();
    editCapture((capture) => {
      const calls = capture.calls as Array<{ toolName: string; arguments: Record<string, unknown> }>;
      calls[1]!.arguments.verdicts = [];
    });
    expect((await evaluateVisualSearch(manifest, load)).decision).toBe("INCOMPLETE");
  });
  it("rejects initial-only capture with a forged empty terminal list", async () => {
    const { manifest, load, editCapture } = fixture();
    editCapture((capture) => {
      const calls = capture.calls as Array<{ result: { _meta: Record<string, Record<string, unknown>> } }>;
      calls[0]!.result._meta["findcheap/visualEvaluation"]!.finalProductHashes = [];
      capture.calls = calls.slice(0, 1);
    });
    const report = await evaluateVisualSearch(manifest, load);
    expect(report.decision).toBe("INCOMPLETE");
    expect(report.issues).toContainEqual({ caseId: "case-0", code: "NONTERMINAL_RESULT_HAS_FINAL_METADATA" });
  });
  it.each(["failed-call", "duplicate-verdict", "wrong-session"])("rejects %s rather than crediting review", async (failure) => {
    const { manifest, load, editCapture } = fixture();
    editCapture((capture) => {
      const calls = capture.calls as Array<{ arguments: Record<string, unknown>; result: Record<string, unknown> }>;
      const last = calls[1]!;
      if (failure === "failed-call") last.result.isError = true;
      else if (failure === "wrong-session") last.arguments.visualSessionId = "another-session";
      else {
        const verdicts = last.arguments.verdicts as unknown[];
        verdicts.push(verdicts[0]);
      }
    });
    expect((await evaluateVisualSearch(manifest, load)).decision).toBe("INCOMPLETE");
  });
  it("fails a fully captured run with a human-confirmed safety violation", async () => {
    const { manifest, load, editReview } = fixture();
    editReview((review) => { review.violations = ["IDENTITY_OVERWRITE"]; });
    expect((await evaluateVisualSearch(manifest, load)).decision).toBe("FAIL");
  });
  it.each(["candidate-image", "final-card"])("rejects %s identity inconsistent with captured metadata", async (field) => {
    const { manifest, load, editCapture } = fixture();
    editCapture((capture) => {
      const calls = capture.calls as Array<{ result: { content?: Array<{ data: string }>; structuredContent: Record<string, unknown> } }>;
      if (field === "candidate-image") calls[0]!.result.content![0]!.data = Buffer.from("different image").toString("base64");
      else (calls[1]!.result.structuredContent.products as Array<{ handle: string }>)[0]!.handle = "wrong-product";
    });
    expect((await evaluateVisualSearch(manifest, load)).decision).toBe("INCOMPLETE");
  });
  it.each([false, true])("checks current-round IDs across a two-round capture (stale ID: %s)", async (staleId) => {
    const { manifest, load, editCapture } = fixture();
    editCapture((capture) => {
      type Call = { toolName: string; arguments: Record<string, unknown>; result: {
        content?: unknown[]; structuredContent: Record<string, unknown>;
        _meta: Record<string, { version: number; traceId: string; retrievedProductHashes: string[];
          reviewedCandidates: Array<{ candidateId: string; productHash: string; imageSha256: string }>;
          finalProductHashes?: string[]; primaryProductHash?: string }>
      } };
      const calls = capture.calls as Call[];
      const first = calls[0]!;
      const second = calls[1]!;
      const terminal = structuredClone(second);
      const firstMeta = first.result._meta["findcheap/visualEvaluation"]!;
      const nextId = "candidate-2";
      const nextSession = `${String(capture.runId)}-second`;
      second.result = { content: structuredClone(first.result.content!),
        structuredContent: { visualReview: { visualSessionId: nextSession, finalAnswerAllowed: false, candidates: [{ candidateId: nextId }] } },
        _meta: { "findcheap/visualEvaluation": { ...firstMeta,
          retrievedProductHashes: [...firstMeta.retrievedProductHashes, "c".repeat(64)],
          reviewedCandidates: [{ ...firstMeta.reviewedCandidates[0]!, candidateId: nextId, productHash: "c".repeat(64) }]
        } } };
      terminal.arguments.visualSessionId = nextSession;
      (terminal.arguments.verdicts as Array<{ candidateId: string }>)[0]!.candidateId = staleId ? "candidate-1" : nextId;
      capture.calls = [first, second, terminal];
    });
    expect((await evaluateVisualSearch(manifest, load)).decision).toBe(staleId ? "INCOMPLETE" : "PASS_RECORDED_EVIDENCE");
  });
  it("calculates metrics from captured stage identities, not supplied success booleans", async () => {
    const { manifest, load } = fixture();
    const report = await evaluateVisualSearch(manifest, load);
    expect(report.decision).toBe("PASS_RECORDED_EVIDENCE");
    expect(report.completeCases).toBe(40);
    expect(report.segments.WITH_BRAND.candidate).toMatchObject({ runs: 40, candidateRecall: 1, reviewRecall: 1, top3HitRate: 1 });
    expect(report.segments.WITHOUT_BRAND.candidate).toMatchObject({ runs: 40, precision: 1 });
  });

  it("rejects retrospective exclusions and retains the frozen denominator", async () => {
    const { manifest, load, editLabel } = fixture();
    editLabel(0, (label) => { label.eligibility = "UNAVAILABLE"; label.reason = "Failed during the candidate run"; });
    const report = await evaluateVisualSearch(manifest, load);
    expect(report.issues).toContainEqual({ caseId: "case-0", code: "COHORT_LABEL_CHANGED" });
    expect(report.denominators).toMatchObject({ plannedCases: 40, supportedCases: 40 });
    expect(report.segments.WITH_BRAND.candidate.allSampleTop3Coverage).toBe(39 / 40);
  });

  it("rejects missing cohort cases instead of reducing the planned sample count", async () => {
    const { manifest, load } = fixture();
    manifest.cases.pop();
    const report = await evaluateVisualSearch(manifest, load);
    expect(report.issues).toContainEqual({ code: "COHORT_CASE_SET_MISMATCH" });
    expect(report.denominators.plannedCases).toBe(40);
    expect(report.decision).toBe("INCOMPLETE");
  });

  it("rejects rewriting the cohort after existing captures even with a backdated timestamp", async () => {
    const { manifest, load, editLabel, editCohort } = fixture();
    editLabel(0, (label) => { label.eligibility = "UNAVAILABLE"; label.reason = "Trying to exclude a failed target"; });
    editCohort((cohort) => {
      const first = (cohort.cases as Array<Record<string, unknown>>)[0]!;
      first.labelSha256 = manifest.cases[0]!.label.sha256;
      first.eligibility = "UNAVAILABLE";
    });
    const report = await evaluateVisualSearch(manifest, load);
    expect(report.decision).toBe("INCOMPLETE");
    expect(report.issues).toContainEqual({ caseId: "case-0", code: "RUN_COHORT_MISMATCH" });
  });

  it.each(["late-freeze", "family-leak", "exposed-held-out"])("rejects %s", async (kind) => {
    const { manifest, load, editCohort } = fixture();
    editCohort((cohort) => {
      const cases = cohort.cases as Array<Record<string, unknown>>;
      if (kind === "late-freeze") cohort.frozenAt = "2026-09-04T12:45:00Z";
      if (kind === "family-leak") cases[20]!.styleFamilyId = cases[0]!.styleFamilyId;
      if (kind === "exposed-held-out") cases[20]!.priorExposure = "DEVELOPMENT";
    });
    const report = await evaluateVisualSearch(manifest, load);
    expect(report.decision).toBe("INCOMPLETE");
    expect(report.issues.some((issue) => issue.code === ({
      "late-freeze": "COHORT_NOT_FROZEN_BEFORE_RUN", "family-leak": "STYLE_FAMILY_SPLIT_LEAKAGE",
      "exposed-held-out": "DEVELOPMENT_CASE_IN_HELD_OUT"
    }[kind]))).toBe(true);
  });

  it("rejects a known PDF development image in held-out even when renamed", async () => {
    const { manifest, load, editCohort } = fixture();
    const hash = "4f431c93a1f2eeaa56f8811b14a9e3f44681dd8be940ea726f5713616194ea95";
    manifest.cases[20]!.image.sha256 = hash;
    editCohort((cohort) => { (cohort.cases as Array<Record<string, unknown>>)[20]!.imageSha256 = hash; });
    expect((await evaluateVisualSearch(manifest, load)).issues).toContainEqual({ caseId: "case-20", code: "DEVELOPMENT_CASE_IN_HELD_OUT" });
  });

  it.each(["sourcePageUrl", "suspectedProductName"])("rejects answer-guided %s capture", async (key) => {
    const { manifest, load, editCapture } = fixture();
    editCapture((capture) => {
      const visual = (capture.referenceExtraction as { visualInput: Record<string, unknown> }).visualInput;
      visual[key] = key === "sourcePageUrl" ? "https://example.com/answer" : "Known answer dress";
      ((capture.calls as Array<{ arguments: Record<string, unknown> }>)[0]!.arguments.visualInput as Record<string, unknown>)[key] = visual[key];
    });
    expect((await evaluateVisualSearch(manifest, load)).issues).toContainEqual({ caseId: "case-0", code: "ANSWER_GUIDED_CAPTURE_NOT_ACCEPTANCE" });
  });

  it("cannot credit captures whose verdict provenance was not reviewed", async () => {
    const { manifest, load, editReview } = fixture();
    editReview((review) => { review.verdictOriginReviewed = "SYNTHETIC"; });
    expect((await evaluateVisualSearch(manifest, load)).decision).toBe("INCOMPLETE");
  });

  it("scores a genuine terminal no-candidate capture as a miss, not missing evidence", async () => {
    const { manifest, load, editCapture, editReview } = fixture();
    editCapture((capture) => {
      const first = (capture.calls as Array<{ result: Record<string, unknown> }>)[0]!;
      first.result = { content: [], structuredContent: { status: "OK", products: [],
        visualSearchFailure: { code: "NO_CATALOG_CANDIDATES" } }, _meta: { "findcheap/visualEvaluation": {
        version: 1, traceId: capture.runId, retrievedProductHashes: [], reviewedCandidates: [], finalProductHashes: []
      } } };
      capture.calls = [first];
    });
    editReview((review) => { review.productLabels = []; review.expectedPrimaryProductHash = null; });
    const report = await evaluateVisualSearch(manifest, load);
    expect(report.issues).toEqual([]);
    expect(report.segments.WITH_BRAND.candidate.top3HitRate).toBe(39 / 40);
    expect(report.decision).toBe("FAIL"); // Baseline was 100%; miss remains in the denominator.
  });

  it.each(["a".repeat(64), "https://private.example/image"])("accepts only hashed optional image URL provenance: %s", async (imageUrlHash) => {
    const { manifest, load, editCapture } = fixture();
    editCapture((capture) => {
      const calls = capture.calls as Array<{ result: { _meta: Record<string, { reviewedCandidates: Array<Record<string, unknown>> }> } }>;
      calls[0]!.result._meta["findcheap/visualEvaluation"]!.reviewedCandidates[0]!.imageUrlHash = imageUrlHash;
    });
    expect((await evaluateVisualSearch(manifest, load)).decision).toBe(imageUrlHash.startsWith("https") ? "INCOMPLETE" : "PASS_RECORDED_EVIDENCE");
  });
});
