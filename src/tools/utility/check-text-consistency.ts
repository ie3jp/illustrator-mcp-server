import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeJsx } from '../../executor/jsx-runner.js';
import {
  coordinateSystemSchema,
  resolveCoordinateSystem,
} from '../session.js';
import { READ_ANNOTATIONS } from '../modify/shared.js';
/**
 * check_text_consistency — テキスト一貫性チェック（ダミーテキスト検出・フォント統計）
 * @see https://www.indesignjs.de/extendscriptAPI/indesign-cs6.html#TextFrame
 * @see https://www.indesignjs.de/extendscriptAPI/indesign-cs6.html#Text
 *
 * Collects all text frame contents from the active InDesign document.
 * Node.js-side post-processing detects dummy text patterns and known notation variations.
 */
const jsxCode = `
var preflight = preflightChecks();
if (preflight) {
  writeResultFile(RESULT_PATH, preflight);
} else {
  try {
    var params = readParamsFile(PARAMS_PATH);
    var doc = app.activeDocument;
    var filterPage = (params && typeof params.page_index === "number") ? params.page_index : null;

    if (filterPage !== null && (filterPage < 0 || filterPage >= doc.pages.length)) {
      writeResultFile(RESULT_PATH, {
        error: true,
        message: "Page index " + filterPage + " is out of range (0-" + (doc.pages.length - 1) + ")"
      });
    } else {
      var frames = [];

      // Iterate all text frames in the document
      for (var i = 0; i < doc.textFrames.length; i++) {
        var tf = doc.textFrames[i];
        try {
          var uuid = ensureUUID(tf);

          // Determine which page this frame belongs to
          var pageIdx = -1;
          try {
            var parentPage = tf.parentPage;
            if (parentPage) {
              pageIdx = parentPage.documentOffset;
            }
          } catch(e) {}

          if (filterPage !== null && pageIdx !== filterPage) continue;

          // Layer name
          var layerName = "";
          try {
            var item = tf;
            while (item.parent) {
              if (item.parent.constructor && item.parent.constructor.name === "Layer") {
                layerName = item.parent.name;
                break;
              }
              // Check typename for Layer
              try {
                if (item.parent.typename === "Layer") {
                  layerName = item.parent.name;
                  break;
                }
              } catch(le) {}
              item = item.parent;
            }
          } catch(e) {}

          // Page label (user-visible page name, e.g. "i", "1", "A-1")
          var pageLabel = "";
          try {
            if (tf.parentPage) {
              pageLabel = tf.parentPage.name;
            }
          } catch(e) {}

          frames.push({
            uuid: uuid,
            contents: tf.contents,
            layerName: layerName,
            pageIndex: pageIdx,
            pageLabel: pageLabel
          });
        } catch(e) {}
      }

      writeResultFile(RESULT_PATH, {
        totalFrames: frames.length,
        frames: frames
      });
    }
  } catch (e) {
    writeResultFile(RESULT_PATH, { error: true, message: e.message, line: e.line });
  }
}
`;

// --- Node.js post-processing: pattern-based text analysis ---

interface TextFrame {
  uuid: string;
  contents: string;
  layerName: string;
  pageIndex: number;
  pageLabel: string;
}

interface DummyTextHit {
  uuid: string;
  contents: string;
  pattern: string;
  layerName: string;
  pageIndex: number;
  pageLabel: string;
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
          pageIndex: frame.pageIndex,
          pageLabel: frame.pageLabel,
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
  const katakanaWordMap = new Map<string, Map<string, string[]>>();
  const katakanaPattern = /[\u30A0-\u30FF]{2,}/g;

  for (const frame of frames) {
    const matches = frame.contents.match(katakanaPattern);
    if (!matches) continue;
    for (const word of matches) {
      const base = word.replace(/\u30FC+$/, '');
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

  if (result.length === 0) return null;

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
    pageIndex: f.pageIndex,
    pageLabel: f.pageLabel,
  }));

  return { dummyTexts, knownVariations, allTexts };
}

export function register(server: McpServer): void {
  server.registerTool(
    'check_text_consistency',
    {
      title: 'Check Text Consistency',
      description:
        'Analyze text frames for dummy/placeholder text and known notation variation patterns ' +
        '(katakana long vowel, fullwidth/halfwidth, wave dash/tilde). ' +
        'Returns all text contents for LLM-driven deeper analysis of inconsistencies, typos, and version mismatches. ' +
        'Note: AI analysis may miss errors and does not replace a human text review.',
      inputSchema: {
        page_index: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe('Filter by page index (0-based document offset). Omit to check all pages.'),
        coordinate_system: coordinateSystemSchema,
      },
      annotations: READ_ANNOTATIONS,
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
                mechanicalChecks: {
                  _reliability: 'deterministic',
                  dummyTexts: analysis.dummyTexts,
                  knownVariations: analysis.knownVariations,
                },
                llmAnalysis: {
                  _reliability: 'ai-assisted — may miss errors or produce false positives. Clearly distinguish AI-based findings from mechanical checks when reporting to the user.',
                  allTexts: analysis.allTexts,
                },
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
