import { describe, expect, it } from "vitest";

import {
  parseIngestionEnvironment,
  redisConnectionOptions
} from "../src/runtime/environment.js";
import { createDatabase } from "../../../packages/db/src/client.js";

describe("ingestion runtime environment", () => {
  it("accepts authenticated TLS Redis in production without retaining the URL", () => {
    const environment = parseIngestionEnvironment({
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://worker:secret@db.example/shopping?sslmode=verify-full&application_name=ingestion-worker",
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

  it("passes the validated verify-full connection string to the PostgreSQL client", () => {
    const databaseUrl = "postgresql://worker:secret@db.example/shopping?sslmode=verify-full";
    const environment = parseIngestionEnvironment({
      NODE_ENV: "production",
      DATABASE_URL: databaseUrl
    });
    expect(environment.databaseUrl).toBe(databaseUrl);
    expect(createDatabase(environment.databaseUrl!)).toBeDefined();
  });

  it.each([
    ["redis://worker:secret@redis.example:6379/0", /TLS|rediss/i],
    ["rediss://redis.example:6380/0", /authentication|password/i],
    ["rediss://worker:secret@redis.example:6380/16", /database/i]
  ])("rejects unsafe production Redis URL %s", (redisUrl, expected) => {
    expect(() => parseIngestionEnvironment({
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://worker:secret@db.example/shopping?sslmode=verify-full",
      REDIS_URL: redisUrl
    })).toThrow(expected);
  });

  it.each([
    ["postgresql://worker@db.example/shopping?sslmode=verify-full", /password/i],
    ["postgresql://worker:@db.example/shopping?sslmode=verify-full", /password/i],
    ["postgresql://worker:secret@db.example/shopping", /verify-full/i],
    ["postgresql://worker:secret@db.example/shopping?sslmode=require", /verify-full/i],
    ["postgresql://worker:secret@db.example/shopping?sslmode=verify-ca", /verify-full/i],
    ["postgresql://worker:secret@db.example/shopping?sslmode=disable", /verify-full/i],
    ["postgresql://worker:secret@db.example/shopping?sslmode=verify-full&options=-cstatement_timeout%3D0", /query|parameter/i],
    ["postgresql://worker:secret@db.example/shopping?sslmode=verify-full#secret", /fragment/i],
    ["postgresql://worker:secret@db.example/shopping?sslmode=verify-full&sslmode=verify-full", /duplicate/i]
  ])("rejects unsafe production PostgreSQL URL %s", (databaseUrl, expected) => {
    expect(() => parseIngestionEnvironment({
      NODE_ENV: "production",
      DATABASE_URL: databaseUrl
    })).toThrow(expected);
  });

  it("rejects unsupported PostgreSQL query parameters in every environment", () => {
    expect(() => parseIngestionEnvironment({
      DATABASE_URL: "postgresql://shopping:local-only@127.0.0.1/shopping?connect_timeout=0"
    })).toThrow(/query|parameter/i);
    expect(() => parseIngestionEnvironment({
      DATABASE_URL: "postgresql://shopping:local-only@127.0.0.1/shopping?options=-cstatement_timeout%3D0"
    })).toThrow(/options|parameter/i);
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
