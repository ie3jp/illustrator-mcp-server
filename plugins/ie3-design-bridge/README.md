# Design Bridge by IE3

Design tools for Adobe Illustrator: read, edit and export Illustrator documents from Claude Code or Claude Cowork. (Not affiliated with Adobe.)

This plugin bundles:

- **illustrator-mcp-server** — 66 MCP tools for reading document structure, colors, text and images, creating and modifying objects, exporting SVG/PNG/JPG/PDF, and pre-press checks. Started with `npx illustrator-mcp-server@latest`.
- **illustrator-preflight** skill — a pre-press workflow that checks a document before printing or handoff (RGB in CMYK, broken links, low-resolution images, white overprint, fonts, PDF/X).

## Requirements

- Adobe Illustrator 2020 or later (tested on 2024 and later), running on macOS or Windows
- Node.js 20+
- macOS: allow automation access on first run (System Settings > Privacy & Security > Automation)

## Install

```
/plugin install ie3-design-bridge --marketplace ie3jp/illustrator-mcp-server
```

On Claude Code earlier than v2.1.275, add the marketplace first:

```
/plugin marketplace add ie3jp/illustrator-mcp-server
/plugin install ie3-design-bridge@ie3
```

If you already added the server with `claude mcp add`, remove it first so it doesn't run twice.

## Links

- Documentation: <https://github.com/ie3jp/illustrator-mcp-server#readme> (日本語: <https://github.com/ie3jp/illustrator-mcp-server/blob/main/README.ja.md>)
- Privacy policy: <https://github.com/ie3jp/illustrator-mcp-server/blob/main/PRIVACY.md>
- Issues: <https://github.com/ie3jp/illustrator-mcp-server/issues>
