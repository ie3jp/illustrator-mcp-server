import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';
import { readPackageVersion } from '../../src/server.js';

describe('readPackageVersion', () => {
  it('returns the version from package.json', () => {
    const pkg = JSON.parse(
      readFileSync(new URL('../../package.json', import.meta.url), 'utf-8'),
    ) as { version: string };
    expect(readPackageVersion()).toBe(pkg.version);
  });
});
