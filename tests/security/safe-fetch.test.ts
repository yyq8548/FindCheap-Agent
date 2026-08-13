import { describe, expect, it, vi } from "vitest";

import {
  MAX_RESPONSE_BYTES,
  safeFetch,
  type FetchPolicy,
  type ResolvedAddress
} from "../../apps/ingestion-worker/src/network/safe-fetch.js";

const publicAddress: ResolvedAddress = { address: "93.184.216.34", family: 4 };

function policy(overrides: Partial<FetchPolicy> = {}): FetchPolicy {
  return {
    allowedHosts: ["shop.example"],
    resolve: vi.fn(async () => [publicAddress]),
    request: vi.fn(async () => new Response("ok", { status: 200 })),
    ...overrides
  };
}

describe("safeFetch", () => {
  it.each([
    "http://127.0.0.1/x",
    "http://169.254.169.254/latest/meta-data",
    "https://unlisted.example/x",
    "not a URL"
  ])("blocks forbidden target %s", async (url) => {
    await expect(safeFetch({ url }, policy())).rejects.toThrow(/blocked/i);
  });

  it.each([
    "0.0.0.0",
    "10.0.0.1",
    "100.64.0.1",
    "127.0.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "192.168.0.1",
    "224.0.0.1",
    "255.255.255.255",
    "::",
    "::1",
    "fc00::1",
    "fe80::1",
    "ff02::1",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1"
  ])("blocks a forbidden DNS result: %s", async (address) => {
    const family = address.includes(":") ? 6 : 4;
    await expect(
      safeFetch(
        { url: "https://shop.example/product" },
        policy({ resolve: async () => [{ address, family }] })
      )
    ).rejects.toThrow(/blocked address/i);
  });

  it("blocks when any DNS answer is forbidden", async () => {
    await expect(
      safeFetch(
        { url: "https://shop.example/product" },
        policy({
          resolve: async () => [publicAddress, { address: "127.0.0.1", family: 4 }]
        })
      )
    ).rejects.toThrow(/blocked address/i);
  });

  it("revalidates DNS on every redirect hop", async () => {
    const resolve = vi
      .fn<NonNullable<FetchPolicy["resolve"]>>()
      .mockResolvedValueOnce([publicAddress])
      .mockResolvedValueOnce([{ address: "169.254.169.254", family: 4 }]);
    const request = vi.fn(async () =>
      new Response(null, { status: 302, headers: { location: "/private" } })
    );

    await expect(
      safeFetch({ url: "https://shop.example/redirect-private" }, policy({ resolve, request }))
    ).rejects.toThrow(/redirect.*blocked address/i);
    expect(resolve).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("blocks a redirect to a host outside the exact normalized allowlist", async () => {
    const request = vi.fn(async () =>
      new Response(null, { status: 302, headers: { location: "https://evil.example/x" } })
    );

    await expect(
      safeFetch({ url: "https://SHOP.EXAMPLE./start" }, policy({ request }))
    ).rejects.toThrow(/redirect.*blocked host/i);
  });

  it("allows at most three redirects", async () => {
    const request = vi.fn(async (url: URL) => {
      const step = Number(url.searchParams.get("step") ?? 0);
      return new Response(null, {
        status: 302,
        headers: { location: `/next?step=${step + 1}` }
      });
    });

    await expect(
      safeFetch({ url: "https://shop.example/start" }, policy({ request }))
    ).rejects.toThrow(/redirect limit/i);
    expect(request).toHaveBeenCalledTimes(4);
  });

  it("rejects malformed or oversized declared content lengths", async () => {
    const malformed = policy({
      request: async () => new Response("x", { headers: { "content-length": "abc" } })
    });
    await expect(safeFetch({ url: "https://shop.example/x" }, malformed)).rejects.toThrow(
      /content-length/i
    );

    const oversized = policy({
      request: async () =>
        new Response(null, { headers: { "content-length": String(MAX_RESPONSE_BYTES + 1) } })
    });
    await expect(safeFetch({ url: "https://shop.example/x" }, oversized)).rejects.toThrow(
      /response too large/i
    );
  });

  it("caps actual streamed bytes even without Content-Length", async () => {
    const chunk = new Uint8Array(2_500_001);
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(chunk);
        controller.enqueue(chunk);
        controller.close();
      }
    });

    await expect(
      safeFetch(
        { url: "https://shop.example/x" },
        policy({ request: async () => new Response(body) })
      )
    ).rejects.toThrow(/response too large/i);
  });

  it("passes the approved DNS set and an 8-second abort signal to the request seam", async () => {
    const request = vi.fn<NonNullable<FetchPolicy["request"]>>(async () => new Response("ok"));
    const response = await safeFetch({ url: "https://shop.example/x" }, policy({ request }));

    expect(await response.text()).toBe("ok");
    expect(request).toHaveBeenCalledWith(
      new URL("https://shop.example/x"),
      expect.objectContaining({ redirect: "manual", signal: expect.any(AbortSignal) }),
      [publicAddress]
    );
    const call = request.mock.calls[0];
    expect(call).toBeDefined();
    expect(call?.[1].signal).not.toBeUndefined();
  });

  it("fails closed on DNS errors and empty DNS results", async () => {
    await expect(
      safeFetch(
        { url: "https://shop.example/x" },
        policy({ resolve: async () => Promise.reject(new Error("dns unavailable")) })
      )
    ).rejects.toThrow(/dns/i);

    await expect(
      safeFetch(
        { url: "https://shop.example/x" },
        policy({ resolve: async () => [] })
      )
    ).rejects.toThrow(/dns/i);
  });
});
