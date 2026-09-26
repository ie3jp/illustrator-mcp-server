import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const readJson = (rel: string) => JSON.parse(readFileSync(join(ROOT, rel), 'utf8'));

describe('Claude Code プラグイン', () => {
  // プラグインは git の main から配られるので、CI がタグから書き換える manifest.json と違い、コミット時点で揃っている必要がある
  it('plugin.json の version が package.json と一致する', () => {
    expect(readJson('plugins/ie3-design-bridge/.claude-plugin/plugin.json').version).toBe(readJson('package.json').version);
  });

  it('marketplace.json がプラグインのディレクトリを指している', () => {
    const market = readJson('.claude-plugin/marketplace.json');
    expect(market.plugins.map((p: { source: string }) => p.source)).toContain('./plugins/ie3-design-bridge');
  });
});
