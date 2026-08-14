import { createDatabase, type Database } from "../../../packages/db/src/client.js";
import { buildApp } from "./app.js";
import { createCurrentOfferStore } from "./current-offer-store.js";
import { parseCommerceEnvironment } from "./environment.js";

export type CommerceRuntime = {
  status: "disabled" | "running";
  close(): Promise<void>;
};

export async function startCommerceRuntime(
  input: Record<string, string | undefined> = process.env,
  createDb: (url: string) => Database = createDatabase
): Promise<CommerceRuntime> {
  const environment = parseCommerceEnvironment(input);
  if (environment.databaseUrl === undefined) {
    return { status: "disabled", async close() {} };
  }
  const db = createDb(environment.databaseUrl);
  try {
    await db.connect();
  } catch (error) {
    await db.close();
    throw error;
  }
  const store = createCurrentOfferStore(db);
  const app = buildApp({
    offers: store,
    quoteExactOffer: store.quoteExactOffer,
    clock: { now: () => new Date() }
  }, environment.bearerToken === undefined ? {} : { bearerToken: environment.bearerToken });
  try {
    await app.listen({ host: environment.host, port: environment.port });
  } catch (error) {
    await db.close();
    throw error;
  }
  return {
    status: "running",
    async close() {
      try {
        await app.close();
      } finally {
        await db.close();
      }
    }
  };
}
