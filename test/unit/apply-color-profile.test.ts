import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/executor/jsx-runner.js', () => ({
  executeJsx: vi.fn(),
  executeJsxHeavy: vi.fn(),
}));

vi.mock('../../src/tools/session.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/tools/session.js')>();
  return {
    ...actual,
    invalidateAutoDetectCache: vi.fn(),
  };
});

import { executeJsx } from '../../src/executor/jsx-runner.js';
import { invalidateAutoDetectCache } from '../../src/tools/session.js';
import { register } from '../../src/tools/modify/apply-color-profile.js';

type ToolHandler = (params: Record<string, unknown>) => Promise<unknown>;

function captureToolHandler(): ToolHandler {
  let handler: ToolHandler | undefined;
  const server = {
    registerTool: vi.fn((_name: string, _config: unknown, registeredHandler: ToolHandler) => {
      handler = registeredHandler;
    }),
  } as unknown as McpServer;
  register(server);
  if (!handler) throw new Error('Tool handler was not registered');
  return handler;
}

const mockExecuteJsx = vi.mocked(executeJsx);
const mockInvalidate = vi.mocked(invalidateAutoDetectCache);
const assignColorProfile = captureToolHandler();

describe('assign_color_profile', () => {
  beforeEach(() => {
    mockExecuteJsx.mockReset();
    mockInvalidate.mockReset();
  });

  // colorProfile は座標系の自動検出（print/web）の入力なので、書き換えたらキャッシュを捨てる
  it('invalidates the auto-detect cache after assigning a profile', async () => {
    mockExecuteJsx.mockResolvedValue({ assigned: true });
    await assignColorProfile({ profile: 'Japan Color 2001 Coated' });
    expect(mockInvalidate).toHaveBeenCalledTimes(1);
  });

  it('invalidates the cache even when the JSX fails', async () => {
    mockExecuteJsx.mockRejectedValue(new Error('Failed to apply profile'));
    await expect(assignColorProfile({ profile: 'x' })).rejects.toThrow('Failed to apply profile');
    expect(mockInvalidate).toHaveBeenCalledTimes(1);
  });
});
