import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  type CoordinateSystem,
  type WorkflowType,
  setSession,
  clearSession,
  getSessionWorkflow,
  getSessionCoordinateSystem,
} from '../session.js';

const workflowToCoord: Record<
  Exclude<WorkflowType, 'unknown'>,
  CoordinateSystem
> = {
  web: 'artboard-web',
  print: 'document',
  video: 'artboard-web',
};

export function register(server: McpServer): void {
  server.registerTool(
    'set_workflow',
    {
      title: 'Set Workflow',
      description:
        'Set the session-level workflow and default coordinate system. ' +
        'Call this after confirming the user\'s intent (web, print, or video). ' +
        'Once set, all tools that omit coordinate_system will use the session default. ' +
        'Use clear: true to reset to the default behavior (artboard-web).',
      inputSchema: {
        workflow: z
          .enum(['web', 'print', 'video'])
          .optional()
          .describe('The workflow type. Determines the default coordinate system.'),
        coordinate_system: z
          .enum(['artboard-web', 'document'])
          .optional()
          .describe(
            'Explicit coordinate system override. If provided with workflow, overrides the workflow-derived default.',
          ),
        clear: z
          .boolean()
          .optional()
          .describe('Reset session to default behavior (auto-detect from document).'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params) => {
      if (params.clear) {
        clearSession();
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                status: 'cleared',
                message:
                  'Session reset. coordinate_system will auto-detect from document.',
              }),
            },
          ],
        };
      }

      if (!params.workflow && !params.coordinate_system) {
        // Return current state
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                currentWorkflow: getSessionWorkflow(),
                currentCoordinateSystem: getSessionCoordinateSystem(),
                message: getSessionWorkflow()
                  ? `Session is set to ${getSessionWorkflow()} workflow (${getSessionCoordinateSystem()}).`
                  : 'No session workflow set. Auto-detecting from document.',
              }),
            },
          ],
        };
      }

      const workflow: WorkflowType = params.workflow ?? 'unknown';
      const coordinateSystem: CoordinateSystem =
        params.coordinate_system ??
        (params.workflow ? workflowToCoord[params.workflow] : 'artboard-web');

      setSession(workflow, coordinateSystem);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              status: 'set',
              workflow,
              coordinateSystem,
              message: `Session set to ${workflow} workflow. Default coordinate system: ${coordinateSystem}.`,
            }),
          },
        ],
      };
    },
  );
}
