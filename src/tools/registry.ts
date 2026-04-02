import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

// Phase 1: 基本読み取りツール
import { register as registerGetDocumentInfo } from './read/get-document-info.js';
import { register as registerGetArtboards } from './read/get-artboards.js';
import { register as registerGetLayers } from './read/get-layers.js';
import { register as registerGetSelection } from './read/get-selection.js';
import { register as registerListTextFrames } from './read/list-text-frames.js';

// Phase 2: 読み取り系ツール（Web実装向け）
import { register as registerGetTextFrameDetail } from './read/get-text-frame-detail.js';
import { register as registerGetColors } from './read/get-colors.js';
import { register as registerGetPathItems } from './read/get-path-items.js';
import { register as registerGetGuidelines } from './read/get-guidelines.js';
import { register as registerGetGroups } from './read/get-groups.js';
import { register as registerGetEffects } from './read/get-effects.js';
import { register as registerGetImages } from './read/get-images.js';
import { register as registerGetSymbols } from './read/get-symbols.js';
import { register as registerGetDocumentStructure } from './read/get-document-structure.js';
import { register as registerFindObjects } from './read/find-objects.js';
import { register as registerCheckContrast } from './read/check-contrast.js';
import { register as registerExtractDesignTokens } from './read/extract-design-tokens.js';

// Phase 3: 書き出し + 印刷向け読み取り
import { register as registerExport } from './export/export.js';
import { register as registerExportPdf } from './export/export-pdf.js';
import { register as registerGetOverprintInfo } from './read/get-overprint-info.js';
import { register as registerGetSeparationInfo } from './read/get-separation-info.js';
import { register as registerPreflightCheck } from './utility/preflight-check.js';
import { register as registerCheckTextConsistency } from './utility/check-text-consistency.js';
import { register as registerSetWorkflow } from './utility/set-workflow.js';
import { register as registerSetIllustratorVersion } from './utility/set-illustrator-version.js';

// Phase 4: 操作系ツール
import { register as registerCreateRectangle } from './modify/create-rectangle.js';
import { register as registerCreateEllipse } from './modify/create-ellipse.js';
import { register as registerCreateLine } from './modify/create-line.js';
import { register as registerCreateTextFrame } from './modify/create-text-frame.js';
import { register as registerCreatePath } from './modify/create-path.js';
import { register as registerModifyObject } from './modify/modify-object.js';
import { register as registerConvertToOutlines } from './modify/convert-to-outlines.js';
import { register as registerApplyColorProfile } from './modify/apply-color-profile.js';
import { register as registerPlaceImage } from './modify/place-image.js';
import { register as registerResizeForVariation } from './modify/resize-for-variation.js';
import { register as registerAlignObjects } from './modify/align-objects.js';
import { register as registerReplaceColor } from './modify/replace-color.js';
import { register as registerManageLayers } from './modify/manage-layers.js';
import { register as registerPlaceColorChips } from './modify/place-color-chips.js';
import { register as registerPlaceStyleGuide } from './modify/place-style-guide.js';
import { register as registerCreateCropMarks } from './modify/create-crop-marks.js';

// Phase 5: ドキュメント管理ツール
import { register as registerCreateDocument } from './modify/create-document.js';
import { register as registerCloseDocument } from './modify/close-document.js';

// Phase 6: 新規ツール
import { register as registerSaveDocument } from './modify/save-document.js';
import { register as registerOpenDocument } from './modify/open-document.js';
import { register as registerGroupObjects } from './modify/group-objects.js';
import { register as registerUngroupObjects } from './modify/ungroup-objects.js';
import { register as registerDuplicateObjects } from './modify/duplicate-objects.js';
import { register as registerListFonts } from './read/list-fonts.js';
import { register as registerManageArtboards } from './modify/manage-artboards.js';
import { register as registerSetZOrder } from './modify/set-z-order.js';
import { register as registerMoveToLayer } from './modify/move-to-layer.js';
import { register as registerApplyGraphicStyle } from './modify/apply-graphic-style.js';
import { register as registerManageSwatches } from './modify/manage-swatches.js';
import { register as registerApplyTextStyle } from './modify/apply-text-style.js';
import { register as registerCreateGradient } from './modify/create-gradient.js';
import { register as registerManageLinkedImages } from './modify/manage-linked-images.js';
import { register as registerUndo } from './modify/undo.js';
import { register as registerManageDatasets } from './modify/manage-datasets.js';
import { register as registerPlaceSymbol } from './modify/place-symbol.js';
import { register as registerCreatePathText } from './modify/create-path-text.js';
import { register as registerSelectObjects } from './modify/select-objects.js';
import { register as registerConvertCoordinate } from './read/convert-coordinate.js';

export function registerAllTools(server: McpServer): void {
  // Phase 1: 基本読み取りツール
  registerGetDocumentInfo(server);
  registerGetArtboards(server);
  registerGetLayers(server);
  registerGetSelection(server);
  registerListTextFrames(server);

  // Phase 2: 読み取り系ツール
  registerGetTextFrameDetail(server);
  registerGetColors(server);
  registerGetPathItems(server);
  registerGetGuidelines(server);
  registerGetGroups(server);
  registerGetEffects(server);
  registerGetImages(server);
  registerGetSymbols(server);
  registerGetDocumentStructure(server);
  registerFindObjects(server);
  registerCheckContrast(server);
  registerExtractDesignTokens(server);

  // Phase 3: 書き出し + 印刷向け
  registerExport(server);
  registerExportPdf(server);
  registerGetOverprintInfo(server);
  registerGetSeparationInfo(server);
  registerPreflightCheck(server);
  registerCheckTextConsistency(server);
  registerSetWorkflow(server);
  registerSetIllustratorVersion(server);

  // Phase 4: 操作系
  registerCreateRectangle(server);
  registerCreateEllipse(server);
  registerCreateLine(server);
  registerCreateTextFrame(server);
  registerCreatePath(server);
  registerModifyObject(server);
  registerConvertToOutlines(server);
  registerApplyColorProfile(server);
  registerPlaceImage(server);
  registerResizeForVariation(server);
  registerAlignObjects(server);
  registerReplaceColor(server);
  registerManageLayers(server);
  registerPlaceColorChips(server);
  registerPlaceStyleGuide(server);
  registerCreateCropMarks(server);

  // Phase 5: ドキュメント管理
  registerCreateDocument(server);
  registerCloseDocument(server);

  // Phase 6: 新規ツール
  registerSaveDocument(server);
  registerOpenDocument(server);
  registerGroupObjects(server);
  registerUngroupObjects(server);
  registerDuplicateObjects(server);
  registerListFonts(server);
  registerManageArtboards(server);
  registerSetZOrder(server);
  registerMoveToLayer(server);
  registerApplyGraphicStyle(server);
  registerManageSwatches(server);
  registerApplyTextStyle(server);
  registerCreateGradient(server);
  registerManageLinkedImages(server);
  registerUndo(server);
  registerManageDatasets(server);
  registerPlaceSymbol(server);
  registerCreatePathText(server);
  registerSelectObjects(server);
  registerConvertCoordinate(server);
}
