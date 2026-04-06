/**
 * E2E テスト共有インフラ
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { writeFileSync } from 'fs';
import { deflateSync } from 'zlib';

// ── 定数 ──

export const PASS = '\u2713';
export const FAIL = '\u2717';

export const DOC_WIDTH = 800;
export const DOC_HEIGHT = 600;
export const DOC_COLOR_MODE = 'rgb';
export const TMP_DIR = '/tmp/illustrator-mcp-e2e-test';

export const TEST_IMG_WIDTH = 100;
export const TEST_IMG_HEIGHT = 100;
export const TEST_IMG_PATH_LINKED = `${TMP_DIR}/e2e-test-image.png`;
export const TEST_IMG_PATH_EMBEDDED = `${TMP_DIR}/e2e-test-image-embed.png`;
export const TEST_IMG_PLACE_SIZE_PT = 100;
export const TEST_IMG_EXPECTED_DPI = 72;

// ── テスト結果 ──

export interface TestResult {
  name: string;
  status: 'pass' | 'fail' | 'skip';
  message?: string;
  duration?: number;
}

export const results: TestResult[] = [];

// ── クライアント ──

export async function createClient(): Promise<Client> {
  const transport = new StdioClientTransport({
    command: 'node',
    args: ['dist/index.js'],
  });
  const client = new Client({ name: 'e2e-test', version: '1.0.0' });
  await client.connect(transport);
  return client;
}

export async function callTool(client: Client, name: string, params: Record<string, unknown> = {}): Promise<unknown> {
  const result = await client.callTool({ name, arguments: params });
  const content = result.content as Array<{ type: string; text: string }>;
  if (!content || content.length === 0) throw new Error('No content in response');

  for (let i = content.length - 1; i >= 0; i--) {
    if (content[i].type === 'text') {
      try {
        return JSON.parse(content[i].text);
      } catch { /* not JSON, try next */ }
    }
  }
  if (content[0].type === 'text') {
    return { error: true, message: content[0].text };
  }
  throw new Error('No text content in response');
}

// ── テストランナー ──

export async function test(name: string, fn: () => Promise<void>, retries = 1): Promise<void> {
  const start = Date.now();
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 500));
      await fn();
      const duration = Date.now() - start;
      results.push({ name, status: 'pass', duration });
      if (attempt > 0) {
        console.log(`  ${PASS} ${name} (${duration}ms) [retry ${attempt}]`);
      } else {
        console.log(`  ${PASS} ${name} (${duration}ms)`);
      }
      return;
    } catch (e) {
      lastError = e;
    }
  }
  const duration = Date.now() - start;
  const message = lastError instanceof Error ? (lastError as Error).message : String(lastError);
  results.push({ name, status: 'fail', message, duration });
  console.log(`  ${FAIL} ${name} (${duration}ms)`);
  console.log(`    -> ${message}`);
}

// ── アサーション ──

export function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

export function assertClose(actual: number, expected: number, message: string, tolerance = 2): void {
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(`${message}: expected ~${expected}, got ${actual}`);
  }
}

// ── PNG 生成 ──

export function generateTestPng(filePath: string, width: number, height: number): void {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8;  // bit depth
  ihdrData[9] = 2;  // color type: RGB
  ihdrData[10] = 0; // compression
  ihdrData[11] = 0; // filter
  ihdrData[12] = 0; // interlace
  const ihdr = createPngChunk('IHDR', ihdrData);

  const rawData = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    const rowOffset = y * (1 + width * 3);
    rawData[rowOffset] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const pixOffset = rowOffset + 1 + x * 3;
      rawData[pixOffset] = 255;     // R
      rawData[pixOffset + 1] = 0;   // G
      rawData[pixOffset + 2] = 0;   // B
    }
  }
  const idat = createPngChunk('IDAT', deflateSync(rawData));
  const iend = createPngChunk('IEND', Buffer.alloc(0));
  writeFileSync(filePath, Buffer.concat([signature, ihdr, idat, iend]));
}

function createPngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuffer = Buffer.from(type, 'ascii');
  const crcInput = Buffer.concat([typeBuffer, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// ── 結果レポート ──

export function printResults(): void {
  const passed = results.filter((r) => r.status === 'pass').length;
  const failed = results.filter((r) => r.status === 'fail').length;
  const skipped = results.filter((r) => r.status === 'skip').length;

  console.log('\n' + '='.repeat(50));
  console.log(`結果: ${passed} passed, ${failed} failed, ${skipped} skipped / ${results.length} total`);

  if (failed > 0) {
    console.log('\n失敗したテスト:');
    for (const r of results.filter((r) => r.status === 'fail')) {
      console.log(`  ${FAIL} ${r.name}: ${r.message}`);
    }
  }

  process.exit(failed > 0 ? 1 : 0);
}
