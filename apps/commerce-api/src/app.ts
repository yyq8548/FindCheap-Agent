import Fastify from "fastify";
import { ZodError } from "zod";
import type { CompareDeps } from "./compare-products.js";
import { registerCompareRoute } from "./routes/compare.js";

export function buildApp(deps: CompareDeps) {
  const app = Fastify();

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.status(400).send({ error: "VALIDATION_ERROR" });
    }
    return reply.status(500).send({ error: "INTERNAL_SERVER_ERROR" });
  });
  registerCompareRoute(app, deps);
  return app;
}
