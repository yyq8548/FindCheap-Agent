import Fastify from "fastify";
import type { CompareDeps } from "./compare-products.js";
import { registerCompareRoute } from "./routes/compare.js";

export function buildApp(deps: CompareDeps) {
  const app = Fastify();

  app.setErrorHandler((error, _request, reply) => {
    return reply.status(500).send({ error: "INTERNAL_SERVER_ERROR" });
  });
  registerCompareRoute(app, deps);
  return app;
}
