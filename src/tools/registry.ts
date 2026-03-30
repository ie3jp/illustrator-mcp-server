import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

// 読み取りツール — 基本
import { register as registerGetDocumentInfo } from './read/get-document-info.js';
import { register as registerGetPages } from './read/get-pages.js';
import { register as registerGetLayers } from './read/get-layers.js';
import { register as registerGetSelection } from './read/get-selection.js';
import { register as registerListTextFrames } from './read/list-text-frames.js';
import { register as registerGetStories } from './read/get-stories.js';
import { register as registerListFonts } from './read/list-fonts.js';
import { register as registerGetMasterSpreads } from './read/get-master-spreads.js';

// 読み取りツール — 上級
import { register as registerGetTextFrameDetail } from './read/get-text-frame-detail.js';
import { register as registerGetColors } from './read/get-colors.js';
import { register as registerGetGroups } from './read/get-groups.js';
import { register as registerGetImages } from './read/get-images.js';
import { register as registerGetDocumentStructure } from './read/get-document-structure.js';
import { register as registerFindObjects } from './read/find-objects.js';
import { register as registerCheckContrast } from './read/check-contrast.js';
import { register as registerExtractDesignTokens } from './read/extract-design-tokens.js';
import { register as registerConvertCoordinate } from './read/convert-coordinate.js';

// 読み取りツール — InDesign 固有
import { register as registerGetStyles } from './read/get-styles.js';
import { register as registerGetTables } from './read/get-tables.js';
import { register as registerGetSections } from './read/get-sections.js';
import { register as registerGetPreflightResults } from './read/get-preflight-results.js';

// 操作ツール — ドキュメント管理
import { register as registerCreateDocument } from './modify/create-document.js';
import { register as registerOpenDocument } from './modify/open-document.js';
import { register as registerSaveDocument } from './modify/save-document.js';
import { register as registerCloseDocument } from './modify/close-document.js';

// 操作ツール — オブジェクト作成
import { register as registerCreateRectangle } from './modify/create-rectangle.js';
import { register as registerCreateEllipse } from './modify/create-ellipse.js';
import { register as registerCreateLine } from './modify/create-line.js';
import { register as registerCreateTextFrame } from './modify/create-text-frame.js';
import { register as registerPlaceImage } from './modify/place-image.js';

// 操作ツール — オブジェクト操作
import { register as registerModifyObject } from './modify/modify-object.js';
import { register as registerAlignObjects } from './modify/align-objects.js';
import { register as registerGroupObjects } from './modify/group-objects.js';
import { register as registerUngroupObjects } from './modify/ungroup-objects.js';
import { register as registerDuplicateObjects } from './modify/duplicate-objects.js';
import { register as registerSelectObjects } from './modify/select-objects.js';
import { register as registerMoveToLayer } from './modify/move-to-layer.js';
import { register as registerSetZOrder } from './modify/set-z-order.js';
import { register as registerReplaceColor } from './modify/replace-color.js';
import { register as registerUndo } from './modify/undo.js';

// 操作ツール — レイヤー・スウォッチ
import { register as registerManageLayers } from './modify/manage-layers.js';
import { register as registerManageSwatches } from './modify/manage-swatches.js';
import { register as registerManageLinkedImages } from './modify/manage-linked-images.js';

// 操作ツール — テキスト・スタイル
import { register as registerApplyTextStyle } from './modify/apply-text-style.js';
import { register as registerApplyObjectStyle } from './modify/apply-object-style.js';
import { register as registerManageStyles } from './modify/manage-styles.js';
import { register as registerApplyTextWrap } from './modify/apply-text-wrap.js';

// 操作ツール — InDesign 固有（ページ・マスター）
import { register as registerManagePages } from './modify/manage-pages.js';
import { register as registerManageMasterSpreads } from './modify/manage-master-spreads.js';
import { register as registerOverrideMasterItems } from './modify/override-master-items.js';

// 操作ツール — InDesign 固有（テキスト構造）
import { register as registerThreadTextFrames } from './modify/thread-text-frames.js';
import { register as registerManageTables } from './modify/manage-tables.js';
import { register as registerManageFootnotes } from './modify/manage-footnotes.js';
import { register as registerManageTextVariables } from './modify/manage-text-variables.js';
import { register as registerManageCrossReferences } from './modify/manage-cross-references.js';
import { register as registerGenerateToc } from './modify/generate-toc.js';
import { register as registerManageSections } from './modify/manage-sections.js';

// 書き出しツール
import { register as registerExport } from './export/export.js';
import { register as registerExportPdf } from './export/export-pdf.js';
import { register as registerExportEpub } from './export/export-epub.js';
import { register as registerExportIdml } from './export/export-idml.js';

// ユーティリティツール
import { register as registerPreflightCheck } from './utility/preflight-check.js';
import { register as registerCheckTextConsistency } from './utility/check-text-consistency.js';
import { register as registerSetWorkflow } from './utility/set-workflow.js';

export function registerAllTools(server: McpServer): void {
  // 読み取り — 基本
  registerGetDocumentInfo(server);
  registerGetPages(server);
  registerGetLayers(server);
  registerGetSelection(server);
  registerListTextFrames(server);
  registerGetStories(server);
  registerListFonts(server);
  registerGetMasterSpreads(server);

  // 読み取り — 上級
  registerGetTextFrameDetail(server);
  registerGetColors(server);
  registerGetGroups(server);
  registerGetImages(server);
  registerGetDocumentStructure(server);
  registerFindObjects(server);
  registerCheckContrast(server);
  registerExtractDesignTokens(server);
  registerConvertCoordinate(server);

  // 読み取り — InDesign 固有
  registerGetStyles(server);
  registerGetTables(server);
  registerGetSections(server);
  registerGetPreflightResults(server);

  // 操作 — ドキュメント管理
  registerCreateDocument(server);
  registerOpenDocument(server);
  registerSaveDocument(server);
  registerCloseDocument(server);

  // 操作 — オブジェクト作成
  registerCreateRectangle(server);
  registerCreateEllipse(server);
  registerCreateLine(server);
  registerCreateTextFrame(server);
  registerPlaceImage(server);

  // 操作 — オブジェクト操作
  registerModifyObject(server);
  registerAlignObjects(server);
  registerGroupObjects(server);
  registerUngroupObjects(server);
  registerDuplicateObjects(server);
  registerSelectObjects(server);
  registerMoveToLayer(server);
  registerSetZOrder(server);
  registerReplaceColor(server);
  registerUndo(server);

  // 操作 — レイヤー・スウォッチ
  registerManageLayers(server);
  registerManageSwatches(server);
  registerManageLinkedImages(server);

  // 操作 — テキスト・スタイル
  registerApplyTextStyle(server);
  registerApplyObjectStyle(server);
  registerManageStyles(server);
  registerApplyTextWrap(server);

  // 操作 — InDesign 固有（ページ・マスター）
  registerManagePages(server);
  registerManageMasterSpreads(server);
  registerOverrideMasterItems(server);

  // 操作 — InDesign 固有（テキスト構造）
  registerThreadTextFrames(server);
  registerManageTables(server);
  registerManageFootnotes(server);
  registerManageTextVariables(server);
  registerManageCrossReferences(server);
  registerGenerateToc(server);
  registerManageSections(server);

  // 書き出し
  registerExport(server);
  registerExportPdf(server);
  registerExportEpub(server);
  registerExportIdml(server);

  // ユーティリティ
  registerPreflightCheck(server);
  registerCheckTextConsistency(server);
  registerSetWorkflow(server);
}
