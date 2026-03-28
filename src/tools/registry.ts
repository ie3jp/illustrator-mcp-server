import type { ToolRegistry } from '../tool-server.ts';

// Phase 1: 基本読み取りツール
import { register as registerGetDocumentInfo } from './read/get-document-info.ts';
import { register as registerGetArtboards } from './read/get-artboards.ts';
import { register as registerGetLayers } from './read/get-layers.ts';
import { register as registerGetSelection } from './read/get-selection.ts';
import { register as registerListTextFrames } from './read/list-text-frames.ts';

// Phase 2: 読み取り系ツール（Web実装向け）
import { register as registerGetTextFrameDetail } from './read/get-text-frame-detail.ts';
import { register as registerGetColors } from './read/get-colors.ts';
import { register as registerGetPathItems } from './read/get-path-items.ts';
import { register as registerGetGuidelines } from './read/get-guidelines.ts';
import { register as registerGetGroups } from './read/get-groups.ts';
import { register as registerGetEffects } from './read/get-effects.ts';
import { register as registerGetImages } from './read/get-images.ts';
import { register as registerGetSymbols } from './read/get-symbols.ts';
import { register as registerGetDocumentStructure } from './read/get-document-structure.ts';
import { register as registerFindObjects } from './read/find-objects.ts';

// Phase 3: 書き出し + 印刷向け読み取り
import { register as registerExport } from './export/export.ts';
import { register as registerExportPdf } from './export/export-pdf.ts';
import { register as registerGetOverprintInfo } from './read/get-overprint-info.ts';
import { register as registerPreflightCheck } from './utility/preflight-check.ts';

// Phase 4: 操作系ツール
import { register as registerCreateRectangle } from './modify/create-rectangle.ts';
import { register as registerCreateEllipse } from './modify/create-ellipse.ts';
import { register as registerCreateLine } from './modify/create-line.ts';
import { register as registerCreateTextFrame } from './modify/create-text-frame.ts';
import { register as registerCreatePath } from './modify/create-path.ts';
import { register as registerModifyObject } from './modify/modify-object.ts';
import { register as registerConvertToOutlines } from './modify/convert-to-outlines.ts';
import { register as registerApplyColorProfile } from './modify/apply-color-profile.ts';
import { register as registerPlaceImage } from './modify/place-image.ts';

// Phase 5: ドキュメント管理ツール
import { register as registerCreateDocument } from './modify/create-document.ts';
import { register as registerCloseDocument } from './modify/close-document.ts';

export function registerAllTools(server: ToolRegistry): void {
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

  // Phase 3: 書き出し + 印刷向け
  registerExport(server);
  registerExportPdf(server);
  registerGetOverprintInfo(server);
  registerPreflightCheck(server);

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

  // Phase 5: ドキュメント管理
  registerCreateDocument(server);
  registerCloseDocument(server);
}
