const zlib = require('node:zlib');
const fs = require('node:fs');

// Workbench mark: teal rounded square with a dark "A" monogram.
const BG = [22, 121, 100];
const FG = [17, 23, 26];

/** Draw the icon at an arbitrary square size, returning an RGBA buffer. */
function render(size) {
  const rgba = new Uint8Array(size * size * 4);
  const set = (x, y, r, g, b, a = 255) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    rgba[i] = r; rgba[i + 1] = g; rgba[i + 2] = b; rgba[i + 3] = a;
  };

  const radius = size * 0.25;
  const inRounded = (x, y) => {
    const dx = Math.max(radius - x, x - (size - radius), 0);
    const dy = Math.max(radius - y, y - (size - radius), 0);
    return dx * dx + dy * dy <= radius * radius;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (inRounded(x, y)) set(x, y, BG[0], BG[1], BG[2], 255);
      else set(x, y, 0, 0, 0, 0);
    }
  }

  const s = size / 256;
  const bary = (a, b, c, x, y) => {
    const d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
    const u = ((b[1] - c[1]) * (x - c[0]) + (c[0] - b[0]) * (y - c[1])) / d;
    const v = ((c[1] - a[1]) * (x - c[0]) + (a[0] - c[0]) * (y - c[1])) / d;
    return [1 - u - v, u, v];
  };
  const tri = (p0, p1, p2, color) => {
    const a = [p0[0] * s, p0[1] * s];
    const b = [p1[0] * s, p1[1] * s];
    const c = [p2[0] * s, p2[1] * s];
    const minx = Math.floor(Math.min(a[0], b[0], c[0]));
    const maxx = Math.ceil(Math.max(a[0], b[0], c[0]));
    const miny = Math.floor(Math.min(a[1], b[1], c[1]));
    const maxy = Math.ceil(Math.max(a[1], b[1], c[1]));
    for (let y = miny; y <= maxy; y++) {
      for (let x = minx; x <= maxx; x++) {
        const [w, u, v] = bary(a, b, c, x, y);
        if (w >= 0 && u >= 0 && v >= 0) set(x, y, color[0], color[1], color[2], 255);
      }
    }
  };
  // "A" silhouette, with the counter carved back to teal.
  tri([72, 186], [184, 186], [128, 60], FG);
  tri([100, 150], [156, 150], [128, 96], BG);
  return rgba;
}

function png(size) {
  const rgba = render(size);
  const crcTable = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let k = n;
      for (let i = 0; i < 8; i++) k = (k & 1) ? (0xEDB88320 ^ (k >>> 1)) : (k >>> 1);
      t[n] = k >>> 0;
    }
    return t;
  })();
  const crc32 = (buf) => {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, 'ascii');
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
    return Buffer.concat([len, typeBuf, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  const stride = 1 + size * 4;
  const raw = Buffer.alloc(size * stride);
  for (let y = 0; y < size; y++) {
    raw[y * stride] = 0;
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      raw[y * stride + 1 + x * 4] = rgba[i];
      raw[y * stride + 1 + x * 4 + 1] = rgba[i + 1];
      raw[y * stride + 1 + x * 4 + 2] = rgba[i + 2];
      raw[y * stride + 1 + x * 4 + 3] = rgba[i + 3];
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** A 32-bit BMP (DIB) icon image, bottom-up BGRA plus a 1-bit AND mask. */
function dib(size) {
  const rgba = render(size);
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(size, 4);
  header.writeInt32LE(size * 2, 8); // XOR + AND
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  header.writeUInt32LE(0, 16);
  const xor = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    const srcRow = size - 1 - y; // bottom-up
    for (let x = 0; x < size; x++) {
      const si = (srcRow * size + x) * 4;
      const di = (y * size + x) * 4;
      xor[di] = rgba[si + 2];     // B
      xor[di + 1] = rgba[si + 1]; // G
      xor[di + 2] = rgba[si];     // R
      xor[di + 3] = rgba[si + 3]; // A
    }
  }
  const maskStride = ((size + 31) >> 5) << 2;
  const mask = Buffer.alloc(maskStride * size, 0);
  return Buffer.concat([header, xor, mask]);
}

function ico(sizes) {
  const images = sizes.map((size) => ({ size, data: dib(size) }));
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  const entries = [];
  let offset = 6 + images.length * 16;
  for (const image of images) {
    const entry = Buffer.alloc(16);
    entry[0] = image.size >= 256 ? 0 : image.size;
    entry[1] = image.size >= 256 ? 0 : image.size;
    entry[2] = 0;
    entry[3] = 0;
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(image.data.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += image.data.length;
    entries.push(entry);
  }
  return Buffer.concat([header, ...entries, ...images.map((image) => image.data)]);
}

fs.writeFileSync('electron/icon.png', png(256));
fs.writeFileSync('electron/icon.ico', ico([16, 24, 32, 48, 64, 128, 256]));
console.log('wrote electron/icon.png and multi-size electron/icon.ico');