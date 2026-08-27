import { z } from "zod";

import { parseDatabaseUrl } from "../../../packages/db/src/environment.js";

const NodeEnvironmentSchema = z.enum(["development", "test", "production"]);
const BindHostSchema = z.enum(["127.0.0.1", "::1", "0.0.0.0", "::"]);

export type CommerceEnvironment = {
  nodeEnvironment: z.infer<typeof NodeEnvironmentSchema>;
  databaseUrl?: string;
  bearerToken?: string;
  host: z.infer<typeof BindHostSchema>;
  port: number;
};

export function parseCommerceEnvironment(
  input: Record<string, string | undefined>
): CommerceEnvironment {
  const nodeEnvironment = NodeEnvironmentSchema.parse(input.NODE_ENV ?? "development");
  const databaseUrl = parseDatabaseUrl(input.DATABASE_URL, nodeEnvironment, {
    allowRailwayPrivateRequire: true
  });
  const bearerToken = input.COMMERCE_API_TOKEN;
  if (bearerToken !== undefined && (bearerToken.length < 32 || bearerToken.length > 512)) {
    throw new Error("COMMERCE_API_TOKEN must contain 32 through 512 characters");
  }
  if (databaseUrl !== undefined && bearerToken === undefined) {
    throw new Error("COMMERCE_API_TOKEN is required whenever DATABASE_URL is configured");
  }
  if (nodeEnvironment === "production") {
    if (databaseUrl === undefined) throw new Error("DATABASE_URL is required in production");
    if (bearerToken === undefined) throw new Error("COMMERCE_API_TOKEN is required in production");
  }
  const port = Number(input.COMMERCE_API_PORT ?? "3000");
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("COMMERCE_API_PORT must be an integer from 1 through 65535");
  }
  return {
    nodeEnvironment,
    ...(databaseUrl === undefined ? {} : { databaseUrl }),
    ...(bearerToken === undefined ? {} : { bearerToken }),
    host: BindHostSchema.parse(input.COMMERCE_API_HOST ?? "127.0.0.1"),
    port
  };
}
