import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeJsx } from '../../executor/jsx-runner.js';
import { formatToolResult } from '../tool-executor.js';
import {
  coordinateSystemSchema,
  resolveCoordinateSystem,
} from '../session.js';
import { READ_ANNOTATIONS } from '../modify/shared.js';
/**
 * get_text_frame_detail — テキストフレームの詳細情報取得
 * @see https://ai-scripting.docsforadobe.dev/jsobjref/TextFrameItem/ — contents, textRanges, paragraphs
 * @see https://ai-scripting.docsforadobe.dev/jsobjref/CharacterAttributes/ — size, textFont, tracking, Tsume, etc.
 *
 * 行送り（leading / autoLeading）は CharacterAttributes、段落スタイルは TextRange.paragraphStyles から読む
 * （ParagraphAttributes に leading / autoLeading / paragraphStyle は存在しない）。
 */
const jsxCode = `
var preflight = preflightChecks();
if (preflight) {
  writeResultFile(RESULT_PATH, preflight);
} else {
  try {
    var params = readParamsFile(PARAMS_PATH);
    var doc = app.activeDocument;
    var coordSystem = (params && params.coordinate_system) ? params.coordinate_system : "artboard-web";
    var targetUUID = params.uuid;

    if (!targetUUID) {
      writeResultFile(RESULT_PATH, { error: true, message: "uuid parameter is required" });
    } else {
      var found = null;
      var foundIndex = -1;
      for (var i = 0; i < doc.textFrames.length; i++) {
        var item = doc.textFrames[i];
        var itemUUID = ensureUUID(item);
        if (itemUUID === targetUUID) {
          found = item;
          foundIndex = i;
          break;
        }
      }

      if (!found) {
        writeResultFile(RESULT_PATH, {
          error: true,
          message: "No text frame found matching UUID: " + targetUUID
        });
      } else {
        var tf = found;
        // 文字属性の読み直しでは tf ごと文書から取り直す（同じ tf より成功しやすい。common.jsx の readTextUnits）
        var refetchFrame = function() { return doc.textFrames[foundIndex]; };

        var textKind = getTextKind(tf);

        var itemAbIdx = getArtboardIndexForItem(tf);
        var boundsAbRect = null;
        if (coordSystem === "artboard-web") {
          boundsAbRect = getArtboardRectByIndex(itemAbIdx);
        }
        var bounds = getBounds(tf, coordSystem, boundsAbRect);

        var orientation = "horizontal";
        try { if (tf.orientation === TextOrientation.VERTICAL) orientation = "vertical"; } catch (e) {}

        // ポイント文字・パス上文字では nextFrame / previousFrame が例外（9544、実機）。連結が無いだけなので null のまま
        var nextFrameUUID = null;
        var previousFrameUUID = null;
        try { if (tf.nextFrame) nextFrameUUID = ensureUUID(tf.nextFrame); } catch (e) {}
        try { if (tf.previousFrame) previousFrameUUID = ensureUUID(tf.previousFrame); } catch (e) {}

        // 文字属性は既定値で埋めない。読めなければ（再試行しても）どの項目かを添えてエラーにする
        var readStage = "the text frame";

        // 段落属性（各段落ごと）。leading / autoLeading は文字属性（段落先頭文字の値）
        var paraAttrs;
        try {
          paraAttrs = readTextUnits(tf, "paragraphs", function(para, pIndex) {
            readStage = "paragraph " + pIndex;
            var pa = para.paragraphAttributes;
            var info = { text: para.contents };
            info.leading = para.characterAttributes.leading;
            info.autoLeading = para.characterAttributes.autoLeading;
            info.autoLeadingAmount = pa.autoLeadingAmount;
            info.firstLineIndent = pa.firstLineIndent;
            info.leftIndent = pa.leftIndent;
            info.rightIndent = pa.rightIndent;
            info.spaceBefore = pa.spaceBefore;
            info.spaceAfter = pa.spaceAfter;
            var j = pa.justification;
            if (j === Justification.LEFT) info.justification = "left";
            else if (j === Justification.CENTER) info.justification = "center";
            else if (j === Justification.RIGHT) info.justification = "right";
            else if (j === Justification.FULLJUSTIFYLASTLINELEFT) info.justification = "justify-left";
            else if (j === Justification.FULLJUSTIFYLASTLINECENTER) info.justification = "justify-center";
            else if (j === Justification.FULLJUSTIFYLASTLINERIGHT) info.justification = "justify-right";
            else if (j === Justification.FULLJUSTIFY) info.justification = "justify-all";
            else info.justification = String(j);
            info.hyphenation = pa.hyphenation;
            info.paragraphStyle = (para.paragraphStyles.length > 0) ? (para.paragraphStyles[0].name || "") : "";
            return info;
          }, { units: tf.paragraphs, refetch: refetchFrame });
        } catch (eP) {
          throw new Error("Could not read the attributes of " + readStage + ": " + describeTextReadError(eP));
        }

        // 1 文字ずつの属性
        var charInfos;
        try {
          charInfos = readTextUnits(tf, "characters", function(ch, cIndex) {
            readStage = "character " + cIndex;
            var cca = ch.characterAttributes;
            var info = { text: ch.contents };
            info.fontFamily = cca.textFont.family;
            info.fontStyle = cca.textFont.style;
            info.fontSize = cca.size;
            info.color = colorToObject(cca.fillColor);
            info.tracking = cca.tracking;
            var km2 = cca.kerningMethod;
            if (km2 === AutoKernType.AUTO) info.kerningMethod = "auto";
            else if (km2 === AutoKernType.OPTICAL) info.kerningMethod = "optical";
            else if (km2 === AutoKernType.METRICSROMANONLY) info.kerningMethod = "metrics";
            else if (km2 === AutoKernType.NOAUTOKERN) info.kerningMethod = "none";
            else info.kerningMethod = String(km2);
            info.proportionalMetrics = cca.proportionalMetrics;
            info.akiLeft = cca.akiLeft;
            info.akiRight = cca.akiRight;
            info.tsume = cca.Tsume;
            info.baselineShift = cca.baselineShift;
            info.horizontalScale = cca.horizontalScale;
            info.verticalScale = cca.verticalScale;
            info.rotation = cca.rotation;
            return info;
          }, { units: tf.characters, refetch: refetchFrame });
        } catch (eC) {
          throw new Error("Could not read the attributes of " + readStage + ": " + describeTextReadError(eC));
        }

        // 手動カーニング（TextRange.kerning は手動設定が無い位置で 9551 を投げる＝値なし。内部エラーは値なしにしない）
        var kernings;
        try {
          kernings = readTextUnits(tf, "characters", function(ch, kIndex) {
            readStage = "kerning at character " + kIndex;
            try { return ch.kerning; } catch (ek) {
              if (isIllustratorInternalError(ek)) throw ek;
              return null;
            }
          }, { units: tf.characters, refetch: refetchFrame });
        } catch (eK) {
          throw new Error("Could not read the " + readStage + ": " + describeTextReadError(eK));
        }

        // 同一属性の連続文字はランにまとめる（色は全成分＝特色名・濃度・グラデーション分岐点まで比較する）
        var runs = [];
        var prevKey = "";
        var currentRun = null;
        var kerningPairs = [];
        for (var ci = 0; ci < charInfos.length; ci++) {
          var info = charInfos[ci];
          var key = info.fontFamily + "|" + info.fontStyle + "|" + info.fontSize
            + "|" + info.tracking + "|" + info.kerningMethod
            + "|" + info.akiLeft + "|" + info.akiRight + "|" + info.tsume + "|" + info.proportionalMetrics
            + "|" + info.baselineShift + "|" + info.horizontalScale + "|" + info.verticalScale
            + "|" + info.rotation
            + "|" + jsonStringify(info.color);

          if (key === prevKey && currentRun) {
            currentRun.text += info.text;
          } else {
            currentRun = {
              text: info.text,
              fontFamily: info.fontFamily,
              fontStyle: info.fontStyle,
              fontSize: info.fontSize,
              color: info.color,
              tracking: info.tracking,
              kerningMethod: info.kerningMethod,
              akiLeft: info.akiLeft,
              akiRight: info.akiRight,
              tsume: info.tsume,
              proportionalMetrics: info.proportionalMetrics,
              baselineShift: info.baselineShift,
              horizontalScale: info.horizontalScale,
              verticalScale: info.verticalScale,
              rotation: info.rotation
            };
            runs.push(currentRun);
            prevKey = key;
          }

          if (kernings[ci] !== null) {
            var right = (ci + 1 < charInfos.length) ? charInfos[ci + 1].text : "";
            kerningPairs.push({ index: ci, left: info.text, right: right, value: kernings[ci] });
          }
        }

        writeResultFile(RESULT_PATH, {
          uuid: targetUUID,
          contents: tf.contents,
          x: bounds.x,
          y: bounds.y,
          width: bounds.width,
          height: bounds.height,
          textKind: textKind,
          orientation: orientation,
          nextFrameUUID: nextFrameUUID,
          previousFrameUUID: previousFrameUUID,
          zIndex: getZIndex(tf),
          artboardIndex: itemAbIdx,
          coordinateSystem: coordSystem,
          characterRuns: runs,
          kerningPairs: kerningPairs,
          paragraphAttributes: paraAttrs
        });
      }
    }
  } catch (e) {
    writeResultFile(RESULT_PATH, { error: true, message: "Failed to get text frame detail: " + e.message, line: e.line });
  }
}
`;

export function register(server: McpServer): void {
  server.registerTool(
    'get_text_frame_detail',
    {
      title: 'Get Text Frame Detail',
      description:
        'Get detailed text frame attributes including per-character runs (font, tracking, akiLeft/akiRight, tsume, proportionalMetrics), kerning pairs with manual kerning values (1/1000 em), paragraph attributes (leading, autoLeading, paragraph style), orientation (horizontal/vertical) and threaded-frame links (nextFrameUUID/previousFrameUUID). Returns cssHints for web/CSS reproduction.',
      inputSchema: {
        uuid: z.string().describe('UUID of the target text frame'),
        coordinate_system: coordinateSystemSchema,
      },
      annotations: READ_ANNOTATIONS,
    },
    async (params) => {
      const resolvedParams = { ...params, coordinate_system: await resolveCoordinateSystem(params.coordinate_system) };
      const result = (await executeJsx(jsxCode, resolvedParams)) as Record<string, unknown>;

      if (result.error) {
        return formatToolResult(result);
      }

      // --- CSS ヒント付与 & サマリ生成 ---
      const runs = (result.characterRuns ?? []) as Array<Record<string, unknown>>;
      const kerningPairs = (result.kerningPairs ?? []) as Array<Record<string, unknown>>;
      const cssRules: string[] = [];
      const notes: string[] = [];

      for (const run of runs) {
        const css: Record<string, string> = {};

        const tracking = run.tracking as number;
        if (tracking !== 0) {
          css['letter-spacing'] = `${(tracking / 1000).toFixed(3)}em`;
        }

        // palt は proportionalMetrics に対応。tsume（ツメ）は別物で CSS に直接の対応がない
        if (run.proportionalMetrics === true) {
          css['font-feature-settings'] = '"palt"';
        }

        const baselineShift = run.baselineShift as number;
        if (baselineShift !== 0) {
          css['vertical-align'] = `${baselineShift}pt`;
        }

        const hScale = run.horizontalScale as number;
        const vScale = run.verticalScale as number;
        const rotation = run.rotation as number;
        const transforms: string[] = [];
        if (hScale !== 100 || vScale !== 100) {
          transforms.push(`scale(${(hScale / 100).toFixed(2)}, ${(vScale / 100).toFixed(2)})`);
        }
        if (rotation !== 0) {
          transforms.push(`rotate(${rotation}deg)`);
        }
        if (transforms.length > 0) {
          css['transform'] = transforms.join(' ');
        }

        const kernType = run.kerningMethod as string;
        if (kernType === 'none') {
          css['font-kerning'] = 'none';
        } else if (kernType === 'optical' || kernType === 'metrics' || kernType === 'auto') {
          css['font-kerning'] = 'auto';
        }

        if (Object.keys(css).length > 0) {
          run.cssHints = css;
        }
      }

      // --- 自然言語サマリを生成 ---
      const fontSet = new Set(runs.map((r) => `${r.fontFamily} ${r.fontStyle}`));
      const fontSize = runs.length > 0 ? (runs[0].fontSize as number) : 0;
      cssRules.push(`font-family: "${runs[0]?.fontFamily ?? ''}", sans-serif`);
      cssRules.push(`font-size: ${fontSize}pt`);

      const trackingVal = runs.length > 0 ? (runs[0].tracking as number) : 0;
      if (trackingVal !== 0) {
        cssRules.push(`letter-spacing: ${(trackingVal / 1000).toFixed(3)}em`);
      }

      const kernMethod = runs.length > 0 ? (runs[0].kerningMethod as string) : 'auto';
      if (kernMethod !== 'none') {
        cssRules.push('font-kerning: auto');
      }

      if (kerningPairs.length > 0) {
        const pairDescs = kerningPairs.map(
          (p) => `"${p.left}${p.right}" ${(p.value as number) > 0 ? '+' : ''}${p.value as number}`,
        );
        notes.push(
          `手動カーニング (${kerningPairs.length}箇所): ${pairDescs.join(', ')}。` +
            'Web再現するには各文字を<span>で囲み個別にletter-spacingを設定。',
        );
      } else {
        notes.push('手動カーニングなし。フォント内蔵のメトリクスカーニングのみ（font-kerning: auto で再現）。');
      }

      if (runs.length > 1) {
        const diffs: string[] = [];
        for (const run of runs) {
          const parts: string[] = [];
          if ((run.horizontalScale as number) !== 100 || (run.verticalScale as number) !== 100) {
            parts.push(`transform: scale(${((run.horizontalScale as number) / 100).toFixed(2)}, ${((run.verticalScale as number) / 100).toFixed(2)})`);
          }
          if ((run.baselineShift as number) !== 0) {
            parts.push(`ベースラインシフト: ${run.baselineShift}pt`);
          }
          if ((run.rotation as number) !== 0) {
            parts.push(`回転: ${run.rotation}°`);
          }
          if (parts.length > 0) {
            diffs.push(`"${(run.text as string).substring(0, 20)}" → ${parts.join(', ')}`);
          }
        }
        if (diffs.length > 0) {
          notes.push(`文字単位の個別設定: ${diffs.join('; ')}`);
        }
      }

      const hasTsume = runs.some((r) => (r.tsume as number) > 0);
      const hasPropMetrics = runs.some((r) => r.proportionalMetrics === true);
      if (hasPropMetrics) {
        cssRules.push('font-feature-settings: "palt"');
        notes.push('プロポーショナルメトリクスが有効。CSSではfont-feature-settings: "palt"で再現。');
      }
      if (hasTsume) {
        notes.push('ツメ（文字前後の空きを詰める率）が設定されている。CSSに直接の対応はない（"palt" とは別物）。近似するなら letter-spacing の負値で調整。');
      }

      if (result.orientation === 'vertical') {
        cssRules.push('writing-mode: vertical-rl');
      }

      const paras = (result.paragraphAttributes ?? []) as Array<Record<string, unknown>>;
      if (paras.length > 0) {
        const para = paras[0];
        if (para.justification && para.justification !== 'left') {
          cssRules.push(`text-align: ${para.justification}`);
        }
        const leading = para.leading as number;
        const autoLeadingAmount = para.autoLeadingAmount as number | null;
        if (para.autoLeading === true && typeof autoLeadingAmount === 'number' && autoLeadingAmount > 0) {
          cssRules.push(`line-height: ${(autoLeadingAmount / 100).toFixed(2)}`);
        } else if (leading > 0 && fontSize > 0) {
          cssRules.push(`line-height: ${(leading / fontSize).toFixed(2)}`);
        }
      }

      // --- プレーンテキストのサマリを生成（Claude が最初に読むブロック） ---
      const summaryLines: string[] = [];
      summaryLines.push(`■ テキスト: "${(result.contents as string).replace(/\r/g, '\\n').substring(0, 60)}"`);
      summaryLines.push(`■ フォント: ${[...fontSet].join(', ')} / ${fontSize}pt`);
      summaryLines.push('');
      summaryLines.push('【CSS再現ルール】');
      for (const rule of cssRules) {
        summaryLines.push(`  ${rule};`);
      }

      if (kerningPairs.length > 0) {
        summaryLines.push('');
        summaryLines.push(`【手動カーニング: ${kerningPairs.length}箇所】`);
        summaryLines.push('  Web再現するには各文字を<span>で囲み個別にletter-spacingを設定。');
        summaryLines.push('  値の単位は1/1000em。');
        for (const p of kerningPairs) {
          const v = p.value as number;
          summaryLines.push(`  "${p.left}${p.right}": ${v > 0 ? '+' : ''}${v} → letter-spacing: ${(v / 1000).toFixed(3)}em`);
        }
      } else {
        summaryLines.push('');
        summaryLines.push('【カーニング】');
        summaryLines.push('  手動カーニングなし。font-kerning: auto でフォント内蔵メトリクスを使用。');
      }

      for (const note of notes) {
        if (!note.startsWith('手動カーニング')) {
          summaryLines.push('');
          summaryLines.push(`【注意】 ${note}`);
        }
      }

      return {
        content: [
          { type: 'text', text: summaryLines.join('\n') },
          { type: 'text', text: JSON.stringify(result, null, 2) },
        ],
      };
    },
  );
}
