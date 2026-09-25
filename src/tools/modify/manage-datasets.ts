import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeJsx } from '../../executor/jsx-runner.js';
import { formatToolResult } from '../tool-executor.js';
import { DESTRUCTIVE_ANNOTATIONS } from './shared.js';

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
 *   Document.importVariables(fileSpec: File) → void  (既存の変数・データセットを全置換する)
 *   Document.exportVariables(fileSpec: File) → void
 */
const jsxCode = `
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
// アートボード矩形に掛かる（visibleBounds が交差する）トップレベルのアイテムを z 順の下から集める。
// Layer.pageItems はレイヤー直下のみを返すため、グループの子を二重に拾わない。サブレイヤーは再帰する
function collectTemplateItems(container, abRect, out) {
  var layers = container.layers;
  for (var li = layers.length - 1; li >= 0; li--) {
    var layer = layers[li];
    for (var pi = layer.pageItems.length - 1; pi >= 0; pi--) {
      var it = layer.pageItems[pi];
      var vb = it.visibleBounds; // [left, top, right, bottom]
      if (vb[2] >= abRect[0] && vb[0] <= abRect[2] && vb[3] <= abRect[1] && vb[1] >= abRect[3]) {
        out.push(it);
      }
    }
    collectTemplateItems(layer, abRect, out);
  }
}
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
      var hasBound = false;
      for (var cb = 0; cb < doc.pageItems.length && !hasBound; cb++) {
        try { if (doc.pageItems[cb].contentVariable) hasBound = true; } catch(_e1) {}
        try { if (doc.pageItems[cb].visibilityVariable) hasBound = true; } catch(_e2) {}
      }
      if (!hasBound) {
        writeResultFile(RESULT_PATH, { error: true, message: "Cannot create dataset: no variables are bound to objects. Use bind_variable or import (XML) first." });
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
          csvFile.encoding = "UTF-8";
          csvFile.open("r");
          var csvText = csvFile.read();
          csvFile.close();

          var lines = csvText.split(/\\r?\\n/);
          while (lines.length > 0 && lines[lines.length - 1].replace(/^\\s+|\\s+$/g, "") === "") {
            lines.pop();
          }
          if (lines.length < 2) {
            writeResultFile(RESULT_PATH, { error: true, message: "CSV must have a header row and at least one data row" });
          } else {
            var headers = parseCsvLine(lines[0]);
            for (var hi = 0; hi < headers.length; hi++) {
              headers[hi] = headers[hi].replace(/^\\s+|\\s+$/g, "");
            }

            // テンプレート（アートボード 0）は変更せず、CSV の各行ごとに新しいアートボードへ複製する
            var abRect = doc.artboards[0].artboardRect;
            var abWidth = abRect[2] - abRect[0];
            var abHeight = abRect[1] - abRect[3]; // top - bottom (document coords)

            // アートボード 0 に掛かるトップレベルのアイテムだけを複製元にする
            // （doc.pageItems 全件だと他アートボードの中身まで複製される）
            var origItems = [];
            collectTemplateItems(doc, abRect, origItems);
            if (origItems.length === 0) {
              throw new Error("No objects found on artboard 0 (the import_csv template)");
            }

            // geometricBounds: [left, top, right, bottom]
            var rightOverhang = 0;
            var leftOverhang = 0;
            var topOverhang = 0;
            var bottomOverhang = 0;
            for (var oi = 0; oi < origItems.length; oi++) {
              var gb = origItems[oi].geometricBounds;
              var rOver = gb[2] - abRect[2];
              var lOver = abRect[0] - gb[0];
              var tOver = gb[1] - abRect[1];
              var bOver = abRect[3] - gb[3];
              if (rOver > rightOverhang) rightOverhang = rOver;
              if (lOver > leftOverhang) leftOverhang = lOver;
              if (tOver > topOverhang) topOverhang = tOver;
              if (bOver > bottomOverhang) bottomOverhang = bOver;
            }
            // Spacing = overhang on both sides + 20pt gap
            var hSpacing = rightOverhang + leftOverhang + 20;
            var vSpacing = topOverhang + bottomOverhang + 20;

            // 既存アートボードと重ならないよう、全アートボードの右端より右にグリッドを置く
            var maxRight = abRect[2];
            for (var ai = 0; ai < doc.artboards.length; ai++) {
              var r = doc.artboards[ai].artboardRect;
              if (r[2] > maxRight) maxRight = r[2];
            }
            var gridOffsetX = maxRight + hSpacing - abRect[0];

            // Grid layout: max 4 columns per row
            var maxCols = 4;
            var totalRows = lines.length - 1;
            if (totalRows <= maxCols) maxCols = totalRows;

            var createdIndices = [];
            var uuidWarnings = [];
            for (var ri = 1; ri < lines.length; ri++) {
              var values = parseCsvLine(lines[ri]);
              var rowName = params.dataset_name_prefix
                ? params.dataset_name_prefix + " " + ri
                : values[0] || ("Row " + ri);
              var gridIndex = ri - 1;
              var col = gridIndex % maxCols;
              var row = Math.floor(gridIndex / maxCols);
              var xOffset = gridOffsetX + col * (abWidth + hSpacing);
              var yOffset = row * (abHeight + vSpacing);

              // Document coords: y increases upward, so subtract yOffset
              var newRect = [abRect[0] + xOffset, abRect[1] - yOffset, abRect[2] + xOffset, abRect[3] - yOffset];
              var newAb = doc.artboards.add(newRect);
              newAb.name = rowName;
              invalidateArtboardCache();
              createdIndices.push(doc.artboards.length - 1);

              for (var di = 0; di < origItems.length; di++) {
                var dup = origItems[di].duplicate();
                dup.translate(xOffset, -yOffset);
                // duplicate() は note（UUID）を継承するため、複製側の UUID を子孫まで振り直す
                var uuidWarning = uuidReassignWarning(reassignUUIDDeep(dup), "Copy for row " + ri);
                if (uuidWarning) uuidWarnings.push(uuidWarning);
                // テキスト差し込みもグループ内の子まで含めて走査する
                var dupItems = collectItemWithDescendants(dup);
                for (var dj = 0; dj < dupItems.length; dj++) {
                  var d = dupItems[dj];
                  if (d.typename === "TextFrame") {
                    for (var ci3 = 0; ci3 < headers.length && ci3 < values.length; ci3++) {
                      if (headers[ci3] !== "" && d.name === headers[ci3]) {
                        d.contents = values[ci3];
                        break;
                      }
                    }
                  }
                }
              }
            }

            var verification = [];
            for (var vai = 0; vai < createdIndices.length; vai++) {
              verification.push(verifyArtboardContents(createdIndices[vai]));
            }

            var csvResult = {
              success: true,
              action: "import_csv",
              templateArtboard: 0,
              columns: headers,
              artboards: verification
            };
            if (uuidWarnings.length > 0) csvResult.warnings = uuidWarnings;
            writeResultFile(RESULT_PATH, csvResult);
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
        'List variables/datasets, apply or create datasets, bind variables to objects, import/export variable XML, or generate artboards from CSV. import (XML) replaces ALL existing variables and datasets in the document. import_csv does not create variables or datasets: it copies the objects on artboard 0 (left unchanged as the template) onto one new artboard per CSV row, placed to the right of existing artboards, and sets the text of copied text frames whose name matches a CSV header. Note: Illustrator will be activated (brought to foreground) during execution.',
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
      // import は既存の変数・データセットを全置換する（importVariables の仕様）ため destructive
      annotations: DESTRUCTIVE_ANNOTATIONS,
    },
    async (params) => {
      const result = await executeJsx(jsxCode, params, { activate: true });
      return formatToolResult(result);
    },
  );
}
