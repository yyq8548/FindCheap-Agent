import { describe, expect, it } from "vitest";

import { parseCommerceEnvironment } from "../src/environment.js";

describe("Commerce API environment", () => {
  it("defaults to loopback and supports a disabled local runtime", () => {
    expect(parseCommerceEnvironment({})).toEqual({
      nodeEnvironment: "development",
      host: "127.0.0.1",
      port: 3000
    });
  });

  it("requires authenticated verify-full PostgreSQL in production", () => {
    expect(() => parseCommerceEnvironment({ NODE_ENV: "production" })).toThrow(/DATABASE_URL/);
    expect(() => parseCommerceEnvironment({
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://shopping:password@db.example/shopping?sslmode=verify-full"
    })).toThrow(/COMMERCE_API_TOKEN/);
    expect(parseCommerceEnvironment({
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://shopping:password@db.example/shopping?sslmode=verify-full",
      COMMERCE_API_TOKEN: "x".repeat(32)
    })).toMatchObject({ nodeEnvironment: "production", bearerToken: "x".repeat(32) });
  });

  it("allows encrypted Railway private-network PostgreSQL without weakening public hosts", () => {
    const databaseUrl = "postgresql://shopping:password@postgres.railway.internal:5432/railway?sslmode=require&uselibpqcompat=true";
    expect(parseCommerceEnvironment({
      NODE_ENV: "production",
      DATABASE_URL: databaseUrl,
      COMMERCE_API_TOKEN: "x".repeat(32)
    }).databaseUrl).toBe(databaseUrl);
    expect(() => parseCommerceEnvironment({
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://shopping:password@db.example/railway?sslmode=require",
      COMMERCE_API_TOKEN: "x".repeat(32)
    })).toThrow(/verify-full/);
    expect(() => parseCommerceEnvironment({
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://shopping:password@postgres.railway.internal/railway?sslmode=require",
      COMMERCE_API_TOKEN: "x".repeat(32)
    })).toThrow(/verify-full/);
  });

  it("rejects unsafe binds, short tokens, and non-TLS production databases", () => {
    expect(() => parseCommerceEnvironment({ COMMERCE_API_HOST: "commerce.example" })).toThrow();
    expect(() => parseCommerceEnvironment({ COMMERCE_API_TOKEN: "short" })).toThrow();
    expect(() => parseCommerceEnvironment({
      DATABASE_URL: "postgresql://shopping:local-only@127.0.0.1:5432/shopping"
    })).toThrow(/COMMERCE_API_TOKEN/);
    expect(() => parseCommerceEnvironment({
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://shopping:password@db.example/shopping",
      COMMERCE_API_TOKEN: "x".repeat(32)
    })).toThrow(/verify-full/);
  });
});
