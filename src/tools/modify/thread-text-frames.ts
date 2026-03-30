import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeJsx } from '../../executor/jsx-runner.js';
import { WRITE_ANNOTATIONS, DESTRUCTIVE_ANNOTATIONS } from './shared.js';

const jsxCode = `
var preflight = preflightChecks();
if (preflight) {
  writeResultFile(RESULT_PATH, preflight);
} else {
  try {
    var params = readParamsFile(PARAMS_PATH);
    var doc = app.activeDocument;
    var action = params.action;

    function getFrameInfo(tf) {
      return {
        uuid: ensureUUID(tf),
        name: tf.name,
        hasNextFrame: (tf.nextTextFrame !== null && tf.nextTextFrame.isValid),
        hasPreviousFrame: (tf.previousTextFrame !== null && tf.previousTextFrame.isValid),
        overflows: tf.overflows
      };
    }

    if (action === "thread") {
      if (!params.from_uuid || !params.to_uuid) {
        writeResultFile(RESULT_PATH, { error: true, message: "from_uuid and to_uuid are required for thread" });
      } else {
        var fromFrame = findItemByUUID(params.from_uuid);
        var toFrame = findItemByUUID(params.to_uuid);
        if (!fromFrame) {
          writeResultFile(RESULT_PATH, { error: true, message: "from frame not found: " + params.from_uuid });
        } else if (!toFrame) {
          writeResultFile(RESULT_PATH, { error: true, message: "to frame not found: " + params.to_uuid });
        } else if (fromFrame.typename !== "TextFrame") {
          writeResultFile(RESULT_PATH, { error: true, message: "from object is not a TextFrame" });
        } else if (toFrame.typename !== "TextFrame") {
          writeResultFile(RESULT_PATH, { error: true, message: "to object is not a TextFrame" });
        } else {
          // Thread: set nextTextFrame on the from frame
          fromFrame.nextTextFrame = toFrame;
          writeResultFile(RESULT_PATH, {
            success: true,
            action: "thread",
            fromFrame: getFrameInfo(fromFrame),
            toFrame: getFrameInfo(toFrame)
          });
        }
      }

    } else if (action === "unthread") {
      if (!params.uuid) {
        writeResultFile(RESULT_PATH, { error: true, message: "uuid is required for unthread" });
      } else {
        var frame = findItemByUUID(params.uuid);
        if (!frame) {
          writeResultFile(RESULT_PATH, { error: true, message: "Frame not found: " + params.uuid });
        } else if (frame.typename !== "TextFrame") {
          writeResultFile(RESULT_PATH, { error: true, message: "Object is not a TextFrame" });
        } else {
          // Unthread: break the thread after this frame
          frame.nextTextFrame = NothingEnum.NOTHING;
          writeResultFile(RESULT_PATH, {
            success: true,
            action: "unthread",
            frame: getFrameInfo(frame)
          });
        }
      }

    } else if (action === "get_story") {
      if (!params.uuid) {
        writeResultFile(RESULT_PATH, { error: true, message: "uuid is required for get_story" });
      } else {
        var storyFrame = findItemByUUID(params.uuid);
        if (!storyFrame) {
          writeResultFile(RESULT_PATH, { error: true, message: "Frame not found: " + params.uuid });
        } else if (storyFrame.typename !== "TextFrame") {
          writeResultFile(RESULT_PATH, { error: true, message: "Object is not a TextFrame" });
        } else {
          var story = storyFrame.parentStory;
          var frames = story.textContainers;
          var frameInfos = [];
          for (var fi = 0; fi < frames.length; fi++) {
            frameInfos.push(getFrameInfo(frames[fi]));
          }
          writeResultFile(RESULT_PATH, {
            success: true,
            action: "get_story",
            storyLength: story.contents.length,
            frameCount: frames.length,
            frames: frameInfos
          });
        }
      }

    } else {
      writeResultFile(RESULT_PATH, { error: true, message: "Unknown action: " + action + ". Valid: thread, unthread, get_story" });
    }
  } catch (e) {
    writeResultFile(RESULT_PATH, { error: true, message: "thread_text_frames failed: " + e.message, line: e.line });
  }
}
`;

export function register(server: McpServer): void {
  server.registerTool(
    'thread_text_frames',
    {
      title: 'Thread Text Frames',
      description: 'Link or unlink text frame threading (stories) in InDesign. Thread connects frames so text flows between them.',
      inputSchema: {
        action: z.enum(['thread', 'unthread', 'get_story']).describe('thread=link two frames, unthread=break link after a frame, get_story=list all frames in a story'),
        from_uuid: z.string().optional().describe('UUID of the first text frame (for thread action)'),
        to_uuid: z.string().optional().describe('UUID of the second text frame to link to (for thread action)'),
        uuid: z.string().optional().describe('UUID of a text frame (for unthread/get_story)'),
      },
      annotations: WRITE_ANNOTATIONS,
    },
    async (params) => {
      const result = await executeJsx(jsxCode, params, { activate: true });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );
}
