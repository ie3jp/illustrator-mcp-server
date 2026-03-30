import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { executeJsx } from '../../executor/jsx-runner.js';
import { READ_ANNOTATIONS } from '../modify/shared.js';
/**
 * preflight_check — InDesign built-in preflight
 * @see https://www.indesignjs.de/extendscriptAPI/indesign-cs6.html#PreflightProcess
 * @see https://www.indesignjs.de/extendscriptAPI/indesign-cs6.html#PreflightProfile
 *
 * InDesign has its own preflight engine. This tool runs the built-in preflight
 * on the active document using the embedded default profile (or the first available
 * profile) and returns the structured results.
 */
const jsxCode = `
var preflight = preflightChecks();
if (preflight) {
  writeResultFile(RESULT_PATH, preflight);
} else {
  try {
    var doc = app.activeDocument;

    // Resolve the preflight profile to use: prefer [Basic] then fall back to index 0
    var profile = null;
    try {
      profile = app.preflightProfiles.item("[Basic]");
      // Accessing .name forces evaluation — throws if it doesn't exist
      var pName = profile.name;
    } catch(e) {
      profile = null;
    }
    if (!profile) {
      try {
        if (app.preflightProfiles.length > 0) {
          profile = app.preflightProfiles[0];
        }
      } catch(e2) {}
    }

    if (!profile) {
      writeResultFile(RESULT_PATH, {
        error: true,
        message: "No preflight profile found. Please create or install a preflight profile in InDesign."
      });
    } else {
      // Add preflight process and wait for it to complete
      var process = app.preflightProcesses.add(doc, profile);
      process.waitForProcess();

      var rawResults = "";
      try {
        rawResults = process.processResults;
      } catch(e) {
        rawResults = "";
      }

      // Capture profile name and pass counts before removing process
      var profileName = "";
      try { profileName = profile.name; } catch(e) {}

      var errorCount = 0;
      var warningCount = 0;
      var infoCount = 0;
      try { errorCount = process.errorCount; } catch(e) {}
      try { warningCount = process.warningCount; } catch(e) {}
      try { infoCount = process.infoCount; } catch(e) {}

      var passed = (errorCount === 0);

      // Remove the process to avoid accumulating processes in the panel
      try { process.remove(); } catch(e) {}

      writeResultFile(RESULT_PATH, {
        passed: passed,
        profileName: profileName,
        errorCount: errorCount,
        warningCount: warningCount,
        infoCount: infoCount,
        rawResults: rawResults
      });
    }
  } catch (e) {
    writeResultFile(RESULT_PATH, { error: true, message: "Preflight failed: " + e.message, line: e.line });
  }
}
`;

/** Parse InDesign preflight XML results into structured issues array. */
function parsePreflightResults(
  rawResults: string,
): Array<{ level: string; category: string; message: string; page?: string }> {
  const issues: Array<{ level: string; category: string; message: string; page?: string }> = [];
  if (!rawResults || rawResults.trim() === '') return issues;

  // InDesign preflight results are XML. Extract <Error>, <Warning>, <Info> elements.
  // Pattern: <ResultSummary type="Error|Warning|Info" ...><Description>...</Description>
  // We do a best-effort regex parse rather than a full XML parser.
  const errorPattern = /<ResultSummary[^>]+type="([^"]+)"[^>]*>([\s\S]*?)<\/ResultSummary>/gi;
  let match = errorPattern.exec(rawResults);
  while (match !== null) {
    const level = match[1].toLowerCase();
    const innerXml = match[2];

    const descMatch = /<Description[^>]*>([\s\S]*?)<\/Description>/i.exec(innerXml);
    const catMatch = /<Category[^>]*>([\s\S]*?)<\/Category>/i.exec(innerXml);
    const pageMatch = /<PageNumber[^>]*>([\s\S]*?)<\/PageNumber>/i.exec(innerXml);

    const message = descMatch ? descMatch[1].replace(/<[^>]+>/g, '').trim() : '(no description)';
    const category = catMatch ? catMatch[1].replace(/<[^>]+>/g, '').trim() : 'preflight';
    const page = pageMatch ? pageMatch[1].replace(/<[^>]+>/g, '').trim() : undefined;

    issues.push({ level, category, message, ...(page ? { page } : {}) });
    match = errorPattern.exec(rawResults);
  }

  // Fallback: if no ResultSummary blocks found but rawResults is non-empty, return as plain text
  if (issues.length === 0 && rawResults.trim().length > 0) {
    issues.push({ level: 'info', category: 'preflight', message: rawResults.trim().substring(0, 500) });
  }

  return issues;
}

export function register(server: McpServer): void {
  server.registerTool(
    'preflight_check',
    {
      title: 'Preflight Check',
      description:
        'Run InDesign\'s built-in preflight on the active document using the default preflight profile. ' +
        'Returns pass/fail status, error and warning counts, and structured issue details. ' +
        'Note: This check is not exhaustive — it does not replace a human final review.',
      inputSchema: {},
      annotations: READ_ANNOTATIONS,
    },
    async (params) => {
      const result = (await executeJsx(jsxCode, params)) as {
        passed?: boolean;
        profileName?: string;
        errorCount?: number;
        warningCount?: number;
        infoCount?: number;
        rawResults?: string;
        error?: boolean;
        message?: string;
        [key: string]: unknown;
      };

      if (result.error) {
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }

      // Parse XML results into structured issues
      const issues = parsePreflightResults(result.rawResults ?? '');

      const output: Record<string, unknown> = {
        passed: result.passed,
        profileName: result.profileName,
        errorCount: result.errorCount ?? 0,
        warningCount: result.warningCount ?? 0,
        infoCount: result.infoCount ?? 0,
        issueCount: issues.length,
        issues,
      };

      if (!result.passed) {
        output._note =
          'Preflight errors detected. Resolve all errors before export. ' +
          'Warnings should be reviewed; some may be intentional.';
      } else {
        output._note =
          'No preflight errors detected. This does not mean the document is free of all problems — ' +
          'design intent, contextual content, and print-shop-specific requirements still require human review.';
      }

      return {
        content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
      };
    },
  );
}
