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
      // Check that at least one variable is bound to an object
      var hasBound = false;
      for (var cb = 0; cb < doc.pageItems.length && !hasBound; cb++) {
        try { if (doc.pageItems[cb].contentVariable) hasBound = true; } catch(_e1) {}
        try { if (doc.pageItems[cb].visibilityVariable) hasBound = true; } catch(_e2) {}
      }
      if (!hasBound) {
        writeResultFile(RESULT_PATH, { error: true, message: "Cannot create dataset: no variables are bound to objects. Use bind_variable or import_csv first." });
      } else {
        var newDs = doc.dataSets.add();
        if (params.dataset_name) newDs.name = params.dataset_name;
        writeResultFile(RESULT_PATH, { success: true, name: newDs.name, index: doc.dataSets.length - 1 });
      }
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
    } else if (action === "bind_variable") {
      if (!params.variable_name || !params.object_name) {
        writeResultFile(RESULT_PATH, { error: true, message: "variable_name and object_name are required" });
      } else {
        var bindVar = null;
        for (var bv = 0; bv < doc.variables.length; bv++) {
          if (doc.variables[bv].name === params.variable_name) {
            bindVar = doc.variables[bv];
            break;
          }
        }
        if (!bindVar) {
          writeResultFile(RESULT_PATH, { error: true, message: "Variable not found: " + params.variable_name });
        } else {
          var bindItem = null;
          for (var bp = 0; bp < doc.pageItems.length; bp++) {
            if (doc.pageItems[bp].name === params.object_name) {
              bindItem = doc.pageItems[bp];
              break;
            }
          }
          if (!bindItem) {
            writeResultFile(RESULT_PATH, { error: true, message: "Object not found: " + params.object_name });
          } else {
            if (bindVar.kind === VariableKind.TEXTUAL) {
              bindItem.contentVariable = bindVar;
            } else if (bindVar.kind === VariableKind.VISIBILITY) {
              bindItem.visibilityVariable = bindVar;
            } else if (bindVar.kind === VariableKind.IMAGE) {
              bindItem.contentVariable = bindVar;
            } else {
              bindItem.contentVariable = bindVar;
            }
            writeResultFile(RESULT_PATH, { success: true, variable: params.variable_name, object: params.object_name });
          }
        }
      }
    } else if (action === "import_csv") {
      if (!params.file_path) {
        writeResultFile(RESULT_PATH, { error: true, message: "file_path is required for import_csv" });
      } else {
        var csvFile = new File(params.file_path);
        if (!csvFile.exists) {
          writeResultFile(RESULT_PATH, { error: true, message: "File not found: " + params.file_path });
        } else {
          csvFile.open("r");
          csvFile.encoding = "UTF-8";
          var csvText = csvFile.read();
          csvFile.close();

          var lines = csvText.split(/\r?\n/);
          // Remove empty trailing lines
          while (lines.length > 0 && lines[lines.length - 1].replace(/^\s+|\s+$/g, "") === "") {
            lines.pop();
          }
          if (lines.length < 2) {
            writeResultFile(RESULT_PATH, { error: true, message: "CSV must have a header row and at least one data row" });
          } else {
            // Parse CSV header
            var headers = [];
            var rawHeaders = lines[0].split(",");
            for (var hi = 0; hi < rawHeaders.length; hi++) {
              headers.push(rawHeaders[hi].replace(/^\s+|\s+$/g, "").replace(/^"|"$/g, ""));
            }

            // Create or find variables and bind to objects with matching names
            var boundCount = 0;
            for (var vi = 0; vi < headers.length; vi++) {
              var colName = headers[vi];
              if (colName === "") continue;

              // Find or create variable
              var csvVar = null;
              for (var ev = 0; ev < doc.variables.length; ev++) {
                if (doc.variables[ev].name === colName) {
                  csvVar = doc.variables[ev];
                  break;
                }
              }
              if (!csvVar) {
                csvVar = doc.variables.add();
                csvVar.name = colName;
                csvVar.kind = VariableKind.TEXTUAL;
              }

              // Find object with matching name and bind
              for (var oi = 0; oi < doc.pageItems.length; oi++) {
                if (doc.pageItems[oi].name === colName) {
                  doc.pageItems[oi].contentVariable = csvVar;
                  boundCount++;
                  break;
                }
              }
            }

            // Parse CSV values (simple parser handling quoted fields)
            function parseCsvLine(line) {
              var result = [];
              var current = "";
              var inQuotes = false;
              for (var ci = 0; ci < line.length; ci++) {
                var ch = line.charAt(ci);
                if (inQuotes) {
                  if (ch === '"' && ci + 1 < line.length && line.charAt(ci + 1) === '"') {
                    current += '"';
                    ci++;
                  } else if (ch === '"') {
                    inQuotes = false;
                  } else {
                    current += ch;
                  }
                } else {
                  if (ch === '"') {
                    inQuotes = true;
                  } else if (ch === ',') {
                    result.push(current);
                    current = "";
                  } else {
                    current += ch;
                  }
                }
              }
              result.push(current);
              return result;
            }

            // Create datasets from rows
            var datasetNames = [];
            for (var ri = 1; ri < lines.length; ri++) {
              var values = parseCsvLine(lines[ri]);

              // Set text frame contents to this row's values
              for (var ci2 = 0; ci2 < headers.length && ci2 < values.length; ci2++) {
                var hdr = headers[ci2];
                if (hdr === "") continue;
                for (var pi = 0; pi < doc.pageItems.length; pi++) {
                  if (doc.pageItems[pi].name === hdr && doc.pageItems[pi].typename === "TextFrame") {
                    doc.pageItems[pi].contents = values[ci2];
                    break;
                  }
                }
              }

              // Create dataset capturing current state
              var dsName = params.dataset_name_prefix
                ? params.dataset_name_prefix + " " + ri
                : values[0] || ("Row " + ri);
              var csvDs = doc.dataSets.add();
              csvDs.name = dsName;
              csvDs.update();
              datasetNames.push(dsName);
            }

            // Display first dataset
            if (doc.dataSets.length > 0) {
              doc.dataSets[0].display();
            }

            writeResultFile(RESULT_PATH, {
              success: true,
              action: "import_csv",
              variables: headers,
              bound: boundCount,
              datasets: datasetNames
            });
          }
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
        'List variables/datasets, apply or create datasets, bind variables to objects, import CSV/XML. CSV headers are auto-bound to objects with matching names. Note: Illustrator will be activated (brought to foreground) during execution.',
      inputSchema: {
        action: z
          .enum([
            'list_variables',
            'list_datasets',
            'apply_dataset',
            'create_dataset',
            'bind_variable',
            'import_csv',
            'import',
            'export',
          ])
          .describe('Action to perform'),
        dataset_name: z
          .string()
          .optional()
          .describe('Dataset name (for apply_dataset, create_dataset)'),
        variable_name: z
          .string()
          .optional()
          .describe('Variable name (for bind_variable)'),
        object_name: z
          .string()
          .optional()
          .describe('Object name to bind variable to (for bind_variable)'),
        dataset_name_prefix: z
          .string()
          .optional()
          .describe('Prefix for auto-generated dataset names (for import_csv). If omitted, first column value is used.'),
        file_path: z
          .string()
          .optional()
          .describe('File path (XML for import/export, CSV for import_csv)'),
      },
      annotations: WRITE_ANNOTATIONS,
    },
    async (params) => {
      const result = await executeJsx(jsxCode, params, { activate: true });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );
}
