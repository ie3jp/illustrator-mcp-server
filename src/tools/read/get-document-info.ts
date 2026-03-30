import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeJsx } from '../../executor/jsx-runner.js';
import {
  coordinateSystemSchema,
  resolveCoordinateSystem,
  detectWorkflow,
} from '../session.js';
import { READ_ANNOTATIONS } from '../modify/shared.js';

/**
 * get_document_info — InDesign ドキュメントの基本情報取得
 * Pages instead of artboards, InDesign properties (intent, facingPages, margins, columns).
 */
const jsxCode = `
var preflight = preflightChecks();
if (preflight) {
  writeResultFile(RESULT_PATH, preflight);
} else {
  try {
    var params = readParamsFile(PARAMS_PATH);
    var doc = app.activeDocument;
    var coordSystem = (params && params.coordinate_system) ? params.coordinate_system : "page-relative";

    var fileName = doc.name;
    var filePath = "";
    try { filePath = doc.fullName.fsName; } catch (e) { filePath = ""; }

    var docPrefs = doc.documentPreferences;

    // ページサイズ
    var pageWidth = 0;
    var pageHeight = 0;
    try {
      pageWidth = docPrefs.pageWidth;
      pageHeight = docPrefs.pageHeight;
    } catch (e) {}

    // ドキュメントインテント
    var intent = "unknown";
    try {
      var di = docPrefs.intent;
      if (di === DocumentIntentOptions.PRINT_INTENT) intent = "print";
      else if (di === DocumentIntentOptions.WEB_INTENT) intent = "digital";
      else if (di === DocumentIntentOptions.MOBILE_INTENT) intent = "digital";
    } catch (e) {}

    // 見開き設定
    var facingPages = false;
    try { facingPages = docPrefs.facingPages; } catch (e) {}

    // ページ数
    var pageCount = doc.pages.length;
    var spreadCount = doc.spreads.length;

    // ルーラー単位
    var rulerUnits = "unknown";
    try {
      var viewPrefs = doc.viewPreferences;
      var ru = viewPrefs.horizontalMeasurementUnits;
      if (ru === MeasurementUnits.PIXELS) rulerUnits = "px";
      else if (ru === MeasurementUnits.POINTS) rulerUnits = "pt";
      else if (ru === MeasurementUnits.MILLIMETERS) rulerUnits = "mm";
      else if (ru === MeasurementUnits.CENTIMETERS) rulerUnits = "cm";
      else if (ru === MeasurementUnits.INCHES) rulerUnits = "in";
      else if (ru === MeasurementUnits.PICAS) rulerUnits = "pica";
      else if (ru === MeasurementUnits.CICEROS) rulerUnits = "cicero";
    } catch (e) {}

    // カラープロファイル
    var cmykProfile = "";
    var rgbProfile = "";
    try { cmykProfile = doc.cmykProfile || ""; } catch (e) {}
    try { rgbProfile = doc.rgbProfile || ""; } catch (e) {}

    // 裁ち落とし
    var bleed = { top: 0, bottom: 0, left: 0, right: 0 };
    try {
      bleed.top = docPrefs.documentBleedTopOffset || 0;
      bleed.bottom = docPrefs.documentBleedBottomOffset || 0;
      bleed.left = docPrefs.documentBleedInsideOrLeftOffset || 0;
      bleed.right = docPrefs.documentBleedOutsideOrRightOffset || 0;
    } catch (e) {}

    // スラッグ
    var slug = { top: 0, bottom: 0, left: 0, right: 0 };
    try {
      slug.top = docPrefs.slugTopOffset || 0;
      slug.bottom = docPrefs.slugBottomOffset || 0;
      slug.left = docPrefs.slugInsideOrLeftOffset || 0;
      slug.right = docPrefs.slugRightOrOutsideOffset || 0;
    } catch (e) {}

    // マスタースプレッド数
    var masterSpreadCount = 0;
    try { masterSpreadCount = doc.masterSpreads.length; } catch (e) {}

    // セクション数
    var sectionCount = 0;
    try { sectionCount = doc.sections.length; } catch (e) {}

    // レイヤー数
    var layerCount = 0;
    try { layerCount = doc.layers.length; } catch (e) {}

    // スウォッチ数
    var swatchCount = 0;
    try { swatchCount = doc.swatches.length; } catch (e) {}

    // 段落スタイル数
    var paragraphStyleCount = 0;
    try { paragraphStyleCount = doc.paragraphStyles.length; } catch (e) {}

    // 文字スタイル数
    var characterStyleCount = 0;
    try { characterStyleCount = doc.characterStyles.length; } catch (e) {}

    // ページ一覧（サマリー）
    var pages = [];
    for (var i = 0; i < doc.pages.length; i++) {
      var pg = doc.pages[i];
      var pgInfo = {
        index: i,
        name: pg.name || String(i + 1)
      };
      try {
        var pgBounds = pg.bounds; // [top, left, bottom, right]
        pgInfo.width = pgBounds[3] - pgBounds[1];
        pgInfo.height = pgBounds[2] - pgBounds[0];
      } catch (e) {}
      try {
        pgInfo.appliedMaster = pg.appliedMaster ? pg.appliedMaster.name : "None";
      } catch (e) { pgInfo.appliedMaster = "None"; }
      try {
        var mp = pg.marginPreferences;
        pgInfo.margins = {
          top: mp.top,
          bottom: mp.bottom,
          left: mp.left,
          right: mp.right
        };
        pgInfo.columns = {
          count: mp.columnCount,
          gutter: mp.columnGutter
        };
      } catch (e) {}
      pages.push(pgInfo);
    }

    var result = {
      fileName: fileName,
      filePath: filePath,
      pageWidth: pageWidth,
      pageHeight: pageHeight,
      intent: intent,
      facingPages: facingPages,
      pageCount: pageCount,
      spreadCount: spreadCount,
      masterSpreadCount: masterSpreadCount,
      sectionCount: sectionCount,
      layerCount: layerCount,
      swatchCount: swatchCount,
      paragraphStyleCount: paragraphStyleCount,
      characterStyleCount: characterStyleCount,
      rulerUnits: rulerUnits,
      cmykProfile: cmykProfile,
      rgbProfile: rgbProfile,
      bleed: bleed,
      slug: slug,
      pages: pages,
      coordinateSystem: coordSystem
    };

    writeResultFile(RESULT_PATH, result);
  } catch (e) {
    writeResultFile(RESULT_PATH, { error: true, message: e.message, line: e.line });
  }
}
`;

export function register(server: McpServer): void {
  server.registerTool(
    'get_document_info',
    {
      title: 'Get Document Info',
      description: 'Get InDesign document metadata: pages, intent, facingPages, margins, columns, bleed, slug, color profiles, style counts.',
      inputSchema: {
        coordinate_system: coordinateSystemSchema,
      },
      annotations: READ_ANNOTATIONS,
    },
    async (params) => {
      const resolvedParams = {
        ...params,
        coordinate_system: await resolveCoordinateSystem(params.coordinate_system),
      };
      const result = await executeJsx(jsxCode, resolvedParams);

      if (result && !result.error) {
        const hint = detectWorkflow({
          intent: (result.intent as string) ?? 'unknown',
          pageWidth: (result.pageWidth as number) ?? 0,
          pageHeight: (result.pageHeight as number) ?? 0,
          facingPages: (result.facingPages as boolean) ?? false,
        });
        result.workflowHint = hint;
      }

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    },
  );
}
