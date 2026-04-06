/**
 * E2E テスト共有インフラ
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { writeFileSync } from 'fs';
import { deflateSync } from 'zlib';

// ── ANSI カラー ──

const c = {
  reset:   '\x1b[0m',
  bold:    '\x1b[1m',
  dim:     '\x1b[2m',
  green:   '\x1b[32m',
  red:     '\x1b[31m',
  yellow:  '\x1b[33m',
  cyan:    '\x1b[36m',
  magenta: '\x1b[35m',
  white:   '\x1b[37m',
  gray:    '\x1b[90m',
  bgGreen: '\x1b[42m',
  bgRed:   '\x1b[41m',
  bgCyan:  '\x1b[46m',
  bgYellow: '\x1b[43m',
  black:   '\x1b[30m',
};

// ── 定数 ──

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
let phasePassCount = 0;
let phaseFailCount = 0;

// ── 表示ユーティリティ ──

export function printHeader(): void {
  console.log('');
  console.log(`  ${c.bgCyan}${c.black}${c.bold} ILLUSTRATOR MCP ${c.reset}  ${c.bold}E2E Test Suite${c.reset}`);
  console.log(`  ${c.gray}${'─'.repeat(46)}${c.reset}`);
  console.log('');
}

export function printPhase(num: number, label: string): void {
  // 前の Phase のサマリを出力（Phase 0 以降）
  if (num > 0) printPhaseSummary();
  phasePassCount = 0;
  phaseFailCount = 0;
  console.log('');
  console.log(`  ${c.bgCyan}${c.black} ${num} ${c.reset} ${c.bold}${c.cyan}${label}${c.reset}`);
  console.log('');
}

function printPhaseSummary(): void {
  const total = phasePassCount + phaseFailCount;
  if (total === 0) return;
  const status = phaseFailCount === 0
    ? `${c.green}${phasePassCount}/${total} passed${c.reset}`
    : `${c.red}${phaseFailCount} failed${c.reset}${c.gray}, ${phasePassCount} passed${c.reset}`;
  console.log(`${c.gray}     ${'·'.repeat(40)}  ${status}${c.reset}`);
}

export function printStatus(msg: string): void {
  console.log(`  ${c.gray}${msg}${c.reset}`);
}

function formatDuration(ms: number): string {
  if (ms < 100) return `${c.green}${ms}ms${c.reset}`;
  if (ms < 1000) return `${c.gray}${ms}ms${c.reset}`;
  return `${c.yellow}${(ms / 1000).toFixed(1)}s${c.reset}`;
}

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
      phasePassCount++;
      const retry = attempt > 0 ? ` ${c.yellow}[retry ${attempt}]${c.reset}` : '';
      console.log(`     ${c.green}\u2713${c.reset} ${c.white}${name}${c.reset}  ${formatDuration(duration)}${retry}`);
      return;
    } catch (e) {
      lastError = e;
    }
  }
  const duration = Date.now() - start;
  const message = lastError instanceof Error ? (lastError as Error).message : String(lastError);
  results.push({ name, status: 'fail', message, duration });
  phaseFailCount++;
  console.log(`     ${c.red}\u2717 ${name}${c.reset}  ${formatDuration(duration)}`);
  console.log(`       ${c.red}${c.dim}\u2514 ${message}${c.reset}`);
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

export function printResults(startTime: number): void {
  // 最後の Phase サマリ
  printPhaseSummary();

  const passed = results.filter((r) => r.status === 'pass').length;
  const failed = results.filter((r) => r.status === 'fail').length;
  const skipped = results.filter((r) => r.status === 'skip').length;
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log('');
  console.log(`  ${c.gray}${'━'.repeat(50)}${c.reset}`);
  console.log('');

  if (failed === 0) {
    console.log(`  ${c.bgGreen}${c.black}${c.bold} PASS ${c.reset}  ${c.green}${c.bold}All ${passed} tests passed${c.reset}  ${c.gray}(${elapsed}s)${c.reset}`);
  } else {
    console.log(`  ${c.bgRed}${c.black}${c.bold} FAIL ${c.reset}  ${c.red}${c.bold}${failed} failed${c.reset}${c.gray}, ${passed} passed, ${results.length} total${c.reset}  ${c.gray}(${elapsed}s)${c.reset}`);
  }
  if (skipped > 0) {
    console.log(`         ${c.yellow}${skipped} skipped${c.reset}`);
  }

  if (failed > 0) {
    console.log('');
    console.log(`  ${c.red}${c.bold}Failures:${c.reset}`);
    for (const r of results.filter((r) => r.status === 'fail')) {
      console.log(`  ${c.red}\u2717 ${r.name}${c.reset}`);
      console.log(`    ${c.dim}${r.message}${c.reset}`);
    }
  }

  console.log('');
  process.exit(failed > 0 ? 1 : 0);
}
