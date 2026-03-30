import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeJsx } from '../../executor/jsx-runner.js';
import { READ_ANNOTATIONS } from '../modify/shared.js';

/**
 * get_tables — ドキュメント内のテーブル一覧取得
 * List tables in document: story location, rows, columns, header/footer rows.
 */
const jsxCode = `
var preflight = preflightChecks();
if (preflight) {
  writeResultFile(RESULT_PATH, preflight);
} else {
  try {
    var params = readParamsFile(PARAMS_PATH);
    var doc = app.activeDocument;
    var filterPage = (params && typeof params.page_index === "number") ? params.page_index : null;
    var includeCells = (params && params.include_cells === true) ? true : false;

    var tables = [];

    for (var i = 0; i < doc.stories.length; i++) {
      var story = doc.stories[i];

      try {
        var storyTables = story.tables;
        for (var ti = 0; ti < storyTables.length; ti++) {
          var tbl = storyTables[ti];

          // テーブルを含むテキストフレームのページを特定
          var pageIndex = -1;
          var containerUUID = "";
          try {
            var containers = story.textContainers;
            if (containers && containers.length > 0) {
              var firstContainer = containers[0];
              containerUUID = ensureUUID(firstContainer);
              var cPP = firstContainer.parentPage;
              if (cPP) pageIndex = cPP.index;
            }
          } catch (e2) {}

          // ページフィルタ
          if (filterPage !== null && pageIndex !== filterPage) continue;

          var tblInfo = {
            index: tables.length,
            storyIndex: i,
            containerUUID: containerUUID,
            pageIndex: pageIndex,
            rows: 0,
            columns: 0,
            headerRowCount: 0,
            footerRowCount: 0,
            bodyRowCount: 0,
            appliedTableStyle: ""
          };

          try { tblInfo.rows = tbl.rows.length; } catch (e2) {}
          try { tblInfo.columns = tbl.columns.length; } catch (e2) {}
          try { tblInfo.headerRowCount = tbl.headerRowCount || 0; } catch (e2) {}
          try { tblInfo.footerRowCount = tbl.footerRowCount || 0; } catch (e2) {}
          tblInfo.bodyRowCount = tblInfo.rows - tblInfo.headerRowCount - tblInfo.footerRowCount;
          try {
            if (tbl.appliedTableStyle) {
              tblInfo.appliedTableStyle = tbl.appliedTableStyle.name || "";
            }
          } catch (e2) {}

          // セル内容（オプション）
          if (includeCells) {
            var cellData = [];
            try {
              var tblRows = tbl.rows;
              for (var ri = 0; ri < tblRows.length; ri++) {
                var rowData = [];
                var row = tblRows[ri];
                try {
                  var rowCells = row.cells;
                  for (var rci = 0; rci < rowCells.length; rci++) {
                    var cell = rowCells[rci];
                    var cellInfo = {
                      contents: "",
                      columnSpan: 1,
                      rowSpan: 1
                    };
                    try { cellInfo.contents = cell.contents || ""; } catch (e3) {}
                    try { cellInfo.columnSpan = cell.columnSpan || 1; } catch (e3) {}
                    try { cellInfo.rowSpan = cell.rowSpan || 1; } catch (e3) {}
                    rowData.push(cellInfo);
                  }
                } catch (e3) {}
                cellData.push(rowData);
              }
            } catch (e2) {}
            tblInfo.cells = cellData;
          } else {
            // セル内容なしの場合は先頭行のプレビューのみ
            try {
              if (tbl.rows.length > 0) {
                var previewRow = tbl.rows[0];
                var previewCells = [];
                for (var pci = 0; pci < previewRow.cells.length && pci < 5; pci++) {
                  try {
                    var pc = previewRow.cells[pci].contents || "";
                    previewCells.push(pc.length > 30 ? pc.substring(0, 30) + "..." : pc);
                  } catch (e3) {}
                }
                tblInfo.headerPreview = previewCells;
              }
            } catch (e2) {}
          }

          tables.push(tblInfo);
        }
      } catch (e) {}
    }

    writeResultFile(RESULT_PATH, {
      tableCount: tables.length,
      tables: tables
    });
  } catch (e) {
    writeResultFile(RESULT_PATH, { error: true, message: "get_tables: " + e.message, line: e.line });
  }
}
`;

export function register(server: McpServer): void {
  server.registerTool(
    'get_tables',
    {
      title: 'Get Tables',
      description: 'List all tables in InDesign document stories: row/column counts, header/footer row counts, applied table style, and optionally cell contents.',
      inputSchema: {
        page_index: z.number().int().min(0).optional().describe('Filter by page index (0-based)'),
        include_cells: z
          .boolean()
          .optional()
          .default(false)
          .describe('Include full cell contents (default: false, only shows first row preview)'),
      },
      annotations: READ_ANNOTATIONS,
    },
    async (params) => {
      const result = await executeJsx(jsxCode, params);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );
}
