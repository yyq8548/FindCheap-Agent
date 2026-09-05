import { describe, expect, it, vi } from "vitest";
import jpeg from "jpeg-js";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Worker } from "node:worker_threads";

import {
  VisualCandidateImageError,
  createVisualCandidateImagePort
} from "../src/visual-candidate-images.js";
import { safeFetchWithProvenance } from "../../../packages/network-safety/src/safe-fetch.js";

const smallJpeg = jpeg.encode({ width: 1, height: 1, data: new Uint8Array([10, 20, 30, 255]) }, 75).data;
const smallLossyWebp = Buffer.from("UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA", "base64");
const smallLosslessWebp = Buffer.from("UklGRh4AAABXRUJQVlA4TBEAAAAvAAAAAAfQ//73v/+BiOh/AAA=", "base64");
const png = createRequire(import.meta.url)("pngjs") as {
  PNG: { sync: { write(image: { width: number; height: number; data: Uint8Array }): Buffer } };
};

function withExifOrientation(bytes: Uint8Array, orientation: number, bigEndian = false): Buffer {
  const app1 = Buffer.alloc(36);
  app1.writeUInt16BE(0xffe1, 0);
  app1.writeUInt16BE(34, 2);
  app1.write("Exif\0\0", 4, "latin1");
  app1.write(bigEndian ? "MM" : "II", 10, "ascii");
  const short = (value: number, offset: number) => bigEndian ? app1.writeUInt16BE(value, offset) : app1.writeUInt16LE(value, offset);
  const long = (value: number, offset: number) => bigEndian ? app1.writeUInt32BE(value, offset) : app1.writeUInt32LE(value, offset);
  short(42, 12); long(8, 14); short(1, 18);
  short(0x0112, 20); short(3, 22); long(1, 24); short(orientation, 28);
  return Buffer.concat([bytes.subarray(0, 2), app1, bytes.subarray(2)]);
}

describe("visual candidate image loader", () => {
  it("loads a bounded public image and pins the exact source host", async () => {
    const fetchImage = vi.fn(async () => ({
      response: new Response(Uint8Array.from(smallJpeg), {
        status: 200,
        headers: { "content-type": "image/jpeg", "content-length": String(smallJpeg.length) }
      }),
      finalUrl: "https://cdn.example.test/item.jpg"
    }));
    const port = createVisualCandidateImagePort(fetchImage);

    await expect(port.load("https://cdn.example.test/item.jpg")).resolves.toEqual({
      data: Buffer.from(smallJpeg).toString("base64"),
      mimeType: "image/jpeg",
      sourceContentSha256: createHash("sha256").update(smallJpeg).digest("hex")
    });
    expect(fetchImage).toHaveBeenCalledWith(
      { url: "https://cdn.example.test/item.jpg" },
      { allowedHosts: ["cdn.example.test"], maxResponseBytes: 1_500_000 }
    );
  });

  it("preserves source-content identity when round budgets produce different real JPEG outputs", async () => {
    const data = Buffer.alloc(512 * 512 * 4);
    let seed = 17;
    for (let offset = 0; offset < data.length; offset += 4) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      data[offset] = seed & 255; data[offset + 1] = (seed >>> 8) & 255;
      data[offset + 2] = (seed >>> 16) & 255; data[offset + 3] = 255;
    }
    const bytes = jpeg.encode({ data, width: 512, height: 512 }, 85).data;
    const port = createVisualCandidateImagePort(async (request) => ({
      response: new Response(Uint8Array.from(bytes), { headers: { "content-type": "image/jpeg" } }), finalUrl: request.url
    }));
    const first = await port.load("https://example.test/same.jpg?v=first", { maxDataChars: 66_666 });
    const second = await port.load("https://example.test/same.jpg?v=second", { maxDataChars: 133_333 });
    expect(first.data).not.toBe(second.data);
    expect(first.data.length).toBeLessThanOrEqual(66_666);
    expect(second.data.length).toBeLessThanOrEqual(133_333);
    const sourceHash = createHash("sha256").update(bytes).digest("hex");
    expect(first.sourceContentSha256).toBe(sourceHash);
    expect(second.sourceContentSha256).toBe(sourceHash);
    expect(createHash("sha256").update(Buffer.from(first.data, "base64")).digest("hex")).not.toBe(sourceHash);
  });

  it("hashes the bounded downloaded PNG and WebP bodies as source content", async () => {
    const pngBytes = png.PNG.sync.write({ width: 1, height: 1, data: new Uint8Array([10, 20, 30, 255]) });
    for (const [contentType, bytes] of [["image/png", pngBytes], ["image/webp", smallLosslessWebp]] as const) {
      const port = createVisualCandidateImagePort(async (request) => ({
        response: new Response(Uint8Array.from(bytes), { headers: { "content-type": contentType } }), finalUrl: request.url
      }));
      const image = await port.load("https://example.test/image");
      expect(image.sourceContentSha256).toBe(createHash("sha256").update(bytes).digest("hex"));
    }
  });

  it("requests a bounded Shopify rendition before embedding candidate media", async () => {
    const fetchImage = vi.fn(async (input: { url: string }) => ({
      response: new Response(Uint8Array.from(smallJpeg), {
        status: 200,
        headers: { "content-type": "image/jpeg", "content-length": String(smallJpeg.length) }
      }),
      finalUrl: input.url
    }));
    const port = createVisualCandidateImagePort(fetchImage);

    await expect(port.load("https://cdn.shopify.com/s/files/1/product.jpg?variant=1")).resolves.toMatchObject({
      mimeType: "image/jpeg"
    });
    expect(fetchImage).toHaveBeenCalledWith(
      { url: "https://cdn.shopify.com/s/files/1/product.jpg?variant=1&width=512" },
      { allowedHosts: ["cdn.shopify.com"], maxResponseBytes: 1_500_000 }
    );
  });

  it("allows only the known Shopify storefront CDN redirect", async () => {
    const fetchImage = vi.fn(async (_input: { url: string }, _policy: { allowedHosts: readonly string[] }) => ({
      response: new Response(Uint8Array.from(smallLosslessWebp), {
        status: 200,
        headers: { "content-type": "image/webp", "content-length": String(smallLosslessWebp.length) }
      }),
      finalUrl: "https://cdn.shopify.com/s/files/1/product.webp"
    }));
    const port = createVisualCandidateImagePort(fetchImage);

    await expect(port.load("https://brand.example/cdn/shop/files/product.jpg#ignored"))
      .resolves.toMatchObject({ mimeType: "image/webp" });
    expect(fetchImage).toHaveBeenCalledWith(
      { url: "https://brand.example/cdn/shop/files/product.jpg?width=512" },
      { allowedHosts: ["brand.example", "cdn.shopify.com"], maxResponseBytes: 1_500_000 }
    );
  });

  it("stops oversized chunked images at the safe transport's 1.5MB boundary", async () => {
    const cancelled = vi.fn();
    const transport = vi.fn(async () => new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        for (let index = 0; index < 4; index += 1) controller.enqueue(new Uint8Array(500_000));
      }, cancel: cancelled
    }), { headers: { "content-type": "image/jpeg" } }));
    const port = createVisualCandidateImagePort((input, policy) => safeFetchWithProvenance(input, {
      ...policy, resolve: async () => [{ address: "93.184.216.34", family: 4 }], request: transport
    }));
    await expect(port.load("https://merchant.example/photo.jpg")).rejects.toMatchObject({ code: "RESPONSE_TOO_LARGE" });
    expect(cancelled).toHaveBeenCalledTimes(1);
  });

  it("validates simple lossy, lossless, and extended WebP dimensions", async () => {
    const extended = Buffer.concat([smallLosslessWebp.subarray(0, 12), Buffer.from("565038580a00000000000000000000000000", "hex"), smallLosslessWebp.subarray(12)]);
    extended.writeUInt32LE(extended.length - 8, 4);
    for (const bytes of [smallLossyWebp, smallLosslessWebp, extended]) {
      const port = createVisualCandidateImagePort(async (input) => ({
        response: new Response(Uint8Array.from(bytes), { headers: { "content-type": "image/webp" } }), finalUrl: input.url
      }));
      await expect(port.load("https://merchant.example/photo.webp")).resolves.toMatchObject({ mimeType: "image/webp" });
    }
  });

  it("rejects malformed or oversized WebP bitstream and canvas dimensions", async () => {
    const lossyBomb = Buffer.from(smallLossyWebp);
    lossyBomb.writeUInt16LE(8_193, 26);
    const losslessBomb = Buffer.from(smallLosslessWebp);
    losslessBomb.writeUInt32LE(4_000 | (4_000 << 14), 21);
    const extended = Buffer.concat([smallLosslessWebp.subarray(0, 12), Buffer.from("565038580a00000000000000000000000000", "hex"), smallLosslessWebp.subarray(12)]);
    extended.writeUInt32LE(extended.length - 8, 4);
    extended.writeUIntLE(8_192, 24, 3);
    for (const bytes of [lossyBomb, losslessBomb, extended]) {
      const port = createVisualCandidateImagePort(async (input) => ({
        response: new Response(Uint8Array.from(bytes), { headers: { "content-type": "image/webp" } }), finalUrl: input.url
      }));
      await expect(port.load("https://merchant.example/photo.webp")).rejects.toMatchObject({ code: "IMAGE_PIXEL_LIMIT_EXCEEDED" });
    }
    const invalidSignature = Buffer.from(smallLosslessWebp);
    invalidSignature[0] = 0xd2;
    const invalidVersion = Buffer.from(smallLosslessWebp);
    invalidVersion.writeUInt32LE(0xe0000000, 21);
    for (const bytes of [new Uint8Array([1, 2, 3]), smallLosslessWebp.subarray(0, 28), invalidSignature, invalidVersion]) {
      const port = createVisualCandidateImagePort(async (input) => ({
        response: new Response(Uint8Array.from(bytes), { headers: { "content-type": "image/webp" } }), finalUrl: input.url
      }));
      await expect(port.load("https://merchant.example/photo.webp")).rejects.toMatchObject({ code: "IMAGE_PROCESSING_FAILED" });
    }
  });

  it("caps custom Shopify storefront renditions without changing unrelated hosts", async () => {
    const fetchImage = vi.fn(async (input: { url: string }) => ({
      response: new Response(Uint8Array.from(smallJpeg), { headers: { "content-type": "image/jpeg" } }),
      finalUrl: input.url
    }));
    const port = createVisualCandidateImagePort(fetchImage);
    await port.load("https://brand.example/cdn/shop/products/dress.jpg?width=2048&v=1");
    await port.load("https://other.example/photos/dress.jpg?width=2048");
    expect(fetchImage.mock.calls.map(([input]) => input.url)).toEqual([
      "https://brand.example/cdn/shop/products/dress.jpg?width=512&v=1",
      "https://other.example/photos/dress.jpg?width=2048"
    ]);
  });

  it("enforces the remaining base64 budget before embedding a candidate", async () => {
    const fetchImage = vi.fn(async (input: { url: string }) => ({
      response: new Response(Uint8Array.from(smallJpeg), { headers: { "content-type": "image/jpeg" } }),
      finalUrl: input.url
    }));
    const port = createVisualCandidateImagePort(fetchImage);
    await expect(port.load("https://cdn.example.test/item.jpg", { maxDataChars: 8 }))
      .rejects.toMatchObject({ code: "OUTPUT_BUDGET_EXCEEDED", sourceHost: "cdn.example.test" });
    await expect(port.load("https://cdn.example.test/item.jpg", { maxDataChars: 1_000 }))
      .resolves.toMatchObject({ data: Buffer.from(smallJpeg).toString("base64") });
  });

  it("rejects exhausted output budget before download and cancels oversized declared bodies", async () => {
    const cancelled = vi.fn();
    const fetchImage = vi.fn(async (input: { url: string }) => ({
      response: new Response(new ReadableStream<Uint8Array>({ cancel: cancelled }), {
        headers: { "content-type": "image/webp", "content-length": "7" }
      }),
      finalUrl: input.url
    }));
    const port = createVisualCandidateImagePort(fetchImage);
    await expect(port.load("https://cdn.example.test/item.jpg", { maxDataChars: 3 }))
      .rejects.toMatchObject({ code: "OUTPUT_BUDGET_EXCEEDED" });
    expect(fetchImage).not.toHaveBeenCalled();
    await expect(port.load("https://cdn.example.test/item.jpg", { maxDataChars: 8 }))
      .rejects.toMatchObject({ code: "IMAGE_TRANSFORM_UNSUPPORTED" });
    expect(cancelled).toHaveBeenCalledTimes(1);
  });

  it("resizes a real non-CDN JPEG into the bounded visual payload", async () => {
    const pixels = new Uint8Array(640 * 640 * 4);
    let seed = 42;
    for (let index = 0; index < pixels.length; index += 1) {
      seed = (seed * 1_664_525 + 1_013_904_223) >>> 0;
      pixels[index] = index % 4 === 3 ? 255 : seed >>> 24;
    }
    const original = jpeg.encode({ width: 640, height: 640, data: pixels }, 90).data;
    const port = createVisualCandidateImagePort(async (input) => ({
      response: new Response(Uint8Array.from(original), { headers: { "content-type": "image/jpeg" } }), finalUrl: input.url
    }));
    const image = await port.load("https://merchant.example/photo.jpg", { maxDataChars: 80_000 });
    expect(original.length).toBeGreaterThan(60_000);
    expect(image.data.length).toBeLessThanOrEqual(80_000);
    expect(image.mimeType).toBe("image/jpeg");
    const resized = jpeg.decode(Buffer.from(image.data, "base64"));
    expect(resized.width).toBeLessThanOrEqual(512);
    expect(resized.height).toBeLessThanOrEqual(512);
  });

  it("preserves all eight EXIF orientations when resizing a real JPEG", async () => {
    const colors = [[240, 20, 20], [20, 240, 20], [20, 20, 240], [240, 240, 20]];
    const pixels = Buffer.alloc(600 * 400 * 4);
    for (let y = 0; y < 400; y += 1) for (let x = 0; x < 600; x += 1) {
      const color = colors[(y < 200 ? 0 : 2) + (x < 300 ? 0 : 1)]!;
      const offset = (y * 600 + x) * 4;
      pixels.set([...color, 255], offset);
    }
    const encoded = jpeg.encode({ width: 600, height: 400, data: pixels }, 90).data;
    const expectedQuadrants = [
      [0, 1, 2, 3], [1, 0, 3, 2], [3, 2, 1, 0], [2, 3, 0, 1],
      [0, 2, 1, 3], [2, 0, 3, 1], [3, 1, 2, 0], [1, 3, 0, 2]
    ];
    for (let orientation = 1; orientation <= 8; orientation += 1) {
      const original = withExifOrientation(encoded, orientation, orientation % 2 === 0);
      const port = createVisualCandidateImagePort(async (input) => ({
        response: new Response(Uint8Array.from(original), { headers: { "content-type": "image/jpeg" } }), finalUrl: input.url
      }));
      const image = await port.load("https://merchant.example/oriented.jpg", { maxDataChars: 80_000 });
      const resized = jpeg.decode(Buffer.from(image.data, "base64"));
      expect([resized.width, resized.height]).toEqual(orientation >= 5 ? [341, 512] : [512, 341]);
      for (let quadrant = 0; quadrant < 4; quadrant += 1) {
        const x = Math.floor(resized.width * (quadrant % 2 === 0 ? 0.25 : 0.75));
        const y = Math.floor(resized.height * (quadrant < 2 ? 0.25 : 0.75));
        const offset = (y * resized.width + x) * 4;
        const expected = colors[expectedQuadrants[orientation - 1]![quadrant]!]!;
        for (let channel = 0; channel < 3; channel += 1) {
          expect(Math.abs(resized.data[offset + channel]! - expected[channel]!)).toBeLessThan(15);
        }
      }
    }
  });

  it("keeps a bounded original EXIF JPEG intact and rejects unsafe orientation metadata", async () => {
    const original = withExifOrientation(smallJpeg, 6);
    const port = (bytes: Uint8Array) => createVisualCandidateImagePort(async (input) => ({
      response: new Response(Uint8Array.from(bytes), { headers: { "content-type": "image/jpeg" } }), finalUrl: input.url
    }));
    await expect(port(original).load("https://merchant.example/original.jpg"))
      .resolves.toMatchObject({ data: original.toString("base64") });
    const invalidOffset = Buffer.from(original);
    invalidOffset.writeUInt32LE(0xfffffff0, 16);
    for (const bytes of [withExifOrientation(smallJpeg, 0), withExifOrientation(smallJpeg, 9), invalidOffset]) {
      await expect(port(bytes).load("https://merchant.example/invalid-exif.jpg"))
        .rejects.toMatchObject({ code: "IMAGE_TRANSFORM_UNSUPPORTED" });
    }
  });

  it("rejects pixel bombs before decoder allocation", async () => {
    const oversizedHeader = Uint8Array.from([255, 216, 255, 192, 0, 11, 8, 255, 255, 255, 255, 1, 1, 17, 0]);
    const port = createVisualCandidateImagePort(async (input) => ({
      response: new Response(oversizedHeader, { headers: { "content-type": "image/jpeg" } }), finalUrl: input.url
    }));
    await expect(port.load("https://merchant.example/photo.jpg"))
      .rejects.toMatchObject({ code: "IMAGE_PIXEL_LIMIT_EXCEEDED" });
  });

  it("resizes a transparent PNG with bounded inflate and preserves its aspect ratio", async () => {
    const original = png.PNG.sync.write({ width: 640, height: 480, data: Buffer.alloc(640 * 480 * 4) });
    const port = createVisualCandidateImagePort(async (input) => ({
      response: new Response(Uint8Array.from(original), { headers: { "content-type": "image/png" } }), finalUrl: input.url
    }));
    const image = await port.load("https://merchant.example/photo.png", { maxDataChars: 50_000 });
    expect(image.data.length).toBeLessThanOrEqual(50_000);
    expect(image.mimeType).toBe("image/jpeg");
    const resized = jpeg.decode(Buffer.from(image.data, "base64"));
    expect([resized.width, resized.height]).toEqual([512, 384]);
    expect([...resized.data.subarray(0, 4)]).toEqual([255, 255, 255, 255]);
  });

  it("rejects unsafe PNG headers before allocation or unbounded interlaced inflate", async () => {
    const original = png.PNG.sync.write({ width: 1, height: 1, data: Buffer.alloc(4) });
    const bomb = Buffer.from(original);
    bomb.writeUInt32BE(100_000, 16);
    const interlaced = Buffer.from(original);
    interlaced[28] = 1;
    const duplicate = Buffer.concat([original.subarray(0, 33), original.subarray(8)]);
    for (const [bytes, code] of [
      [bomb, "IMAGE_PIXEL_LIMIT_EXCEEDED"], [interlaced, "IMAGE_TRANSFORM_UNSUPPORTED"],
      [duplicate, "IMAGE_PROCESSING_FAILED"]
    ] as const) {
      const port = createVisualCandidateImagePort(async (input) => ({
        response: new Response(Uint8Array.from(bytes), { headers: { "content-type": "image/png" } }), finalUrl: input.url
      }));
      await expect(port.load("https://merchant.example/photo.png")).rejects.toMatchObject({ code });
    }
  });

  it("terminates isolated decoding when its deadline or caller budget expires", async () => {
    const fetchImage = async (input: { url: string }) => ({
      response: new Response(Uint8Array.from(smallJpeg), { headers: { "content-type": "image/jpeg" } }), finalUrl: input.url
    });
    await expect(createVisualCandidateImagePort(fetchImage, 1).load("https://merchant.example/photo.jpg"))
      .rejects.toMatchObject({ code: "IMAGE_PROCESSING_TIMEOUT" });
    await expect(createVisualCandidateImagePort(fetchImage).load("https://merchant.example/photo.jpg", {
      signal: AbortSignal.timeout(5)
    })).rejects.toMatchObject({ code: "REQUEST_ABORTED" });
  });

  it("queues a six-image review batch without discarding valid JPEGs as busy", async () => {
    const port = createVisualCandidateImagePort(async (input) => ({
      response: new Response(Uint8Array.from(smallJpeg), { headers: { "content-type": "image/jpeg" } }), finalUrl: input.url
    }));
    const images = await Promise.all(Array.from({ length: 6 }, (_, index) =>
      port.load(`https://merchant.example/photo-${index}.jpg`, { maxDataChars: 1_000 })));
    expect(images).toHaveLength(6);
    expect(images.every((image) => image.mimeType === "image/jpeg" && image.data.length <= 1_000)).toBe(true);
  });

  it("bounds queued work and removes cancelled waiters without leaking worker slots", async () => {
    const port = createVisualCandidateImagePort(async (input) => ({
      response: new Response(Uint8Array.from(smallJpeg), { headers: { "content-type": "image/jpeg" } }), finalUrl: input.url
    }));
    const controller = new AbortController();
    const results = Array.from({ length: 17 }, (_, index) => port.load(`https://merchant.example/batch-${index}.jpg`, {
      ...(index === 5 ? { signal: controller.signal } : {})
    }));
    const settled = Promise.allSettled(results);
    setTimeout(() => controller.abort(), 5);
    const completed = await settled;
    expect(completed.filter((entry) => entry.status === "fulfilled")).toHaveLength(13);
    const failures = completed.flatMap((entry) => entry.status === "rejected" ? [entry.reason as VisualCandidateImageError] : []);
    expect(failures.filter((error) => error.code === "IMAGE_PROCESSING_BUSY")).toHaveLength(3);
    expect(failures.filter((error) => error.code === "REQUEST_ABORTED")).toHaveLength(1);
    await expect(port.load("https://merchant.example/after-cancellation.jpg")).resolves.toMatchObject({ mimeType: "image/jpeg" });
  });

  it("charges waiting time to the original deadline and removes timed-out queued work", async () => {
    const fetchImage = async (input: { url: string }) => ({
      response: new Response(Uint8Array.from(smallJpeg), { headers: { "content-type": "image/jpeg" } }), finalUrl: input.url
    });
    const port = createVisualCandidateImagePort(fetchImage);
    const occupyingSlots = Promise.all([port.load("https://merchant.example/first.jpg"), port.load("https://merchant.example/second.jpg")]);
    await expect(createVisualCandidateImagePort(fetchImage, 1).load("https://merchant.example/queued.jpg"))
      .rejects.toMatchObject({ code: "IMAGE_PROCESSING_TIMEOUT" });
    expect(await occupyingSlots).toHaveLength(2);
    await expect(port.load("https://merchant.example/after-timeout.jpg")).resolves.toMatchObject({ mimeType: "image/jpeg" });
  });

  it("runs the shipped worker outside the repository without node_modules", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "findcheap-image-worker-"));
    const workerPath = path.join(directory, "visual-image-worker.cjs");
    await copyFile(new URL("../../../plugins/findcheap-agent/dist/visual-image-worker.cjs", import.meta.url), workerPath);
    const worker = new Worker(workerPath, { workerData: {
      bytes: Uint8Array.from(smallJpeg).buffer, mimeType: "image/jpeg", maxBytes: 1_000
    } });
    try {
      const message = await new Promise<{ ok: boolean; bytes: Uint8Array; mimeType: string }>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("standalone worker timeout")), 2_000);
        worker.once("message", (value: { ok: boolean; bytes: Uint8Array; mimeType: string }) => {
          clearTimeout(timeout);
          resolve(value);
        });
        worker.once("error", (error) => { clearTimeout(timeout); reject(error); });
      });
      expect(message.ok).toBe(true);
      expect(message.mimeType).toBe("image/jpeg");
      expect([...message.bytes]).toEqual([...smallJpeg]);
    } finally {
      await worker.terminate();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("forwards cancellation and cancels stalled image bodies", async () => {
    const controller = new AbortController();
    const cancelled = vi.fn();
    const fetchImage = vi.fn(async (input: { url: string }) => ({
      response: new Response(new ReadableStream<Uint8Array>({ cancel: cancelled }), {
        headers: { "content-type": "image/jpeg" }
      }),
      finalUrl: input.url
    }));
    const port = createVisualCandidateImagePort(fetchImage);
    const pending = port.load("https://cdn.example.test/item.jpg", { signal: controller.signal });
    const rejected = expect(pending).rejects.toMatchObject({ code: "REQUEST_ABORTED" });
    await Promise.resolve();
    controller.abort();
    await rejected;
    expect(fetchImage).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ signal: controller.signal }));
    expect(cancelled).toHaveBeenCalledTimes(1);
  });

  it("rejects already cancelled work without starting an image fetch", async () => {
    const fetchImage = vi.fn();
    await expect(createVisualCandidateImagePort(fetchImage).load("https://cdn.example.test/item.jpg", {
      signal: AbortSignal.abort()
    })).rejects.toMatchObject({ code: "REQUEST_ABORTED" });
    expect(fetchImage).not.toHaveBeenCalled();
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

  it("normalizes body failures without exposing upstream exception details", async () => {
    const port = createVisualCandidateImagePort(async (input) => ({
      response: new Response(new ReadableStream({
        start(controller) { controller.error(new Error("failed https://cdn.example.test/item?token=secret")); }
      }), { headers: { "content-type": "image/jpeg" } }), finalUrl: input.url
    }));
    const error = await port.load("https://cdn.example.test/item.jpg").catch((failure: unknown) => failure);
    expect(error).toMatchObject({ code: "REQUEST_FAILED", sourceHost: "cdn.example.test" });
    expect(String(error)).not.toContain("token=secret");
  });
});
