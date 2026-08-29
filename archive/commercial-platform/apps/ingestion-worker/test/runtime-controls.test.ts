import { describe, expect, it } from "vitest";

import { createRuntimeControls } from "../src/runtime/controls.js";

describe("ingestion runtime controls", () => {
  it("reads kill switches live without enabling merchants outside the approved registry", () => {
    let environment: Record<string, string | undefined> = {};
    const controls = createRuntimeControls({
      enabledMerchantIds: ["merchant-a"],
      environment: () => environment,
      circuitFailureThreshold: 2,
      circuitResetMs: 60_000,
      clock: { now: () => new Date("2026-08-13T20:00:00.000Z") }
    });

    expect(controls.flags.isMerchantEnabled("merchant-a")).toBe(true);
    expect(controls.flags.isMerchantEnabled("merchant-b")).toBe(false);
    expect(controls.killSwitch.isActive("merchant-a")).toBe(false);

    environment = { INGESTION_MERCHANT_KILL_SWITCHES: "merchant-a" };
    expect(controls.killSwitch.isActive("merchant-a")).toBe(true);
    environment = { INGESTION_GLOBAL_KILL_SWITCH: "true" };
    expect(controls.killSwitch.isActive("merchant-a")).toBe(true);
  });

  it("opens after bounded consecutive failures and resets after the configured interval", () => {
    let now = new Date("2026-08-13T20:00:00.000Z");
    const controls = createRuntimeControls({
      enabledMerchantIds: ["merchant-a"],
      environment: () => ({}),
      circuitFailureThreshold: 2,
      circuitResetMs: 60_000,
      clock: { now: () => now }
    });

    controls.circuitBreaker.recordFailure("merchant-a");
    expect(controls.circuitBreaker.isOpen("merchant-a")).toBe(false);
    controls.circuitBreaker.recordFailure("merchant-a");
    expect(controls.circuitBreaker.isOpen("merchant-a")).toBe(true);
    expect(controls.circuitBreaker.openMerchantIds()).toEqual(["merchant-a"]);

    now = new Date("2026-08-13T20:01:00.000Z");
    expect(controls.circuitBreaker.isOpen("merchant-a")).toBe(false);
    controls.circuitBreaker.recordFailure("merchant-a");
    controls.circuitBreaker.recordSuccess("merchant-a");
    expect(controls.circuitBreaker.isOpen("merchant-a")).toBe(false);
  });
});
