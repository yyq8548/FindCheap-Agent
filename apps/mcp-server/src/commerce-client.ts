import http from "node:http";
import https from "node:https";

import { ComparisonResultSchema } from "../../../packages/contracts/src/index.js";
import type { ComparePort, CompareProductsInput } from "./server.js";

const MAX_RESPONSE_BYTES = 1024 * 1024;
const REQUEST_TIMEOUT_MS = 8_000;

export function createCommerceApiComparePort(baseUrl: string, token: string): ComparePort {
  const origin = parseCommerceOrigin(baseUrl);
  if (token.length < 32 || token.length > 512) throw new Error("invalid Commerce API token");
  return {
    async compare(input) {
      const body = Buffer.from(JSON.stringify(apiInput(input)), "utf8");
      if (body.byteLength > 32 * 1024) throw new Error("Commerce API request exceeds limit");
      const response = await requestJson(new URL("/v1/comparisons", origin), token, body);
      return ComparisonResultSchema.parse(response);
    }
  };
}

export function createComparePortFromEnvironment(
  input: Record<string, string | undefined>,
  unavailable: () => ComparePort
): ComparePort {
  const url = input.SHOPPING_COMMERCE_API_URL;
  const token = input.SHOPPING_COMMERCE_API_TOKEN;
  if (url === undefined && token === undefined) return unavailable();
  if (url === undefined || token === undefined) return unavailable();
  try {
    return createCommerceApiComparePort(url, token);
  } catch {
    return unavailable();
  }
}

function apiInput(input: CompareProductsInput) {
  return {
    query: input.query,
    zipCode: input.zipCode.slice(0, 5),
    memberships: input.membershipIds ?? []
  };
}

function parseCommerceOrigin(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("invalid Commerce API URL");
  }
  if (url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "") {
    throw new Error("Commerce API URL credentials, query, and fragment are not allowed");
  }
  if (url.pathname !== "/") throw new Error("Commerce API URL must contain only an origin");
  if (url.protocol === "http:") {
    if (url.hostname !== "127.0.0.1" && url.hostname !== "[::1]") {
      throw new Error("plain HTTP is limited to numeric loopback addresses");
    }
  } else if (url.protocol !== "https:") {
    throw new Error("Commerce API URL must use HTTPS or loopback HTTP");
  }
  return url;
}

function requestJson(url: URL, token: string, body: Buffer): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const transport = url.protocol === "https:" ? https : http;
    const request = transport.request(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "content-length": String(body.byteLength),
        accept: "application/json"
      },
      timeout: REQUEST_TIMEOUT_MS
    }, (response) => {
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error("Commerce API returned a non-success response"));
        return;
      }
      const contentType = response.headers["content-type"] ?? "";
      if (!contentType.toLowerCase().startsWith("application/json")) {
        response.resume();
        reject(new Error("Commerce API returned a non-JSON response"));
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      response.on("data", (chunk: Buffer) => {
        size += chunk.byteLength;
        if (size > MAX_RESPONSE_BYTES) {
          response.destroy(new Error("Commerce API response exceeds limit"));
          return;
        }
        chunks.push(chunk);
      });
      response.once("error", reject);
      response.once("end", () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown);
        } catch {
          reject(new Error("Commerce API returned invalid JSON"));
        }
      });
    });
    request.once("timeout", () => request.destroy(new Error("Commerce API request timed out")));
    request.once("error", reject);
    request.end(body);
  });
}
