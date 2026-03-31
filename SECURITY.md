# Security Policy

## Supported Versions

| Version | Supported          |
|---------|--------------------|
| 1.x     | :white_check_mark: |

## Reporting a Vulnerability

If you discover a security vulnerability, please report it responsibly:

1. **Do not** open a public GitHub issue
2. Email the maintainer or use [GitHub's private vulnerability reporting](https://github.com/ie3jp/illustrator-mcp-server/security/advisories/new)
3. Include steps to reproduce and potential impact

We will acknowledge your report within 7 days and aim to release a fix promptly.

## Scope

This MCP server executes ExtendScript code inside Adobe Illustrator via `osascript` (macOS) or PowerShell COM automation (Windows). Key security considerations:

- **File system access**: The server reads/writes temporary files and can export to user-specified paths
- **No network access**: The server does not make network requests
- **Local only**: Designed to run locally via stdio transport, not over a network

## Dependency Update PR Safety (Dependabot)

Dependency update pull requests must be treated as untrusted until reviewed.

- Do not auto-merge dependency PRs.
- Require CI to pass before merge.
- Review changed files carefully (especially lockfile-only expectation and workflow/config changes).
- Verify package origin and release notes for critical dependencies before approving.

Recommended maintainer checks:

1. Ensure the PR only modifies expected dependency files (`package.json`, `package-lock.json`) unless intentionally changing more.
2. Confirm no unexpected lifecycle-script behavior is introduced by added dependencies.
3. If a PR touches `.github/workflows/`, require explicit human security review before merge.
