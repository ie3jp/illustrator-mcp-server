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
import { WRITE_IDEMPOTENT_ANNOTATIONS } from '../modify/shared.js';

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
        'Use clear: true to reset to auto-detection from document (CMYK/print → document coords, RGB/web → artboard-web).',
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
      annotations: WRITE_IDEMPOTENT_ANNOTATIONS,
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

      const coordinateSystem: CoordinateSystem =
        params.coordinate_system ??
        (params.workflow ? workflowToCoord[params.workflow] : 'artboard-web');
      // workflow が未指定の場合は coordinate_system から推定（不明なら 'unknown'）
      let workflow: WorkflowType;
      if (params.workflow) {
        workflow = params.workflow;
      } else if (coordinateSystem === 'document') {
        workflow = 'print';
      } else {
        workflow = 'web';
      }

      setSession(workflow, coordinateSystem);

      const note = !params.workflow
        ? ` (workflow inferred as "${workflow}" from coordinate_system)`
        : '';

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              status: 'set',
              workflow,
              coordinateSystem,
              message: `Session set to ${workflow} workflow. Default coordinate system: ${coordinateSystem}.${note}`,
            }),
          },
        ],
      };
    },
  );
}
