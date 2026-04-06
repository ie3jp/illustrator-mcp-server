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
 * 既知の制限: ParagraphAttributes.leading / .autoLeading は存在しないプロパティ（try/catch で回避中）。
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
      // textFrames を走査して UUID が一致するテキストフレームを探す
      var found = null;
      for (var i = 0; i < doc.textFrames.length; i++) {
        var item = doc.textFrames[i];
        var itemUUID = ensureUUID(item);
        if (itemUUID === targetUUID) {
          found = item;
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

        var textKind = getTextKind(tf);

        // 座標
        var itemAbIdx = getArtboardIndexForItem(tf);
        var boundsAbRect = null;
        if (coordSystem === "artboard-web") {
          boundsAbRect = getArtboardRectByIndex(itemAbIdx);
        }
        var bounds = getBounds(tf, coordSystem, boundsAbRect);

        // 段落属性（各段落ごと）
        var paraAttrs = [];
        for (var pi = 0; pi < tf.paragraphs.length; pi++) {
          var para = tf.paragraphs[pi];
          var pa = para.paragraphAttributes;
          var paraInfo = {
            text: para.contents,
            leading: 0,
            autoLeading: false,
            firstLineIndent: 0,
            leftIndent: 0,
            rightIndent: 0,
            spaceBefore: 0,
            spaceAfter: 0,
            justification: "left",
            hyphenation: false,
            paragraphStyle: ""
          };

          try { paraInfo.leading = pa.leading; } catch (e) {}
          try { paraInfo.autoLeading = pa.autoLeading; } catch (e) {}
          try { paraInfo.firstLineIndent = pa.firstLineIndent; } catch (e) {}
          try { paraInfo.leftIndent = pa.leftIndent; } catch (e) {}
          try { paraInfo.rightIndent = pa.rightIndent; } catch (e) {}
          try { paraInfo.spaceBefore = pa.spaceBefore; } catch (e) {}
          try { paraInfo.spaceAfter = pa.spaceAfter; } catch (e) {}
          try {
            var j = pa.justification;
            if (j === Justification.LEFT) paraInfo.justification = "left";
            else if (j === Justification.CENTER) paraInfo.justification = "center";
            else if (j === Justification.RIGHT) paraInfo.justification = "right";
            else if (j === Justification.FULLJUSTIFYLASTLINELEFT) paraInfo.justification = "justify-left";
            else if (j === Justification.FULLJUSTIFYLASTLINECENTER) paraInfo.justification = "justify-center";
            else if (j === Justification.FULLJUSTIFYLASTLINERIGHT) paraInfo.justification = "justify-right";
            else if (j === Justification.FULLJUSTIFY) paraInfo.justification = "justify-all";
            else paraInfo.justification = j.toString();
          } catch (e) {}
          try { paraInfo.hyphenation = pa.hyphenation; } catch (e) {}
          try {
            if (pa.paragraphStyle) {
              paraInfo.paragraphStyle = pa.paragraphStyle.name || "";
            }
          } catch (e) {}

          paraAttrs.push(paraInfo);
        }

        // 文字単位走査: 同一属性の連続文字はランにまとめる
        var chars = tf.characters;
        var runs = [];
        var prevKey = "";
        var currentRun = null;

        for (var ci = 0; ci < chars.length; ci++) {
          var ch = chars[ci];
          var cca = ch.characterAttributes;
          var info = {
            fontFamily: "",
            fontStyle: "",
            fontSize: 0,
            color: { type: "none" },
            tracking: 0,
            kerningMethod: "auto",
            akiLeft: -1,
            akiRight: -1,
            tsume: 0,
            proportionalMetrics: false,
            baselineShift: 0,
            horizontalScale: 100,
            verticalScale: 100,
            rotation: 0
          };

          try { info.fontFamily = cca.textFont.family; } catch (e2) {}
          try { info.fontStyle = cca.textFont.style; } catch (e2) {}
          try { info.fontSize = cca.size; } catch (e2) {}
          try { info.color = colorToObject(cca.fillColor); } catch (e2) {}
          try { info.tracking = cca.tracking; } catch (e2) {}
          try {
            var km2 = cca.kerningMethod;
            if (km2 === AutoKernType.AUTO) info.kerningMethod = "auto";
            else if (km2 === AutoKernType.OPTICAL) info.kerningMethod = "optical";
            else if (km2 === AutoKernType.METRICSROMANONLY) info.kerningMethod = "metrics";
            else if (km2 === AutoKernType.NOAUTOKERN) info.kerningMethod = "none";
            else info.kerningMethod = String(km2);
          } catch (e2) {}
          try { info.proportionalMetrics = cca.proportionalMetrics; } catch (e2) {}
          try { info.akiLeft = cca.akiLeft; } catch (e2) {}
          try { info.akiRight = cca.akiRight; } catch (e2) {}
          try { info.tsume = cca.Tsume; } catch (e2) {}
          try { info.baselineShift = cca.baselineShift; } catch (e2) {}
          try { info.horizontalScale = cca.horizontalScale; } catch (e2) {}
          try { info.verticalScale = cca.verticalScale; } catch (e2) {}
          try { info.rotation = cca.rotation; } catch (e2) {}

          // ランキー生成: 属性が同一なら前のランに結合
          var key = info.fontFamily + "|" + info.fontStyle + "|" + info.fontSize
            + "|" + info.tracking + "|" + info.kerningMethod
            + "|" + info.akiLeft + "|" + info.akiRight + "|" + info.tsume + "|" + info.proportionalMetrics
            + "|" + info.baselineShift + "|" + info.horizontalScale + "|" + info.verticalScale
            + "|" + info.rotation
            + "|" + (info.color.type === "rgb" ? info.color.r + "," + info.color.g + "," + info.color.b
                   : info.color.type === "cmyk" ? info.color.c + "," + info.color.m + "," + info.color.y + "," + info.color.k
                   : info.color.type);

          if (key === prevKey && currentRun) {
            currentRun.text += ch.contents;
          } else {
            currentRun = {
              text: ch.contents,
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
        }

        // 文字ペア間のカーニング値を収集 (TextRange.kerning — 手動設定がない位置では例外)
        var kerningPairs = [];
        for (var ki = 0; ki < chars.length; ki++) {
          var kVal = null;
          try { kVal = chars[ki].kerning; } catch (ek) { /* no manual kerning */ }
          if (kVal !== null) {
            var left = chars[ki].contents;
            var right = (ki + 1 < chars.length) ? chars[ki + 1].contents : "";
            kerningPairs.push({ index: ki, left: left, right: right, value: kVal });
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
        'Get detailed text frame attributes including per-character runs (font, tracking, akiLeft/akiRight, tsume, proportionalMetrics), kerning pairs with manual kerning values (1/1000 em), and paragraph attributes. Returns cssHints for web/CSS reproduction. Note: paragraph leading/autoLeading may return 0 in some ExtendScript versions due to missing API support.',
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

        const tsume = run.tsume as number;
        const propMetrics = run.proportionalMetrics as boolean;
        const featureFlags: string[] = [];
        if (tsume > 0) featureFlags.push('"palt"');
        if (propMetrics) featureFlags.push('"palt"');
        if (featureFlags.length > 0) {
          css['font-feature-settings'] = [...new Set(featureFlags)].join(', ');
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
      // フォント情報
      const fontSet = new Set(runs.map((r) => `${r.fontFamily} ${r.fontStyle}`));
      const fontSize = runs.length > 0 ? (runs[0].fontSize as number) : 0;
      cssRules.push(`font-family: "${runs[0]?.fontFamily ?? ''}", sans-serif`);
      cssRules.push(`font-size: ${fontSize}pt`);

      // tracking → letter-spacing
      const trackingVal = runs.length > 0 ? (runs[0].tracking as number) : 0;
      if (trackingVal !== 0) {
        cssRules.push(`letter-spacing: ${(trackingVal / 1000).toFixed(3)}em`);
      }

      // kerning method
      const kernMethod = runs.length > 0 ? (runs[0].kerningMethod as string) : 'auto';
      if (kernMethod !== 'none') {
        cssRules.push('font-kerning: auto');
      }

      // kerning pairs サマリ
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

      // 文字単位の特殊設定を検出
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

      // tsume / proportionalMetrics
      const hasTsume = runs.some((r) => (r.tsume as number) > 0);
      const hasPropMetrics = runs.some((r) => r.proportionalMetrics === true);
      if (hasTsume || hasPropMetrics) {
        cssRules.push('font-feature-settings: "palt"');
        notes.push('プロポーショナルメトリクスまたはツメが有効。CSSではfont-feature-settings: "palt"で再現。');
      }

      // paragraphs
      const paras = (result.paragraphAttributes ?? []) as Array<Record<string, unknown>>;
      if (paras.length > 0) {
        const para = paras[0];
        if (para.justification && para.justification !== 'left') {
          cssRules.push(`text-align: ${para.justification}`);
        }
        const leading = para.leading as number;
        if (leading > 0 && fontSize > 0) {
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
