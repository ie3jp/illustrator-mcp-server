import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeJsx } from '../../executor/jsx-runner.js';
import { formatToolResult } from '../tool-executor.js';
import { coerceBoolean, DESTRUCTIVE_ANNOTATIONS } from './shared.js';

/**
 * make_trap_stroke — 見当ずれ対策のトラップ線を引く
 *
 * Illustrator にトラッピングの API は無い（公式リファレンスの trapping は PDFSaveOptions と
 * InkInfo のみ）。これは「塗りと同じ色の線をオーバープリント指定で引く」という、
 * 印刷会社が手作業でやる処理の自動化。版ズレで隙間（白抜け）が出るのを防ぐ。
 *
 * @see https://ai-scripting.docsforadobe.dev/jsobjref/PathItem/ — strokeOverprint, strokeWidth, strokeCap, strokeJoin
 */
const jsxCode = `
var preflight = preflightChecks();
if (preflight) {
  writeResultFile(RESULT_PATH, preflight);
} else {
  try {
    var params = readParamsFile(PARAMS_PATH);
    var doc = app.activeDocument;
    var weight = (typeof params.weight === "number") ? params.weight : 0.5;
    var round = (params.round === false) ? false : true;

    // 単色の塗りだけが対象。グラデーション・パターンは「どの色で線を引くか」が決まらない
    var SOLID = { CMYKColor: 1, RGBColor: 1, GrayColor: 1, SpotColor: 1, LabColor: 1 };

    var trapped = [];
    var skipped = [];
    var failed = [];

    function noteSkipped(item, reason) {
      if (skipped.length >= 20) return;
      var info = { uuid: null, name: "", reason: reason };
      try { info.uuid = extractUUIDFromNote(item.note) || null; } catch (e1) {}
      try { info.name = item.name || ""; } catch (e2) {}
      skipped.push(info);
    }

    function trapPath(p) {
      var filled = false;
      try { filled = p.filled === true; } catch (eF) {}
      if (!filled) { noteSkipped(p, "not filled"); return; }
      var fc = null;
      try { fc = p.fillColor; } catch (eC) {}
      if (!fc || !SOLID[fc.typename]) {
        noteSkipped(p, "fill is not a solid color (" + (fc ? fc.typename : "unknown") + ")");
        return;
      }
      if (isItemEffectivelyLocked(p)) { noteSkipped(p, "locked"); return; }
      try {
        p.stroked = true;
        p.strokeColor = fc;
        p.strokeWidth = weight;
        if (round) {
          p.strokeCap = StrokeCap.ROUNDENDCAP;
          p.strokeJoin = StrokeJoin.ROUNDENDJOIN;
        }
        // 下の版を抜かずに重ねるのがトラップの要点。これが false だと白抜けは防げない
        p.strokeOverprint = true;
        // 読み返して確かめる（代入が黙って無視される実機事例があるため）
        var okOverprint = false;
        try { okOverprint = p.strokeOverprint === true; } catch (eR) {}
        if (!okOverprint) {
          failed.push({ uuid: (function () { try { return extractUUIDFromNote(p.note) || null; } catch (e3) { return null; } })(), message: "strokeOverprint was not applied when read back" });
          return;
        }
        var uuid = ensureUUID(p);
        trapped.push({ uuid: uuid, name: (function () { try { return p.name || ""; } catch (e4) { return ""; } })() });
      } catch (eT) {
        failed.push({ uuid: (function () { try { return extractUUIDFromNote(p.note) || null; } catch (e5) { return null; } })(), message: eT.message });
      }
    }

    // 対象の解決: uuids 指定 / "selection" / "all"
    var items = [];
    if (params.uuids && params.uuids.length > 0) {
      var notFound = [];
      for (var i = 0; i < params.uuids.length; i++) {
        var found = findItemByUUID(params.uuids[i]);
        if (found) items.push(found);
        else notFound.push(params.uuids[i]);
      }
      if (notFound.length > 0 && items.length === 0) {
        writeResultFile(RESULT_PATH, { error: true, message: "No objects found", notFound: notFound });
      } else {
        runTrap(items, notFound);
      }
    } else if (params.target === "selection") {
      var sel = doc.selection;
      if (!sel || sel.length === 0) {
        writeResultFile(RESULT_PATH, { error: true, message: "Nothing is selected. Select objects in Illustrator, pass uuids, or use target: \\"all\\"." });
      } else {
        for (var s = 0; s < sel.length; s++) items.push(sel[s]);
        runTrap(items, []);
      }
    } else {
      var top = collectTopLevelPageItems(doc);
      for (var t = 0; t < top.length; t++) items.push(top[t]);
      runTrap(items, []);
    }

    function runTrap(targetItems, notFound) {
      for (var k = 0; k < targetItems.length; k++) {
        var leafSkipped = {};
        var leaves = collectPaintLeaves(targetItems[k], leafSkipped);
        for (var l = 0; l < leaves.length; l++) {
          if (leaves[l].typename === "PathItem" || leaves[l].typename === "CompoundPathItem") trapPath(leaves[l]);
          else noteSkipped(leaves[l], "not a path (" + leaves[l].typename + ")");
        }
      }
      var result = {
        success: failed.length === 0 && trapped.length > 0,
        trappedCount: trapped.length,
        trapped: trapped,
        weight: weight,
        skippedCount: skipped.length,
        verified: { trappedCount: trapped.length, overprintApplied: trapped.length }
      };
      if (skipped.length > 0) result.skipped = skipped;
      if (failed.length > 0) result.failed = failed;
      if (notFound.length > 0) result.notFound = notFound;
      if (trapped.length === 0) result.message = "No path with a solid fill was found in the target, so nothing was trapped (see skipped).";
      writeResultFile(RESULT_PATH, result);
    }
  } catch (e) {
    writeResultFile(RESULT_PATH, { error: true, message: "make_trap_stroke failed: " + e.message, line: e.line });
  }
}
`;

export function register(server: McpServer): void {
  server.registerTool(
    'make_trap_stroke',
    {
      title: 'Make Trap Stroke',
      description:
        'Add a trap to filled paths: a stroke in the same color as the fill, set to overprint, so a press misregistration does not leave a white gap along the edge. '
        + 'Illustrator has no trapping API; this is the manual prepress technique, applied for you. '
        + 'Only paths with a solid fill are trapped — gradients and patterns are skipped (there is no single color to stroke with), as are locked objects; both are listed in skipped. '
        + 'strokeOverprint is read back after writing, and objects where it did not stick are listed in failed. '
        + 'Ask your printer for the trap width before using this: 0.25–0.5 pt is common for offset, but it depends on the press and the stock.',
      inputSchema: {
        uuids: z
          .array(z.string())
          .optional()
          .describe('UUIDs of objects to trap. Groups and compound paths are walked down to the paths inside. Omit to use target.'),
        target: z
          .enum(['selection', 'all'])
          .optional()
          .default('all')
          .describe('Used when uuids is omitted: "selection" (selected objects) or "all" (every top-level object in the document)'),
        weight: z
          .number()
          .min(0.01)
          .max(72)
          .optional()
          .default(0.5)
          .describe('Trap width in points. 0.25–0.5 pt is common for offset printing; confirm with your printer.'),
        round: coerceBoolean
          .optional()
          .default(true)
          .describe('Use round caps and joins so the trap follows corners without spikes'),
      },
      annotations: DESTRUCTIVE_ANNOTATIONS,
    },
    async (params) => {
      const result = await executeJsx(jsxCode, params);
      return formatToolResult(result);
    },
  );
}
