/**
 * ツールの埋め込み JSX（ExtendScript）を common.jsx と一緒に Node.js 上で実行するテスト用ハーネス。
 *
 * app.activeDocument などの Illustrator オブジェクトはテスト側で偽物を渡す。
 * 入力はこのリポジトリ内のソースファイルのみ（外部入力なし）のため動的評価を使う（テスト専用）。
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const COMMON_JSX = readFileSync(join(ROOT, 'src/jsx/helpers/common.jsx'), 'utf-8');

/** src/tools 配下の .ts から `const jsxCode = \`...\`` を取り出し、エスケープを展開して返す */
export function loadToolJsx(relPathFromTools: string): string {
  const src = readFileSync(join(ROOT, 'src/tools', relPathFromTools), 'utf-8');
  const m = src.match(/const jsxCode = `([\s\S]*?)\n`;/);
  if (!m) throw new Error(`jsxCode not found in ${relPathFromTools}`);
  // eslint-disable-next-line no-eval -- test-only: expand template-literal escapes of repo source
  return eval('`' + m[1].replace(/`/g, '\\`') + '`') as string; // NOSONAR
}

// ExtendScript の列挙定数の偽物（比較にしか使わないので一意な文字列でよい）
const ENUM_MOCKS = `
var TextType = { POINTTEXT: "POINTTEXT", AREATEXT: "AREATEXT", PATHTEXT: "PATHTEXT" };
var TextOrientation = { HORIZONTAL: "HORIZONTAL", VERTICAL: "VERTICAL" };
var Justification = { LEFT: "LEFT", CENTER: "CENTER", RIGHT: "RIGHT", FULLJUSTIFYLASTLINELEFT: "FJL",
  FULLJUSTIFYLASTLINECENTER: "FJC", FULLJUSTIFYLASTLINERIGHT: "FJR", FULLJUSTIFY: "FJ" };
var AutoKernType = { AUTO: "AUTO", OPTICAL: "OPTICAL", METRICSROMANONLY: "METRICSROMANONLY", NOAUTOKERN: "NOAUTOKERN" };
var StrokeCap = { BUTTENDCAP: "BUTT", ROUNDENDCAP: "ROUND", PROJECTINGENDCAP: "PROJECTING" };
var StrokeJoin = { MITERENDJOIN: "MITER", ROUNDENDJOIN: "ROUND", BEVELENDJOIN: "BEVEL" };
var PointType = { SMOOTH: "SMOOTH", CORNER: "CORNER" };
var ImageColorSpace = { RGB: "RGB", CMYK: "CMYK", Grayscale: "GRAY" };
var DocumentColorSpace = { RGB: "RGB", CMYK: "CMYK" };
`;

/**
 * ツール JSX を実行して結果オブジェクトを返す。
 * @param jsx loadToolJsx() の戻り値
 * @param doc app.activeDocument に入れる偽ドキュメント
 * @param params readParamsFile() が返すパラメータ
 */
export function runToolJsx(jsx: string, doc: unknown, params: Record<string, unknown> = {}): any {
  const wrapped = `
  ${ENUM_MOCKS}
  var __written = {};
  var __paramsJson = ${JSON.stringify(JSON.stringify(params))};
  function File(p) {
    this.encoding = "";
    this.open = function() { return true; };
    this.read = function() { return __paramsJson; };
    this.write = function(c) { __written[p] = c; };
    this.close = function() {};
  }
  var app = { version: "30.0", documents: { length: 1 }, activeDocument: __doc };
  var PARAMS_PATH = "params.json";
  var RESULT_PATH = "result.json";
  ${COMMON_JSX}
  ${jsx}
  return jsonParse(__written[RESULT_PATH]);
  `;
  // eslint-disable-next-line no-new-func -- test-only: evaluating ES3 ExtendScript in Node.js
  const factory = new Function('__doc', wrapped); // NOSONAR
  return factory(doc);
}

/** 偽ドキュメントの土台（アートボード 1 枚: 左上 (0,0)・500x500pt） */
export function fakeDoc(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    artboards: Object.assign([{ artboardRect: [0, 0, 500, -500] }], {
      getActiveArtboardIndex: () => 0,
    }),
    layers: [],
    selection: [],
    ...extra,
  };
}

/** 偽 PageItem を作る（geometricBounds は [left, top, right, bottom]、Illustrator 座標） */
export function fakeItem(typename: string, bounds: number[], extra: Record<string, unknown> = {}): any {
  return {
    typename,
    note: '',
    name: '',
    geometricBounds: bounds,
    visibleBounds: bounds,
    zOrderPosition: 1,
    locked: false,
    hidden: false,
    opacity: 100,
    ...extra,
  };
}

/** 偽 Layer を作る */
export function fakeLayer(name: string, pageItems: unknown[], extra: Record<string, unknown> = {}): any {
  return { typename: 'Layer', name, visible: true, locked: false, pageItems, layers: [], ...extra };
}
