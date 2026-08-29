import { describe, expect, it } from "vitest";

import { parseProductIdentityBackfillArgs } from "./backfill-product-identity-keys.js";

describe("product identity backfill CLI", () => {
  it("defaults to a dry run", () => {
    expect(parseProductIdentityBackfillArgs([])).toEqual({ apply: false, batchSize: 100 });
  });

  it("requires an explicit apply flag and validates bounded batch sizes", () => {
    expect(parseProductIdentityBackfillArgs(["--", "--apply", "--batch-size", "7"])).toEqual({
      apply: true,
      batchSize: 7
    });
    expect(() => parseProductIdentityBackfillArgs(["--batch-size", "0"])).toThrow(/between 1 and 1000/i);
    expect(() => parseProductIdentityBackfillArgs(["--wat"])).toThrow(/unknown argument/i);
  });
});
