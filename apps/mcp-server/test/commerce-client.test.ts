import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";

import { createCommerceApiComparePort, createComparePortFromEnvironment } from "../src/commerce-client.js";
import { createUnavailableComparePort } from "../src/server.js";

const token = "test-commerce-token-that-is-at-least-32-characters";
const servers: http.Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  })));
});

describe("Commerce API compare client", () => {
  it("sends only the fixed comparison route and validates the response", async () => {
    let observed: { url: string | undefined; authorization: string | undefined; body: unknown } = {
      url: undefined,
      authorization: undefined,
      body: undefined
    };
    const server = http.createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        observed = {
          url: request.url,
          authorization: request.headers.authorization,
          body: JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown
        };
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({
          productId: "product-1",
          exactOffers: [],
          similarOffers: [],
          questions: ["No current comparable offers were found."]
        }));
      });
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("test server did not bind TCP");
    const client = createCommerceApiComparePort(`http://127.0.0.1:${address.port}`, token);

    await expect(client.compare({
      query: "OLED65C4PUA",
      zipCode: "33433-1234",
      membershipIds: ["club"]
    })).resolves.toMatchObject({ productId: "product-1" });
    expect(observed).toEqual({
      url: "/v1/comparisons",
      authorization: `Bearer ${token}`,
      body: { query: "OLED65C4PUA", zipCode: "33433", memberships: ["club"] }
    });
  });

  it.each([
    "http://merchant.example",
    "ftp://127.0.0.1",
    "https://commerce.example/untrusted-path",
    "https://user:secret@commerce.example",
    "https://commerce.example?redirect=https://evil.example"
  ])("rejects unsafe origins: %s", (url) => {
    expect(() => createCommerceApiComparePort(url, token)).toThrow();
  });

  it("fails closed on redirects and malformed API output", async () => {
    const server = http.createServer((_request, response) => {
      response.statusCode = 302;
      response.setHeader("location", "https://evil.example");
      response.end();
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("test server did not bind TCP");
    const client = createCommerceApiComparePort(`http://127.0.0.1:${address.port}`, token);
    await expect(client.compare({ query: "model", zipCode: "10001" })).rejects.toThrow(/non-success/);
  });

  it("enforces an absolute wall-clock deadline against slow-drip responses", async () => {
    const server = http.createServer((_request, response) => {
      response.setHeader("content-type", "application/json");
      response.write("{");
      const interval = setInterval(() => response.write(" "), 10);
      response.once("close", () => clearInterval(interval));
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("test server did not bind TCP");
    const client = createCommerceApiComparePort(
      `http://127.0.0.1:${address.port}`,
      token,
      { timeoutMs: 50 }
    );
    const startedAt = Date.now();
    await expect(client.compare({ query: "model", zipCode: "10001" })).rejects.toThrow(/timed out/);
    expect(Date.now() - startedAt).toBeLessThan(500);
  });

  it("destroys an oversized response immediately", async () => {
    let closed = false;
    const server = http.createServer((_request, response) => {
      response.setHeader("content-type", "application/json");
      response.once("close", () => { closed = true; });
      response.end(JSON.stringify({ payload: "x".repeat(512) }));
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("test server did not bind TCP");
    const client = createCommerceApiComparePort(
      `http://127.0.0.1:${address.port}`,
      token,
      { maxResponseBytes: 32 }
    );
    await expect(client.compare({ query: "model", zipCode: "10001" })).rejects.toThrow(/exceeds limit/);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(closed).toBe(true);
  });

  it("keeps absent or partial configuration unavailable", async () => {
    const absent = createComparePortFromEnvironment({}, createUnavailableComparePort);
    const partial = createComparePortFromEnvironment({
      SHOPPING_COMMERCE_API_URL: "https://commerce.example"
    }, createUnavailableComparePort);
    await expect(absent.compare({ query: "model", zipCode: "10001" })).rejects.toThrow("DATA_SOURCE_UNAVAILABLE");
    await expect(partial.compare({ query: "model", zipCode: "10001" })).rejects.toThrow("DATA_SOURCE_UNAVAILABLE");
  });
});
