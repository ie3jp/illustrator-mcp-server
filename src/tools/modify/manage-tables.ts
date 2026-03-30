import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeJsx } from '../../executor/jsx-runner.js';
import { WRITE_ANNOTATIONS, DESTRUCTIVE_ANNOTATIONS } from './shared.js';

const jsxCode = `
var preflight = preflightChecks();
if (preflight) {
  writeResultFile(RESULT_PATH, preflight);
} else {
  try {
    var params = readParamsFile(PARAMS_PATH);
    var doc = app.activeDocument;
    var action = params.action;

    function getTableInfo(table) {
      return {
        rows: table.rows.length,
        columns: table.columns.length,
        bodyRowCount: table.bodyRowCount,
        headerRowCount: table.headerRowCount,
        footerRowCount: table.footerRowCount
      };
    }

    if (action === "create") {
      if (!params.uuid) {
        writeResultFile(RESULT_PATH, { error: true, message: "uuid of a text frame is required for create" });
      } else {
        var tf = findItemByUUID(params.uuid);
        if (!tf) {
          writeResultFile(RESULT_PATH, { error: true, message: "Text frame not found: " + params.uuid });
        } else if (tf.typename !== "TextFrame") {
          writeResultFile(RESULT_PATH, { error: true, message: "Object is not a TextFrame" });
        } else {
          var rows = params.rows || 3;
          var cols = params.columns || 3;
          // Insert table at insertion point of the text frame
          var ip = tf.insertionPoints.item(0);
          var table = ip.tables.add({ bodyRowCount: rows, columnCount: cols });
          writeResultFile(RESULT_PATH, { success: true, action: "create", tableIndex: 0, tableInfo: getTableInfo(table) });
        }
      }

    } else if (action === "set_cell") {
      if (!params.uuid) {
        writeResultFile(RESULT_PATH, { error: true, message: "uuid of a text frame is required for set_cell" });
      } else {
        var tf2 = findItemByUUID(params.uuid);
        if (!tf2 || tf2.typename !== "TextFrame") {
          writeResultFile(RESULT_PATH, { error: true, message: "TextFrame not found: " + params.uuid });
        } else {
          var tables2 = tf2.tables;
          var tableIdx = params.table_index || 0;
          if (tableIdx >= tables2.length) {
            writeResultFile(RESULT_PATH, { error: true, message: "Table index out of range: " + tableIdx });
          } else {
            var tbl = tables2.item(tableIdx);
            var row = params.row || 0;
            var col = params.column || 0;
            var cell = tbl.cells.item(row * tbl.columns.length + col);
            if (typeof params.contents === "string") {
              cell.contents = params.contents;
            }
            writeResultFile(RESULT_PATH, { success: true, action: "set_cell", row: row, column: col, contents: cell.contents });
          }
        }
      }

    } else if (action === "add_row") {
      if (!params.uuid) {
        writeResultFile(RESULT_PATH, { error: true, message: "uuid is required for add_row" });
      } else {
        var tf3 = findItemByUUID(params.uuid);
        if (!tf3 || tf3.typename !== "TextFrame") {
          writeResultFile(RESULT_PATH, { error: true, message: "TextFrame not found: " + params.uuid });
        } else {
          var tableIdx3 = params.table_index || 0;
          var tbl3 = tf3.tables.item(tableIdx3);
          var atRow = (typeof params.at_row === "number") ? params.at_row : tbl3.rows.length;
          var refRow = tbl3.rows.item(atRow - 1);
          tbl3.rows.add(LocationOptions.AFTER, refRow);
          writeResultFile(RESULT_PATH, { success: true, action: "add_row", tableInfo: getTableInfo(tbl3) });
        }
      }

    } else if (action === "add_column") {
      if (!params.uuid) {
        writeResultFile(RESULT_PATH, { error: true, message: "uuid is required for add_column" });
      } else {
        var tf4 = findItemByUUID(params.uuid);
        if (!tf4 || tf4.typename !== "TextFrame") {
          writeResultFile(RESULT_PATH, { error: true, message: "TextFrame not found: " + params.uuid });
        } else {
          var tableIdx4 = params.table_index || 0;
          var tbl4 = tf4.tables.item(tableIdx4);
          var atCol = (typeof params.at_column === "number") ? params.at_column : tbl4.columns.length;
          var refCol = tbl4.columns.item(atCol - 1);
          tbl4.columns.add(LocationOptions.AFTER, refCol);
          writeResultFile(RESULT_PATH, { success: true, action: "add_column", tableInfo: getTableInfo(tbl4) });
        }
      }

    } else if (action === "merge_cells") {
      if (!params.uuid) {
        writeResultFile(RESULT_PATH, { error: true, message: "uuid is required for merge_cells" });
      } else {
        var tf5 = findItemByUUID(params.uuid);
        if (!tf5 || tf5.typename !== "TextFrame") {
          writeResultFile(RESULT_PATH, { error: true, message: "TextFrame not found: " + params.uuid });
        } else {
          var tbl5 = tf5.tables.item(params.table_index || 0);
          var startRow = params.start_row || 0;
          var startCol = params.start_column || 0;
          var endRow = params.end_row || startRow;
          var endCol = params.end_column || startCol;
          var cellRange = tbl5.cells.itemByRange(
            tbl5.cells.item(startRow * tbl5.columns.length + startCol),
            tbl5.cells.item(endRow * tbl5.columns.length + endCol)
          );
          cellRange.merge();
          writeResultFile(RESULT_PATH, { success: true, action: "merge_cells" });
        }
      }

    } else {
      writeResultFile(RESULT_PATH, { error: true, message: "Unknown action: " + action + ". Valid: create, set_cell, add_row, add_column, merge_cells" });
    }
  } catch (e) {
    writeResultFile(RESULT_PATH, { error: true, message: "manage_tables failed: " + e.message, line: e.line });
  }
}
`;

export function register(server: McpServer): void {
  server.registerTool(
    'manage_tables',
    {
      title: 'Manage Tables',
      description: 'Create and edit tables within InDesign text frames.',
      inputSchema: {
        action: z
          .enum(['create', 'set_cell', 'add_row', 'add_column', 'merge_cells'])
          .describe('Table operation: create=insert new table, set_cell=set cell content, add_row/add_column=add row/column, merge_cells=merge cell range'),
        uuid: z.string().optional().describe('UUID of the text frame containing (or to contain) the table'),
        rows: z.number().int().min(1).optional().describe('Number of body rows (for create, default: 3)'),
        columns: z.number().int().min(1).optional().describe('Number of columns (for create, default: 3)'),
        table_index: z.number().int().min(0).optional().describe('Zero-based table index within the text frame (default: 0)'),
        row: z.number().int().min(0).optional().describe('Zero-based row index (for set_cell)'),
        column: z.number().int().min(0).optional().describe('Zero-based column index (for set_cell)'),
        contents: z.string().optional().describe('Cell text content (for set_cell)'),
        at_row: z.number().int().min(0).optional().describe('Insert row after this index (for add_row, default: end)'),
        at_column: z.number().int().min(0).optional().describe('Insert column after this index (for add_column, default: end)'),
        start_row: z.number().int().min(0).optional().describe('Start row for merge range'),
        start_column: z.number().int().min(0).optional().describe('Start column for merge range'),
        end_row: z.number().int().min(0).optional().describe('End row for merge range'),
        end_column: z.number().int().min(0).optional().describe('End column for merge range'),
      },
      annotations: WRITE_ANNOTATIONS,
    },
    async (params) => {
      const result = await executeJsx(jsxCode, params, { activate: true });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );
}
