import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeJsx } from '../../executor/jsx-runner.js';
import { formatToolResult } from '../tool-executor.js';
import { invalidateAutoDetectCache } from '../session.js';
import { DESTRUCTIVE_ANNOTATIONS, coerceBoolean } from './shared.js';

/**
 * close_document — アクティブドキュメントを閉じる
 * @see https://ai-scripting.docsforadobe.dev/jsobjref/Document/ — Document.close(saveOptions)
 */
const jsxCode = `
try {
  var verErr = checkIllustratorVersion();
  if (verErr) {
    writeResultFile(RESULT_PATH, verErr);
  } else {
    var params = readParamsFile(PARAMS_PATH);
    // save 未指定（undefined）と明示的な false を区別する。未指定で未保存の変更があれば閉じない
    var saveSpecified = (params.save === true || params.save === false);
    var save = params.save === true;

    if (app.documents.length === 0) {
      writeResultFile(RESULT_PATH, { error: true, message: "No document is open" });
    } else {
      var doc = app.activeDocument;
      var docName = doc.name;
      var hadUnsavedChanges = (doc.saved === false);
      if (hadUnsavedChanges && !saveSpecified) {
        writeResultFile(RESULT_PATH, {
          error: true,
          unsavedChanges: true,
          document: docName,
          message: "Document '" + docName + "' has unsaved changes, so it was NOT closed. " +
            "Call close_document again with save: true to save and close, " +
            "or save: false to close and discard the changes. " +
            "For a document that has never been saved, use save_document (mode: 'save_as') first."
        });
      } else {
        var saveOpt = save ? SaveOptions.SAVECHANGES : SaveOptions.DONOTSAVECHANGES;
        doc.close(saveOpt);
        writeResultFile(RESULT_PATH, {
          success: true,
          document: docName,
          saved: save,
          discardedChanges: (!save && hadUnsavedChanges)
        });
      }
    }
  }
} catch (e) {
  writeResultFile(RESULT_PATH, { error: true, message: "Failed to close document: " + e.message, line: e.line });
}
`;

export function register(server: McpServer): void {
  server.registerTool(
    'close_document',
    {
      title: 'Close Document',
      description:
        'Close the active Illustrator document. If the document has unsaved changes and save is omitted, ' +
        'the document is NOT closed and an error is returned — pass save: true to save, or save: false to explicitly discard the changes. ' +
        'Note: Illustrator will be activated (brought to foreground) during execution.',
      inputSchema: {
        save: coerceBoolean
          .optional()
          .describe('true = save then close; false = close and DISCARD unsaved changes. Omit to close only when there are no unsaved changes'),
      },
      annotations: DESTRUCTIVE_ANNOTATIONS,
    },
    async (params) => {
      const result = await executeJsx(jsxCode, params, { activate: true });
      invalidateAutoDetectCache();
      return formatToolResult(result);
    },
  );
}
