/**
 * 新しい版が出ていることを利用者に知らせる。
 *
 * 自動更新されない入れ方が多いため（.mcpb は更新されず、版指定なしの `npx illustrator-mcp-server` は
 * 最初に取得した版を npx のキャッシュから使い続ける）、起動時に npm の最新版を一度だけ調べ、
 * 古ければ最初のツール応答に一度だけ知らせを添える。
 *
 * - 通信に失敗しても黙って何もしない（オフラインでもツールは普段どおり動く）
 * - `ILLUSTRATOR_MCP_NO_UPDATE_CHECK=1` で無効化できる
 * - 起動時の initialize には間に合わないため、server の instructions ではなくツール応答に載せる
 */

const LATEST_URL = 'https://registry.npmjs.org/illustrator-mcp-server/latest';
const RELEASES_URL = 'https://github.com/ie3jp/illustrator-mcp-server/releases/latest';
const FETCH_TIMEOUT_MS = 3000;

let pendingNotice: string | null = null;

/** "1.13.0" / "v1.13.0" / "1.13.0-beta.1" を [1, 13, 0] にする。読めなければ null */
function parseCore(version: string): [number, number, number] | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version.trim());
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** latest が current より新しいか。どちらかが読めなければ false（誤った知らせを出さない） */
export function isNewerVersion(latest: string, current: string): boolean {
  const a = parseCore(latest);
  const b = parseCore(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
}

export function buildUpdateNotice(latest: string, current: string): string {
  return [
    `[illustrator-mcp-server] Update available: ${latest} (running ${current}). Please tell the user:`,
    `- Installed via the .mcpb extension: download the new .mcpb from ${RELEASES_URL} and install it again.`,
    '- Installed via npx: use `npx -y illustrator-mcp-server@latest` in the MCP config. Without `@latest`, npx keeps reusing the version it cached first. Then restart the client.',
    '- Installed as the Claude Code plugin: restart Claude Code (the plugin already uses @latest).',
    'Set ILLUSTRATOR_MCP_NO_UPDATE_CHECK=1 to turn this check off.',
  ].join('\n');
}

export function isUpdateCheckDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = env['ILLUSTRATOR_MCP_NO_UPDATE_CHECK'];
  return v !== undefined && v !== '' && v !== '0' && v.toLowerCase() !== 'false';
}

type FetchLike = (url: string, init: { signal: AbortSignal }) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

/**
 * npm の最新版を調べ、新しければ知らせを保留する。失敗は握りつぶす（起動を妨げない）。
 * 戻り値はテスト用（保留した知らせ、または null）
 */
export async function checkForUpdate(
  currentVersion: string,
  options: { env?: NodeJS.ProcessEnv; fetchImpl?: FetchLike; timeoutMs?: number } = {},
): Promise<string | null> {
  if (isUpdateCheckDisabled(options.env)) return null;
  // 版が読めない配置（readPackageVersion の '0.0.0-unknown'）では比べようがないので調べない
  if (!parseCore(currentVersion) || currentVersion.includes('unknown')) return null;
  const fetchImpl = options.fetchImpl ?? (globalThis.fetch as unknown as FetchLike | undefined);
  if (!fetchImpl) return null;

  try {
    const res = await fetchImpl(LATEST_URL, { signal: AbortSignal.timeout(options.timeoutMs ?? FETCH_TIMEOUT_MS) });
    if (!res.ok) return null;
    const body = (await res.json()) as { version?: unknown };
    if (typeof body.version !== 'string' || !isNewerVersion(body.version, currentVersion)) return null;
    pendingNotice = buildUpdateNotice(body.version, currentVersion);
    console.error(pendingNotice);
    return pendingNotice;
  } catch {
    return null;
  }
}

/** 保留中の知らせを一度だけ取り出す（2 回目以降は null） */
export function takeUpdateNotice(): string | null {
  const notice = pendingNotice;
  pendingNotice = null;
  return notice;
}

/** テスト用 */
export function resetUpdateNoticeForTest(): void {
  pendingNotice = null;
}
