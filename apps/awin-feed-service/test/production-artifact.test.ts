import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Awin Feed production artifact", () => {
  it("uses a CommonJS bundle so pg runtime imports remain available", async () => {
    const packageJson = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8")
    ) as { scripts: Record<string, string>; dependencies: Record<string, string> };
    const dockerfile = await readFile(
      new URL("../../../infra/docker/awin-feed-service.Dockerfile", import.meta.url),
      "utf8"
    );

    expect(packageJson.scripts.build).toContain("--format=cjs");
    expect(packageJson.scripts.build).toContain("dist/main.cjs");
    expect(packageJson.dependencies.pg).toBeDefined();
    expect(dockerfile).toContain("dist/main.cjs");
    expect(dockerfile).not.toContain("dist/main.js");
  });
});
