const ALLOWED_DATABASE_QUERY_PARAMETERS = new Set(["sslmode", "application_name", "uselibpqcompat"]);

export function parseDatabaseUrl(
  value: string | undefined,
  nodeEnvironment: "development" | "test" | "production",
  options: { allowRailwayPrivateRequire?: boolean } = {}
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
  const libpqCompatibility = url.searchParams.get("uselibpqcompat");
  if (libpqCompatibility !== null && libpqCompatibility !== "true") {
    throw new Error("DATABASE_URL uselibpqcompat must be true when supplied");
  }
  if (nodeEnvironment === "production") {
    const password = url.password === "" ? undefined : decodeURIComponent(url.password);
    if (password === undefined || password.length === 0) {
      throw new Error("production PostgreSQL password is required");
    }
    const railwayPrivateRequire = options.allowRailwayPrivateRequire === true &&
      url.hostname.endsWith(".railway.internal") && url.searchParams.get("sslmode") === "require" &&
      libpqCompatibility === "true";
    if (url.searchParams.get("sslmode") !== "verify-full" && !railwayPrivateRequire) {
      throw new Error("production PostgreSQL must use sslmode=verify-full");
    }
  }
  return value;
}
