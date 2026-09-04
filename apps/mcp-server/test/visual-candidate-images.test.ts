import { describe, expect, it, vi } from "vitest";

import {
  VisualCandidateImageError,
  createVisualCandidateImagePort
} from "../src/visual-candidate-images.js";

describe("visual candidate image loader", () => {
  it("loads a bounded public image and pins the exact source host", async () => {
    const fetchImage = vi.fn(async () => ({
      response: new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { "content-type": "image/jpeg", "content-length": "3" }
      }),
      finalUrl: "https://cdn.example.test/item.jpg"
    }));
    const port = createVisualCandidateImagePort(fetchImage);

    await expect(port.load("https://cdn.example.test/item.jpg")).resolves.toEqual({
      data: "AQID",
      mimeType: "image/jpeg"
    });
    expect(fetchImage).toHaveBeenCalledWith(
      { url: "https://cdn.example.test/item.jpg" },
      { allowedHosts: ["cdn.example.test"] }
    );
  });

  it("requests a bounded Shopify rendition before embedding candidate media", async () => {
    const fetchImage = vi.fn(async (input: { url: string }) => ({
      response: new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { "content-type": "image/jpeg", "content-length": "3" }
      }),
      finalUrl: input.url
    }));
    const port = createVisualCandidateImagePort(fetchImage);

    await expect(port.load("https://cdn.shopify.com/s/files/1/product.jpg?variant=1")).resolves.toMatchObject({
      mimeType: "image/jpeg"
    });
    expect(fetchImage).toHaveBeenCalledWith(
      { url: "https://cdn.shopify.com/s/files/1/product.jpg?variant=1&width=512" },
      { allowedHosts: ["cdn.shopify.com"] }
    );
  });

  it("allows only the known Shopify storefront CDN redirect", async () => {
    const fetchImage = vi.fn(async (_input: { url: string }, _policy: { allowedHosts: readonly string[] }) => ({
      response: new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { "content-type": "image/webp", "content-length": "3" }
      }),
      finalUrl: "https://cdn.shopify.com/s/files/1/product.webp"
    }));
    const port = createVisualCandidateImagePort(fetchImage);

    await expect(port.load("https://brand.example/cdn/shop/files/product.jpg#ignored"))
      .resolves.toMatchObject({ mimeType: "image/webp" });
    expect(fetchImage).toHaveBeenCalledWith(
      { url: "https://brand.example/cdn/shop/files/product.jpg" },
      { allowedHosts: ["brand.example", "cdn.shopify.com"] }
    );
  });

  it("rejects non-HTTPS URLs before network access", async () => {
    const fetchImage = vi.fn();
    const port = createVisualCandidateImagePort(fetchImage);

    await expect(port.load("http://cdn.example.test/item.jpg"))
      .rejects.toMatchObject({ code: "UNSAFE_URL", sourceHost: "cdn.example.test" });
    expect(fetchImage).not.toHaveBeenCalled();
  });

  it("rejects oversized, unsupported, and cross-host responses", async () => {
    const oversized = createVisualCandidateImagePort(async () => ({
      response: new Response(new Uint8Array([1]), {
        status: 200,
        headers: { "content-type": "image/jpeg", "content-length": "1500001" }
      }),
      finalUrl: "https://cdn.example.test/item.jpg"
    }));
    const unsupported = createVisualCandidateImagePort(async () => ({
      response: new Response(new Uint8Array([1]), {
        status: 200,
        headers: { "content-type": "image/svg+xml" }
      }),
      finalUrl: "https://cdn.example.test/item.jpg"
    }));
    const redirected = createVisualCandidateImagePort(async () => ({
      response: new Response(new Uint8Array([1]), {
        status: 200,
        headers: { "content-type": "image/png" }
      }),
      finalUrl: "https://other.example.test/item.png"
    }));

    await expect(oversized.load("https://cdn.example.test/item.jpg"))
      .rejects.toMatchObject({ code: "RESPONSE_TOO_LARGE", sourceHost: "cdn.example.test" });
    await expect(unsupported.load("https://cdn.example.test/item.jpg"))
      .rejects.toMatchObject({ code: "UNSUPPORTED_CONTENT_TYPE", sourceHost: "cdn.example.test" });
    await expect(redirected.load("https://cdn.example.test/item.jpg"))
      .rejects.toMatchObject({ code: "REDIRECT_NOT_APPROVED", sourceHost: "cdn.example.test" });
  });

  it("uses stable internal failure codes without exposing full URLs", async () => {
    const port = createVisualCandidateImagePort(async () => {
      throw new Error("redirect blocked host: private.example/path?token=secret");
    });

    const failure = await port.load("https://cdn.example.test/item.jpg?token=secret")
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(VisualCandidateImageError);
    expect(failure).toMatchObject({ code: "REDIRECT_NOT_APPROVED", sourceHost: "cdn.example.test" });
    expect(String(failure)).not.toContain("token=secret");
  });
});
