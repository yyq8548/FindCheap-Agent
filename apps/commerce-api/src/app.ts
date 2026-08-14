import Fastify from "fastify";
import { createHash, timingSafeEqual } from "node:crypto";
import type { CompareDeps } from "./compare-products.js";
import { registerCompareRoute } from "./routes/compare.js";

export function buildApp(deps: CompareDeps, options: { bearerToken?: string } = {}) {
  const app = Fastify({
    bodyLimit: 32 * 1024,
    connectionTimeout: 5_000,
    requestTimeout: 10_000,
    keepAliveTimeout: 5_000
  });

  app.setErrorHandler((error, _request, reply) => {
    return reply.status(500).send({ error: "INTERNAL_SERVER_ERROR" });
  });
  app.get("/health", async () => ({ status: "ok" }));
  app.addHook("onRequest", async (request, reply) => {
    if (!request.url.startsWith("/v1/")) return;
    if (options.bearerToken !== undefined && !validBearer(request.headers.authorization, options.bearerToken)) {
      await reply.status(401).send({ error: "UNAUTHORIZED" });
    }
  });
  registerCompareRoute(app, deps);
  return app;
}

function validBearer(header: string | undefined, expected: string): boolean {
  if (header === undefined || !header.startsWith("Bearer ")) return false;
  const supplied = header.slice("Bearer ".length);
  const suppliedDigest = createHash("sha256").update(supplied).digest();
  const expectedDigest = createHash("sha256").update(expected).digest();
  return timingSafeEqual(suppliedDigest, expectedDigest);
}
