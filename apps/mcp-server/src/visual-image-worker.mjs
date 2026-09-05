import { Buffer } from "node:buffer";
import { parentPort, workerData } from "node:worker_threads";
import jpeg from "jpeg-js";
import pngjs from "pngjs";

// Independent caps remain effective even if a caller passes incorrect limits.
const MAX_PIXELS = 4_000_000;
const MAX_DIMENSION = 8_192;
const MAX_BYTES = 1_500_000;

function fail(code) { throw new Error(code); }

function dimensions(bytes, type) {
  if (type === "image/png") {
    if (bytes.length < 33 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
      fail("IMAGE_PROCESSING_FAILED");
    }
    let headerCount = 0;
    for (let offset = 8; offset < bytes.length;) {
      if (offset + 12 > bytes.length) fail("IMAGE_PROCESSING_FAILED");
      const length = bytes.readUInt32BE(offset);
      const kind = bytes.toString("ascii", offset + 4, offset + 8);
      if (offset + 12 + length > bytes.length) fail("IMAGE_PROCESSING_FAILED");
      if (kind === "IHDR") {
        headerCount += 1;
        if (headerCount !== 1 || offset !== 8 || length !== 13) fail("IMAGE_PROCESSING_FAILED");
      }
      // pngjs's interlaced sync path has no bounded inflate option.
      if (kind === "acTL") fail("IMAGE_TRANSFORM_UNSUPPORTED");
      offset += length + 12;
    }
    if (headerCount !== 1) fail("IMAGE_PROCESSING_FAILED");
    if (bytes[28] !== 0) fail("IMAGE_TRANSFORM_UNSUPPORTED");
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if (type !== "image/jpeg" || bytes[0] !== 255 || bytes[1] !== 216) fail("IMAGE_PROCESSING_FAILED");
  for (let offset = 2; offset + 3 < bytes.length;) {
    if (bytes[offset++] !== 255) fail("IMAGE_PROCESSING_FAILED");
    while (bytes[offset] === 255) offset += 1;
    const marker = bytes[offset++];
    if (marker === 217 || marker === 218) break;
    if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
    if (offset + 2 > bytes.length) fail("IMAGE_PROCESSING_FAILED");
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) fail("IMAGE_PROCESSING_FAILED");
    if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker)) {
      if (length < 8) fail("IMAGE_PROCESSING_FAILED");
      return { width: bytes.readUInt16BE(offset + 5), height: bytes.readUInt16BE(offset + 3) };
    }
    offset += length;
  }
  fail("IMAGE_PROCESSING_FAILED");
}

function jpegOrientation(bytes) {
  let orientation;
  for (let offset = 2; offset + 3 < bytes.length;) {
    if (bytes[offset++] !== 255) fail("IMAGE_TRANSFORM_UNSUPPORTED");
    while (bytes[offset] === 255) offset += 1;
    const marker = bytes[offset++];
    if (marker === 217 || marker === 218) break;
    if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
    if (offset + 2 > bytes.length) fail("IMAGE_TRANSFORM_UNSUPPORTED");
    const length = bytes.readUInt16BE(offset);
    const end = offset + length;
    if (length < 2 || end > bytes.length) fail("IMAGE_TRANSFORM_UNSUPPORTED");
    if (marker === 225 && length >= 8 && bytes.toString("latin1", offset + 2, offset + 8) === "Exif\0\0") {
      const tiff = offset + 8;
      if (tiff + 8 > end) fail("IMAGE_TRANSFORM_UNSUPPORTED");
      const order = bytes.toString("latin1", tiff, tiff + 2);
      if (order !== "II" && order !== "MM") fail("IMAGE_TRANSFORM_UNSUPPORTED");
      const read = (position, size) => {
        if (position < tiff || position + size > end) fail("IMAGE_TRANSFORM_UNSUPPORTED");
        return order === "II" ? bytes.readUIntLE(position, size) : bytes.readUIntBE(position, size);
      };
      if (read(tiff + 2, 2) !== 42) fail("IMAGE_TRANSFORM_UNSUPPORTED");
      const relative = read(tiff + 4, 4);
      if (relative < 8) fail("IMAGE_TRANSFORM_UNSUPPORTED");
      const ifd = tiff + relative;
      const count = read(ifd, 2);
      if (ifd + 2 + count * 12 + 4 > end) fail("IMAGE_TRANSFORM_UNSUPPORTED");
      for (let index = 0; index < count; index += 1) {
        const entry = ifd + 2 + index * 12;
        if (read(entry, 2) !== 0x0112) continue;
        if (read(entry + 2, 2) !== 3 || read(entry + 4, 4) !== 1) fail("IMAGE_TRANSFORM_UNSUPPORTED");
        const value = read(entry + 8, 2);
        if (value < 1 || value > 8 || (orientation !== undefined && orientation !== value)) {
          fail("IMAGE_TRANSFORM_UNSUPPORTED");
        }
        orientation = value;
      }
    }
    offset = end;
  }
  return orientation ?? 1;
}

function resize(image, maximum, orientation) {
  const orientedWidth = orientation >= 5 ? image.height : image.width;
  const orientedHeight = orientation >= 5 ? image.width : image.height;
  const scale = Math.min(1, maximum / Math.max(orientedWidth, orientedHeight));
  const width = Math.max(1, Math.round(orientedWidth * scale));
  const height = Math.max(1, Math.round(orientedHeight * scale));
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const ox = Math.min(orientedWidth - 1, (x + 0.5) / scale - 0.5);
      const oy = Math.min(orientedHeight - 1, (y + 0.5) / scale - 0.5);
      // Map displayed coordinates back into the original buffer; no full-size copy.
      let sx = ox;
      let sy = oy;
      if (orientation === 2) sx = image.width - 1 - ox;
      else if (orientation === 3) { sx = image.width - 1 - ox; sy = image.height - 1 - oy; }
      else if (orientation === 4) sy = image.height - 1 - oy;
      else if (orientation === 5) { sx = oy; sy = ox; }
      else if (orientation === 6) { sx = oy; sy = image.height - 1 - ox; }
      else if (orientation === 7) { sx = image.width - 1 - oy; sy = image.height - 1 - ox; }
      else if (orientation === 8) { sx = image.width - 1 - oy; sy = ox; }
      const x0 = Math.max(0, Math.floor(sx));
      const y0 = Math.max(0, Math.floor(sy));
      const dx = Math.max(0, sx - x0);
      const dy = Math.max(0, sy - y0);
      const samples = [
        [x0, y0, (1 - dx) * (1 - dy)], [Math.min(x0 + 1, image.width - 1), y0, dx * (1 - dy)],
        [x0, Math.min(y0 + 1, image.height - 1), (1 - dx) * dy],
        [Math.min(x0 + 1, image.width - 1), Math.min(y0 + 1, image.height - 1), dx * dy]
      ];
      const target = (y * width + x) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        let value = 0;
        for (const [px, py, weight] of samples) {
          const source = (py * image.width + px) * 4;
          const alpha = image.data[source + 3] / 255;
          value += (image.data[source + channel] * alpha + 255 * (1 - alpha)) * weight;
        }
        data[target + channel] = Math.round(value);
      }
      data[target + 3] = 255;
    }
  }
  return { data, width, height };
}

try {
  const bytes = Buffer.from(workerData.bytes);
  const maxBytes = Math.min(MAX_BYTES, workerData.maxBytes);
  if (bytes.length > MAX_BYTES || !Number.isSafeInteger(maxBytes) || maxBytes < 1) fail("OUTPUT_BUDGET_EXCEEDED");
  const size = dimensions(bytes, workerData.mimeType);
  if (size.width < 1 || size.height < 1 || size.width > MAX_DIMENSION || size.height > MAX_DIMENSION ||
      size.width * size.height > MAX_PIXELS) fail("IMAGE_PIXEL_LIMIT_EXCEEDED");
  const orientation = workerData.mimeType === "image/jpeg" ? jpegOrientation(bytes) : 1;
  const image = workerData.mimeType === "image/jpeg"
    ? jpeg.decode(bytes, { useTArray: true, maxResolutionInMP: MAX_PIXELS / 1_000_000, maxMemoryUsageInMB: 64, tolerantDecoding: false })
    : pngjs.PNG.sync.read(bytes, { checkCRC: true });
  if (image.width !== size.width || image.height !== size.height) fail("IMAGE_PROCESSING_FAILED");
  let output;
  let mimeType = workerData.mimeType;
  if (Math.max(size.width, size.height) <= 512 && bytes.length <= maxBytes) output = bytes;
  else {
    mimeType = "image/jpeg";
    for (const width of [512, 384, 256, 192, 128]) {
      const thumbnail = resize(image, width, orientation);
      for (const quality of [75, 50, 30]) {
        const encoded = jpeg.encode(thumbnail, quality).data;
        if (encoded.length <= maxBytes) { output = encoded; break; }
      }
      if (output !== undefined) break;
    }
  }
  if (output === undefined) fail("OUTPUT_BUDGET_EXCEEDED");
  const transfer = Uint8Array.from(output);
  parentPort.postMessage({ ok: true, bytes: transfer, mimeType }, [transfer.buffer]);
} catch (error) {
  const safeCodes = new Set(["IMAGE_PIXEL_LIMIT_EXCEEDED", "IMAGE_TRANSFORM_UNSUPPORTED", "OUTPUT_BUDGET_EXCEEDED"]);
  parentPort.postMessage({ ok: false, code: safeCodes.has(error?.message) ? error.message : "IMAGE_PROCESSING_FAILED" });
}
