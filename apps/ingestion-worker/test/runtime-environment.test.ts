import { describe, expect, it } from "vitest";

import {
  parseIngestionEnvironment,
  redisConnectionOptions
} from "../src/runtime/environment.js";

describe("ingestion runtime environment", () => {
  it("accepts authenticated TLS Redis in production without retaining the URL", () => {
    const environment = parseIngestionEnvironment({
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://worker:secret@db.example/shopping",
      REDIS_URL: "rediss://worker:secret@redis.example:6380/2",
      MERCHANT_MINIMUM_ENABLED: "10",
      INGESTION_CIRCUIT_FAILURE_THRESHOLD: "4"
    });

    expect(environment).toMatchObject({
      nodeEnvironment: "production",
      minimumEnabledMerchants: 10,
      circuitFailureThreshold: 4
    });
    expect(redisConnectionOptions(environment)).toEqual({
      host: "redis.example",
      port: 6380,
      db: 2,
      username: "worker",
      password: "secret",
      tls: {},
      maxRetriesPerRequest: null
    });
    expect(JSON.stringify(environment)).not.toContain("rediss://");
  });

  it.each([
    ["redis://worker:secret@redis.example:6379/0", /TLS|rediss/i],
    ["rediss://redis.example:6380/0", /authentication|password/i],
    ["rediss://worker:secret@redis.example:6380/16", /database/i]
  ])("rejects unsafe production Redis URL %s", (redisUrl, expected) => {
    expect(() => parseIngestionEnvironment({
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://worker:secret@db.example/shopping",
      REDIS_URL: redisUrl
    })).toThrow(expected);
  });

  it("allows explicit local development connections and validates controls strictly", () => {
    const environment = parseIngestionEnvironment({
      NODE_ENV: "development",
      DATABASE_URL: "postgresql://shopping:local-only@127.0.0.1:5432/shopping",
      REDIS_URL: "redis://127.0.0.1:6379/0",
      INGESTION_GLOBAL_KILL_SWITCH: "true",
      INGESTION_MERCHANT_KILL_SWITCHES: "merchant-a,merchant-b"
    });
    expect(environment.globalKillSwitch).toBe(true);
    expect(environment.merchantKillSwitches).toEqual(new Set(["merchant-a", "merchant-b"]));

    expect(() => parseIngestionEnvironment({
      INGESTION_GLOBAL_KILL_SWITCH: "yes"
    })).toThrow(/boolean/i);
  });
});
