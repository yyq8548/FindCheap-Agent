import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { productReferenceKey } from "../apps/mcp-server/src/product-reference.js";
import { evaluateShoppingTasks } from "./evaluate-shopping-tasks.js";

// Synthetic evaluator unit fixtures only. Never a real acceptance dataset.
function fixture(count = 1, sourceKind?: "WEB_PRODUCT_PAGE") {
  const artifacts = new Map<string, Uint8Array>();
  const artifact = (path: string, data: unknown) => {
    const bytes = Buffer.isBuffer(data) ? data : Buffer.from(JSON.stringify(data));
    artifacts.set(path, bytes);
    return { path, sha256: createHash("sha256").update(bytes).digest("hex") };
  };
  const baseline = { version: "0.17.20", commit: "a".repeat(40), bundleSha256: "a".repeat(64) };
  const candidate = { version: "candidate", commit: "b".repeat(40), bundleSha256: "b".repeat(64) };
  const cases = Array.from({ length: count }, (_, index) => {
    const id = `case-${index}`;
    const input = artifact(`${id}.txt`, Buffer.from(`Synthetic query ${index}`));
    const card = { merchantId: "merchant", sourceHost: "example.com", handle: `product-${index}`, selectionId: "selected",
      ...(sourceKind === undefined ? {} : { sourceKind }) };
    const productHash = createHash("sha256").update(productReferenceKey(card)).digest("hex");
    const label = artifact(`${id}-label.json`, { kind: "HUMAN_SHOPPING_TARGET", caseId: id, inputSha256: input.sha256,
      reviewerId: "fixture-human", reviewedAt: "2026-09-05T10:00:00Z", eligibility: "VERIFIED_RECOMMENDABLE", targetProductHashes: [productHash] });
    const record = (release: typeof baseline, name: string) => {
      const capture = artifact(`${id}-${name}.json`, { kind: "LIVE_CODEX_SHOPPING_CAPTURE", origin: "LIVE", ...release,
        caseId: id, inputSha256: input.sha256, cohortSha256: "0".repeat(64), runId: `${id}-${name}`, threadId: `${id}-${name}`,
        startedAt: "2026-09-05T11:00:00Z", retrieval: { origin: "SERVER_TRACE", productHashes: [productHash] },
        finalResult: { products: [card], recommendation: { primarySelectionId: "selected" } } });
      const review = artifact(`${id}-${name}-review.json`, { kind: "HUMAN_SHOPPING_REVIEW", caseId: id, captureSha256: capture.sha256,
        reviewerId: "fixture-human", reviewedAt: "2026-09-05T12:00:00Z", captureOriginReviewed: true, retrievalOrderReviewed: true,
        answerIsolationReviewed: true, products: [{ productHash, relevant: true, requirementsSatisfied: true, merchantVerified: true, requiredQualityEvidence: true }], violations: [] });
      return { capture, review };
    };
    return { id, input, label, baseline: record(baseline, "baseline"), candidate: record(candidate, "candidate") };
  });
  const manifest = { schemaVersion: 1, baseline, candidate, cases, cohort: artifact("cohort.json", {
    kind: "FROZEN_SHOPPING_COHORT", frozenAt: "2026-09-05T10:30:00Z", reviewerId: "fixture-human", reviewedAt: "2026-09-05T10:30:00Z",
    cases: cases.map(entry => ({ id: entry.id, inputSha256: entry.input.sha256, labelSha256: entry.label.sha256,
      familyId: entry.id, category: "haircare", split: "HELD_OUT", modality: "TEXT", priorExposure: "UNSEEN", eligibility: "VERIFIED_RECOMMENDABLE" }))
  }), hostRuns: [] as Array<{ capture: { path: string; sha256: string }; review: { path: string; sha256: string } }> };
  const edit = (ref: { path: string; sha256: string }, mutate: (data: Record<string, unknown>) => void) => {
    const data = JSON.parse(Buffer.from(artifacts.get(ref.path)!).toString()) as Record<string, unknown>;
    mutate(data);
    Object.assign(ref, artifact(ref.path, data));
  };
  const editCapture = (index: number, mutate: (data: Record<string, unknown>) => void) => {
    const pair = cases[index]!.candidate;
    edit(pair.capture, mutate);
    edit(pair.review, review => { review.captureSha256 = pair.capture.sha256; });
  };
  const bindCohort = () => {
    for (const entry of cases) for (const release of ["baseline", "candidate"] as const) {
      const pair = entry[release];
      edit(pair.capture, capture => { capture.cohortSha256 = manifest.cohort.sha256; });
      edit(pair.review, review => { review.captureSha256 = pair.capture.sha256; });
    }
  };
  bindCohort();
  const host = (scenario = "ACCEPTED", threadId = `host-${manifest.hostRuns.length}`, browserActions = scenario === "ACCEPTED" ? 1 : 0) => {
    const id = `host-run-${manifest.hostRuns.length}`;
    const capture = artifact(`${id}.json`, { kind: "LIVE_CODEX_HOST_RECOVERY_CAPTURE", origin: "LIVE", ...candidate,
      runId: id, threadId, startedAt: "2026-09-05T11:00:00Z", scenario, permissionStatus: scenario === "ACCEPTED" ? "READY" : "PERMISSION_DENIED",
      browserActions, completedWebSearch: scenario === "ACCEPTED", nativeCardsReturned: scenario === "ACCEPTED" ? 1 : 0 });
    const review = artifact(`${id}-review.json`, { kind: "HUMAN_HOST_RECOVERY_REVIEW", captureSha256: capture.sha256,
      reviewerId: "fixture-human", reviewedAt: "2026-09-05T12:00:00Z", hostOriginReviewed: true, scenarioOutcomeCorrect: true });
    manifest.hostRuns.push({ capture, review });
  };
  const load = async (path: string) => { const data = artifacts.get(path); if (data === undefined) throw new Error("MISSING"); return data; };
  return { manifest, load, artifacts, artifact, edit, editCapture, bindCohort, host };
}

describe("recorded shopping task evaluation", () => {
  it("never passes an empty cohort and reports undefined precision, not 100 percent", async () => {
    const { manifest, load } = fixture(0);
    const report = await evaluateShoppingTasks(manifest, load);
    expect(report.decision).toBe("INCOMPLETE");
    expect(report.heldOut.candidate.precisionAt3).toBeNull();
    expect(report.host.independentAcceptedThreads).toBe(0);
  });
  it("scores a valid recorded task without confusing a pilot with acceptance", async () => {
    const { manifest, load } = fixture();
    const report = await evaluateShoppingTasks(manifest, load);
    expect(report.heldOut.candidate).toMatchObject({ recallAt20: 1, precisionAt3: 1, recommendationCoverage: 1, taskSuccessRate: 1 });
    expect(report.decision).toBe("INCOMPLETE");
  });
  it("scores admitted web-page product references using their actual source identity", async () => {
    const f = fixture(1, "WEB_PRODUCT_PAGE");
    const report = await evaluateShoppingTasks(f.manifest, f.load);
    expect(report.heldOut.candidate).toMatchObject({ completedTasks: 1, recallAt20: 1, precisionAt3: 1 });
  });
  it("does not score empty recommendations as perfect precision", async () => {
    const f = fixture();
    f.editCapture(0, capture => { capture.finalResult = { products: [] }; });
    const report = await evaluateShoppingTasks(f.manifest, f.load);
    expect(report.heldOut.candidate).toMatchObject({ precisionAt3: null, recommendationCoverage: 0, taskSuccessRate: 0 });
  });
  it("uses the first 20 unique retrieved products, not an unbounded pool", async () => {
    const f = fixture();
    f.editCapture(0, capture => {
      const retrieval = capture.retrieval as { productHashes: string[] };
      retrieval.productHashes = [...Array.from({ length: 20 }, (_, n) => createHash("sha256").update(`unrelated-${n}`).digest("hex")), ...retrieval.productHashes];
    });
    expect((await evaluateShoppingTasks(f.manifest, f.load)).heldOut.candidate.recallAt20).toBe(0);
  });
  it("binds a revalidated old candidate without counting it as fresh source recall", async () => {
    const f = fixture();
    f.editCapture(0, capture => {
      const retrieval = capture.retrieval as { productHashes: string[] };
      capture.retrieval = { ...retrieval, order: "SOURCE_OBSERVATION_ORDER", truncated: false,
        productHashes: [], revalidatedProductHashes: retrieval.productHashes };
    });
    const report = await evaluateShoppingTasks(f.manifest, f.load);
    expect(report.heldOut.candidate).toMatchObject({ completedTasks: 1, recallAt20: 0, precisionAt3: 1, taskSuccessRate: 1 });
    expect(report.recallBasis).toBe("FIRST_20_UNIQUE_SOURCE_OBSERVATIONS_NOT_GLOBAL_RANK");
  });
  it("still rejects final products absent from both observed and revalidated pools", async () => {
    const f = fixture();
    f.editCapture(0, capture => { capture.retrieval = { origin: "SERVER_TRACE", productHashes: [], revalidatedProductHashes: [] }; });
    expect((await evaluateShoppingTasks(f.manifest, f.load)).issues).toContainEqual({ caseId: "case-0", code: "FINAL_OUTSIDE_RETRIEVED_POOL" });
  });
  it("retains failed captured tasks in the frozen recall denominator", async () => {
    const f = fixture(2);
    f.artifacts.delete(f.manifest.cases[1]!.candidate.capture.path);
    const report = await evaluateShoppingTasks(f.manifest, f.load);
    expect(report.heldOut.candidate).toMatchObject({ recallAt20: 0.5, completionCoverage: 0.5, taskSuccessRate: 0.5 });
    expect(report.decision).toBe("INCOMPLETE");
  });
  it("rejects changed hashes rather than accepting hand-edited scores", async () => {
    const f = fixture();
    f.artifacts.set(f.manifest.cases[0]!.candidate.capture.path, Buffer.from("{}"));
    expect((await evaluateShoppingTasks(f.manifest, f.load)).issues).toContainEqual({ caseId: "case-0", code: "ARTIFACT_HASH_MISMATCH" });
  });
  it("fails a recommended product with missing hard or trust evidence", async () => {
    const f = fixture();
    f.edit(f.manifest.cases[0]!.candidate.review, review => { (review.products as Array<{ merchantVerified: boolean }>)[0]!.merchantVerified = false; });
    const report = await evaluateShoppingTasks(f.manifest, f.load);
    expect(report.decision).toBe("FAIL");
    expect(report.heldOut.candidate.precisionAt3).toBe(0);
  });
  it("rejects held-out development exposure and family duplication", async () => {
    const f = fixture(2);
    f.edit(f.manifest.cohort, cohort => {
      const cases = cohort.cases as Array<{ priorExposure: string; familyId: string }>;
      cases[0]!.priorExposure = "DEVELOPMENT";
      cases[1]!.familyId = cases[0]!.familyId;
    });
    f.bindCohort();
    const report = await evaluateShoppingTasks(f.manifest, f.load);
    expect(report.issues.map(item => item.code)).toContain("DEVELOPMENT_IN_HELD_OUT");
    expect(report.issues.map(item => item.code)).toContain("DUPLICATE_HELD_OUT_FAMILY");
  });
  it("does not accept image rows as a shortcut around the existing visual gate", async () => {
    const f = fixture();
    f.edit(f.manifest.cohort, cohort => { (cohort.cases as Array<{ modality: string }>)[0]!.modality = "IMAGE"; });
    f.bindCohort();
    expect((await evaluateShoppingTasks(f.manifest, f.load)).issues.map(item => item.code)).toContain("VISUAL_EVIDENCE_REQUIRED");
  });
  it("requires three independent host tasks, not three retries of one task", async () => {
    const f = fixture();
    f.host("ACCEPTED", "same-thread"); f.host("ACCEPTED", "same-thread"); f.host("ACCEPTED", "same-thread");
    const report = await evaluateShoppingTasks(f.manifest, f.load);
    expect(report.host.independentAcceptedThreads).toBe(1);
    expect(report.issues.map(item => item.code)).toContain("THREE_INDEPENDENT_LIVE_HOST_ACCEPTANCES_REQUIRED");
  });
  it("fails any browser action following a denied host scenario", async () => {
    const f = fixture(); f.host("DENIED", "denied-thread", 1);
    expect((await evaluateShoppingTasks(f.manifest, f.load)).decision).toBe("FAIL");
  });
  it("does not count a different installed bundle as the candidate", async () => {
    const f = fixture(); f.editCapture(0, capture => { capture.bundleSha256 = "c".repeat(64); });
    expect((await evaluateShoppingTasks(f.manifest, f.load)).issues.map(item => item.code)).toContain("RUN_PROVENANCE_MISMATCH");
  });
  it("rejects path traversal before asking the loader", async () => {
    const f = fixture(); f.manifest.cohort.path = "../cohort.json";
    expect((await evaluateShoppingTasks(f.manifest, f.load)).issues.map(item => item.code)).toContain("ARTIFACT_PATH_INVALID");
  });
});
