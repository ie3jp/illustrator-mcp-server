import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeToolJsx } from '../tool-executor.js';
import { coordinateSystemSchema } from '../session.js';
import { WRITE_ANNOTATIONS } from './shared.js';

/**
 * place_style_guide — カラーチップ＋フォントサンプル＋スペーシング表示をアートボード外に配置
 */
const jsxCode = `
// ─── Helper functions (top-level for ES3 compatibility) ───
function makeTextColor(isCMYK) {
  if (isCMYK) {
    var c = new CMYKColor();
    c.cyan = 0; c.magenta = 0; c.yellow = 0; c.black = 100;
    return c;
  }
  var r = new RGBColor();
  r.red = 0; r.green = 0; r.blue = 0;
  return r;
}

function addSectionTitle(layer, text, x, y, isCMYK) {
  var tf = layer.textFrames.add();
  tf.contents = text;
  tf.position = [x, y];
  try {
    tf.textRange.characterAttributes.size = 11;
    tf.textRange.characterAttributes.fillColor = makeTextColor(isCMYK);
  } catch(e) {}
  return tf;
}

function addLabel(layer, text, x, y, fontSize, isCMYK) {
  var tf = layer.textFrames.add();
  tf.contents = text;
  tf.position = [x, y];
  try {
    tf.textRange.characterAttributes.size = fontSize || 7;
    tf.textRange.characterAttributes.fillColor = makeTextColor(isCMYK);
  } catch(e) {}
  return tf;
}

function addColorToMap(color, colorMap, colorList) {
  try {
    var key = "";
    if (color.typename === "CMYKColor") {
      key = "cmyk_" + Math.round(color.cyan) + "_" + Math.round(color.magenta) + "_" + Math.round(color.yellow) + "_" + Math.round(color.black);
    } else if (color.typename === "RGBColor") {
      key = "rgb_" + Math.round(color.red) + "_" + Math.round(color.green) + "_" + Math.round(color.blue);
    } else if (color.typename === "SpotColor") {
      key = "spot_" + color.spot.name;
    } else if (color.typename === "GrayColor") {
      key = "gray_" + Math.round(color.gray);
    } else {
      return;
    }
    if (!colorMap[key]) {
      colorMap[key] = true;
      colorList.push({ color: color, key: key, info: colorToObject(color) });
    }
  } catch(e) {}
}

var preflight = preflightChecks();
if (preflight) {
  writeResultFile(RESULT_PATH, preflight);
} else {
  try {
    var params = readParamsFile(PARAMS_PATH);
    var doc = app.activeDocument;
    var abIdx = (typeof params.artboard_index === "number") ? params.artboard_index : doc.artboards.getActiveArtboardIndex();
    var position = params.position || "right";
    var layerName = params.layer_name || "Style Guide";
    var isCMYKDoc = (doc.documentColorSpace === DocumentColorSpace.CMYK);

    if (abIdx < 0 || abIdx >= doc.artboards.length) {
      writeResultFile(RESULT_PATH, { error: true, message: "Artboard index out of range" });
    } else {
      var abRect = doc.artboards[abIdx].artboardRect;
      var guideLayer = resolveTargetLayer(doc, layerName);

      // ─── Layout parameters ───
      var chipSize = 30;
      var gap = 8;
      var sectionGap = 30;
      var marginFromArtboard = 40;

      // Scan all existing items to find the farthest edge (avoid overlap)
      var maxRight = abRect[2];  // artboard right edge
      var maxBottom = abRect[3]; // artboard bottom edge (lower Y in document coords)
      for (var si = 0; si < doc.pageItems.length; si++) {
        try {
          var scanItem = doc.pageItems[si];
          if (scanItem.layer.name === layerName) continue;
          var sb = scanItem.geometricBounds; // [left, top, right, bottom]
          if (sb[2] > maxRight) maxRight = sb[2];
          if (sb[3] < maxBottom) maxBottom = sb[3];
        } catch(e) {}
      }

      var curX, curY;
      if (position === "right") {
        curX = maxRight + marginFromArtboard;
        curY = abRect[1];
      } else {
        curX = abRect[0];
        curY = maxBottom - marginFromArtboard;
      }

      var placedCount = 0;

      // ═══════════════════════════════════════════════════
      // SECTION 1: COLOR PALETTE
      // ═══════════════════════════════════════════════════
      addSectionTitle(guideLayer, "COLOR PALETTE", curX, curY, isCMYKDoc);
      placedCount++;
      curY -= 20;

      // Collect unique colors
      var colorMap = {};
      var colorList = [];

      for (var i = 0; i < doc.pathItems.length; i++) {
        var item = doc.pathItems[i];
        try {
          if (item.filled) addColorToMap(item.fillColor, colorMap, colorList);
          if (item.stroked) addColorToMap(item.strokeColor, colorMap, colorList);
        } catch(e) {}
      }

      // Place color chips
      var colorStartY = curY;
      for (var ci = 0; ci < colorList.length; ci++) {
        var entry = colorList[ci];
        var chipX, chipY;
        if (position === "right") {
          chipX = curX;
          chipY = curY - ci * (chipSize + gap);
        } else {
          chipX = curX + ci * (chipSize + gap + 80);
          chipY = curY;
        }

        var rect = guideLayer.pathItems.rectangle(chipY, chipX, chipSize, chipSize);
        try {
          if (entry.color.typename === "CMYKColor") {
            var nc = new CMYKColor();
            nc.cyan = entry.color.cyan; nc.magenta = entry.color.magenta;
            nc.yellow = entry.color.yellow; nc.black = entry.color.black;
            rect.fillColor = nc;
          } else if (entry.color.typename === "RGBColor") {
            var nr = new RGBColor();
            nr.red = entry.color.red; nr.green = entry.color.green; nr.blue = entry.color.blue;
            rect.fillColor = nr;
          } else if (entry.color.typename === "SpotColor") {
            var ns = new SpotColor();
            ns.spot = entry.color.spot; ns.tint = entry.color.tint;
            rect.fillColor = ns;
          } else if (entry.color.typename === "GrayColor") {
            var ng = new GrayColor();
            ng.gray = entry.color.gray;
            rect.fillColor = ng;
          }
        } catch(e) {}
        rect.stroked = true;
        var strokeC = new GrayColor();
        strokeC.gray = 80;
        rect.strokeColor = strokeC;
        rect.strokeWidth = 0.5;

        // Color label
        var label = "";
        var info = entry.info;
        if (info.type === "cmyk") {
          label = "C" + Math.round(info.c) + " M" + Math.round(info.m) + " Y" + Math.round(info.y) + " K" + Math.round(info.k);
        } else if (info.type === "rgb") {
          var hexR = ("0" + Math.round(info.r).toString(16)).slice(-2).toUpperCase();
          var hexG = ("0" + Math.round(info.g).toString(16)).slice(-2).toUpperCase();
          var hexB = ("0" + Math.round(info.b).toString(16)).slice(-2).toUpperCase();
          label = "#" + hexR + hexG + hexB + "  R" + Math.round(info.r) + " G" + Math.round(info.g) + " B" + Math.round(info.b);
        } else if (info.type === "spot") {
          label = info.name;
        } else if (info.type === "gray") {
          label = "Gray " + Math.round(info.value) + "%";
        }
        if (label) {
          if (position === "right") {
            addLabel(guideLayer, label, chipX + chipSize + 6, chipY - 2, 7, isCMYKDoc);
          } else {
            addLabel(guideLayer, label, chipX, chipY - chipSize - 4, 7, isCMYKDoc);
          }
        }
        placedCount++;
      }

      // Update cursor
      if (position === "right") {
        curY = curY - colorList.length * (chipSize + gap) - sectionGap;
      } else {
        curX = curX + colorList.length * (chipSize + gap + 80) + sectionGap;
        curY = colorStartY;
      }

      // ═══════════════════════════════════════════════════
      // SECTION 2: TYPOGRAPHY
      // ═══════════════════════════════════════════════════
      addSectionTitle(guideLayer, "TYPOGRAPHY", curX, curY, isCMYKDoc);
      placedCount++;
      curY -= 24;

      // Collect unique fonts
      var fontMap = {};
      var fontList = [];

      for (var ti = 0; ti < doc.textFrames.length; ti++) {
        try {
          var tf = doc.textFrames[ti];
          // Skip items on the style guide layer itself
          if (tf.layer.name === layerName) continue;
          for (var ri = 0; ri < tf.textRanges.length; ri++) {
            try {
              var tr = tf.textRanges[ri];
              var ca = tr.characterAttributes;
              var fName = "";
              var fStyle = "";
              var fSize = 0;
              try { fName = ca.textFont.name; } catch(e2) {}
              try { fStyle = ca.textFont.style; } catch(e2) {}
              try { fSize = Math.round(ca.size); } catch(e2) {}
              if (fName) {
                var fKey = fName + "|" + fSize;
                if (!fontMap[fKey]) {
                  fontMap[fKey] = { name: fName, style: fStyle, size: fSize, count: 1 };
                  fontList.push(fontMap[fKey]);
                } else {
                  fontMap[fKey].count++;
                }
              }
            } catch(e2) {}
          }
        } catch(e) {}
      }

      // Sort by frequency, take top 8
      fontList.sort(function(a, b) { return b.count - a.count; });
      if (fontList.length > 8) fontList = fontList.slice(0, 8);

      // Place font samples
      for (var fi = 0; fi < fontList.length; fi++) {
        var font = fontList[fi];
        var sampleSize = Math.min(font.size, 36);
        if (sampleSize < 8) sampleSize = 12;

        // Font info label FIRST (small, above the sample)
        var fontLabel = font.name + "  " + font.size + "pt";
        addLabel(guideLayer, fontLabel, curX, curY, 7, isCMYKDoc);
        placedCount++;
        curY -= 12;

        // Font sample text
        var sampleTf = guideLayer.textFrames.add();
        sampleTf.contents = "Aa Bb Cc 123";
        sampleTf.position = [curX, curY];
        try {
          sampleTf.textRange.characterAttributes.size = sampleSize;
          sampleTf.textRange.characterAttributes.fillColor = makeTextColor(isCMYKDoc);
          try {
            sampleTf.textRange.characterAttributes.textFont = app.textFonts.getByName(font.name);
          } catch(e3) {}
        } catch(e) {}
        placedCount++;

        // Use actual rendered height to advance cursor
        try {
          var sampleBounds = sampleTf.geometricBounds;
          var actualHeight = sampleBounds[1] - sampleBounds[3]; // top - bottom
          if (position === "right") {
            curY -= actualHeight + 16;
          } else {
            curX += (sampleBounds[2] - sampleBounds[0]) + 30;
          }
        } catch(e) {
          if (position === "right") {
            curY -= sampleSize * 1.4 + 16;
          } else {
            curX += 250;
          }
        }
      }

      // Update cursor for next section
      if (position === "right") {
        curY -= sectionGap;
      } else {
        curX += sectionGap;
      }

      // ═══════════════════════════════════════════════════
      // SECTION 3: SPACING (on-artboard annotations + legend)
      // ═══════════════════════════════════════════════════

      // Group color palette for spacing values
      var groupColors = [];
      if (isCMYKDoc) {
        groupColors.push(function() { var c = new CMYKColor(); c.cyan = 0; c.magenta = 80; c.yellow = 80; c.black = 0; return c; });
        groupColors.push(function() { var c = new CMYKColor(); c.cyan = 80; c.magenta = 20; c.yellow = 0; c.black = 0; return c; });
        groupColors.push(function() { var c = new CMYKColor(); c.cyan = 60; c.magenta = 0; c.yellow = 80; c.black = 0; return c; });
        groupColors.push(function() { var c = new CMYKColor(); c.cyan = 30; c.magenta = 70; c.yellow = 0; c.black = 0; return c; });
        groupColors.push(function() { var c = new CMYKColor(); c.cyan = 0; c.magenta = 20; c.yellow = 90; c.black = 0; return c; });
        groupColors.push(function() { var c = new CMYKColor(); c.cyan = 70; c.magenta = 0; c.yellow = 30; c.black = 0; return c; });
      } else {
        groupColors.push(function() { var c = new RGBColor(); c.red = 230; c.green = 74; c.blue = 51; return c; });
        groupColors.push(function() { var c = new RGBColor(); c.red = 41; c.green = 128; c.blue = 205; return c; });
        groupColors.push(function() { var c = new RGBColor(); c.red = 46; c.green = 184; c.blue = 92; return c; });
        groupColors.push(function() { var c = new RGBColor(); c.red = 155; c.green = 89; c.blue = 182; return c; });
        groupColors.push(function() { var c = new RGBColor(); c.red = 243; c.green = 156; c.blue = 18; return c; });
        groupColors.push(function() { var c = new RGBColor(); c.red = 26; c.green = 188; c.blue = 156; return c; });
      }
      var groupColorNames = ["Red", "Blue", "Green", "Purple", "Orange", "Teal"];

      // Collect object bounds (visibleBounds for accurate visual edges)
      var objInfos = [];
      for (var oi = 0; oi < doc.pageItems.length && oi < 150; oi++) {
        try {
          var pItem = doc.pageItems[oi];
          if (pItem.layer.name === layerName) continue;
          if (pItem.layer.name === "Color Chips") continue;
          var ob;
          try { ob = pItem.visibleBounds; } catch(e2) { ob = pItem.geometricBounds; }
          objInfos.push({ left: ob[0], top: ob[1], right: ob[2], bottom: ob[3] });
        } catch(e) {}
      }

      // Find horizontal gaps (Y-overlapping pairs, non-overlapping X)
      // and vertical gaps (X-overlapping pairs, non-overlapping Y)
      // Store full positional info for placing annotations
      var hGapMap = {}; // key: rounded gap → { value, annotations: [{x,y,w,h}] }
      var vGapMap = {};

      for (var gi = 0; gi < objInfos.length; gi++) {
        for (var gj = gi + 1; gj < objInfos.length; gj++) {
          var a = objInfos[gi];
          var b = objInfos[gj];

          // --- Horizontal gap ---
          var yOvlp = Math.min(a.top, b.top) - Math.max(a.bottom, b.bottom);
          if (yOvlp > 0) {
            var leftObj = (a.right <= b.left) ? a : (b.right <= a.left) ? b : null;
            var rightObj = (leftObj === a) ? b : (leftObj === b) ? a : null;
            if (leftObj && rightObj) {
              var hDist = Math.round(rightObj.left - leftObj.right);
              if (hDist > 2 && hDist < 300) {
                var hk = "" + hDist;
                if (!hGapMap[hk]) hGapMap[hk] = { value: hDist, annotations: [] };
                if (hGapMap[hk].annotations.length < 5) {
                  var overlapTop = Math.min(a.top, b.top);
                  var overlapBottom = Math.max(a.bottom, b.bottom);
                  var midY = (overlapTop + overlapBottom) / 2;
                  var newAnn = {
                    x: leftObj.right,
                    y: midY + 2,
                    w: rightObj.left - leftObj.right,
                    h: 4
                  };
                  // Deduplicate: skip if a nearby annotation already exists
                  var isDupH = false;
                  for (var di = 0; di < hGapMap[hk].annotations.length; di++) {
                    var ex = hGapMap[hk].annotations[di];
                    if (Math.abs(ex.x - newAnn.x) < 20 && Math.abs(ex.y - newAnn.y) < 20) { isDupH = true; break; }
                  }
                  if (!isDupH) hGapMap[hk].annotations.push(newAnn);
                }
              }
            }
          }

          // --- Vertical gap ---
          var xOvlp = Math.min(a.right, b.right) - Math.max(a.left, b.left);
          if (xOvlp > 0) {
            var upper = (a.top >= b.top) ? a : b;
            var lower = (a.top >= b.top) ? b : a;
            var vDist = Math.round(upper.bottom - lower.top);
            if (vDist > 2 && vDist < 300) {
              var vk = "" + vDist;
              if (!vGapMap[vk]) vGapMap[vk] = { value: vDist, annotations: [] };
              if (vGapMap[vk].annotations.length < 5) {
                var overlapLeft = Math.max(a.left, b.left);
                var overlapRight = Math.min(a.right, b.right);
                var midX = (overlapLeft + overlapRight) / 2;
                var newVAnn = {
                  x: midX - 2,
                  y: upper.bottom,
                  w: 4,
                  h: upper.bottom - lower.top
                };
                // Deduplicate: skip if a nearby annotation already exists
                var isDupV = false;
                for (var dvi = 0; dvi < vGapMap[vk].annotations.length; dvi++) {
                  var exv = vGapMap[vk].annotations[dvi];
                  if (Math.abs(exv.x - newVAnn.x) < 20 && Math.abs(exv.y - newVAnn.y) < 20) { isDupV = true; break; }
                }
                if (!isDupV) vGapMap[vk].annotations.push(newVAnn);
              }
            }
          }
        }
      }

      // Filter for 2+ occurrences, sort by frequency, cap at 6
      var hList = [];
      for (var hk2 in hGapMap) {
        if (hGapMap[hk2].annotations.length >= 2) hList.push(hGapMap[hk2]);
      }
      hList.sort(function(a, b) { return b.annotations.length - a.annotations.length; });
      if (hList.length > 6) hList = hList.slice(0, 6);

      var vList = [];
      for (var vk2 in vGapMap) {
        if (vGapMap[vk2].annotations.length >= 2) vList.push(vGapMap[vk2]);
      }
      vList.sort(function(a, b) { return b.annotations.length - a.annotations.length; });
      if (vList.length > 6) vList = vList.slice(0, 6);

      // Assign colors: same value gets same color
      var valueColorMap = {};
      var nextColorIdx = 0;
      var allGapGroups = hList.concat(vList);
      for (var agi = 0; agi < allGapGroups.length; agi++) {
        var sv = "" + allGapGroups[agi].value;
        if (typeof valueColorMap[sv] === "undefined") {
          valueColorMap[sv] = nextColorIdx % groupColors.length;
          nextColorIdx++;
        }
      }

      var spacingCount = hList.length + vList.length;

      // Place colored bars ON the artboard, grouped by spacing value
      // Each value gets its own group so clicking one highlights all same-value annotations
      function placeAnnotationBars(gapList) {
        for (var gli = 0; gli < gapList.length; gli++) {
          var gEntry = gapList[gli];
          var cIdx = valueColorMap["" + gEntry.value];

          // Create a group for this spacing value
          var grp = guideLayer.groupItems.add();
          grp.name = "Spacing " + gEntry.value + "pt";

          for (var ani = 0; ani < gEntry.annotations.length; ani++) {
            var ann = gEntry.annotations[ani];

            // Bar — create in layer first, then move into group
            var annBar = guideLayer.pathItems.rectangle(ann.y, ann.x, ann.w, ann.h);
            annBar.fillColor = groupColors[cIdx]();
            annBar.stroked = false;
            annBar.opacity = 60;
            annBar.move(grp, ElementPlacement.PLACEATEND);
            placedCount++;

            // Label near the bar
            var lblX, lblY;
            if (ann.w > ann.h) {
              // horizontal bar: label above center
              lblX = ann.x + ann.w / 2 - 10;
              lblY = ann.y + 16;
            } else {
              // vertical bar: label to the right of center
              lblX = ann.x + ann.w + 4;
              lblY = ann.y - ann.h / 2 + 6;
            }
            var annLabel = guideLayer.textFrames.add();
            annLabel.contents = "" + gEntry.value;
            annLabel.position = [lblX, lblY];
            try {
              annLabel.textRange.characterAttributes.size = 14;
              annLabel.textRange.characterAttributes.fillColor = groupColors[cIdx]();
            } catch(e) {}
            annLabel.move(grp, ElementPlacement.PLACEATEND);
            placedCount++;
          }
          placedCount++; // group itself
        }
      }

      if (spacingCount > 0) {
        // Place on-artboard annotations
        placeAnnotationBars(hList);
        placeAnnotationBars(vList);

        // Place legend in style guide area
        addSectionTitle(guideLayer, "SPACING", curX, curY, isCMYKDoc);
        placedCount++;
        curY -= 20;

        var allSorted = hList.concat(vList);
        // Deduplicate by value for legend
        var legendMap = {};
        var legendList = [];
        for (var li = 0; li < allSorted.length; li++) {
          var lv = "" + allSorted[li].value;
          if (!legendMap[lv]) {
            legendMap[lv] = true;
            legendList.push(allSorted[li]);
          }
        }
        legendList.sort(function(a, b) { return a.value - b.value; });

        for (var lei = 0; lei < legendList.length; lei++) {
          var le = legendList[lei];
          var lcIdx = valueColorMap["" + le.value];

          // Find the existing annotation group to add legend items into
          var targetGrp = null;
          var grpName = "Spacing " + le.value + "pt";
          for (var gsi = 0; gsi < guideLayer.groupItems.length; gsi++) {
            if (guideLayer.groupItems[gsi].name === grpName) {
              targetGrp = guideLayer.groupItems[gsi];
              break;
            }
          }

          // Color swatch
          var swatchSize = 14;
          var swatch = guideLayer.pathItems.rectangle(curY, curX, swatchSize, swatchSize);
          swatch.fillColor = groupColors[lcIdx]();
          swatch.stroked = false;
          if (targetGrp) swatch.move(targetGrp, ElementPlacement.PLACEATEND);
          placedCount++;

          // Legend label
          var totalCount = 0;
          if (hGapMap["" + le.value]) totalCount += hGapMap["" + le.value].annotations.length;
          if (vGapMap["" + le.value]) totalCount += vGapMap["" + le.value].annotations.length;
          var dirs = [];
          if (hGapMap["" + le.value] && hGapMap["" + le.value].annotations.length >= 2) dirs.push("H");
          if (vGapMap["" + le.value] && vGapMap["" + le.value].annotations.length >= 2) dirs.push("V");
          var legendText = le.value + "pt  " + dirs.join("+") + "  (x" + totalCount + ")";
          var legLabel = addLabel(guideLayer, legendText, curX + swatchSize + 6, curY - 2, 8, isCMYKDoc);
          if (targetGrp) legLabel.move(targetGrp, ElementPlacement.PLACEATEND);
          placedCount++;

          curY -= swatchSize + gap + 4;
        }
      }

      // ═══════════════════════════════════════════════════
      // SECTION 4: ARTBOARD MARGINS
      // ═══════════════════════════════════════════════════

      // Find nearest object edge from each artboard side
      var marginColor;
      if (isCMYKDoc) {
        marginColor = function() { var c = new CMYKColor(); c.cyan = 50; c.magenta = 0; c.yellow = 100; c.black = 0; return c; };
      } else {
        marginColor = function() { var c = new RGBColor(); c.red = 139; c.green = 195; c.blue = 74; return c; };
      }

      var nearTop = null, nearRight = null, nearBottom = null, nearLeft = null;
      for (var mi = 0; mi < objInfos.length; mi++) {
        var mo = objInfos[mi];
        // Only consider objects that are within the artboard horizontally/vertically
        var inH = mo.right > abRect[0] && mo.left < abRect[2];
        var inV = mo.top > abRect[3] && mo.bottom < abRect[1];
        if (inH && inV) {
          var dTop = abRect[1] - mo.top;     // artboard top - object top
          var dBottom = mo.bottom - abRect[3]; // object bottom - artboard bottom
          var dLeft = mo.left - abRect[0];    // object left - artboard left
          var dRight = abRect[2] - mo.right;  // artboard right - object right
          if (dTop > 0 && (nearTop === null || dTop < nearTop.dist))
            nearTop = { dist: dTop, x: (mo.left + mo.right) / 2, objEdge: mo.top };
          if (dBottom > 0 && (nearBottom === null || dBottom < nearBottom.dist))
            nearBottom = { dist: dBottom, x: (mo.left + mo.right) / 2, objEdge: mo.bottom };
          if (dLeft > 0 && (nearLeft === null || dLeft < nearLeft.dist))
            nearLeft = { dist: dLeft, y: (mo.top + mo.bottom) / 2, objEdge: mo.left };
          if (dRight > 0 && (nearRight === null || dRight < nearRight.dist))
            nearRight = { dist: dRight, y: (mo.top + mo.bottom) / 2, objEdge: mo.right };
        }
      }

      var marginGrp = guideLayer.groupItems.add();
      marginGrp.name = "Artboard Margins";
      var marginAnnotations = [];

      // Top margin
      if (nearTop && nearTop.dist > 1) {
        marginAnnotations.push({ dir: "v", x: nearTop.x - 2, y: abRect[1], w: 4, h: nearTop.dist, val: Math.round(nearTop.dist) });
      }
      // Bottom margin
      if (nearBottom && nearBottom.dist > 1) {
        marginAnnotations.push({ dir: "v", x: nearBottom.x - 2, y: nearBottom.objEdge, w: 4, h: nearBottom.dist, val: Math.round(nearBottom.dist) });
      }
      // Left margin
      if (nearLeft && nearLeft.dist > 1) {
        marginAnnotations.push({ dir: "h", x: abRect[0], y: nearLeft.y + 2, w: nearLeft.dist, h: 4, val: Math.round(nearLeft.dist) });
      }
      // Right margin
      if (nearRight && nearRight.dist > 1) {
        marginAnnotations.push({ dir: "h", x: nearRight.objEdge, y: nearRight.y + 2, w: nearRight.dist, h: 4, val: Math.round(nearRight.dist) });
      }

      for (var mai = 0; mai < marginAnnotations.length; mai++) {
        var ma = marginAnnotations[mai];
        var mBar = guideLayer.pathItems.rectangle(ma.y, ma.x, ma.w, ma.h);
        mBar.fillColor = marginColor();
        mBar.stroked = false;
        mBar.opacity = 70;
        mBar.move(marginGrp, ElementPlacement.PLACEATEND);
        placedCount++;

        var mLblX, mLblY;
        if (ma.dir === "h") {
          mLblX = ma.x + ma.w / 2 - 10;
          mLblY = ma.y + 16;
        } else {
          mLblX = ma.x + ma.w + 4;
          mLblY = ma.y - ma.h / 2 + 6;
        }
        var mLabel = guideLayer.textFrames.add();
        mLabel.contents = "" + ma.val;
        mLabel.position = [mLblX, mLblY];
        try {
          mLabel.textRange.characterAttributes.size = 14;
          mLabel.textRange.characterAttributes.fillColor = marginColor();
        } catch(e) {}
        mLabel.move(marginGrp, ElementPlacement.PLACEATEND);
        placedCount++;
      }

      // Margin legend
      if (marginAnnotations.length > 0) {
        if (position === "right") { curY -= sectionGap; }
        addSectionTitle(guideLayer, "MARGINS", curX, curY, isCMYKDoc);
        placedCount++;
        curY -= 20;

        var mSwatchSize = 14;
        var mSwatch = guideLayer.pathItems.rectangle(curY, curX, mSwatchSize, mSwatchSize);
        mSwatch.fillColor = marginColor();
        mSwatch.stroked = false;
        mSwatch.move(marginGrp, ElementPlacement.PLACEATEND);
        placedCount++;

        var marginVals = [];
        for (var mvi = 0; mvi < marginAnnotations.length; mvi++) {
          marginVals.push(marginAnnotations[mvi].val + "pt");
        }
        var mLegLabel = addLabel(guideLayer, "T/R/B/L: " + marginVals.join(", "), curX + mSwatchSize + 6, curY - 2, 8, isCMYKDoc);
        mLegLabel.move(marginGrp, ElementPlacement.PLACEATEND);
        placedCount++;
        curY -= mSwatchSize + gap + 4;
      }

      // ═══════════════════════════════════════════════════
      // SECTION 5: GUIDE GAPS
      // ═══════════════════════════════════════════════════

      var guideColor;
      if (isCMYKDoc) {
        guideColor = function() { var c = new CMYKColor(); c.cyan = 0; c.magenta = 60; c.yellow = 0; c.black = 0; return c; };
      } else {
        guideColor = function() { var c = new RGBColor(); c.red = 233; c.green = 30; c.blue = 99; return c; };
      }

      // Collect guide positions
      var hGuides = []; // horizontal guides (Y positions)
      var vGuides = []; // vertical guides (X positions)
      for (var gui = 0; gui < doc.pathItems.length; gui++) {
        try {
          var gItem = doc.pathItems[gui];
          if (gItem.guides) {
            var gb = gItem.geometricBounds;
            var gWidth = gb[2] - gb[0];
            var gHeight = gb[1] - gb[3];
            if (gHeight < 1 && gWidth > 10) {
              // Horizontal guide
              hGuides.push((gb[1] + gb[3]) / 2);
            } else if (gWidth < 1 && gHeight > 10) {
              // Vertical guide
              vGuides.push((gb[0] + gb[2]) / 2);
            }
          }
        } catch(e) {}
      }

      // Sort and calculate gaps
      hGuides.sort(function(a, b) { return b - a; }); // top to bottom (descending Y)
      vGuides.sort(function(a, b) { return a - b; }); // left to right (ascending X)

      var guideGrp = guideLayer.groupItems.add();
      guideGrp.name = "Guide Gaps";
      var guideAnnotCount = 0;

      // Horizontal guide gaps (vertical distance between adjacent horizontal guides)
      for (var hgi = 0; hgi < hGuides.length - 1; hgi++) {
        var gGap = Math.round(hGuides[hgi] - hGuides[hgi + 1]);
        if (gGap > 1 && gGap < 1000) {
          var gMidX = (abRect[0] + abRect[2]) / 2;
          var gBar = guideLayer.pathItems.rectangle(hGuides[hgi], gMidX - 2, 4, hGuides[hgi] - hGuides[hgi + 1]);
          gBar.fillColor = guideColor();
          gBar.stroked = false;
          gBar.opacity = 50;
          gBar.move(guideGrp, ElementPlacement.PLACEATEND);
          placedCount++;

          var gLabel = guideLayer.textFrames.add();
          gLabel.contents = "" + gGap;
          gLabel.position = [gMidX + 6, (hGuides[hgi] + hGuides[hgi + 1]) / 2 + 6];
          try {
            gLabel.textRange.characterAttributes.size = 14;
            gLabel.textRange.characterAttributes.fillColor = guideColor();
          } catch(e) {}
          gLabel.move(guideGrp, ElementPlacement.PLACEATEND);
          placedCount++;
          guideAnnotCount++;
        }
      }

      // Vertical guide gaps (horizontal distance between adjacent vertical guides)
      for (var vgi = 0; vgi < vGuides.length - 1; vgi++) {
        var vgGap = Math.round(vGuides[vgi + 1] - vGuides[vgi]);
        if (vgGap > 1 && vgGap < 2000) {
          var gMidY = (abRect[1] + abRect[3]) / 2;
          var vgBar = guideLayer.pathItems.rectangle(gMidY + 2, vGuides[vgi], vGuides[vgi + 1] - vGuides[vgi], 4);
          vgBar.fillColor = guideColor();
          vgBar.stroked = false;
          vgBar.opacity = 50;
          vgBar.move(guideGrp, ElementPlacement.PLACEATEND);
          placedCount++;

          var vgLabel = guideLayer.textFrames.add();
          vgLabel.contents = "" + vgGap;
          vgLabel.position = [(vGuides[vgi] + vGuides[vgi + 1]) / 2 - 10, gMidY + 18];
          try {
            vgLabel.textRange.characterAttributes.size = 14;
            vgLabel.textRange.characterAttributes.fillColor = guideColor();
          } catch(e) {}
          vgLabel.move(guideGrp, ElementPlacement.PLACEATEND);
          placedCount++;
          guideAnnotCount++;
        }
      }

      // Guide legend
      if (guideAnnotCount > 0) {
        if (position === "right") { curY -= sectionGap; }
        addSectionTitle(guideLayer, "GUIDE GAPS", curX, curY, isCMYKDoc);
        placedCount++;
        curY -= 20;

        var gSwSize = 14;
        var gSwatch = guideLayer.pathItems.rectangle(curY, curX, gSwSize, gSwSize);
        gSwatch.fillColor = guideColor();
        gSwatch.stroked = false;
        gSwatch.move(guideGrp, ElementPlacement.PLACEATEND);
        placedCount++;

        var gLegText = hGuides.length + " horizontal, " + vGuides.length + " vertical guides";
        var gLegLabel = addLabel(guideLayer, gLegText, curX + gSwSize + 6, curY - 2, 8, isCMYKDoc);
        gLegLabel.move(guideGrp, ElementPlacement.PLACEATEND);
        placedCount++;
        curY -= gSwSize + gap + 4;
      }

      // Verification
      var verifiedItems = [];
      var guideItems = guideLayer.pageItems;
      for (var vi = 0; vi < guideItems.length && vi < 5; vi++) {
        verifiedItems.push(verifyItem(guideItems[vi], params.coordinate_system, abRect));
      }

      writeResultFile(RESULT_PATH, {
        success: true,
        placedCount: placedCount,
        sections: {
          colors: colorList.length,
          fonts: fontList.length,
          horizontalSpacings: hList.length,
          verticalSpacings: vList.length,
          margins: marginAnnotations.length,
          guideGaps: guideAnnotCount
        },
        layerName: layerName,
        position: position,
        verified: verifiedItems
      });
    }
  } catch (e) {
    writeResultFile(RESULT_PATH, { error: true, message: "Place style guide failed: " + e.message, line: e.line });
  }
}
`;

export function register(server: McpServer): void {
  server.registerTool(
    'place_style_guide',
    {
      title: 'Place Style Guide',
      description:
        'Place a visual style guide (color chips, font samples, spacing indicators) outside the artboard',
      inputSchema: {
        artboard_index: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe('Target artboard (default: active artboard)'),
        position: z
          .enum(['right', 'bottom'])
          .optional()
          .default('right')
          .describe('Place style guide to the right or below the artboard'),
        layer_name: z
          .string()
          .optional()
          .default('Style Guide')
          .describe('Layer name for the style guide'),
        coordinate_system: coordinateSystemSchema,
      },
      annotations: WRITE_ANNOTATIONS,
    },
    async (params) => {
      return executeToolJsx(jsxCode, params, { heavy: true, resolveCoordinate: true });
    },
  );
}
