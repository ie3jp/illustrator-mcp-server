import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeJsx } from '../../executor/jsx-runner.js';
import { WRITE_ANNOTATIONS } from './shared.js';

/**
 * manage_datasets — 変数・データセットの一覧・適用・作成・インポート/エクスポート
 *
 * @see https://ai-scripting.docsforadobe.dev/jsobjref/Dataset/ — Dataset, Variable, Document.importVariables()
 *
 * JSX API:
 *   Document.variables → Variables コレクション
 *   Variable.kind → VariableKind (TEXTUAL | VISIBILITY | IMAGE | GRAPH)
 *   Document.dataSets → Datasets コレクション
 *   Dataset.display() → void  (データセットを表示)
 *   Datasets.add() → Dataset
 *   Document.importVariables(fileSpec: File) → void
 *   Document.exportVariables(fileSpec: File) → void
 */
const jsxCode = `
var preflight = preflightChecks();
if (preflight) {
  writeResultFile(RESULT_PATH, preflight);
} else {
  try {
    var params = readParamsFile(PARAMS_PATH);
    var doc = app.activeDocument;
    var action = params.action;

    if (action === "list_variables") {
      var vars = [];
      for (var i = 0; i < doc.variables.length; i++) {
        var v = doc.variables[i];
        var kindStr = "unknown";
        if (v.kind === VariableKind.TEXTUAL) kindStr = "textual";
        else if (v.kind === VariableKind.VISIBILITY) kindStr = "visibility";
        else if (v.kind === VariableKind.IMAGE) kindStr = "image";
        else if (v.kind === VariableKind.GRAPH) kindStr = "graph";
        vars.push({ name: v.name, kind: kindStr });
      }
      writeResultFile(RESULT_PATH, { count: vars.length, variables: vars });
    } else if (action === "list_datasets") {
      var ds = [];
      for (var j = 0; j < doc.dataSets.length; j++) {
        ds.push({ index: j, name: doc.dataSets[j].name });
      }
      writeResultFile(RESULT_PATH, { count: ds.length, datasets: ds });
    } else if (action === "apply_dataset") {
      if (!params.dataset_name) {
        writeResultFile(RESULT_PATH, { error: true, message: "dataset_name is required" });
      } else {
        var found = false;
        for (var k = 0; k < doc.dataSets.length; k++) {
          if (doc.dataSets[k].name === params.dataset_name) {
            doc.dataSets[k].display();
            found = true;
            break;
          }
        }
        if (found) {
          writeResultFile(RESULT_PATH, { success: true, dataset: params.dataset_name });
        } else {
          writeResultFile(RESULT_PATH, { error: true, message: "Dataset not found: " + params.dataset_name });
        }
      }
    } else if (action === "create_dataset") {
      var newDs = doc.dataSets.add();
      if (params.dataset_name) newDs.name = params.dataset_name;
      writeResultFile(RESULT_PATH, { success: true, name: newDs.name, index: doc.dataSets.length - 1 });
    } else if (action === "import") {
      if (!params.file_path) {
        writeResultFile(RESULT_PATH, { error: true, message: "file_path is required for import" });
      } else {
        var impFile = new File(params.file_path);
        if (!impFile.exists) {
          writeResultFile(RESULT_PATH, { error: true, message: "File not found: " + params.file_path });
        } else {
          doc.importVariables(impFile);
          writeResultFile(RESULT_PATH, { success: true, action: "import", path: params.file_path });
        }
      }
    } else if (action === "export") {
      if (!params.file_path) {
        writeResultFile(RESULT_PATH, { error: true, message: "file_path is required for export" });
      } else {
        var expFile = new File(params.file_path);
        doc.exportVariables(expFile);
        writeResultFile(RESULT_PATH, { success: true, action: "export", path: params.file_path });
      }
    } else {
      writeResultFile(RESULT_PATH, { error: true, message: "Unknown action: " + action });
    }
  } catch (e) {
    writeResultFile(RESULT_PATH, { error: true, message: "manage_datasets failed: " + e.message, line: e.line });
  }
}
`;

export function register(server: McpServer): void {
  server.registerTool(
    'manage_datasets',
    {
      title: 'Manage Variables & Datasets',
      description:
        'List variables/datasets, apply or create datasets, import/export variables XML. Note: Illustrator will be activated (brought to foreground) during execution.',
      inputSchema: {
        action: z
          .enum([
            'list_variables',
            'list_datasets',
            'apply_dataset',
            'create_dataset',
            'import',
            'export',
          ])
          .describe('Action to perform'),
        dataset_name: z
          .string()
          .optional()
          .describe('Dataset name (for apply_dataset, create_dataset)'),
        file_path: z
          .string()
          .optional()
          .describe('XML file path (for import/export)'),
      },
      annotations: WRITE_ANNOTATIONS,
    },
    async (params) => {
      const result = await executeJsx(jsxCode, params, { activate: true });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );
}
