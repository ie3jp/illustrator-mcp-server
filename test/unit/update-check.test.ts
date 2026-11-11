import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  checkForUpdate,
  isNewerVersion,
  isUpdateCheckDisabled,
  resetUpdateNoticeForTest,
  takeUpdateNotice,
} from '../../src/update-check.js';
import { appendUpdateNotice } from '../../src/server.js';

const respond = (body: unknown, ok = true) =>
  vi.fn(async () => ({ ok, json: async () => body }));

afterEach(() => resetUpdateNoticeForTest());

describe('isNewerVersion', () => {
  it.each([
    ['1.13.1', '1.13.0', true],
    ['1.14.0', '1.13.9', true],
    ['2.0.0', '1.99.99', true],
    ['1.13.0', '1.13.0', false],
    ['1.12.9', '1.13.0', false],
    ['1.10.0', '1.9.0', true], // 文字列比較だと逆になる
    ['v1.14.0', '1.13.0', true],
    ['garbage', '1.13.0', false],
  ])('%s vs %s -> %s', (latest, current, expected) => {
    expect(isNewerVersion(latest, current)).toBe(expected);
  });
});

describe('isUpdateCheckDisabled', () => {
  it.each([
    [undefined, false],
    ['', false],
    ['0', false],
    ['false', false],
    ['1', true],
    ['true', true],
  ])('ILLUSTRATOR_MCP_NO_UPDATE_CHECK=%s -> %s', (v, expected) => {
    const env = v === undefined ? {} : { ILLUSTRATOR_MCP_NO_UPDATE_CHECK: v };
    expect(isUpdateCheckDisabled(env)).toBe(expected);
  });
});

describe('checkForUpdate', () => {
  it('holds a notice once when npm has a newer version', async () => {
    const fetchImpl = respond({ version: '1.14.0' });
    const notice = await checkForUpdate('1.13.0', { env: {}, fetchImpl });
    expect(notice).toContain('1.14.0');
    expect(notice).toContain('running 1.13.0');
    expect(notice).toContain('illustrator-mcp-server@latest');
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(takeUpdateNotice()).toBe(notice);
    expect(takeUpdateNotice()).toBeNull();
  });

  it('stays quiet when already up to date', async () => {
    expect(await checkForUpdate('1.14.0', { env: {}, fetchImpl: respond({ version: '1.14.0' }) })).toBeNull();
    expect(takeUpdateNotice()).toBeNull();
  });

  it('does not touch the network when disabled', async () => {
    const fetchImpl = respond({ version: '9.0.0' });
    expect(await checkForUpdate('1.13.0', { env: { ILLUSTRATOR_MCP_NO_UPDATE_CHECK: '1' }, fetchImpl })).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('does not check when the running version is unknown', async () => {
    const fetchImpl = respond({ version: '9.0.0' });
    // readPackageVersion() の既定値。数値部分は 0.0.0 と読めてしまうので、誤報しないことを確かめる
    expect(await checkForUpdate('0.0.0-unknown', { env: {}, fetchImpl })).toBeNull();
    expect(await checkForUpdate('unknown', { env: {}, fetchImpl })).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    ['network error', vi.fn(async () => { throw new Error('offline'); })],
    ['HTTP error', respond({}, false)],
    ['malformed body', respond({ nope: true })],
  ])('swallows %s', async (_label, fetchImpl) => {
    expect(await checkForUpdate('1.13.0', { env: {}, fetchImpl })).toBeNull();
    expect(takeUpdateNotice()).toBeNull();
  });
});

describe('appendUpdateNotice', () => {
  const result = { content: [{ type: 'text', text: '{"success":true}' }] };

  it('adds the notice as a separate text item, only on the first response', async () => {
    await checkForUpdate('1.13.0', { env: {}, fetchImpl: respond({ version: '1.14.0' }) });
    const first = appendUpdateNotice(result) as typeof result;
    expect(first.content).toHaveLength(2);
    expect(first.content[0]).toEqual(result.content[0]);
    expect(first.content[1].text).toContain('Update available');
    expect(appendUpdateNotice(result)).toBe(result);
  });

  it('keeps isError on failed responses', async () => {
    await checkForUpdate('1.13.0', { env: {}, fetchImpl: respond({ version: '1.14.0' }) });
    const failed = { content: [{ type: 'text', text: '{"error":true}' }], isError: true };
    expect(appendUpdateNotice(failed)).toMatchObject({ isError: true });
  });

  it('leaves responses untouched when there is no notice', () => {
    expect(appendUpdateNotice(result)).toBe(result);
  });
});
