import type { FastifyInstance } from "fastify";
import { CompareInputSchema, compareProducts, type CompareDeps } from "../compare-products.js";

export function registerCompareRoute(app: FastifyInstance, deps: CompareDeps): void {
  app.post("/v1/comparisons", async (request, reply) => {
    const input = CompareInputSchema.safeParse(request.body);
    if (!input.success) {
      return reply.status(400).send({ error: "VALIDATION_ERROR" });
    }
    return reply.send(await compareProducts(input.data, deps));
  });
}
