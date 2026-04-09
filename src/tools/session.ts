import { z } from 'zod';
import { executeJsx } from '../executor/jsx-runner.js';

export type WorkflowType = 'web' | 'print' | 'video' | 'unknown';
export type CoordinateSystem = 'artboard-web' | 'document';

// --- Session state (module-level, lives for the MCP server process lifetime) ---

let sessionCoordinateSystem: CoordinateSystem | null = null;
let sessionWorkflow: WorkflowType | null = null;
/** true when user/AI explicitly called set_workflow */
let sessionExplicit = false;

export function getSessionCoordinateSystem(): CoordinateSystem | null {
  return sessionCoordinateSystem;
}

export function getSessionWorkflow(): WorkflowType | null {
  return sessionWorkflow;
}

export function setSession(
  workflow: WorkflowType,
  coordinateSystem: CoordinateSystem,
): void {
  sessionWorkflow = workflow;
  sessionCoordinateSystem = coordinateSystem;
  sessionExplicit = true;
}

export function clearSession(): void {
  sessionWorkflow = null;
  sessionCoordinateSystem = null;
  sessionExplicit = false;
  autoDetectCache = null;
}

/** ドキュメント切替時（create/close/open）に自動検出キャッシュのみ無効化 */
export function invalidateAutoDetectCache(): void {
  autoDetectCache = null;
}

// --- Auto-detection cache ---

interface AutoDetectCache {
  documentKey: string; // filePath or fileName to detect document switch
  coordinateSystem: CoordinateSystem;
  workflow: WorkflowType;
}

let autoDetectCache: AutoDetectCache | null = null;

/** Minimal JSX to fetch only the current document key (for cache validation) */
const GET_DOCUMENT_KEY_JSX = `
try {
  if (app.documents.length === 0) {
    writeResultFile(RESULT_PATH, { error: true, message: "No document open" });
  } else {
    var doc = app.activeDocument;
    var fp = "";
    try { fp = doc.fullName.fsName; } catch (e) {}
    writeResultFile(RESULT_PATH, { documentKey: fp || doc.name });
  }
} catch (e) {
  writeResultFile(RESULT_PATH, { error: true, message: e.message });
}
`;

/** Lightweight JSX to fetch only document signals needed for workflow detection */
const DETECT_SIGNALS_JSX = `
try {
  var preflight = preflightChecks();
  if (preflight) {
    writeResultFile(RESULT_PATH, preflight);
  } else {
    var doc = app.activeDocument;
    var filePath = "";
    try { filePath = doc.fullName.fsName; } catch (e) { filePath = ""; }

    var colorMode = "unknown";
    if (doc.documentColorSpace === DocumentColorSpace.CMYK) colorMode = "CMYK";
    else if (doc.documentColorSpace === DocumentColorSpace.RGB) colorMode = "RGB";

    var colorProfile = "";
    try { colorProfile = doc.colorProfileName; } catch (e) {}

    var rulerUnits = "unknown";
    try {
      var ru = doc.rulerUnits;
      if (ru === RulerUnits.Pixels) rulerUnits = "px";
      else if (ru === RulerUnits.Points) rulerUnits = "pt";
      else if (ru === RulerUnits.Millimeters) rulerUnits = "mm";
      else if (ru === RulerUnits.Centimeters) rulerUnits = "cm";
      else if (ru === RulerUnits.Inches) rulerUnits = "in";
      else if (ru === RulerUnits.Picas) rulerUnits = "pica";
    } catch (e) {}

    var rasterRes = 0;
    try { rasterRes = doc.rasterEffectSettings.resolution; } catch (e) {}

    writeResultFile(RESULT_PATH, {
      documentKey: filePath || doc.name,
      colorMode: colorMode,
      rulerUnits: rulerUnits,
      rasterEffectResolution: rasterRes,
      colorProfile: colorProfile
    });
  }
} catch (e) {
  writeResultFile(RESULT_PATH, { error: true, message: e.message });
}
`;

/**
 * Auto-detect coordinate system from the active document.
 * Caches result keyed by document; invalidates on document switch.
 */
async function autoDetectCoordinateSystem(): Promise<CoordinateSystem> {
  const result = await executeJsx(DETECT_SIGNALS_JSX);
  if (!result || result.error) {
    return 'artboard-web'; // fallback on error
  }

  const docKey = (result.documentKey as string) ?? '';
  const hint = detectWorkflow({
    colorMode: (result.colorMode as string) ?? 'unknown',
    rulerUnits: (result.rulerUnits as string) ?? 'unknown',
    rasterEffectResolution: (result.rasterEffectResolution as number) ?? 0,
    colorProfile: (result.colorProfile as string) ?? '',
  });

  autoDetectCache = {
    documentKey: docKey,
    coordinateSystem: hint.recommendedCoordinateSystem,
    workflow: hint.detectedWorkflow,
  };

  return hint.recommendedCoordinateSystem;
}

/**
 * Resolve coordinate_system:
 *   1. explicit param (per-tool call)
 *   2. session default (set via set_workflow)
 *   3. auto-detect from document signals (cached, invalidated on document switch)
 *   4. fallback: 'artboard-web'
 */
export async function resolveCoordinateSystem(
  explicit?: CoordinateSystem,
): Promise<CoordinateSystem> {
  if (explicit !== undefined) return explicit;
  if (sessionExplicit) return sessionCoordinateSystem!;

  // キャッシュがあれば、現在のドキュメントキーと比較して有効性を確認
  if (autoDetectCache) {
    try {
      const keyResult = await executeJsx(GET_DOCUMENT_KEY_JSX);
      if (keyResult && !keyResult.error) {
        const currentKey = (keyResult.documentKey as string) ?? '';
        if (currentKey === autoDetectCache.documentKey) {
          return autoDetectCache.coordinateSystem;
        }
        // ドキュメントが変わっている — キャッシュ無効化して再検出
        autoDetectCache = null;
      }
    } catch {
      // キー取得失敗時はキャッシュを信頼せず再検出へフォールスルー
      autoDetectCache = null;
    }
  }

  // キャッシュなし — 初回自動検出
  try {
    return await autoDetectCoordinateSystem();
  } catch {
    return 'artboard-web';
  }
}

// --- Shared Zod schema (all tools import this instead of defining their own) ---

export const coordinateSystemSchema = z
  .enum(['artboard-web', 'document'])
  .optional()
  .describe(
    'Coordinate system. Auto-detected from document by default (CMYK/print → document, RGB/web → artboard-web). artboard-web: origin at active artboard top-left, Y-down. document: Illustrator native coords, origin at bottom-left, Y-up. Call get_document_info to check which system is active.',
  );

// --- Workflow detection ---

interface DocumentSignals {
  colorMode: string;
  rulerUnits: string;
  rasterEffectResolution: number;
  colorProfile: string;
}

export interface WorkflowHint {
  detectedWorkflow: WorkflowType;
  recommendedCoordinateSystem: CoordinateSystem;
  reasoning: string;
  signals: DocumentSignals;
}

export function detectWorkflow(signals: DocumentSignals): WorkflowHint {
  const { colorMode, rulerUnits, rasterEffectResolution, colorProfile } =
    signals;

  const isCMYK = colorMode === 'CMYK';
  const isRGB = colorMode === 'RGB';
  const isPixelUnit = rulerUnits === 'px';
  const isPrintUnit = ['mm', 'cm', 'in', 'pica'].includes(rulerUnits);
  const is72dpi = rasterEffectResolution === 72;
  const isHighRes = rasterEffectResolution >= 300;
  const isMidRes =
    rasterEffectResolution >= 150 && rasterEffectResolution < 300;

  const isPrintProfile =
    isCMYK ||
    /japan color|fogra|swop|gracol|coated|uncoated/i.test(colorProfile);
  const isWebProfile = /srgb|display p3/i.test(colorProfile);

  let webScore = 0;
  let printScore = 0;
  let videoScore = 0;

  // Color mode
  if (isCMYK) printScore += 3;
  if (isRGB) {
    webScore += 1;
    videoScore += 1;
  }

  // Units
  if (isPixelUnit) {
    webScore += 2;
    videoScore += 2;
  }
  if (isPrintUnit) printScore += 2;
  if (rulerUnits === 'pt') {
    printScore += 1;
    webScore += 1;
  }

  // Resolution
  if (is72dpi) webScore += 2;
  if (isHighRes) printScore += 2;
  if (isMidRes && isRGB) videoScore += 2;

  // Color profile
  if (isPrintProfile) printScore += 2;
  if (isWebProfile) webScore += 2;

  const maxScore = Math.max(webScore, printScore, videoScore);

  let detectedWorkflow: WorkflowType;
  const reasons: string[] = [];

  if (maxScore === 0) {
    detectedWorkflow = 'unknown';
    reasons.push('No strong signals detected');
  } else if (printScore === maxScore && printScore > webScore) {
    detectedWorkflow = 'print';
    if (isCMYK) reasons.push('CMYK color mode');
    if (isPrintUnit) reasons.push(`${rulerUnits} units`);
    if (isHighRes) reasons.push(`${rasterEffectResolution}dpi`);
    if (isPrintProfile && colorProfile) reasons.push(colorProfile);
  } else if (videoScore === maxScore && videoScore > webScore) {
    detectedWorkflow = 'video';
    if (isRGB) reasons.push('RGB color mode');
    if (isPixelUnit) reasons.push('px units');
    if (isMidRes) reasons.push(`${rasterEffectResolution}dpi`);
  } else {
    detectedWorkflow = 'web';
    if (isRGB) reasons.push('RGB color mode');
    if (isPixelUnit) reasons.push('px units');
    if (is72dpi) reasons.push('72dpi');
    if (isWebProfile && colorProfile) reasons.push(colorProfile);
  }

  // 座標系はワークフローに応じて自動選択する。
  // 印刷ドキュメント（CMYK）は document 座標（Y上、左下原点）= デザイナーの標準。
  // Web/Video は artboard-web（Y下、左上原点）= LLM が扱いやすい座標系。
  // set_workflow で明示的にオーバーライド可能。
  const recommendedCoordinateSystem: CoordinateSystem =
    detectedWorkflow === 'print' ? 'document' : 'artboard-web';

  return {
    detectedWorkflow,
    recommendedCoordinateSystem,
    reasoning: reasons.join(', '),
    signals,
  };
}
