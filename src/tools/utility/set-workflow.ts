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
  print: 'page-relative',
  digital: 'page-relative',
};

export function register(server: McpServer): void {
  server.registerTool(
    'set_workflow',
    {
      title: 'Set Workflow',
      description:
        'Set the session-level workflow and default coordinate system. ' +
        'Call this after confirming the user\'s intent (print or digital). ' +
        'Once set, all tools that omit coordinate_system will use the session default. ' +
        'Use action: "clear" to reset to default behavior.',
      inputSchema: {
        workflow: z
          .enum(['print', 'digital'])
          .optional()
          .describe('The workflow type. "print" for press output, "digital" for screen/ebook.'),
        coordinate_system: z
          .enum(['page-relative', 'spread'])
          .optional()
          .describe(
            'Explicit coordinate system override. "page-relative" (default): coordinates relative to page top-left. "spread": pasteboard coordinates.',
          ),
        action: z
          .enum(['clear'])
          .optional()
          .describe('Set to "clear" to reset session to default behavior.'),
      },
      annotations: WRITE_IDEMPOTENT_ANNOTATIONS,
    },
    async (params) => {
      if (params.action === 'clear') {
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
        (params.workflow ? workflowToCoord[params.workflow] : 'page-relative');

      // Infer workflow from coordinate_system when workflow not explicitly provided
      let workflow: WorkflowType;
      if (params.workflow) {
        workflow = params.workflow;
      } else {
        // Both InDesign workflows use page-relative; default to print
        workflow = 'print';
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
