/**
 * トンボ生成の共通 JSX（create_crop_marks / export_pdf で共有）。`CROP_MARKS_JSX + jsxCode` で連結して使う。
 *
 * - 生成物は実行前後の GroupItem の差分で特定する。doc.groupItems は上のレイヤーが先に並ぶ
 *   （実機確認済み）ため index 決め打ちでは既存グループを掴む。キーの native PageItem.uuid は
 *   保存をまたぐと変わるが、1 回の JSX 実行内なら十分
 * - cropMarkStyle 環境設定・選択・アクティブアートボードは呼び出し側の finally で戻す
 */
export const CROP_MARKS_JSX = `
// --- トンボ生成の共通ヘルパー（crop-marks-shared.ts） ---

function _cropMarksGroupKey(item) {
  var u;
  try { u = item.uuid; } catch (e) { u = undefined; }
  if (u === undefined || u === null || u === "") return null;
  return "u" + u;
}

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

// 入れ子の新規グループは最上位だけ残す
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

// TrimMark を実行し、新規トンボグループ（最上位のみ）を返す。rect 指定時は一時矩形を、null なら選択を対象にする。
// 例外時は生成済みグループも削除して再スローする
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

// 各項目は独立に試み、1 つの失敗で他を止めない
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
