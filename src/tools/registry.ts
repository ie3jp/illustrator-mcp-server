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

// Phase 3: 書き出し + 印刷向け読み取り
import { register as registerExport } from './export/export.js';
import { register as registerExportPdf } from './export/export-pdf.js';
import { register as registerGetOverprintInfo } from './read/get-overprint-info.js';
import { register as registerPreflightCheck } from './utility/preflight-check.js';

// Phase 4: 操作系ツール
import { register as registerCreateRectangle } from './modify/create-rectangle.js';
import { register as registerCreateEllipse } from './modify/create-ellipse.js';
import { register as registerCreateLine } from './modify/create-line.js';
import { register as registerCreateTextFrame } from './modify/create-text-frame.js';
import { register as registerCreatePath } from './modify/create-path.js';
import { register as registerModifyObject } from './modify/modify-object.js';
import { register as registerConvertToOutlines } from './modify/convert-to-outlines.js';
import { register as registerApplyColorProfile } from './modify/apply-color-profile.js';

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
}
