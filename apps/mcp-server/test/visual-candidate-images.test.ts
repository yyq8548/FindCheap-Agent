import { describe, expect, it, vi } from "vitest";

import { createVisualCandidateImagePort } from "../src/visual-candidate-images.js";

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

  it("rejects non-HTTPS URLs before network access", async () => {
    const fetchImage = vi.fn();
    const port = createVisualCandidateImagePort(fetchImage);

    await expect(port.load("http://cdn.example.test/item.jpg"))
      .rejects.toThrow("VISUAL_CANDIDATE_IMAGE_UNAVAILABLE");
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

    await expect(oversized.load("https://cdn.example.test/item.jpg")).rejects.toThrow();
    await expect(unsupported.load("https://cdn.example.test/item.jpg")).rejects.toThrow();
    await expect(redirected.load("https://cdn.example.test/item.jpg")).rejects.toThrow();
  });
});
