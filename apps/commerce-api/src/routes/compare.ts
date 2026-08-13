import type { FastifyInstance } from "fastify";
import { CompareInputSchema, compareProducts, type CompareDeps } from "../compare-products.js";

export function registerCompareRoute(app: FastifyInstance, deps: CompareDeps): void {
  app.post("/v1/comparisons", async (request, reply) => {
    const input = CompareInputSchema.parse(request.body);
    return reply.send(await compareProducts(input, deps));
  });
}
