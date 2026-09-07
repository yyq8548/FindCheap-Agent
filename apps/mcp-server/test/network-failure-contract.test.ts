import { describe, expect, it } from "vitest";
import { safeFetch } from "../../../packages/network-safety/src/safe-fetch.js";
import { classifySourceFailure } from "../src/source-failure.js";

const publicAddress = { address: "93.184.216.34", family: 4 };
const target = { url: "https://shop.example/private?token=secret" };
const fail = (code: string) => Object.assign(new Error("private URL and secret body"), { code });

describe("safe transport to source failure contract", () => {
  it.each([
    ["DNS", "EAI_AGAIN", "CONNECTION_FAILED", true],
    ["DNS", "ENOTFOUND", "CONNECTION_FAILED", false],
    ["REQUEST", "ECONNRESET", "CONNECTION_FAILED", true],
    ["REQUEST", "ETIMEDOUT", "TIMEOUT", true],
    ["REQUEST", "CERT_HAS_EXPIRED", "SECURITY_REJECTED", false],
    ["BODY", "ECONNRESET", "CONNECTION_FAILED", true],
    ["REQUEST", "PRIVATE_ARBITRARY_CODE", "UNKNOWN", false]
  ] as const)("classifies %s %s without private details", async (phase, code, kind, retryable) => {
    let observed: unknown;
    try {
      await safeFetch(target, { allowedHosts: ["shop.example"],
        resolve: async () => { if (phase === "DNS") throw fail(code); return [publicAddress]; },
        request: async () => {
          if (phase === "REQUEST") throw fail(code);
          return new Response(new ReadableStream({ start(controller) { controller.error(fail(code)); } }));
        } });
    } catch (error) { observed = classifySourceFailure("OFFICIAL", error); }
    expect(observed).toEqual({ source: "OFFICIAL", kind, retryable, phase });
    expect(JSON.stringify(observed)).not.toMatch(/private|token|secret|ARBITRARY/iu);
  });

  it("does not let a transient-looking cause override a real target denial", async () => {
    for (const address of ["127.0.0.1", "10.0.0.1"]) {
      try {
        await safeFetch(target, { allowedHosts: ["shop.example"], resolve: async () => [{ address, family: 4 }] });
        expect.fail("must reject private address");
      } catch (error) {
        expect(classifySourceFailure("OFFICIAL", error)).toMatchObject({ kind: "SECURITY_REJECTED", retryable: false });
      }
    }
    expect(classifySourceFailure("OFFICIAL", new Error("redirect blocked host", { cause: fail("ECONNRESET") })))
      .toMatchObject({ kind: "SECURITY_REJECTED", retryable: false });
  });
});
