import { openSync, readSync, closeSync } from 'fs';
import { extname } from 'path';

export interface ImageDimensions {
  width: number;
  height: number;
}

const MAX_HEADER_BYTES = 65536; // 64KB - enough for all header formats

function readPngDimensions(buf: Buffer): ImageDimensions | null {
  // PNG signature: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf.length < 24 ||
    buf[0] !== 0x89 ||
    buf[1] !== 0x50 ||
    buf[2] !== 0x4e ||
    buf[3] !== 0x47
  ) {
    return null;
  }
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  return { width, height };
}

function readJpegDimensions(buf: Buffer): ImageDimensions | null {
  // JPEG SOI: FF D8
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) {
    return null;
  }

  let offset = 2;
  while (offset + 4 < buf.length) {
    if (buf[offset] !== 0xff) {
      offset++;
      continue;
    }

    const marker = buf[offset + 1];

    // SOF markers: C0-C3, C5-C7, C9-CB, CD-CF
    if (
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf)
    ) {
      if (offset + 9 >= buf.length) return null;
      const height = buf.readUInt16BE(offset + 5);
      const width = buf.readUInt16BE(offset + 7);
      return { width, height };
    }

    // Skip segment: read length and advance
    if (offset + 3 >= buf.length) return null;
    const segmentLength = buf.readUInt16BE(offset + 2);
    offset += 2 + segmentLength;
  }

  return null;
}

function readGifDimensions(buf: Buffer): ImageDimensions | null {
  // GIF signature: "GIF87a" or "GIF89a"
  if (buf.length < 10) return null;
  const sig = buf.toString('ascii', 0, 6);
  if (sig !== 'GIF87a' && sig !== 'GIF89a') return null;

  const width = buf.readUInt16LE(6);
  const height = buf.readUInt16LE(8);
  return { width, height };
}

function readBmpDimensions(buf: Buffer): ImageDimensions | null {
  // BMP signature: "BM"
  if (buf.length < 26 || buf[0] !== 0x42 || buf[1] !== 0x4d) return null;

  const width = buf.readInt32LE(18);
  const height = Math.abs(buf.readInt32LE(22)); // negative = top-down
  return { width, height };
}

function readTiffDimensions(buf: Buffer): ImageDimensions | null {
  if (buf.length < 8) return null;

  const sig = buf.toString('ascii', 0, 2);
  let bigEndian: boolean;
  if (sig === 'MM') {
    bigEndian = true;
  } else if (sig === 'II') {
    bigEndian = false;
  } else {
    return null;
  }

  const readU16 = bigEndian
    ? (b: Buffer, o: number) => b.readUInt16BE(o)
    : (b: Buffer, o: number) => b.readUInt16LE(o);
  const readU32 = bigEndian
    ? (b: Buffer, o: number) => b.readUInt32BE(o)
    : (b: Buffer, o: number) => b.readUInt32LE(o);

  // Verify TIFF magic number (42)
  if (readU16(buf, 2) !== 42) return null;

  const ifdOffset = readU32(buf, 4);
  if (ifdOffset + 2 > buf.length) return null;

  const entryCount = readU16(buf, ifdOffset);
  let width: number | null = null;
  let height: number | null = null;

  for (let i = 0; i < entryCount; i++) {
    const entryOffset = ifdOffset + 2 + i * 12;
    if (entryOffset + 12 > buf.length) break;

    const tag = readU16(buf, entryOffset);
    const type = readU16(buf, entryOffset + 2);

    // Tag 0x0100 = ImageWidth, 0x0101 = ImageLength
    if (tag === 0x0100 || tag === 0x0101) {
      let value: number;
      if (type === 3) {
        // SHORT
        value = readU16(buf, entryOffset + 8);
      } else {
        // LONG or other
        value = readU32(buf, entryOffset + 8);
      }
      if (tag === 0x0100) width = value;
      else height = value;
    }

    if (width !== null && height !== null) {
      return { width, height };
    }
  }

  if (width !== null && height !== null) {
    return { width, height };
  }
  return null;
}

function readWebpDimensions(buf: Buffer): ImageDimensions | null {
  // RIFF....WEBP
  if (
    buf.length < 30 ||
    buf.toString('ascii', 0, 4) !== 'RIFF' ||
    buf.toString('ascii', 8, 12) !== 'WEBP'
  ) {
    return null;
  }

  const chunkType = buf.toString('ascii', 12, 16);

  if (chunkType === 'VP8 ') {
    // Lossy: frame tag (3 bytes) + start code 9D 01 2A + width/height
    if (buf.length < 30) return null;
    if (buf[23] !== 0x9d || buf[24] !== 0x01 || buf[25] !== 0x2a) return null;
    const width = buf.readUInt16LE(26) & 0x3fff;
    const height = buf.readUInt16LE(28) & 0x3fff;
    return { width, height };
  }

  if (chunkType === 'VP8L') {
    // Lossless: signature 0x2F + packed bits
    if (buf.length < 25 || buf[20] !== 0x2f) return null;
    const bits =
      buf[21] | (buf[22] << 8) | (buf[23] << 16) | (buf[24] << 24);
    const width = (bits & 0x3fff) + 1;
    const height = ((bits >>> 14) & 0x3fff) + 1;
    return { width, height };
  }

  if (chunkType === 'VP8X') {
    // Extended: canvas width-1 and height-1 as 24-bit LE at offsets 24 and 27
    if (buf.length < 30) return null;
    const width = (buf[24] | (buf[25] << 8) | (buf[26] << 16)) + 1;
    const height = (buf[27] | (buf[28] << 8) | (buf[29] << 16)) + 1;
    return { width, height };
  }

  return null;
}

function readPsdDimensions(buf: Buffer): ImageDimensions | null {
  // PSD/PSB signature: "8BPS"
  if (
    buf.length < 22 ||
    buf.toString('ascii', 0, 4) !== '8BPS'
  ) {
    return null;
  }
  // Version: 1 = PSD, 2 = PSB
  const version = buf.readUInt16BE(4);
  if (version !== 1 && version !== 2) return null;

  // Rows (height) at offset 14, columns (width) at offset 18 — both UInt32BE
  const height = buf.readUInt32BE(14);
  const width = buf.readUInt32BE(18);
  return { width, height };
}

function readHeicDimensions(buf: Buffer): ImageDimensions | null {
  // HEIC/HEIF: ISOBMFF container starting with 'ftyp' box
  if (buf.length < 12) return null;
  if (buf.toString('ascii', 4, 8) !== 'ftyp') return null;

  const ftypSize = buf.readUInt32BE(0);
  if (ftypSize < 12) return null;

  // Verify major brand or compatible brands include a HEIC/HEIF brand
  const heicBrands = new Set(['heic', 'heis', 'heim', 'heix', 'hevc', 'hevx', 'mif1', 'msf1', 'avif']);
  const major = buf.toString('ascii', 8, 12);
  let isHeic = heicBrands.has(major);
  if (!isHeic) {
    const brandsEnd = Math.min(ftypSize, buf.length);
    for (let i = 16; i + 4 <= brandsEnd; i += 4) {
      if (heicBrands.has(buf.toString('ascii', i, i + 4))) {
        isHeic = true;
        break;
      }
    }
  }
  if (!isHeic) return null;

  // Scan for 'ispe' (Image Spatial Extents) box — holds width and height
  // Structure: size(4) + "ispe"(4) + version(1) + flags(3) + width(4) + height(4) = 20 bytes
  for (let offset = 0; offset + 20 <= buf.length; offset++) {
    if (buf.toString('ascii', offset + 4, offset + 8) !== 'ispe') continue;
    const ispeSize = buf.readUInt32BE(offset);
    if (ispeSize < 20 || offset + ispeSize > buf.length) continue;
    const width = buf.readUInt32BE(offset + 12);
    const height = buf.readUInt32BE(offset + 16);
    if (width > 0 && height > 0) return { width, height };
  }

  return null;
}

/**
 * Reads pixel dimensions from an image file header.
 * Supports PNG, JPEG, GIF, BMP, TIFF, WebP, PSD, and HEIC/HEIF.
 * Returns null for unsupported or unreadable formats.
 */
export function readImageDimensions(filePath: string): ImageDimensions | null {
  try {
    const fd = openSync(filePath, 'r');
    const buf = Buffer.alloc(MAX_HEADER_BYTES);
    const bytesRead = readSync(fd, buf, 0, MAX_HEADER_BYTES, 0);
    closeSync(fd);
    const header = buf.subarray(0, bytesRead);

    if (bytesRead < 10) return null;

    // Try by extension first, then fall back to magic bytes
    const ext = extname(filePath).toLowerCase();

    switch (ext) {
      case '.png':
        return readPngDimensions(header);
      case '.jpg':
      case '.jpeg':
        return readJpegDimensions(header);
      case '.gif':
        return readGifDimensions(header);
      case '.bmp':
        return readBmpDimensions(header);
      case '.tif':
      case '.tiff':
        return readTiffDimensions(header);
      case '.webp':
        return readWebpDimensions(header);
      case '.psd':
      case '.psb':
        return readPsdDimensions(header);
      case '.heic':
      case '.heif':
      case '.avif':
        return readHeicDimensions(header);
    }

    // Magic byte detection fallback
    if (header[0] === 0x89 && header[1] === 0x50) return readPngDimensions(header);
    if (header[0] === 0xff && header[1] === 0xd8) return readJpegDimensions(header);
    if (header.toString('ascii', 0, 3) === 'GIF') return readGifDimensions(header);
    if (header[0] === 0x42 && header[1] === 0x4d) return readBmpDimensions(header);
    if (header.toString('ascii', 0, 2) === 'MM' || header.toString('ascii', 0, 2) === 'II')
      return readTiffDimensions(header);
    if (header.toString('ascii', 0, 4) === 'RIFF' && header.toString('ascii', 8, 12) === 'WEBP')
      return readWebpDimensions(header);
    if (header.toString('ascii', 0, 4) === '8BPS') return readPsdDimensions(header);
    if (header.length >= 12 && header.toString('ascii', 4, 8) === 'ftyp')
      return readHeicDimensions(header);

    return null;
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'EACCES' || code === 'EISDIR') {
      throw err;
    }
    return null;
  }
}
