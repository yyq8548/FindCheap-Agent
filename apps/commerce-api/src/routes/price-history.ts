import type { FastifyInstance } from "fastify";
import {
  PriceObservationInputSchema,
  PriceHistoryInputSchema,
  type PriceHistoryRepository
} from "../price-history.js";

export function registerPriceHistoryRoute(
  app: FastifyInstance,
  repository: PriceHistoryRepository
): void {
  app.post("/v1/price-observations", async (request, reply) => {
    const input = PriceObservationInputSchema.safeParse(request.body);
    if (!input.success) return reply.status(400).send({ error: "VALIDATION_ERROR" });
    const status = await repository.record(input.data, new Date());
    return status === undefined
      ? reply.status(400).send({ error: "OBSERVATION_TIME_REJECTED" })
      : reply.status(status === "RECORDED" ? 201 : 200).send({ status });
  });
  app.post("/v1/price-history", async (request, reply) => {
    const input = PriceHistoryInputSchema.safeParse(request.body);
    if (!input.success) return reply.status(400).send({ error: "VALIDATION_ERROR" });
    const observations = await repository.lookup(input.data, new Date());
    return reply.send(observations === undefined
      ? { status: "UNAVAILABLE", observations: [] }
      : { status: "OK", observations });
  });
}
