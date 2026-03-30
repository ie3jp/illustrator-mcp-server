import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeJsx } from '../../executor/jsx-runner.js';
import { READ_ANNOTATIONS } from '../modify/shared.js';

/**
 * get_preflight_results — InDesign 組み込みプリフライト結果の取得
 * InDesign built-in preflight results.
 */
const jsxCode = `
var preflight = preflightChecks();
if (preflight) {
  writeResultFile(RESULT_PATH, preflight);
} else {
  try {
    var params = readParamsFile(PARAMS_PATH);
    var doc = app.activeDocument;
    var runPreflight = (params && params.run_preflight !== false) ? true : false;
    var profileName = (params && params.profile) ? params.profile : null;

    // プリフライトの実行
    var preflightProcess = null;
    try {
      if (runPreflight) {
        // プロファイルの選択
        var profile = null;
        if (profileName) {
          for (var pfi = 0; pfi < app.preflightProfiles.length; pfi++) {
            if (app.preflightProfiles[pfi].name === profileName) {
              profile = app.preflightProfiles[pfi];
              break;
            }
          }
        }
        if (!profile && app.preflightProfiles.length > 0) {
          profile = app.preflightProfiles[0]; // デフォルトプロファイル
        }
        if (profile) {
          preflightProcess = app.preflightProcesses.add(doc, profile);
          preflightProcess.waitForProcess();
        }
      }
    } catch (e) {
      // プリフライト実行できない場合はそのまま続行
    }

    // 利用可能なプロファイル一覧
    var profiles = [];
    try {
      for (var pi = 0; pi < app.preflightProfiles.length; pi++) {
        profiles.push({ name: app.preflightProfiles[pi].name });
      }
    } catch (e) {}

    // プリフライト結果の収集
    var errors = [];
    var warnings = [];
    var infos = [];

    if (preflightProcess) {
      try {
        var results = preflightProcess.preflightProcessResults;
        for (var ri = 0; ri < results.length; ri++) {
          var res = results[ri];
          var resInfo = {
            description: "",
            pageIndex: -1,
            errorType: "info"
          };
          try { resInfo.description = res.shortDescription || res.description || ""; } catch (e2) {}
          try {
            if (res.page) resInfo.pageIndex = res.page.index;
          } catch (e2) {}
          try {
            var et = res.errorType;
            if (et === PreflightResultType.PREFLIGHT_WARNING) resInfo.errorType = "warning";
            else if (et === PreflightResultType.PREFLIGHT_REPORT) resInfo.errorType = "info";
            else resInfo.errorType = "error";
          } catch (e2) {}
          if (resInfo.errorType === "error") {
            errors.push(resInfo);
          } else if (resInfo.errorType === "warning") {
            warnings.push(resInfo);
          } else {
            infos.push(resInfo);
          }
        }
      } catch (e) {}
    }

    // マニュアルチェック（プロファイルなし時）
    // 基本的なドキュメント健全性チェック
    var manualChecks = [];

    // 不足リンクのチェック
    try {
      var missingLinks = [];
      for (var li = 0; li < doc.links.length; li++) {
        var lnk = doc.links[li];
        try {
          var ls = lnk.status;
          if (ls === LinkStatus.LINK_MISSING || ls === LinkStatus.LINK_INACCESSIBLE) {
            missingLinks.push({
              name: lnk.name || "",
              status: ls === LinkStatus.LINK_MISSING ? "missing" : "inaccessible"
            });
          }
        } catch (e2) {}
      }
      if (missingLinks.length > 0) {
        manualChecks.push({
          category: "Links",
          type: "error",
          description: missingLinks.length + " missing or inaccessible link(s)",
          details: missingLinks
        });
      } else {
        manualChecks.push({
          category: "Links",
          type: "ok",
          description: "All " + doc.links.length + " links are accessible"
        });
      }
    } catch (e) {}

    // 未更新リンクのチェック
    try {
      var outOfDateLinks = [];
      for (var oli = 0; oli < doc.links.length; oli++) {
        var olnk = doc.links[oli];
        try {
          if (olnk.status === LinkStatus.LINK_OUT_OF_DATE) {
            outOfDateLinks.push({ name: olnk.name || "" });
          }
        } catch (e2) {}
      }
      if (outOfDateLinks.length > 0) {
        manualChecks.push({
          category: "Links",
          type: "warning",
          description: outOfDateLinks.length + " out-of-date link(s)",
          details: outOfDateLinks
        });
      }
    } catch (e) {}

    // テキストオーバーフローのチェック
    try {
      var overflowFrames = [];
      for (var tfi = 0; tfi < doc.textFrames.length; tfi++) {
        var tf = doc.textFrames[tfi];
        try {
          if (tf.overflows) {
            var tfUUID = ensureUUID(tf);
            var tfPageIdx = -1;
            try { if (tf.parentPage) tfPageIdx = tf.parentPage.index; } catch (e3) {}
            overflowFrames.push({ uuid: tfUUID, pageIndex: tfPageIdx });
          }
        } catch (e2) {}
      }
      if (overflowFrames.length > 0) {
        manualChecks.push({
          category: "Text",
          type: "error",
          description: overflowFrames.length + " overflowing text frame(s)",
          details: overflowFrames
        });
      } else {
        manualChecks.push({
          category: "Text",
          type: "ok",
          description: "No overflowing text frames"
        });
      }
    } catch (e) {}

    // 未使用マスターの確認（参考情報）
    try {
      var unusedMasters = [];
      for (var mi = 0; mi < doc.masterSpreads.length; mi++) {
        var ms = doc.masterSpreads[mi];
        var applyCount = 0;
        for (var dpi = 0; dpi < doc.pages.length; dpi++) {
          try {
            if (doc.pages[dpi].appliedMaster && doc.pages[dpi].appliedMaster.name === ms.name) {
              applyCount++;
            }
          } catch (e2) {}
        }
        if (applyCount === 0) {
          unusedMasters.push({ name: ms.name });
        }
      }
      if (unusedMasters.length > 0) {
        manualChecks.push({
          category: "Masters",
          type: "info",
          description: unusedMasters.length + " unused master spread(s)",
          details: unusedMasters
        });
      }
    } catch (e) {}

    // プリフライトプロセスのクリーンアップ
    try {
      if (preflightProcess) {
        preflightProcess.remove();
      }
    } catch (e) {}

    var usedProfile = profileName || (profiles.length > 0 ? profiles[0].name : "none");
    writeResultFile(RESULT_PATH, {
      profileUsed: usedProfile,
      availableProfiles: profiles,
      preflightErrors: errors,
      preflightWarnings: warnings,
      preflightInfos: infos,
      manualChecks: manualChecks,
      summary: {
        errorCount: errors.length + manualChecks.filter(function(c) { return c.type === "error"; }).length,
        warningCount: warnings.length + manualChecks.filter(function(c) { return c.type === "warning"; }).length,
        passCount: manualChecks.filter(function(c) { return c.type === "ok"; }).length
      }
    });
  } catch (e) {
    writeResultFile(RESULT_PATH, { error: true, message: "get_preflight_results: " + e.message, line: e.line });
  }
}
`;

export function register(server: McpServer): void {
  server.registerTool(
    'get_preflight_results',
    {
      title: 'Get Preflight Results',
      description: 'Run InDesign preflight checks and return results. Runs built-in preflight with the specified profile (or first available), plus manual checks for missing links, out-of-date links, and overflowing text frames.',
      inputSchema: {
        run_preflight: z
          .boolean()
          .optional()
          .default(true)
          .describe('Run InDesign preflight process (default: true). Set false for manual checks only.'),
        profile: z
          .string()
          .optional()
          .describe('Preflight profile name. If omitted, uses the first available profile.'),
      },
      annotations: READ_ANNOTATIONS,
    },
    async (params) => {
      const result = await executeJsx(jsxCode, params);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );
}
