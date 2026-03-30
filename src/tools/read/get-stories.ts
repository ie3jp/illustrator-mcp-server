import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeJsx } from '../../executor/jsx-runner.js';
import { READ_ANNOTATIONS } from '../modify/shared.js';

/**
 * get_stories — ストーリー（スレッドチェーン）一覧の取得
 * List stories with: id, length, textContainers count + UUIDs, contents preview (first 200 chars),
 * tables count, footnotes count.
 */
const jsxCode = `
var preflight = preflightChecks();
if (preflight) {
  writeResultFile(RESULT_PATH, preflight);
} else {
  try {
    var params = readParamsFile(PARAMS_PATH);
    var doc = app.activeDocument;

    var stories = [];

    for (var i = 0; i < doc.stories.length; i++) {
      var story = doc.stories[i];

      var storyInfo = {
        index: i,
        id: "",
        length: 0,
        textContainerCount: 0,
        textContainerUUIDs: [],
        contentsPreview: "",
        tableCount: 0,
        footnoteCount: 0
      };

      // テキストコンテナのUUID一覧
      try {
        var containers = story.textContainers;
        storyInfo.textContainerCount = containers.length;

        var uuids = [];
        for (var j = 0; j < containers.length; j++) {
          var tf = containers[j];
          var tfUuid = ensureUUID(tf);
          uuids.push(tfUuid);
        }
        storyInfo.textContainerUUIDs = uuids;

        // ストーリーIDは先頭コンテナのUUID
        if (uuids.length > 0) {
          storyInfo.id = uuids[0];
        } else {
          storyInfo.id = "story-" + i;
        }
      } catch (e) {}

      // 文字数（length）
      try {
        storyInfo.length = story.characters.length;
      } catch (e) {}

      // コンテンツプレビュー（先頭200文字）
      try {
        var fullContents = story.contents || "";
        var preview = "";
        for (var ci = 0; ci < fullContents.length && ci < 200; ci++) {
          var ch = fullContents.charAt(ci);
          if (ch === "\\r" || ch === "\\n") {
            preview += " ";
          } else {
            preview += ch;
          }
        }
        if (fullContents.length > 200) {
          preview += "...";
        }
        storyInfo.contentsPreview = preview;
      } catch (e) {}

      // テーブル数
      try {
        storyInfo.tableCount = story.tables.length;
      } catch (e) { storyInfo.tableCount = 0; }

      // 脚注数
      try {
        storyInfo.footnoteCount = story.footnotes.length;
      } catch (e) { storyInfo.footnoteCount = 0; }

      stories.push(storyInfo);
    }

    writeResultFile(RESULT_PATH, {
      storyCount: stories.length,
      stories: stories
    });
  } catch (e) {
    writeResultFile(RESULT_PATH, { error: true, message: e.message, line: e.line });
  }
}
`;

export function register(server: McpServer): void {
  server.registerTool(
    'get_stories',
    {
      title: 'Get Stories',
      description:
        'List all stories (threaded text chains) in the active InDesign document. Returns story id, character length, text container count and UUIDs, a 200-character content preview, table count, and footnote count for each story.',
      inputSchema: {},
      annotations: READ_ANNOTATIONS,
    },
    async (_params) => {
      const result = await executeJsx(jsxCode, {});
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );
}
