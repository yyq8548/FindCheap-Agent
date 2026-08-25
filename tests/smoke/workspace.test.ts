import { describe, expect, it } from "vitest";

describe("workspace", () => {
  it("runs tests under Node 24", () => {
    expect(Number(process.versions.node.split(".")[0])).toBe(24);
  });
});
