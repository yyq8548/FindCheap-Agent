import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createJsonWatchStore } from "../src/watch-store.js";

const directories: string[] = [];
afterEach(async () => Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))));

describe("JSON watch store", () => {
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
  });
});
