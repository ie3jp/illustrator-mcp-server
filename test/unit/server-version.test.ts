import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';
import { readPackageVersion } from '../../src/server.js';

describe('readPackageVersion', () => {
  // serverInfo.version が手書き定数（旧: '1.2.4'）で package.json とずれていた
  it('returns the version from package.json', () => {
    const pkg = JSON.parse(
      readFileSync(new URL('../../package.json', import.meta.url), 'utf-8'),
    ) as { version: string };
    expect(readPackageVersion()).toBe(pkg.version);
  });
});
