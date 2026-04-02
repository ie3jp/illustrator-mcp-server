import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { setAppVersion, getAppVersion } from '../../executor/jsx-runner.js';
import { WRITE_IDEMPOTENT_ANNOTATIONS } from '../modify/shared.js';

export function register(server: McpServer): void {
  server.registerTool(
    'set_illustrator_version',
    {
      title: 'Set Illustrator Version',
      description:
        'Set which Illustrator version to target when multiple versions are installed. ' +
        'Specify a version year (e.g. "2024", "2025"). ' +
        'If Illustrator is already running, connects to the running instance regardless of version. ' +
        'If not running, launches the specified version. ' +
        'Use clear: true to reset to default behavior (connect to any running Illustrator).',
      inputSchema: {
        version: z
          .string()
          .regex(/^\d{4}$/, 'Version must be a 4-digit year (e.g. "2025")')
          .optional()
          .describe('Illustrator version year (e.g. "2024", "2025").'),
        clear: z
          .boolean()
          .optional()
          .describe('Reset to default behavior (connect to any running Illustrator).'),
      },
      annotations: WRITE_IDEMPOTENT_ANNOTATIONS,
    },
    async (params) => {
      if (params.clear) {
        setAppVersion(undefined);
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              status: 'cleared',
              message: 'Illustrator version reset. Will connect to any running Illustrator.',
            }),
          }],
        };
      }

      if (!params.version) {
        const current = getAppVersion();
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              currentVersion: current ?? null,
              message: current
                ? `Illustrator ${current} is targeted.`
                : 'No version set. Will connect to any running Illustrator.',
            }),
          }],
        };
      }

      setAppVersion(params.version);
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            status: 'set',
            version: params.version,
            message: `Illustrator ${params.version} targeted. If already running, connects to that instance; otherwise launches ${params.version}.`,
          }),
        }],
      };
    },
  );
}
