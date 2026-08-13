import type { ConnectionOptions } from "bullmq";
import { z } from "zod";

const MerchantIdSchema = z.string().regex(/^[a-z0-9-]{1,80}$/u);
const NodeEnvironmentSchema = z.enum(["development", "test", "production"]);

export type IngestionEnvironment = {
  nodeEnvironment: z.infer<typeof NodeEnvironmentSchema>;
  databaseUrl?: string;
  redis?: {
    tls: boolean;
    host: string;
    port: number;
    database: number;
    username?: string;
    password?: string;
  };
  minimumEnabledMerchants: number;
  globalKillSwitch: boolean;
  merchantKillSwitches: ReadonlySet<string>;
  circuitFailureThreshold: number;
  circuitResetMs: number;
};

type EnvironmentInput = Record<string, string | undefined>;

function parseInteger(
  value: string | undefined,
  fallback: number,
  label: string,
  minimum: number,
  maximum: number
): number {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} through ${maximum}`);
  }
  return parsed;
}

function parseBoolean(value: string | undefined, fallback: boolean, label: string): boolean {
  if (value === undefined) return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${label} must be a boolean true or false`);
}

function parseMerchantSet(value: string | undefined): ReadonlySet<string> {
  if (value === undefined || value.trim() === "") return new Set();
  const merchants = value.split(",").map((entry) => MerchantIdSchema.parse(entry.trim()));
  if (merchants.length > 20) throw new Error("merchant kill switch list exceeds 20 merchants");
  return new Set(merchants);
}

const ALLOWED_DATABASE_QUERY_PARAMETERS = new Set(["sslmode", "application_name"]);

function parseDatabaseUrl(
  value: string | undefined,
  nodeEnvironment: IngestionEnvironment["nodeEnvironment"]
): string | undefined {
  if (value === undefined) return undefined;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("DATABASE_URL must be a PostgreSQL URL");
  }
  if (!new Set(["postgres:", "postgresql:"]).has(url.protocol) || url.hostname === "") {
    throw new Error("DATABASE_URL must be a PostgreSQL URL");
  }
  if (url.hash !== "") throw new Error("DATABASE_URL fragment is not supported");
  const keys = [...url.searchParams.keys()];
  if (keys.some((key) => !ALLOWED_DATABASE_QUERY_PARAMETERS.has(key))) {
    throw new Error("DATABASE_URL contains an unsupported query parameter");
  }
  if (new Set(keys).size !== keys.length) {
    throw new Error("DATABASE_URL contains a duplicate query parameter");
  }
  const applicationName = url.searchParams.get("application_name");
  if (applicationName !== null && (
    applicationName.length === 0 ||
    applicationName.length > 64 ||
    [...applicationName].some((character) => {
      const code = character.charCodeAt(0);
      return code <= 31 || code === 127;
    })
  )) {
    throw new Error("DATABASE_URL application_name is invalid");
  }
  if (nodeEnvironment === "production") {
    const password = url.password === "" ? undefined : decodeURIComponent(url.password);
    if (password === undefined || password.length === 0) {
      throw new Error("production PostgreSQL password is required");
    }
    if (url.searchParams.get("sslmode") !== "verify-full") {
      throw new Error("production PostgreSQL must use sslmode=verify-full");
    }
  }
  return value;
}

function parseRedisUrl(
  value: string | undefined,
  nodeEnvironment: IngestionEnvironment["nodeEnvironment"]
): IngestionEnvironment["redis"] {
  if (value === undefined) return undefined;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("REDIS_URL must be a Redis URL");
  }
  if (!new Set(["redis:", "rediss:"]).has(url.protocol) || url.hostname === "") {
    throw new Error("REDIS_URL must be a Redis URL");
  }
  if (url.search !== "" || url.hash !== "") throw new Error("REDIS_URL query and fragment are not supported");
  const port = url.port === "" ? (url.protocol === "rediss:" ? 6380 : 6379) : Number(url.port);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("REDIS_URL port is invalid");
  const databaseText = url.pathname === "" || url.pathname === "/" ? "0" : url.pathname.slice(1);
  if (!/^\d{1,2}$/u.test(databaseText)) throw new Error("REDIS_URL database is invalid");
  const database = Number(databaseText);
  if (database > 15) throw new Error("REDIS_URL database must be from 0 through 15");
  const username = url.username === "" ? undefined : decodeURIComponent(url.username);
  const password = url.password === "" ? undefined : decodeURIComponent(url.password);
  if (nodeEnvironment === "production") {
    if (url.protocol !== "rediss:") throw new Error("production Redis must use TLS rediss://");
    if (password === undefined || password.length === 0) {
      throw new Error("production Redis authentication password is required");
    }
  }
  return {
    tls: url.protocol === "rediss:",
    host: url.hostname,
    port,
    database,
    ...(username === undefined ? {} : { username }),
    ...(password === undefined ? {} : { password })
  };
}

export function parseIngestionEnvironment(input: EnvironmentInput): IngestionEnvironment {
  const nodeEnvironment = NodeEnvironmentSchema.parse(input.NODE_ENV ?? "development");
  const databaseUrl = parseDatabaseUrl(input.DATABASE_URL, nodeEnvironment);
  const redis = parseRedisUrl(input.REDIS_URL, nodeEnvironment);
  return {
    nodeEnvironment,
    ...(databaseUrl === undefined ? {} : { databaseUrl }),
    ...(redis === undefined ? {} : { redis }),
    minimumEnabledMerchants: parseInteger(
      input.MERCHANT_MINIMUM_ENABLED,
      0,
      "MERCHANT_MINIMUM_ENABLED",
      0,
      20
    ),
    globalKillSwitch: parseBoolean(
      input.INGESTION_GLOBAL_KILL_SWITCH,
      false,
      "INGESTION_GLOBAL_KILL_SWITCH"
    ),
    merchantKillSwitches: parseMerchantSet(input.INGESTION_MERCHANT_KILL_SWITCHES),
    circuitFailureThreshold: parseInteger(
      input.INGESTION_CIRCUIT_FAILURE_THRESHOLD,
      5,
      "INGESTION_CIRCUIT_FAILURE_THRESHOLD",
      1,
      100
    ),
    circuitResetMs: parseInteger(
      input.INGESTION_CIRCUIT_RESET_MS,
      60_000,
      "INGESTION_CIRCUIT_RESET_MS",
      1_000,
      3_600_000
    )
  };
}

export function redisConnectionOptions(environment: IngestionEnvironment): ConnectionOptions {
  if (environment.redis === undefined) throw new Error("REDIS_URL is required when merchants are enabled");
  return {
    host: environment.redis.host,
    port: environment.redis.port,
    db: environment.redis.database,
    ...(environment.redis.username === undefined ? {} : { username: environment.redis.username }),
    ...(environment.redis.password === undefined ? {} : { password: environment.redis.password }),
    ...(environment.redis.tls ? { tls: {} } : {}),
    maxRetriesPerRequest: null
  };
}
