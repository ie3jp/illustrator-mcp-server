import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeJsx } from '../../executor/jsx-runner.js';
import { formatToolResult } from '../tool-executor.js';
import { DESTRUCTIVE_ANNOTATIONS, coerceBoolean } from './shared.js';

/**
 * group_objects — 複数オブジェクトをグループ化
 *
 * @see https://ai-scripting.docsforadobe.dev/jsobjref/GroupItems/ — GroupItems.add()
 *
 * JSX API:
 *   GroupItems.add() → GroupItem  (空グループ作成)
 *   PageItem.move(relativeObject, insertionLocation: ElementPlacement) → PageItem
 *   GroupItem.clipped → Boolean (writable)
 *
 * 契約:
 * - 全アイテムが同じ親（レイヤーまたはグループ）の直下にあること。親が違えば何も変更せずエラー。
 *   別レイヤー・別グループのアイテムを黙って 1 つの親へ移すと、レイヤー所属や親グループの
 *   不透明度・効果・クリッピングが変わるため。まとめたいときは先に move_to_layer / ungroup_objects で揃える
 * - 新しいグループは同じ親の中で、対象のうち最前面のアイテムがあった位置に置く（UI の Cmd+G と同じ）
 * - ロック（親グループ・レイヤー含む）・非表示レイヤー上のアイテム、既存クリップグループのクリップパスは拒否
 * - clipped: true は 2 件以上で、最後（最前面＝クリップパス）がパスか複合パスであること。
 *   テキストは UI ではクリップパスにできるが、スクリプトの group.clipped = true は受け付けない（2026 / macOS 実機で確認）
 * - 変更後に失敗したら、アイテムを元の親・重ね順へ戻し、空になったグループを削除する（rollback を返す）。
 *   clipped: true の失敗ではクリップパスの塗り/線も控えから戻す
 */
const jsxCode = `
// 親チェーンに非表示レイヤーがあるか（スクリプトから移動できない）
function goOnHiddenLayer(item) {
  var obj = null;
  try { obj = item.parent; } catch(e) { return false; }
  var depth = 0;
  while (obj && depth < 100) {
    var tn = "";
    try { tn = obj.typename; } catch(e) { break; }
    if (tn === "Document") break;
    if (tn === "Layer") {
      try { if (obj.visible === false) return true; } catch(e) {}
    }
    try { obj = obj.parent; } catch(e) { break; }
    depth++;
  }
  return false;
}

// 既存クリップグループのクリップパスか（複合パスは内部パスの clipping を見る）
function goIsClippingPath(item) {
  try {
    if (item.typename === "PathItem") return item.clipping === true;
    if (item.typename === "CompoundPathItem" && item.pathItems.length > 0) return item.pathItems[0].clipping === true;
  } catch(e) {}
  return false;
}

function goDescribeParent(parent) {
  var d = { type: "", name: "" };
  try { d.type = parent.typename; } catch(e) {}
  try { d.name = parent.name || ""; } catch(e) {}
  return d;
}

// 何も変更する前の検証。問題があればエラー結果、なければ null
function goValidate(items, uuids, clipped) {
  for (var i = 0; i < items.length; i++) {
    for (var k = i + 1; k < items.length; k++) {
      if (items[i] == items[k]) {
        return { error: true, message: "The same object is listed more than once (" + uuids[i] + (uuids[i] === uuids[k] ? "" : " / " + uuids[k]) + "). Nothing was grouped." };
      }
    }
  }

  var parent = items[0].parent;
  var parentType = "";
  try { parentType = parent.typename; } catch(e) {}
  if (parentType !== "Layer" && parentType !== "GroupItem") {
    return { error: true, message: "Cannot group objects inside a " + parentType + ". Nothing was grouped.", uuid: uuids[0] };
  }
  var differentParents = [];
  for (var p = 1; p < items.length; p++) {
    if (!(items[p].parent == parent)) {
      var dp = goDescribeParent(items[p].parent);
      differentParents.push({ uuid: uuids[p], parentType: dp.type, parentName: dp.name });
    }
  }
  if (differentParents.length > 0) {
    var fp = goDescribeParent(parent);
    return {
      error: true,
      message: "All objects must share the same parent (layer or group). " + uuids[0] + " is in " + fp.type + " '" + fp.name +
        "', but " + differentParents.length + " object(s) are elsewhere. Nothing was grouped. Use move_to_layer or ungroup_objects first to bring them under the same parent.",
      expectedParent: { parentType: fp.type, parentName: fp.name },
      differentParents: differentParents
    };
  }

  var locked = [];
  var hiddenLayer = [];
  var clipPaths = [];
  for (var j = 0; j < items.length; j++) {
    if (isItemEffectivelyLocked(items[j])) locked.push(uuids[j]);
    else if (goOnHiddenLayer(items[j])) hiddenLayer.push(uuids[j]);
    // クリップグループの最前面はクリップパス。テキストのマスク（UI で作ったもの）は clipping を持たないので位置でも判定する
    if (parentType === "GroupItem" && parent.clipped === true &&
        (goIsClippingPath(items[j]) || (parent.pageItems.length > 0 && parent.pageItems[0] == items[j]))) clipPaths.push(uuids[j]);
  }
  if (locked.length > 0 || hiddenLayer.length > 0) {
    var r = { error: true, message: "Some objects cannot be edited (locked, or on a locked/hidden layer or in a locked group). Unlock/show them first. Nothing was grouped." };
    if (locked.length > 0) r.locked = locked;
    if (hiddenLayer.length > 0) r.hiddenLayer = hiddenLayer;
    return r;
  }
  if (clipPaths.length > 0) {
    return {
      error: true,
      message: "Cannot group the clipping path of an existing clipping group; it would break that mask. Nothing was grouped.",
      clippingPaths: clipPaths
    };
  }

  if (clipped) {
    if (items.length < 2) {
      return { error: true, message: "clipped: true needs at least 2 objects: the content and, last, the clipping path. Nothing was grouped." };
    }
    var clipType = items[items.length - 1].typename;
    if (clipType !== "PathItem" && clipType !== "CompoundPathItem") {
      return {
        error: true,
        message: "With clipped: true the last object becomes the clipping path and must be a path or compound path (got " + clipType + ")." +
          (clipType === "TextFrame" ? " Text cannot be made a clipping path from a script; convert it to outlines first (convert_to_outlines)." : "") +
          " Nothing was grouped.",
        uuid: uuids[items.length - 1]
      };
    }
  }
  return null;
}

// 元の並び（親の pageItems は前面→背面）を控える。pageItems はライブなので配列に写す
function goSnapshot(parent) {
  var list = [];
  for (var i = 0; i < parent.pageItems.length; i++) list.push(parent.pageItems[i]);
  return list;
}

function goIndexIn(list, item) {
  for (var i = 0; i < list.length; i++) {
    if (list[i] == item) return i;
  }
  return -1;
}

// クリップパスになるパス（複合パスは内部パス全部）の塗り/線を控える。group.clipped = true で消えるため
function goClipTargets(item) {
  var list = [];
  try {
    if (item.typename === "PathItem") list.push(item);
    else if (item.typename === "CompoundPathItem") {
      for (var i = 0; i < item.pathItems.length; i++) list.push(item.pathItems[i]);
    }
  } catch(e) {}
  return list;
}

function goSnapshotPaint(item) {
  var targets = goClipTargets(item);
  var list = [];
  for (var i = 0; i < targets.length; i++) {
    var t = targets[i];
    var p = { path: t };
    try { p.filled = t.filled; if (t.filled) p.fillColor = t.fillColor; } catch(e) {}
    try { p.stroked = t.stroked; if (t.stroked) { p.strokeColor = t.strokeColor; p.strokeWidth = t.strokeWidth; } } catch(e) {}
    list.push(p);
  }
  return list;
}

// 戻せたら true。1 つでも戻せなければ false
function goRestorePaint(paint) {
  var ok = true;
  for (var i = 0; i < paint.length; i++) {
    var p = paint[i];
    try {
      if (p.path.clipping === true) p.path.clipping = false;
      if (p.filled === true) { p.path.filled = true; p.path.fillColor = p.fillColor; }
      else if (p.filled === false) p.path.filled = false;
      if (p.stroked === true) { p.path.stroked = true; p.path.strokeColor = p.strokeColor; p.path.strokeWidth = p.strokeWidth; }
      else if (p.stroked === false) p.path.stroked = false;
      if (p.path.clipping === true || p.path.filled !== p.filled || p.path.stroked !== p.stroked) ok = false;
    } catch(e) { ok = false; }
  }
  return ok;
}

// 変更後の失敗から戻す。前面側から順に、元の並びで直下にあって今も親にあるものの前へ置く。
// 途中で失敗したアイテム（まだ動かしていないもの）は元の位置のままなので基準になる
function goRollback(group, parent, snapshot, items, uuids, clipped, paint) {
  var rb = { restored: [], failed: [], groupRemoved: false, appearanceRestored: true };
  if (clipped) {
    try { if (group.clipped === true) group.clipped = false; } catch(e) {}
    try { if (group.clipped === true) rb.appearanceRestored = false; } catch(e) { rb.appearanceRestored = false; }
  }
  var order = [];
  for (var i = 0; i < items.length; i++) order.push({ item: items[i], uuid: uuids[i], index: goIndexIn(snapshot, items[i]) });
  order.sort(function (a, b) { return a.index - b.index; });

  for (var o = 0; o < order.length; o++) {
    var e = order[o];
    try {
      if (!(e.item.parent == group)) continue;
      var anchor = null;
      for (var s = e.index + 1; s < snapshot.length; s++) {
        var cand = snapshot[s];
        var candParent = null;
        try { candParent = cand.parent; } catch(eP) {}
        if (candParent && candParent == parent) { anchor = cand; break; }
      }
      if (anchor) e.item.move(anchor, ElementPlacement.PLACEBEFORE);
      else e.item.move(parent, ElementPlacement.PLACEATEND);
      rb.restored.push(e.uuid);
    } catch (err) {
      rb.failed.push({ uuid: e.uuid, message: err.message });
    }
  }

  if (clipped && paint) {
    // group.clipped = true はクリップパスの塗り/線を消すので、控えから戻す
    if (!goRestorePaint(paint)) rb.appearanceRestored = false;
    if (!rb.appearanceRestored) {
      rb.warning = "The clipping path " + uuids[items.length - 1] + " was moved back, but its clipping state or fill/stroke could not be fully restored. Check it (undo may help).";
    }
  }

  var left = -1;
  try { left = group.pageItems.length; } catch(e) {}
  if (left === 0) {
    try { group.remove(); rb.groupRemoved = true; } catch(e) {
      rb.removeError = e.message;
      try { rb.remainingGroupUuid = ensureUUID(group); } catch(e2) {}
    }
  } else {
    // 戻しきれなかったアイテムを残したグループは消さない（中身ごと消えるため）
    try { rb.remainingGroupUuid = ensureUUID(group); } catch(e) {}
  }
  rb.complete = rb.failed.length === 0 && rb.groupRemoved === true && rb.appearanceRestored === true;
  return rb;
}

var preflight = preflightChecks();
if (preflight) {
  writeResultFile(RESULT_PATH, preflight);
} else {
  var group = null;
  var targetParent = null;
  var snapshot = null;
  var items = [];
  var uuids = [];
  var clipped = false;
  var committed = false;
  var paint = null;
  try {
    var params = readParamsFile(PARAMS_PATH);
    var doc = app.activeDocument;
    uuids = params.uuids;
    clipped = params.clipped === true;

    var notFound = [];
    for (var i = 0; i < uuids.length; i++) {
      var item = findItemByUUID(uuids[i]);
      if (item) {
        items.push(item);
      } else {
        notFound.push(uuids[i]);
      }
    }

    // 一部だけでグループ化すると構造が変わる（clipped では別アイテムがクリップパスになる）ため、
    // 1 件でも見つからなければ何も変更せずエラーにする
    var invalid = null;
    if (notFound.length > 0) {
      invalid = {
        error: true,
        message: "Objects not found for " + notFound.length + " of " + uuids.length + " UUIDs. Nothing was grouped.",
        notFound: notFound
      };
    } else {
      invalid = goValidate(items, uuids, clipped);
    }

    if (invalid) {
      writeResultFile(RESULT_PATH, invalid);
    } else {
      targetParent = items[0].parent;
      snapshot = goSnapshot(targetParent);

      // 対象のうち最前面のもの（snapshot の先頭側）の直上にある兄弟。null なら親の最前面
      var frontIndex = snapshot.length;
      for (var fi = 0; fi < items.length; fi++) {
        var idx = goIndexIn(snapshot, items[fi]);
        if (idx < 0) throw new Error("could not locate " + uuids[fi] + " among its parent's items");
        if (idx < frontIndex) frontIndex = idx;
      }
      var aboveFront = (frontIndex > 0) ? snapshot[frontIndex - 1] : null;

      group = targetParent.groupItems.add();

      // items[0] が最背面、末尾が最前面（クリッピングマスクのクリップパス）。
      // PLACEATEND/PLACEATBEGINNING の向きに頼らず、直前のアイテムの前面（PLACEBEFORE）へ積む
      items[0].move(group, ElementPlacement.PLACEATEND);
      for (var j = 1; j < items.length; j++) {
        items[j].move(items[j - 1], ElementPlacement.PLACEBEFORE);
      }
      if (!(group.pageItems[0] == items[items.length - 1])) {
        throw new Error("stacking order inside the new group is not as requested");
      }

      if (aboveFront) group.move(aboveFront, ElementPlacement.PLACEAFTER);
      else group.move(targetParent, ElementPlacement.PLACEATBEGINNING);

      if (params.name) {
        group.name = params.name;
      }
      var uuid = ensureUUID(group);

      // クリップパスの塗り/線を消す操作なので最後に行う
      if (clipped) {
        paint = goSnapshotPaint(items[items.length - 1]);
        group.clipped = true;
        if (group.clipped !== true) {
          throw new Error("Illustrator did not turn the group into a clipping group");
        }
      }

      // 結果を組み立てて書き出すまでが変更の一部。ここで例外になったら戻す
      var okResult = {
        success: true,
        uuid: uuid,
        childCount: group.pageItems.length,
        verified: verifyItemDefault(group)
      };
      // クリップパスになったパスは自分の塗り/線を失う（UI のクリッピングマスクと同じ）。
      // 結果から気づけないため明示する
      if (params.clipped === true) {
        okResult.warnings = ["The clip path (last UUID) lost its own fill and stroke, as it does when you make a clipping mask in the UI."];
      }
      writeResultFile(RESULT_PATH, okResult);
      committed = true;
    }
  } catch (e) {
    var failure = { error: true, message: "group_objects failed: " + e.message, line: e.line };
    if (group && !committed) {
      failure.rollback = goRollback(group, targetParent, snapshot, items, uuids, clipped, paint);
      failure.message += failure.rollback.complete
        ? ". Changes were rolled back; nothing was grouped."
        : ". Rollback was incomplete; see rollback.";
    }
    writeResultFile(RESULT_PATH, failure);
  }
}
`;

export function register(server: McpServer): void {
  server.registerTool(
    'group_objects',
    {
      title: 'Group Objects',
      description:
        'Group multiple objects into a single group. The first UUID in the array becomes the bottommost item, the last becomes the topmost. All objects must be directly in the same parent (layer or group); objects on different layers or in different groups are rejected (use move_to_layer / ungroup_objects first). The new group takes the stacking position of the frontmost object. Nothing is changed and an error is returned if any UUID is not found (notFound), any object is locked or on a hidden layer, or clipped: true is given with fewer than 2 objects or a last object that is not a path or compound path (convert text to outlines first). If grouping fails midway, the objects are moved back and the empty group is removed (see rollback in the error).',
      inputSchema: {
        uuids: z.array(z.string()).min(1).describe('UUIDs of objects to group, all with the same parent. Order matters: first=bottom, last=top in layer panel.'),
        name: z.string().optional().describe('Name for the new group'),
        clipped: coerceBoolean
          .optional()
          .default(false)
          .describe('Create as clipping group. Needs at least 2 objects; the last UUID becomes the clip path (topmost) and must be a path or compound path. Example: [content-uuid, mask-uuid] — mask-uuid clips content-uuid. The object that becomes the clip path LOSES its own fill and stroke (same as making a clipping mask in the UI), so do not pass an object whose own paint you want to keep.'),
      },
      // clipped: true ではクリップパスになるパスの塗り/線が失われる（UI のクリッピングマスクと同じ）
      annotations: DESTRUCTIVE_ANNOTATIONS,
    },
    async (params) => {
      const result = await executeJsx(jsxCode, params);
      return formatToolResult(result);
    },
  );
}
