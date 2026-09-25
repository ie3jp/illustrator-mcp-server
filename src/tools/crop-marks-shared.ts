/**
 * トンボ生成の共通 JSX（create_crop_marks / export_pdf で共有）
 *
 * 両ツールとも「TrimMark メニューコマンドでドキュメント上にトンボを生成する」ため、
 * 同じ壊れ方（生成物を index で特定してユーザーのグループを掴む・環境設定を戻さない・
 * 一時矩形が残る）をしていた。ここで一度だけ正しく実装する。
 *
 * - 生成物の特定: 実行前の GroupItem 集合と実行後の差分で特定する。
 *   `doc.groupItems` は上のレイヤーが先に列挙される（実機確認済み）ため、index 決め打ちは
 *   他レイヤーの既存グループを掴む。差分のキーには native `PageItem.uuid` を使う。
 *   uuid は保存をまたぐと変わるが、1 回の JSX 実行内の同一性判定には十分（v24+ で存在）。
 * - 状態の復元: cropMarkStyle 環境設定・選択・アクティブアートボードを保存し、
 *   呼び出し側の finally で cropMarksRestoreState() により戻す。
 * - 一時矩形: cropMarksRun() 内の finally で必ず削除する。TrimMark が例外を投げた場合は
 *   その時点までに生成されたグループも取り除いてから再スローする。
 *
 * 使い方: 各ツールの jsxCode の前に連結して実行する（`CROP_MARKS_JSX + jsxCode`）。
 * ES3 ExtendScript。executeTrimMark() は common.jsx に定義されている。
 */
export const CROP_MARKS_JSX = `
// --- トンボ生成の共通ヘルパー（crop-marks-shared.ts） ---

function _cropMarksGroupKey(item) {
  var u;
  try { u = item.uuid; } catch (e) { u = undefined; }
  if (u === undefined || u === null || u === "") return null;
  return "u" + u;
}

// 現在の全 GroupItem のキー集合（実行前スナップショット）
function _cropMarksGroupKeys(doc) {
  var keys = {};
  var groups = doc.groupItems;
  for (var i = 0; i < groups.length; i++) {
    var k = _cropMarksGroupKey(groups[i]);
    if (k === null) {
      throw new Error("Cannot identify generated crop marks safely: PageItem.uuid is unavailable.");
    }
    keys[k] = true;
  }
  return keys;
}

// スナップショットに無い GroupItem（＝新規生成物）を返す。入れ子の新規グループは最上位だけ残す。
function _cropMarksNewGroups(doc, beforeKeys) {
  var created = [];
  var createdKeys = {};
  var groups = doc.groupItems;
  for (var i = 0; i < groups.length; i++) {
    var k = _cropMarksGroupKey(groups[i]);
    if (k === null) {
      throw new Error("Cannot identify generated crop marks safely: PageItem.uuid is unavailable.");
    }
    if (!beforeKeys[k]) {
      created.push(groups[i]);
      createdKeys[k] = true;
    }
  }
  var top = [];
  for (var j = 0; j < created.length; j++) {
    var parentKey = null;
    try {
      var p = created[j].parent;
      if (p && p.typename === "GroupItem") parentKey = _cropMarksGroupKey(p);
    } catch (e) {}
    if (parentKey === null || !createdKeys[parentKey]) top.push(created[j]);
  }
  return top;
}

/**
 * TrimMark を実行し、新規に生成されたトンボグループ（最上位のみ）を返す。
 * rect（[left, top, right, bottom]）を渡すとその大きさの不可視矩形を一時作成して対象にする。
 * rect が null なら現在の選択を対象にする。
 * 一時矩形は成否にかかわらず削除する。例外時は生成済みグループも削除して再スローする。
 */
function cropMarksRun(doc, rect) {
  var before = _cropMarksGroupKeys(doc);
  var tempRect = null;
  var created = null;
  try {
    if (rect) {
      tempRect = doc.pathItems.rectangle(rect[1], rect[0], rect[2] - rect[0], rect[1] - rect[3]);
      tempRect.filled = false;
      tempRect.stroked = false;
      doc.selection = null;
      tempRect.selected = true;
    }
    executeTrimMark();
    created = _cropMarksNewGroups(doc, before);
  } finally {
    if (tempRect) {
      try { tempRect.remove(); } catch (removeErr) {}
    }
    if (created === null) {
      try { cropMarksRemove(_cropMarksNewGroups(doc, before)); } catch (cleanupErr) {}
    }
  }
  return created;
}

function cropMarksRemove(groups) {
  if (!groups) return;
  for (var i = 0; i < groups.length; i++) {
    try { groups[i].remove(); } catch (e) {}
  }
}

// グループ群の geometricBounds の外接矩形 [left, top, right, bottom]
function cropMarksUnionBounds(groups) {
  var mb = groups[0].geometricBounds.slice();
  for (var i = 1; i < groups.length; i++) {
    var gb = groups[i].geometricBounds;
    if (gb[0] < mb[0]) mb[0] = gb[0];
    if (gb[1] > mb[1]) mb[1] = gb[1];
    if (gb[2] > mb[2]) mb[2] = gb[2];
    if (gb[3] < mb[3]) mb[3] = gb[3];
  }
  return mb;
}

// cropMarkStyle 環境設定・選択・アクティブアートボードを保存する
function cropMarksSaveState(doc) {
  var state = { hasPref: false, prefValue: false, selection: null, activeArtboard: -1 };
  try {
    state.prefValue = app.preferences.getBooleanPreference("cropMarkStyle");
    state.hasPref = true;
  } catch (e) {}
  try {
    var sel = doc.selection;
    if (sel instanceof Array) {
      state.selection = [];
      for (var i = 0; i < sel.length; i++) state.selection.push(sel[i]);
    }
  } catch (e2) {}
  try { state.activeArtboard = doc.artboards.getActiveArtboardIndex(); } catch (e3) {}
  return state;
}

// cropMarksSaveState() の内容を復元する。各項目は独立に試み、1 つの失敗で他を止めない
function cropMarksRestoreState(doc, state) {
  if (!state) return;
  if (state.hasPref) {
    try { app.preferences.setBooleanPreference("cropMarkStyle", state.prefValue); } catch (e) {}
  }
  try { doc.selection = null; } catch (e2) {}
  if (state.selection) {
    for (var i = 0; i < state.selection.length; i++) {
      try { state.selection[i].selected = true; } catch (e3) {}
    }
  }
  if (state.activeArtboard >= 0) {
    try { doc.artboards.setActiveArtboardIndex(state.activeArtboard); } catch (e4) {}
  }
}
`;
