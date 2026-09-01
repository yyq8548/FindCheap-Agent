import { EventEmitter } from "node:events";
import type { ClientRequest, IncomingMessage, RequestOptions } from "node:http";
import type { request as NodeHttpsRequest } from "node:https";
import { PassThrough } from "node:stream";

import { describe, expect, it, vi } from "vitest";

import {
  MAX_RESPONSE_BYTES,
  createPinnedRequest,
  safeFetch,
  safeFetchWithProvenance,
  type FetchPolicy,
  type ResolvedAddress
} from "../../packages/network-safety/src/safe-fetch.js";

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
  it("returns the canonical validated final URL after multiple redirects", async () => {
    const request = vi.fn(async (url: URL) => {
      if (url.pathname === "/start") {
        return new Response(null, {
          status: 302,
          headers: { location: "https://SHOP.EXAMPLE./middle" }
        });
      }
      if (url.pathname === "/middle") {
        return new Response(null, {
          status: 307,
          headers: { location: "/final?q=1#not-sent" }
        });
      }
      return new Response("final", { status: 200 });
    });

    const result = await safeFetchWithProvenance(
      { url: "https://shop.example/start#caller-fragment" },
      policy({ request })
    );

    expect(result.finalUrl).toBe("https://shop.example/final?q=1");
    await expect(result.response.text()).resolves.toBe("final");
    expect(request).toHaveBeenCalledTimes(3);
  });

  it.each([
    "http://127.0.0.1/x",
    "http://169.254.169.254/latest/meta-data",
    "https://unlisted.example/x",
    "https://shop.example:444/x",
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
    "::ffff:7f00:1",
    "::127.0.0.1",
    "64:ff9b::7f00:1",
    "64:ff9b:1::7f00:1",
    "100::1",
    "2001::1",
    "2001:2::1",
    "2001:10::1",
    "2001:1::4",
    "2001:100::1",
    "2001:db8::1",
    "2002:7f00:1::1",
    "2420::1",
    "2612::1",
    "2640::1",
    "2a20::1",
    "2c10::1",
    "2d00::1",
    "3000::1",
    "3ffe::1",
    "3fff::1"
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

  it.each([
    "8.8.8.8",
    "198.51.1.1",
    "2001:1::1",
    "2001:1::2",
    "2001:1::3",
    "2001:3::1",
    "2001:4:112::1",
    "2001:20::1",
    "2001:30::1",
    "2001:4860:4860::8888",
    "2001:200::1",
    "2001:800::1",
    "2001:2000::1",
    "2003::1",
    "2400::1",
    "240f:ffff::1",
    "2410::1",
    "241f:ffff::1",
    "2600::1",
    "260f:ffff::1",
    "2610::1",
    "2620::1",
    "2630::1",
    "263f:ffff::1",
    "2800::1",
    "2a00::1",
    "2a10::1",
    "2c00::1",
    "::ffff:8.8.8.8"
  ])(
    "allows a public/global DNS result: %s",
    async (address) => {
      const response = await safeFetch(
        { url: "https://shop.example/product" },
        policy({
          resolve: async () => [{ address, family: address.includes(":") ? 6 : 4 }]
        })
      );
      expect(await response.text()).toBe("ok");
    }
  );

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

  it("blocks a redirect to a non-443 port", async () => {
    const request = vi.fn(async () =>
      new Response(null, {
        status: 302,
        headers: { location: "https://shop.example:8443/x" }
      })
    );

    await expect(
      safeFetch({ url: "https://shop.example/start" }, policy({ request }))
    ).rejects.toThrow(/redirect.*blocked port/i);
    expect(request).toHaveBeenCalledTimes(1);
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

  it("cancels the response body when Content-Length validation fails", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      }
    });

    await expect(
      safeFetch(
        { url: "https://shop.example/x" },
        policy({
          request: async () =>
            new Response(body, { headers: { "content-length": "not-a-number" } })
        })
      )
    ).rejects.toThrow(/content-length/i);
    expect(cancelled).toBe(true);
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

  it("pins the default HTTPS transport lookup to a prevalidated address", async () => {
    let captured: RequestOptions | undefined;
    const requestImpl = ((options: RequestOptions, callback: (message: IncomingMessage) => void) => {
      captured = options;
      const emitter = new EventEmitter();
      const request = Object.assign(emitter, {
        destroy: vi.fn(),
        end() {
          const message = new PassThrough() as PassThrough & {
            statusCode: number;
            statusMessage: string;
            headers: IncomingMessage["headers"];
          };
          message.statusCode = 200;
          message.statusMessage = "OK";
          message.headers = { "content-type": "text/plain" };
          callback(message as unknown as IncomingMessage);
          message.end("pinned");
        }
      });
      return request as unknown as ClientRequest;
    }) as unknown as typeof NodeHttpsRequest;

    const pinnedRequest = createPinnedRequest(requestImpl);
    const response = await pinnedRequest(
      new URL("https://shop.example/product?q=1"),
      { redirect: "manual", signal: AbortSignal.timeout(8_000) },
      [publicAddress]
    );

    expect(await response.text()).toBe("pinned");
    expect(captured).toMatchObject({
      hostname: "shop.example",
      port: 443,
      path: "/product?q=1",
      servername: "shop.example",
      agent: false,
      headers: expect.objectContaining({
        "user-agent": "FindCheap-Agent/0.15.7 (+https://github.com/yyq8548/FindCheap-Agent)"
      })
    });
    expect(captured?.lookup).toBeTypeOf("function");

    const lookupResult = await new Promise<{ address: string; family: number }>((resolve, reject) => {
      captured?.lookup?.("shop.example", { family: 0 }, (error, address, family) => {
        if (error) reject(error);
        else if (typeof address === "string") resolve({ address, family: family ?? 0 });
        else reject(new Error("expected one pinned address"));
      });
    });
    expect(lookupResult).toEqual(publicAddress);
  });
});
