import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createJsonWatchStore, createMemoryWatchStore } from "../src/watch-store.js";

const directories: string[] = [];
afterEach(async () => Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))));

describe("memory watch default expiration", () => {
  it("gives a newly created Watch an exact 30-day default deadline", async () => {
    const store = createMemoryWatchStore();
    const created = await store.create({
      query: "Black Lace Dress", condition: "RESTOCKED", identity: { gtin: "1234567890123" },
      conditionPreference: "ANY", membershipIds: [], intervalMinutes: 60
    }, "2026-09-06T12:00:00.000Z");

    expect(created.spec.expiresAt).toBe("2026-10-06T12:00:00.000Z");
  });

  it("reuses a Watch without extending its original default deadline", async () => {
    const store = createMemoryWatchStore();
    const spec = {
      query: "Black Lace Dress", condition: "RESTOCKED" as const, identity: { gtin: "1234567890123" },
      conditionPreference: "ANY" as const, membershipIds: [], intervalMinutes: 60
    };
    const created = await store.create(spec, "2026-09-06T12:00:00.000Z");
    const repeated = await store.create(spec, "2026-09-07T12:00:00.000Z");

    expect(repeated.watchId).toBe(created.watchId);
    expect(repeated.spec.expiresAt).toBe("2026-10-06T12:00:00.000Z");
    expect(await store.list()).toHaveLength(1);
  });
});

describe("JSON watch store", () => {
  it("persists the default deadline across instances without extending it on create", async () => {
    const directory = await mkdtemp(join(tmpdir(), "findcheap-watch-default-expiry-"));
    directories.push(directory);
    const first = createJsonWatchStore(directory);
    const spec = {
      query: "Black Lace Dress", condition: "RESTOCKED" as const, identity: { gtin: "1234567890123" },
      conditionPreference: "ANY" as const, membershipIds: [], intervalMinutes: 60
    };
    const created = await first.create(spec, "2026-09-06T12:00:00.000Z");

    expect(created.spec.expiresAt).toBe("2026-10-06T12:00:00.000Z");
    const second = createJsonWatchStore(directory);
    const repeated = await second.create(spec, "2026-09-07T12:00:00.000Z");
    expect(repeated.watchId).toBe(created.watchId);
    expect(repeated.spec.expiresAt).toBe("2026-10-06T12:00:00.000Z");
    expect(await second.list()).toHaveLength(1);
  });

  it("persists, deduplicates, updates, and deletes watches across instances", async () => {
    const directory = await mkdtemp(join(tmpdir(), "findcheap-watch-"));
    directories.push(directory);
    const first = createJsonWatchStore(directory);
    const spec = { query: "AirPods Pro", condition: "PRICE_BELOW" as const, threshold: 17_000, membershipIds: [], intervalMinutes: 60 };
    const created = await first.create(spec, "2026-08-18T12:00:00.000Z");
    const duplicate = await first.create(spec, "2026-08-18T12:01:00.000Z");
    expect(duplicate.watchId).toBe(created.watchId);
    await first.save({
      ...created,
      automationId: "findcheap-airpods-price",
      schedulingState: "BOUND",
      updatedAt: "2026-08-18T12:01:00.000Z"
    });

    const second = createJsonWatchStore(directory);
    expect(await second.get(created.watchId)).toMatchObject({
      watchId: created.watchId,
      automationId: "findcheap-airpods-price"
    });
    await second.save({
      ...(await second.get(created.watchId))!,
      status: "PAUSED",
      updatedAt: "2026-08-18T12:02:00.000Z"
    });
    expect((await first.list())[0]?.status).toBe("PAUSED");
    expect(await second.delete(created.watchId)).toBe(true);
    expect(await first.get(created.watchId)).toBeUndefined();
  });

  it("loads pre-v0.6.0 records without inventing an Automation binding", async () => {
    const directory = await mkdtemp(join(tmpdir(), "findcheap-watch-legacy-"));
    directories.push(directory);
    const watchId = "2e71d6f0-1f08-4f92-885c-ed42eb6f841e";
    await writeFile(join(directory, `${watchId}.json`), JSON.stringify({
      watchId,
      spec: {
        query: "Apple AirPods Pro",
        condition: "PRICE_BELOW",
        threshold: 17_000,
        membershipIds: [],
        intervalMinutes: 60
      },
      status: "ACTIVE",
      createdAt: "2026-08-18T12:00:00.000Z",
      updatedAt: "2026-08-18T12:00:00.000Z"
    }));

    const [legacy] = await createJsonWatchStore(directory).list();
    expect(legacy).toMatchObject({ watchId, status: "ACTIVE" });
    expect(legacy).not.toHaveProperty("automationId");
    expect(legacy).not.toHaveProperty("schedulingState");
    expect(legacy!.spec).not.toHaveProperty("expiresAt");
  });
});

describe.each(["memory", "JSON"] as const)("%s expiration compatibility", (kind) => {
  const spec = {
    query: "Black Lace Dress", condition: "RESTOCKED" as const, identity: { gtin: "1234567890123" },
    conditionPreference: "ANY" as const, membershipIds: [], intervalMinutes: 60
  };
  const createStore = async () => {
    if (kind === "memory") return createMemoryWatchStore();
    const directory = await mkdtemp(join(tmpdir(), "findcheap-watch-expiry-contract-"));
    directories.push(directory);
    return createJsonWatchStore(directory);
  };

  it("preserves an explicit deadline, including when a repeated request omits it", async () => {
    const store = await createStore();
    const explicit = await store.create({ ...spec, expiresAt: "2026-09-08T12:00:00.000Z" }, "2026-09-06T12:00:00.000Z");
    const repeated = await store.create(spec, "2026-09-07T12:00:00.000Z");

    expect(explicit.spec.expiresAt).toBe("2026-09-08T12:00:00.000Z");
    expect(repeated.watchId).toBe(explicit.watchId);
    expect(repeated.spec.expiresAt).toBe("2026-09-08T12:00:00.000Z");
  });

  it("deduplicates an explicit matching default deadline but keeps different deadlines distinct", async () => {
    const store = await createStore();
    const created = await store.create(spec, "2026-09-06T12:00:00.000Z");
    const matching = await store.create({ ...spec, expiresAt: "2026-10-06T12:00:00.000Z" }, "2026-09-07T12:00:00.000Z");
    const changed = await store.create({ ...spec, expiresAt: "2026-10-07T12:00:00.000Z" }, "2026-09-07T12:00:00.000Z");

    expect(matching.watchId).toBe(created.watchId);
    expect(changed.watchId).not.toBe(created.watchId);
    expect((await store.get(created.watchId))!.spec.expiresAt).toBe("2026-10-06T12:00:00.000Z");
  });

  it("does not resume a paused Watch or extend it on duplicate creation", async () => {
    const store = await createStore();
    const created = await store.create(spec, "2026-09-06T12:00:00.000Z");
    await store.save({ ...created, status: "PAUSED" });
    const repeated = await store.create(spec, "2026-09-07T12:00:00.000Z");

    expect(repeated).toMatchObject({ watchId: created.watchId, status: "PAUSED", spec: { expiresAt: "2026-10-06T12:00:00.000Z" } });
  });

  it("does not reuse an elapsed default deadline even before an expiry check runs", async () => {
    const store = await createStore();
    const created = await store.create(spec, "2026-09-06T12:00:00.000Z");
    const before = await store.create(spec, "2026-10-06T11:59:59.999Z");
    const after = await store.create(spec, "2026-10-06T12:00:00.000Z");

    expect(before.watchId).toBe(created.watchId);
    expect(after.watchId).not.toBe(created.watchId);
    expect(after.spec.expiresAt).toBe("2026-11-05T12:00:00.000Z");
    expect((await store.get(created.watchId))!.spec.expiresAt).toBe("2026-10-06T12:00:00.000Z");
  });

  it("keeps a legacy rule without a deadline unchanged", async () => {
    const store = await createStore();
    const created = await store.create(spec, "2026-09-06T12:00:00.000Z");
    const { expiresAt: _expiresAt, ...legacySpec } = created.spec;
    await store.save({ ...created, spec: legacySpec });
    const repeated = await store.create(spec, "2026-09-07T12:00:00.000Z");

    expect(repeated.watchId).toBe(created.watchId);
    expect(repeated.spec).not.toHaveProperty("expiresAt");
  });
});
