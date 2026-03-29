import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeJsx } from '../../executor/jsx-runner.js';
import {
  coordinateSystemSchema,
  resolveCoordinateSystem,
} from '../session.js';

const jsxCode = `
try {
  var err = preflightChecks();
  if (err) {
    writeResultFile(RESULT_PATH, err);
  } else {
    var params = readParamsFile(PARAMS_PATH);
    var doc = app.activeDocument;
    var filterArtboard = (params && typeof params.artboard_index === "number") ? params.artboard_index : null;

    if (filterArtboard !== null && (filterArtboard < 0 || filterArtboard >= doc.artboards.length)) {
      writeResultFile(RESULT_PATH, {
        error: true,
        message: "Artboard index " + filterArtboard + " is out of range (0-" + (doc.artboards.length - 1) + ")"
      });
    } else {
      var frames = [];
      for (var i = 0; i < doc.textFrames.length; i++) {
        var tf = doc.textFrames[i];
        try {
          var uuid = ensureUUID(tf);
          var abIdx = getArtboardIndexForItem(tf);

          if (filterArtboard !== null && abIdx !== filterArtboard) continue;

          var layerName = "";
          var current = tf.parent;
          while (current) {
            if (current.typename === "Layer") { layerName = current.name; break; }
            current = current.parent;
          }

          frames.push({
            uuid: uuid,
            contents: tf.contents,
            layerName: layerName,
            artboardIndex: abIdx
          });
        } catch(e) {}
      }

      writeResultFile(RESULT_PATH, {
        totalFrames: frames.length,
        frames: frames
      });
    }
  }
} catch (e) {
  writeResultFile(RESULT_PATH, { error: true, message: e.message, line: e.line });
}
`;

// --- Node.js post-processing: pattern-based text analysis ---

interface TextFrame {
  uuid: string;
  contents: string;
  layerName: string;
  artboardIndex: number;
}

interface DummyTextHit {
  uuid: string;
  contents: string;
  pattern: string;
  layerName: string;
  artboardIndex: number;
}

interface VariationGroup {
  type: string;
  description: string;
  variants: Array<{ text: string; count: number; uuids: string[] }>;
}

const DUMMY_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /lorem\s+ipsum/i, label: 'Lorem ipsum' },
  { pattern: /テキストが入ります/, label: 'テキストが入ります' },
  { pattern: /ここにテキスト/, label: 'ここにテキスト' },
  { pattern: /ダミーテキスト/, label: 'ダミーテキスト' },
  { pattern: /^ダミー$/, label: 'ダミー' },
  { pattern: /^sample\s*text$/i, label: 'sample text' },
  { pattern: /^placeholder$/i, label: 'placeholder' },
  { pattern: /^xxx+$/i, label: 'XXX placeholder' },
  { pattern: /^○+$/, label: '○○○ placeholder' },
  { pattern: /^●+$/, label: '●●● placeholder' },
  { pattern: /^△+$/, label: '△△△ placeholder' },
  { pattern: /仮テキスト/, label: '仮テキスト' },
  { pattern: /テキストを入力/, label: 'テキストを入力' },
];

function detectDummyTexts(frames: TextFrame[]): DummyTextHit[] {
  const hits: DummyTextHit[] = [];
  for (const frame of frames) {
    const text = frame.contents.trim();
    if (!text) continue;
    for (const dp of DUMMY_PATTERNS) {
      if (dp.pattern.test(text)) {
        hits.push({
          uuid: frame.uuid,
          contents: text.substring(0, 100),
          pattern: dp.label,
          layerName: frame.layerName,
          artboardIndex: frame.artboardIndex,
        });
        break;
      }
    }
  }
  return hits;
}

/**
 * Detect katakana long vowel variations: "サーバー" vs "サーバ"
 */
function detectKatakanaLongVowel(frames: TextFrame[]): VariationGroup | null {
  // Extract all katakana words from text frames
  const katakanaWordMap = new Map<string, Map<string, string[]>>(); // base -> {variant -> uuids}
  const katakanaPattern = /[\u30A0-\u30FF]{2,}/g;

  for (const frame of frames) {
    const matches = frame.contents.match(katakanaPattern);
    if (!matches) continue;
    for (const word of matches) {
      // Normalize: remove trailing long vowel mark
      const base = word.replace(/ー+$/, '');
      if (base.length < 2) continue;
      if (!katakanaWordMap.has(base)) {
        katakanaWordMap.set(base, new Map());
      }
      const variants = katakanaWordMap.get(base)!;
      if (!variants.has(word)) {
        variants.set(word, []);
      }
      variants.get(word)!.push(frame.uuid);
    }
  }

  const variationGroups: Array<{ text: string; count: number; uuids: string[] }> = [];
  for (const [, variants] of katakanaWordMap) {
    if (variants.size > 1) {
      const group: Array<{ text: string; count: number; uuids: string[] }> = [];
      for (const [text, uuids] of variants) {
        group.push({ text, count: uuids.length, uuids: [...new Set(uuids)] });
      }
      variationGroups.push(...group);
    }
  }

  if (variationGroups.length === 0) return null;

  // Regroup by base word
  const result: Array<{ text: string; count: number; uuids: string[] }> = [];
  const seen = new Set<string>();
  for (const [base, variants] of katakanaWordMap) {
    if (variants.size <= 1) continue;
    if (seen.has(base)) continue;
    seen.add(base);
    for (const [text, uuids] of variants) {
      result.push({ text, count: uuids.length, uuids: [...new Set(uuids)] });
    }
  }

  return {
    type: 'katakana_long_vowel',
    description: 'Katakana trailing long vowel mark variation (e.g. "サーバー" vs "サーバ")',
    variants: result,
  };
}

/**
 * Detect fullwidth/halfwidth number variations: "１２３" vs "123"
 */
function detectFullwidthHalfwidth(frames: TextFrame[]): VariationGroup | null {
  let hasFullwidthDigits = false;
  let hasHalfwidthDigits = false;
  const fullwidthUuids: string[] = [];
  const halfwidthUuids: string[] = [];

  const fullwidthDigitPattern = /[０-９]+/;
  const halfwidthDigitPattern = /[0-9]+/;

  for (const frame of frames) {
    if (fullwidthDigitPattern.test(frame.contents)) {
      hasFullwidthDigits = true;
      fullwidthUuids.push(frame.uuid);
    }
    if (halfwidthDigitPattern.test(frame.contents)) {
      hasHalfwidthDigits = true;
      halfwidthUuids.push(frame.uuid);
    }
  }

  if (hasFullwidthDigits && hasHalfwidthDigits) {
    return {
      type: 'fullwidth_halfwidth_digits',
      description: 'Mixed fullwidth and halfwidth digits (e.g. "１２３" vs "123")',
      variants: [
        { text: 'Fullwidth digits (０-９)', count: fullwidthUuids.length, uuids: [...new Set(fullwidthUuids)] },
        { text: 'Halfwidth digits (0-9)', count: halfwidthUuids.length, uuids: [...new Set(halfwidthUuids)] },
      ],
    };
  }
  return null;
}

/**
 * Detect fullwidth/halfwidth alphabet variations: "Ａ" vs "A"
 */
function detectFullwidthAlphabet(frames: TextFrame[]): VariationGroup | null {
  let hasFullwidth = false;
  let hasHalfwidth = false;
  const fullwidthUuids: string[] = [];
  const halfwidthUuids: string[] = [];

  const fullwidthAlphaPattern = /[Ａ-Ｚａ-ｚ]+/;
  const halfwidthAlphaPattern = /[A-Za-z]+/;

  for (const frame of frames) {
    if (fullwidthAlphaPattern.test(frame.contents)) {
      hasFullwidth = true;
      fullwidthUuids.push(frame.uuid);
    }
    if (halfwidthAlphaPattern.test(frame.contents)) {
      hasHalfwidth = true;
      halfwidthUuids.push(frame.uuid);
    }
  }

  if (hasFullwidth && hasHalfwidth) {
    return {
      type: 'fullwidth_halfwidth_alpha',
      description: 'Mixed fullwidth and halfwidth alphabets (e.g. "Ａ" vs "A")',
      variants: [
        { text: 'Fullwidth alpha (Ａ-Ｚ)', count: fullwidthUuids.length, uuids: [...new Set(fullwidthUuids)] },
        { text: 'Halfwidth alpha (A-Z)', count: halfwidthUuids.length, uuids: [...new Set(halfwidthUuids)] },
      ],
    };
  }
  return null;
}

/**
 * Detect wave dash vs fullwidth tilde: "〜" (U+301C) vs "～" (U+FF5E)
 */
function detectWaveDashTilde(frames: TextFrame[]): VariationGroup | null {
  let hasWaveDash = false;
  let hasTilde = false;
  const waveDashUuids: string[] = [];
  const tildeUuids: string[] = [];

  for (const frame of frames) {
    if (frame.contents.includes('\u301C')) {
      hasWaveDash = true;
      waveDashUuids.push(frame.uuid);
    }
    if (frame.contents.includes('\uFF5E')) {
      hasTilde = true;
      tildeUuids.push(frame.uuid);
    }
  }

  if (hasWaveDash && hasTilde) {
    return {
      type: 'wave_dash_tilde',
      description: 'Wave dash (〜 U+301C) vs fullwidth tilde (～ U+FF5E)',
      variants: [
        { text: '〜 (Wave dash U+301C)', count: waveDashUuids.length, uuids: [...new Set(waveDashUuids)] },
        { text: '～ (Fullwidth tilde U+FF5E)', count: tildeUuids.length, uuids: [...new Set(tildeUuids)] },
      ],
    };
  }
  return null;
}

function analyzeTextConsistency(frames: TextFrame[]) {
  const dummyTexts = detectDummyTexts(frames);

  const knownVariations: VariationGroup[] = [];
  const katakana = detectKatakanaLongVowel(frames);
  if (katakana) knownVariations.push(katakana);
  const fwHwDigits = detectFullwidthHalfwidth(frames);
  if (fwHwDigits) knownVariations.push(fwHwDigits);
  const fwHwAlpha = detectFullwidthAlphabet(frames);
  if (fwHwAlpha) knownVariations.push(fwHwAlpha);
  const waveDash = detectWaveDashTilde(frames);
  if (waveDash) knownVariations.push(waveDash);

  // Return all texts for LLM analysis
  const allTexts = frames.map((f) => ({
    uuid: f.uuid,
    contents: f.contents,
    layerName: f.layerName,
    artboardIndex: f.artboardIndex,
  }));

  return { dummyTexts, knownVariations, allTexts };
}

export function register(server: McpServer): void {
  server.registerTool(
    'check_text_consistency',
    {
      title: 'Check Text Consistency',
      description:
        'Analyze text frames for dummy/placeholder text and known notation variation patterns (katakana long vowel, fullwidth/halfwidth, wave dash/tilde). Returns all text contents for LLM-driven deeper analysis of inconsistencies, typos, and version mismatches.',
      inputSchema: {
        artboard_index: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe('Filter by artboard index (0-based)'),
        coordinate_system: coordinateSystemSchema,
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params) => {
      const resolvedParams = { ...params, coordinate_system: await resolveCoordinateSystem(params.coordinate_system) };
      const result = (await executeJsx(jsxCode, resolvedParams)) as {
        totalFrames: number;
        frames: TextFrame[];
        error?: boolean;
        message?: string;
      };

      if (result.error) {
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }

      const analysis = analyzeTextConsistency(result.frames);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                totalFrames: result.totalFrames,
                dummyTexts: analysis.dummyTexts,
                knownVariations: analysis.knownVariations,
                allTexts: analysis.allTexts,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );
}
