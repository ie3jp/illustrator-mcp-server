/**
 * ツールの JSX を Node 上で実行するための最小限の Illustrator モック。
 *
 * ツールの register() から executeJsx に渡される JSX 文字列を捕まえ、
 * common.jsx と連結して（jsx-runner と同じく関数で包んで）評価する。
 * 実機の挙動を再現するものではなく、ツール側の分岐・結果組み立てを検証するためのもの。
 */
import * as fs from 'fs';
import * as path from 'path';

const commonJsx = fs.readFileSync(path.resolve(__dirname, '../../../src/jsx/helpers/common.jsx'), 'utf-8');

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Fake = any;

export function coll<T>(items: T[], byName?: (name: string) => T): T[] & { getByName: (n: string) => T } {
  const arr = items as T[] & { getByName: (n: string) => T };
  arr.getByName = (name: string) => {
    if (byName) return byName(name);
    const found = (arr as Fake[]).find((i) => i.name === name);
    if (!found) throw new Error('No such element');
    return found;
  };
  return arr;
}

function detach(item: Fake) {
  if (item.parent && Array.isArray(item.parent.pageItems)) {
    const idx = item.parent.pageItems.indexOf(item);
    if (idx >= 0) item.parent.pageItems.splice(idx, 1);
  }
}

export function makeItem(typename: string, props: Fake = {}): Fake {
  const item: Fake = {
    typename,
    name: '',
    note: '',
    hidden: false,
    locked: false,
    filled: false,
    stroked: false,
    opacity: 100,
    geometricBounds: [0, 0, 10, -10],
    translated: [] as number[][],
    resized: [] as number[][],
    translate(dx: number, dy: number) {
      this.translated.push([dx, dy]);
      const b = this.geometricBounds;
      this.geometricBounds = [b[0] + dx, b[1] + dy, b[2] + dx, b[3] + dy];
    },
    resize(sx: number, sy: number) {
      this.resized.push([sx, sy]);
    },
    move(target: Fake) {
      detach(this);
      this.parent = target;
      target.pageItems.push(this);
    },
    moveToBeginning(target: Fake) {
      detach(this);
      this.parent = target;
      target.pageItems.unshift(this);
    },
    remove() {
      detach(this);
    },
    ...props,
  };
  if (!('visibleBounds' in props)) {
    Object.defineProperty(item, 'visibleBounds', { get() { return this.geometricBounds; } });
  }
  return item;
}

export function makeTextFrame(props: Fake = {}): Fake {
  const charAttrs: Fake = { size: 12, tracking: 0, autoLeading: true, leading: 0, fillColor: null, strokeWeight: 0 };
  const paraAttrs: Fake = { justification: undefined };
  const textRange = { characterAttributes: charAttrs, paragraphAttributes: paraAttrs };
  return makeItem('TextFrame', {
    contents: '',
    kind: 1,
    textRange,
    textRanges: [textRange],
    paragraphs: [textRange],
    ...props,
  });
}

export function makeGroup(children: Fake[] = [], props: Fake = {}): Fake {
  const g = makeItem('GroupItem', { pageItems: [] as Fake[], ...props });
  for (const c of children) {
    c.parent = g;
    g.pageItems.push(c);
  }
  if (!('geometricBounds' in props)) {
    Object.defineProperty(g, 'geometricBounds', {
      configurable: true,
      get() {
        const bs = this.pageItems.map((c: Fake) => c.geometricBounds);
        if (bs.length === 0) return [0, 0, 0, 0];
        return [
          Math.min(...bs.map((b: number[]) => b[0])),
          Math.max(...bs.map((b: number[]) => b[1])),
          Math.max(...bs.map((b: number[]) => b[2])),
          Math.min(...bs.map((b: number[]) => b[3])),
        ];
      },
      set() { /* ignore */ },
    });
  }
  return g;
}

export function makeLayer(name = 'Layer 1', props: Fake = {}): Fake {
  const layer: Fake = {
    typename: 'Layer',
    name,
    visible: true,
    printable: true,
    locked: false,
    pageItems: [] as Fake[],
    layers: coll([]),
    parent: null,
    ...props,
  };
  const add = (item: Fake) => {
    item.parent = layer;
    item.layer = layer;
    layer.pageItems.push(item);
    return item;
  };
  layer.addItem = add;
  layer.pathItems = {
    rectangle: (top: number, left: number, w: number, h: number) =>
      add(makeItem('PathItem', { geometricBounds: [left, top, left + w, top - h], filled: true, stroked: true })),
    ellipse: (top: number, left: number, w: number, h: number) =>
      add(makeItem('PathItem', { geometricBounds: [left, top, left + w, top - h], filled: true, stroked: true })),
    add: () => add(makeItem('PathItem')),
  };
  layer.textFrames = {
    add: () => add(makeTextFrame()),
    pointText: (p: number[]) => add(makeTextFrame({ geometricBounds: [p[0], p[1] + 10, p[0] + 50, p[1] - 2] })),
    areaText: () => add(makeTextFrame({ kind: 2 })),
    pathText: () => add(makeTextFrame({ kind: 3 })),
  };
  layer.groupItems = { add: () => add(makeGroup()) };
  layer.placedItems = { add: () => add(makeItem('PlacedItem', { file: null })) };
  return layer;
}

export interface FakeDocOptions {
  colorSpace?: 'rgb' | 'cmyk';
  artboardRect?: number[];
  layers?: Fake[];
}

export function makeDoc(opts: FakeDocOptions = {}): Fake {
  const layers = opts.layers ?? [makeLayer()];
  const doc: Fake = {
    typename: 'Document',
    documentColorSpace: opts.colorSpace === 'cmyk' ? 'CMYK' : 'RGB',
    layers: coll(layers),
    activeLayer: layers[0],
    artboards: Object.assign([{ artboardRect: opts.artboardRect ?? [0, 1000, 500, 0] }], {
      getActiveArtboardIndex: () => 0,
    }),
    gradients: {
      add: () => {
        const stops: Fake[] = [{}, {}];
        (stops as Fake).add = () => {
          const s = {};
          stops.push(s);
          return s;
        };
        return { name: '', type: 'LINEAR', gradientStops: stops };
      },
    },
    symbols: coll([]),
    symbolItems: { add: (sym: Fake) => layers[0].addItem(makeItem('SymbolItem', { symbol: sym })) },
  };
  for (const l of layers) l.parent = doc;
  // doc.pathItems / textFrames / pageItems は全レイヤーから動的に集める（グループ・複合パス内部を含む）
  const walk = (container: Fake, out: Fake[]) => {
    for (const item of container.pageItems) {
      out.push(item);
      if (item.typename === 'GroupItem') walk(item, out);
      if (item.typename === 'CompoundPathItem') out.push(...item.pathItems);
    }
  };
  const all = () => {
    const out: Fake[] = [];
    for (const l of doc.layers) walk(l, out);
    return out;
  };
  Object.defineProperty(doc, 'pageItems', { get: () => all().filter((i) => i.parent?.typename !== 'CompoundPathItem') });
  Object.defineProperty(doc, 'pathItems', { get: () => all().filter((i) => i.typename === 'PathItem') });
  Object.defineProperty(doc, 'textFrames', { get: () => all().filter((i) => i.typename === 'TextFrame') });
  Object.defineProperty(doc, 'rasterItems', { get: () => all().filter((i) => i.typename === 'RasterItem') });
  doc.layers.add = () => {
    const l = makeLayer('');
    l.parent = doc;
    doc.layers.push(l);
    return l;
  };
  return doc;
}

export interface FakeApp {
  version: string;
  documents: Fake[];
  activeDocument: Fake;
  textFonts: Fake;
  open?: (f: Fake) => Fake;
}

export function makeApp(doc: Fake, fonts: Array<{ name: string; family: string }> = []): FakeApp {
  const textFonts = coll(fonts as Fake[], (name: string) => {
    const f = fonts.find((x) => x.name === name);
    if (!f) throw new Error('No such element');
    return f;
  });
  return { version: '30.0', documents: [doc], activeDocument: doc, textFonts };
}

/**
 * JSX を実行して結果オブジェクトを返す。
 * params は readParamsFile で読まれる内容、app は Illustrator の app グローバル。
 */
export function runToolJsx(toolJsx: string, params: Record<string, unknown>, app: FakeApp): Fake {
  const files: Record<string, string> = { __params__: JSON.stringify(params) };
  function FakeFile(this: Fake, p: string) {
    this.path = p;
    this.exists = true;
    this.encoding = '';
    this.open = () => true;
    this.read = () => files[p];
    this.write = (c: string) => {
      files[p] = c;
    };
    this.close = () => {};
  }
  const prelude = `
    var app = G.app;
    var File = G.File;
    var DocumentColorSpace = { RGB: "RGB", CMYK: "CMYK" };
    var TextType = { POINTTEXT: 1, AREATEXT: 2, PATHTEXT: 3 };
    var GradientType = { LINEAR: "LINEAR", RADIAL: "RADIAL" };
    var ElementPlacement = { PLACEATEND: "PLACEATEND", PLACEATBEGINNING: "PLACEATBEGINNING" };
    var SaveOptions = { DONOTSAVECHANGES: "DONOTSAVECHANGES" };
    var Justification = {
      LEFT: "LEFT", CENTER: "CENTER", RIGHT: "RIGHT", FULLJUSTIFY: "FULLJUSTIFY",
      FULLJUSTIFYLASTLINELEFT: "FULLJUSTIFYLASTLINELEFT",
      FULLJUSTIFYLASTLINECENTER: "FULLJUSTIFYLASTLINECENTER",
      FULLJUSTIFYLASTLINERIGHT: "FULLJUSTIFYLASTLINERIGHT"
    };
    function CMYKColor() { this.typename = "CMYKColor"; }
    function RGBColor() { this.typename = "RGBColor"; }
    function GrayColor() { this.typename = "GrayColor"; }
    function NoColor() { this.typename = "NoColor"; }
    function GradientColor() { this.typename = "GradientColor"; }
  `;
  const code = `${prelude}
(function() {
${commonJsx}
var PARAMS_PATH = "__params__";
var RESULT_PATH = "__result__";
${toolJsx}
})();`;
  // テスト専用: リポジトリ内のソースから組み立てた JSX のみを評価する（外部入力なし）
  // eslint-disable-next-line no-new-func
  new Function('G', code)({ app, File: FakeFile });
  const raw = files.__result__;
  if (raw === undefined) throw new Error('JSX did not write a result');
  return JSON.parse(raw);
}
