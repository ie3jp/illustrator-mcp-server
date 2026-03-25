import { z } from 'zod';

export type WorkflowType = 'web' | 'print' | 'video' | 'unknown';
export type CoordinateSystem = 'artboard-web' | 'document';

// --- Session state (module-level, lives for the MCP server process lifetime) ---

let sessionCoordinateSystem: CoordinateSystem | null = null;
let sessionWorkflow: WorkflowType | null = null;

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
}

export function clearSession(): void {
  sessionWorkflow = null;
  sessionCoordinateSystem = null;
}

/**
 * Resolve coordinate_system: explicit param > session default > 'artboard-web'
 * Zod schema uses .optional() without .default() so undefined means "not specified".
 */
export function resolveCoordinateSystem(
  explicit?: CoordinateSystem,
): CoordinateSystem {
  if (explicit !== undefined) return explicit;
  return sessionCoordinateSystem ?? 'artboard-web';
}

// --- Shared Zod schema (all tools import this instead of defining their own) ---

export const coordinateSystemSchema = z
  .enum(['artboard-web', 'document'])
  .optional()
  .describe(
    'Coordinate system. Omit to use session default (set via set_workflow), falls back to artboard-web.',
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

  const recommendedCoordinateSystem: CoordinateSystem =
    detectedWorkflow === 'print' ? 'document' : 'artboard-web';

  return {
    detectedWorkflow,
    recommendedCoordinateSystem,
    reasoning: reasons.join(', '),
    signals,
  };
}
