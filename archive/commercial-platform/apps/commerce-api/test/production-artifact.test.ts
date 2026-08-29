import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../../..", import.meta.url));

describe("Commerce production artifact", () => {
  it("declares every external runtime import as a production dependency", async () => {
    const packageJson = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8")
    ) as { dependencies?: Record<string, string> };
    expect(packageJson.dependencies).toMatchObject({ yaml: expect.any(String) });
  });

  it("excludes environment files and common credential material from Docker context", async () => {
    const rules = (await readFile(`${root}/.dockerignore`, "utf8"))
      .split(/\r?\n/u)
      .filter((line) => line !== "");
    expect(rules).toEqual(expect.arrayContaining([
      ".env",
      ".env.*",
      "!.env.example",
      "*.pem",
      "*.key",
      "*.p12",
      "*.pfx",
      "credentials*",
      "secrets*"
    ]));
  });
});
