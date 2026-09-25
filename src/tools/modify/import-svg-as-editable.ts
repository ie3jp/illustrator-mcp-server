import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeToolJsx } from '../tool-executor.js';
import { coordinateSystemSchema } from '../session.js';
import { WRITE_ANNOTATIONS } from './shared.js';

/**
 * import_svg_as_editable — SVG を編集可能な Illustrator オブジェクトとしてインポート
 *
 * @see https://ai-scripting.docsforadobe.dev/jsobjref/Application/ — Application.open()
 * @see https://ai-scripting.docsforadobe.dev/jsobjref/PageItem/ — PageItem.duplicate()
 *
 * 内部フロー:
 *   1. SVG を一時ドキュメントとして app.open() で開く
 *   2. その全 pageItems を、元の対象ドキュメントの指定レイヤーに duplicate
 *      （PageItem.duplicate は relativeObject 引数で別ドキュメントへの複製が可能）
 *   3. 一時ドキュメントを保存せずに閉じ、アクティブを元のドキュメントに復元
 *   4. 必要なら複製群をグループ化 / 指定位置に移動 / アートボードへフィット
 *
 * place_image (PlacedItems.add) は SVG をリンクとして取り込み、編集できない上に
 * 失敗時に壊れたリンクが残るため、本ツールで明示的なルートを用意する。
 */
const jsxCode = `
var srcDoc = null;
var targetDocRef = null;
var preflight = preflightChecks();
if (preflight) {
  writeResultFile(RESULT_PATH, preflight);
} else {
  try {
    var params = readParamsFile(PARAMS_PATH);
    var coordSystem = params.coordinate_system || "artboard-web";

    var svgPath = params.file_path;
    if (!/\\.svgz?$/i.test(svgPath)) {
      writeResultFile(RESULT_PATH, { error: true, message: "import_svg_as_editable expects an .svg or .svgz file. Got: " + svgPath });
    } else {
      var svgFile = new File(svgPath);
      if (!svgFile.exists) {
        writeResultFile(RESULT_PATH, { error: true, message: "SVG file not found: " + svgPath });
      } else {
        targetDocRef = app.activeDocument;
        var abRect = (coordSystem === "artboard-web") ? getActiveArtboardRect() : null;

        try {
          srcDoc = app.open(svgFile);
        } catch (openErr) {
          writeResultFile(RESULT_PATH, { error: true, message: "Failed to open SVG: " + openErr.message });
          srcDoc = null;
        }

        if (srcDoc) {
          // 複製中にコレクションが変動するため事前にスナップショット
          var sourceItems = [];
          for (var i = 0; i < srcDoc.pageItems.length; i++) {
            sourceItems.push(srcDoc.pageItems[i]);
          }

          if (sourceItems.length === 0) {
            try { srcDoc.close(SaveOptions.DONOTSAVECHANGES); } catch (e) {}
            srcDoc = null;
            app.activeDocument = targetDocRef;
            writeResultFile(RESULT_PATH, { error: true, message: "SVG contains no importable items" });
          } else {
            var targetLayer = resolveTargetLayer(targetDocRef, params.layer_name);
            var duplicated = [];
            var dupErrors = [];
            for (var j = 0; j < sourceItems.length; j++) {
              try {
                duplicated.push(sourceItems[j].duplicate(targetLayer, ElementPlacement.PLACEATEND));
              } catch (dupErr) {
                dupErrors.push({ index: j, message: dupErr.message });
              }
            }

            try { srcDoc.close(SaveOptions.DONOTSAVECHANGES); } catch (e) {}
            srcDoc = null;
            app.activeDocument = targetDocRef;

            if (duplicated.length === 0) {
              writeResultFile(RESULT_PATH, {
                error: true,
                message: "Failed to duplicate any SVG items into target document",
                details: dupErrors
              });
            } else {
              var rootItem = wrapAsGroup(duplicated, targetLayer, params.group !== false);
              var movables = rootItem ? [rootItem] : duplicated;

              var bounds = rootItem ? rootItem.geometricBounds : unionBounds(duplicated);

              // フィット → サイズが変わったらバウンディングを取り直す
              if (params.fit_to_artboard === true && abRect) {
                var pad = (typeof params.padding === "number") ? params.padding : 0;
                fitItemsToArtboard(movables, bounds, abRect, pad);
                bounds = rootItem ? rootItem.geometricBounds : unionBounds(duplicated);
              }

              // 明示的な x/y 指定（fit_to_artboard 時は中央配置が優先されるので無視）
              if (!(params.fit_to_artboard === true && abRect) &&
                  typeof params.x === "number" && typeof params.y === "number") {
                var pos = webToAiPoint(params.x, params.y, coordSystem, abRect);
                translateItems(movables, pos[0] - bounds[0], pos[1] - bounds[1]);
                bounds = rootItem ? rootItem.geometricBounds : unionBounds(duplicated);
              }

              var rootUuid = null;
              if (rootItem) {
                if (params.name) rootItem.name = params.name;
                rootUuid = ensureUUID(rootItem);
              }

              var itemSummaries = [];
              for (var u = 0; u < duplicated.length; u++) {
                itemSummaries.push({
                  uuid: ensureUUID(duplicated[u]),
                  type: duplicated[u].typename,
                  name: duplicated[u].name || ""
                });
              }

              writeResultFile(RESULT_PATH, {
                success: true,
                sourcePath: svgPath,
                grouped: !!rootItem && duplicated.length > 1,
                rootUuid: rootUuid,
                importedCount: duplicated.length,
                widthPt: bounds[2] - bounds[0],
                heightPt: bounds[1] - bounds[3],
                items: itemSummaries,
                duplicationErrors: dupErrors.length > 0 ? dupErrors : undefined,
                verified: rootItem ? verifyItem(rootItem, coordSystem, abRect) : null
              });
            }
          }
        }
      }
    }
  } catch (e) {
    writeResultFile(RESULT_PATH, { error: true, message: "import_svg_as_editable failed: " + e.message, line: e.line });
  } finally {
    // 想定外のパスで srcDoc が開いたままなら閉じる
    if (srcDoc) {
      try { srcDoc.close(SaveOptions.DONOTSAVECHANGES); } catch (e) {}
    }
    if (targetDocRef) {
      try { app.activeDocument = targetDocRef; } catch (e) {}
    }
  }
}

// --- ローカルヘルパー ---

function unionBounds(items) {
  // [left, top, right, bottom]
  var b = [items[0].geometricBounds[0], items[0].geometricBounds[1],
           items[0].geometricBounds[2], items[0].geometricBounds[3]];
  for (var k = 1; k < items.length; k++) {
    var g = items[k].geometricBounds;
    if (g[0] < b[0]) b[0] = g[0];
    if (g[1] > b[1]) b[1] = g[1];
    if (g[2] > b[2]) b[2] = g[2];
    if (g[3] < b[3]) b[3] = g[3];
  }
  return b;
}

function translateItems(items, dx, dy) {
  if (dx === 0 && dy === 0) return;
  for (var i = 0; i < items.length; i++) items[i].translate(dx, dy);
}

function wrapAsGroup(items, parentLayer, shouldGroup) {
  if (!shouldGroup) return null;
  if (items.length === 1) return items[0];
  var group = parentLayer.groupItems.add();
  // duplicate は PLACEATEND で末尾に積まれている。グループに移すと積み順が反転するため、
  // 逆順に moveToBeginning することで元の z-order を保つ。
  for (var i = items.length - 1; i >= 0; i--) {
    items[i].moveToBeginning(group);
  }
  return group;
}

function fitItemsToArtboard(items, bounds, abRect, pad) {
  var abW = abRect[2] - abRect[0];
  var abH = abRect[1] - abRect[3];
  var availW = abW - pad * 2;
  var availH = abH - pad * 2;
  var w = bounds[2] - bounds[0];
  var h = bounds[1] - bounds[3];
  if (w <= 0 || h <= 0 || availW <= 0 || availH <= 0) return;

  var scalePct = Math.min(availW / w, availH / h) * 100;
  for (var i = 0; i < items.length; i++) items[i].resize(scalePct, scalePct);

  // リサイズ後にバウンディングを取り直して中央配置
  var newB = (items.length === 1) ? items[0].geometricBounds : unionBounds(items);
  var newW = newB[2] - newB[0];
  var newH = newB[1] - newB[3];
  var targetLeft = abRect[0] + (abW - newW) / 2;
  var targetTop = abRect[1] - (abH - newH) / 2;
  translateItems(items, targetLeft - newB[0], targetTop - newB[1]);
}
`;

export function register(server: McpServer): void {
  server.registerTool(
    'import_svg_as_editable',
    {
      title: 'Import SVG as Editable',
      description:
        'Import an SVG file into the active document as editable Illustrator paths/text/groups (NOT as a linked image). Internally opens the SVG as a temporary document, duplicates its contents into the target document, then closes the source. Use this instead of place_image for SVG. Note: Illustrator will be activated (brought to foreground) during execution. Font caveat: Illustrator does not fall back per glyph across a font-family list. If the FIRST family in the list is installed but lacks a glyph, that character is dropped silently and the import still reports success. Specify a single font-family per text element, and pick one that actually contains the glyphs you use (symbols such as U+2713 are the common failure case). An uninstalled family is substituted by Illustrator and is NOT affected by this.',
      inputSchema: {
        file_path: z.string().describe('Absolute path to the .svg or .svgz file'),
        x: z
          .number()
          .optional()
          .describe('X position of the imported content (top-left of bounding box). Ignored when fit_to_artboard is true.'),
        y: z
          .number()
          .optional()
          .describe('Y position of the imported content (top-left of bounding box). Ignored when fit_to_artboard is true.'),
        layer_name: z
          .string()
          .optional()
          .describe('Target layer name in the active document. Created if missing.'),
        group: z
          .boolean()
          .optional()
          .default(true)
          .describe('Wrap imported items in a single GroupItem (default: true). Set false to keep items flat in the target layer.'),
        fit_to_artboard: z
          .boolean()
          .optional()
          .default(false)
          .describe('Scale and center the imported content to fit the active artboard (default: false).'),
        padding: z
          .number()
          .optional()
          .describe('Padding in points from the artboard edges when fit_to_artboard is true.'),
        name: z
          .string()
          .optional()
          .describe('Name to assign to the root group (only when group=true and multiple items are imported).'),
        coordinate_system: coordinateSystemSchema,
      },
      annotations: WRITE_ANNOTATIONS,
    },
    async (params) => {
      return executeToolJsx(jsxCode, params, { activate: true, resolveCoordinate: true });
    },
  );
}
