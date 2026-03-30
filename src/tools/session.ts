import { z } from 'zod';
import { executeJsx } from '../executor/jsx-runner.js';

export type WorkflowType = 'print' | 'digital' | 'unknown';
export type CoordinateSystem = 'page-relative' | 'spread';

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

/** Lightweight JSX to fetch document signals needed for workflow detection */
const DETECT_SIGNALS_JSX = `
try {
  var preflight = preflightChecks();
  if (preflight) {
    writeResultFile(RESULT_PATH, preflight);
  } else {
    var doc = app.activeDocument;
    var filePath = "";
    try { filePath = doc.fullName.fsName; } catch (e) { filePath = ""; }

    var intent = "unknown";
    try {
      var di = doc.documentPreferences.intent;
      if (di === DocumentIntentOptions.PRINT_INTENT) intent = "print";
      else if (di === DocumentIntentOptions.WEB_INTENT) intent = "digital";
      else if (di === DocumentIntentOptions.MOBILE_INTENT) intent = "digital";
    } catch (e) {}

    var pageWidth = 0;
    var pageHeight = 0;
    try {
      pageWidth = doc.documentPreferences.pageWidth;
      pageHeight = doc.documentPreferences.pageHeight;
    } catch (e) {}

    var facingPages = false;
    try { facingPages = doc.documentPreferences.facingPages; } catch (e) {}

    writeResultFile(RESULT_PATH, {
      documentKey: filePath || doc.name,
      intent: intent,
      pageWidth: pageWidth,
      pageHeight: pageHeight,
      facingPages: facingPages
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
    return 'page-relative'; // fallback on error
  }

  const docKey = (result.documentKey as string) ?? '';
  const hint = detectWorkflow({
    intent: (result.intent as string) ?? 'unknown',
    pageWidth: (result.pageWidth as number) ?? 0,
    pageHeight: (result.pageHeight as number) ?? 0,
    facingPages: (result.facingPages as boolean) ?? false,
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
 *   4. fallback: 'page-relative'
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
    return 'page-relative';
  }
}

// --- Shared Zod schema (all tools import this instead of defining their own) ---

export const coordinateSystemSchema = z
  .enum(['page-relative', 'spread'])
  .optional()
  .describe(
    'Coordinate system. "page-relative" (default): coords relative to page top-left. "spread": pasteboard coordinates.',
  );

// --- Workflow detection ---

interface DocumentSignals {
  intent: string;
  pageWidth: number;
  pageHeight: number;
  facingPages: boolean;
}

export interface WorkflowHint {
  detectedWorkflow: WorkflowType;
  recommendedCoordinateSystem: CoordinateSystem;
  reasoning: string;
  signals: DocumentSignals;
}

export function detectWorkflow(signals: DocumentSignals): WorkflowHint {
  const { intent, pageWidth, pageHeight, facingPages } = signals;

  const reasons: string[] = [];
  let detectedWorkflow: WorkflowType;

  if (intent === 'print') {
    detectedWorkflow = 'print';
    reasons.push('Document intent: Print');
  } else if (intent === 'digital') {
    detectedWorkflow = 'digital';
    reasons.push('Document intent: Digital/Web');
  } else {
    // Heuristic: large pages or facing pages suggest print
    if (facingPages) {
      detectedWorkflow = 'print';
      reasons.push('Facing pages enabled');
    } else if (pageWidth > 0 && pageHeight > 0) {
      // Check for common screen sizes (landscape, 72dpi-ish)
      const ratio = pageWidth / pageHeight;
      if (ratio > 1.5 && pageWidth > 800) {
        detectedWorkflow = 'digital';
        reasons.push('Wide landscape format suggests digital');
      } else {
        detectedWorkflow = 'print';
        reasons.push('Default: assumed print');
      }
    } else {
      detectedWorkflow = 'unknown';
      reasons.push('No strong signals detected');
    }
  }

  // InDesign's coordinate system is always Y-down; page-relative is the standard
  const recommendedCoordinateSystem: CoordinateSystem = 'page-relative';

  return {
    detectedWorkflow,
    recommendedCoordinateSystem,
    reasoning: reasons.join(', '),
    signals,
  };
}
