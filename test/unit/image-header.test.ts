import { describe, expect, it } from 'vitest';
import { readImageDimensions } from '../../src/utils/image-header.js';
import { writeFileSync, unlinkSync, mkdtempSync, rmdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// ---------------------------------------------------------------------------
// Helpers: build minimal valid image buffers from scratch
// ---------------------------------------------------------------------------

function makePng(width: number, height: number): Buffer {
  const buf = Buffer.alloc(24);
  buf[0] = 0x89; buf[1] = 0x50; buf[2] = 0x4e; buf[3] = 0x47; // signature
  buf[4] = 0x0d; buf[5] = 0x0a; buf[6] = 0x1a; buf[7] = 0x0a;
  // IHDR chunk length = 13 at offset 8 (4 bytes), type "IHDR" at 12
  buf.writeUInt32BE(13, 8);
  buf.write('IHDR', 12, 'ascii');
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return buf;
}

function makeJpeg(width: number, height: number): Buffer {
  // Minimal JPEG: SOI + APP0 segment + SOF0 segment
  const buf = Buffer.alloc(32);
  let off = 0;
  buf[off++] = 0xff; buf[off++] = 0xd8; // SOI
  // APP0: FF E0, length=16 (no actual content needed, just valid length)
  buf[off++] = 0xff; buf[off++] = 0xe0;
  buf.writeUInt16BE(16, off); off += 2; // segment length (includes the 2 length bytes)
  off += 14; // skip APP0 data
  // SOF0: FF C0, length=11, precision=8, height, width, components=1
  buf[off++] = 0xff; buf[off++] = 0xc0;
  buf.writeUInt16BE(11, off); off += 2; // segment length
  buf[off++] = 8; // precision
  buf.writeUInt16BE(height, off); off += 2;
  buf.writeUInt16BE(width, off); off += 2;
  return buf;
}

function makeGif(width: number, height: number): Buffer {
  const buf = Buffer.alloc(10);
  buf.write('GIF89a', 0, 'ascii');
  buf.writeUInt16LE(width, 6);
  buf.writeUInt16LE(height, 8);
  return buf;
}

function makeBmp(width: number, height: number): Buffer {
  const buf = Buffer.alloc(26);
  buf[0] = 0x42; buf[1] = 0x4d; // "BM"
  buf.writeInt32LE(width, 18);
  buf.writeInt32LE(height, 22);
  return buf;
}

function makeBmpTopDown(width: number, height: number): Buffer {
  const buf = makeBmp(width, height);
  buf.writeInt32LE(-height, 22); // negative = top-down
  return buf;
}

function makeTiff(width: number, height: number, bigEndian = true): Buffer {
  const buf = Buffer.alloc(128);
  if (bigEndian) {
    buf.write('MM', 0, 'ascii');
    buf.writeUInt16BE(42, 2);
    buf.writeUInt32BE(8, 4); // IFD offset
    buf.writeUInt16BE(2, 8); // 2 entries
    // Entry 0: tag=0x0100 (width), type=3 (SHORT), count=1, value=width
    buf.writeUInt16BE(0x0100, 10); buf.writeUInt16BE(3, 12); buf.writeUInt32BE(1, 14); buf.writeUInt16BE(width, 18);
    // Entry 1: tag=0x0101 (height), type=3 (SHORT), count=1, value=height
    buf.writeUInt16BE(0x0101, 22); buf.writeUInt16BE(3, 24); buf.writeUInt32BE(1, 26); buf.writeUInt16BE(height, 30);
  } else {
    buf.write('II', 0, 'ascii');
    buf.writeUInt16LE(42, 2);
    buf.writeUInt32LE(8, 4);
    buf.writeUInt16LE(2, 8);
    buf.writeUInt16LE(0x0100, 10); buf.writeUInt16LE(3, 12); buf.writeUInt32LE(1, 14); buf.writeUInt16LE(width, 18);
    buf.writeUInt16LE(0x0101, 22); buf.writeUInt16LE(3, 24); buf.writeUInt32LE(1, 26); buf.writeUInt16LE(height, 30);
  }
  return buf;
}

function makeWebpLossy(width: number, height: number): Buffer {
  const buf = Buffer.alloc(30);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(22, 4); // file size
  buf.write('WEBP', 8, 'ascii');
  buf.write('VP8 ', 12, 'ascii');
  buf.writeUInt32LE(10, 16); // chunk size
  // frame tag: 3 bytes (all zero = key frame)
  buf[20] = 0x00; buf[21] = 0x00; buf[22] = 0x00;
  // start code
  buf[23] = 0x9d; buf[24] = 0x01; buf[25] = 0x2a;
  buf.writeUInt16LE(width & 0x3fff, 26);
  buf.writeUInt16LE(height & 0x3fff, 28);
  return buf;
}

function makeWebpLossless(width: number, height: number): Buffer {
  const buf = Buffer.alloc(30);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(22, 4);
  buf.write('WEBP', 8, 'ascii');
  buf.write('VP8L', 12, 'ascii');
  buf.writeUInt32LE(10, 16);
  buf[20] = 0x2f; // signature
  // Pack (width-1) in bits 0-13, (height-1) in bits 14-27
  const w1 = (width - 1) & 0x3fff;
  const h1 = (height - 1) & 0x3fff;
  const bits = w1 | (h1 << 14);
  buf[21] = (bits >>> 0) & 0xff;
  buf[22] = (bits >>> 8) & 0xff;
  buf[23] = (bits >>> 16) & 0xff;
  buf[24] = (bits >>> 24) & 0xff;
  return buf;
}

function makeWebpExtended(width: number, height: number): Buffer {
  const buf = Buffer.alloc(30);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(22, 4);
  buf.write('WEBP', 8, 'ascii');
  buf.write('VP8X', 12, 'ascii');
  buf.writeUInt32LE(10, 16);
  buf[20] = 0x00; // flags
  buf[21] = 0x00; buf[22] = 0x00; buf[23] = 0x00; // reserved
  // canvas width-1 as 24-bit LE
  const w1 = width - 1;
  const h1 = height - 1;
  buf[24] = w1 & 0xff; buf[25] = (w1 >> 8) & 0xff; buf[26] = (w1 >> 16) & 0xff;
  buf[27] = h1 & 0xff; buf[28] = (h1 >> 8) & 0xff; buf[29] = (h1 >> 16) & 0xff;
  return buf;
}

function makePsd(width: number, height: number): Buffer {
  const buf = Buffer.alloc(26);
  buf.write('8BPS', 0, 'ascii');
  buf.writeUInt16BE(1, 4); // version = 1 (PSD)
  // 6 reserved bytes at offset 6
  buf.writeUInt16BE(3, 12); // channels
  buf.writeUInt32BE(height, 14); // rows
  buf.writeUInt32BE(width, 18); // columns
  return buf;
}

function makeHeic(width: number, height: number): Buffer {
  // Minimal HEIC: ftyp box + ispe box
  const buf = Buffer.alloc(80);
  // ftyp box: size(4) + "ftyp"(4) + major brand "heic"(4) + minor version(4)
  buf.writeUInt32BE(20, 0);
  buf.write('ftyp', 4, 'ascii');
  buf.write('heic', 8, 'ascii');
  buf.writeUInt32BE(0, 12); // minor version
  buf.write('mif1', 16, 'ascii'); // compatible brand
  // ispe box at offset 20: size(4) + "ispe"(4) + version(1) + flags(3) + width(4) + height(4)
  buf.writeUInt32BE(20, 20);
  buf.write('ispe', 24, 'ascii');
  buf[28] = 0; buf[29] = 0; buf[30] = 0; buf[31] = 0; // version + flags
  buf.writeUInt32BE(width, 32);
  buf.writeUInt32BE(height, 36);
  return buf;
}

// ---------------------------------------------------------------------------
// Write buffer to temp file, run test, clean up
// ---------------------------------------------------------------------------

function withTempFile(ext: string, buf: Buffer, fn: (path: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'img-header-test-'));
  const filePath = join(dir, `test${ext}`);
  writeFileSync(filePath, buf);
  try {
    fn(filePath);
  } finally {
    try { unlinkSync(filePath); } catch { /* ignore */ }
    try { rmdirSync(dir); } catch { /* ignore */ }
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('readImageDimensions', () => {
  describe('PNG', () => {
    it('reads dimensions by extension', () => {
      withTempFile('.png', makePng(800, 600), (p) => {
        expect(readImageDimensions(p)).toEqual({ width: 800, height: 600 });
      });
    });
    it('reads dimensions by magic bytes (no known extension)', () => {
      withTempFile('.unknown', makePng(100, 200), (p) => {
        expect(readImageDimensions(p)).toEqual({ width: 100, height: 200 });
      });
    });
  });

  describe('JPEG', () => {
    it('reads dimensions from SOF0 marker', () => {
      withTempFile('.jpg', makeJpeg(1920, 1080), (p) => {
        expect(readImageDimensions(p)).toEqual({ width: 1920, height: 1080 });
      });
    });
    it('accepts .jpeg extension', () => {
      withTempFile('.jpeg', makeJpeg(640, 480), (p) => {
        expect(readImageDimensions(p)).toEqual({ width: 640, height: 480 });
      });
    });
  });

  describe('GIF', () => {
    it('reads dimensions', () => {
      withTempFile('.gif', makeGif(320, 240), (p) => {
        expect(readImageDimensions(p)).toEqual({ width: 320, height: 240 });
      });
    });
  });

  describe('BMP', () => {
    it('reads dimensions for bottom-up bitmap', () => {
      withTempFile('.bmp', makeBmp(256, 128), (p) => {
        expect(readImageDimensions(p)).toEqual({ width: 256, height: 128 });
      });
    });
    it('reads dimensions for top-down bitmap (negative height)', () => {
      withTempFile('.bmp', makeBmpTopDown(256, 128), (p) => {
        expect(readImageDimensions(p)).toEqual({ width: 256, height: 128 });
      });
    });
  });

  describe('TIFF', () => {
    it('reads big-endian TIFF', () => {
      withTempFile('.tif', makeTiff(3000, 2000, true), (p) => {
        expect(readImageDimensions(p)).toEqual({ width: 3000, height: 2000 });
      });
    });
    it('reads little-endian TIFF', () => {
      withTempFile('.tiff', makeTiff(4096, 2048, false), (p) => {
        expect(readImageDimensions(p)).toEqual({ width: 4096, height: 2048 });
      });
    });
  });

  describe('WebP', () => {
    it('reads lossy (VP8) dimensions', () => {
      withTempFile('.webp', makeWebpLossy(1280, 720), (p) => {
        expect(readImageDimensions(p)).toEqual({ width: 1280, height: 720 });
      });
    });
    it('reads lossless (VP8L) dimensions', () => {
      withTempFile('.webp', makeWebpLossless(400, 300), (p) => {
        expect(readImageDimensions(p)).toEqual({ width: 400, height: 300 });
      });
    });
    it('reads extended (VP8X) dimensions', () => {
      withTempFile('.webp', makeWebpExtended(1920, 1080), (p) => {
        expect(readImageDimensions(p)).toEqual({ width: 1920, height: 1080 });
      });
    });
    it('detects WebP by magic bytes', () => {
      withTempFile('.unknown', makeWebpLossy(200, 150), (p) => {
        expect(readImageDimensions(p)).toEqual({ width: 200, height: 150 });
      });
    });
  });

  describe('PSD', () => {
    it('reads PSD dimensions', () => {
      withTempFile('.psd', makePsd(2480, 3508), (p) => {
        expect(readImageDimensions(p)).toEqual({ width: 2480, height: 3508 });
      });
    });
    it('accepts .psb extension', () => {
      const buf = makePsd(5000, 7000);
      buf.writeUInt16BE(2, 4); // version = 2 (PSB)
      withTempFile('.psb', buf, (p) => {
        expect(readImageDimensions(p)).toEqual({ width: 5000, height: 7000 });
      });
    });
    it('detects PSD by magic bytes', () => {
      withTempFile('.unknown', makePsd(800, 600), (p) => {
        expect(readImageDimensions(p)).toEqual({ width: 800, height: 600 });
      });
    });
    it('rejects invalid PSD version', () => {
      const buf = makePsd(100, 100);
      buf.writeUInt16BE(99, 4); // invalid version
      withTempFile('.psd', buf, (p) => {
        expect(readImageDimensions(p)).toBeNull();
      });
    });
  });

  describe('HEIC', () => {
    it('reads HEIC dimensions', () => {
      withTempFile('.heic', makeHeic(4032, 3024), (p) => {
        expect(readImageDimensions(p)).toEqual({ width: 4032, height: 3024 });
      });
    });
    it('accepts .heif extension', () => {
      withTempFile('.heif', makeHeic(1920, 1440), (p) => {
        expect(readImageDimensions(p)).toEqual({ width: 1920, height: 1440 });
      });
    });
    it('detects HEIC by magic bytes (ftyp box)', () => {
      withTempFile('.unknown', makeHeic(800, 600), (p) => {
        expect(readImageDimensions(p)).toEqual({ width: 800, height: 600 });
      });
    });
    it('accepts .avif extension', () => {
      // Build a HEIC-like buffer with major brand 'avif'
      const buf = makeHeic(3840, 2160);
      buf.write('avif', 8, 'ascii'); // overwrite major brand
      withTempFile('.avif', buf, (p) => {
        expect(readImageDimensions(p)).toEqual({ width: 3840, height: 2160 });
      });
    });
  });

  describe('error handling', () => {
    it('returns null for non-existent file', () => {
      expect(readImageDimensions('/tmp/does-not-exist-image-header-test.png')).toBeNull();
    });
    it('returns null for unrecognised format', () => {
      withTempFile('.bin', Buffer.from('not an image at all'), (p) => {
        expect(readImageDimensions(p)).toBeNull();
      });
    });
    it('returns null for truncated PNG', () => {
      withTempFile('.png', Buffer.from([0x89, 0x50, 0x4e, 0x47]), (p) => {
        expect(readImageDimensions(p)).toBeNull();
      });
    });
  });
});
