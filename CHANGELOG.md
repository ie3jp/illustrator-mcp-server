# Changelog

## [1.2.11] - 2026-03-31

### Fixed
- Documentation consistency updates for current cross-platform behavior (macOS `osascript` + Windows PowerShell COM) and latest package/tool metadata.
- Corrected outdated manifest/README references in release notes (tool count and platform declaration wording).

## [1.2.8] - 2026-03-30

### Added
- **.mcpb bundle for Claude Desktop** — Drag-and-drop installation via Extensions panel. CJS bundle for compatibility with Claude Desktop's built-in Node.js
- **Automated release pipeline** — CI builds .mcpb, creates GitHub Release, and publishes to MCP Registry on tag push
- **manifest.json v0.3** — Full tool listing, platform/runtime compatibility declaration

### Changed
- README updated: Claude Desktop install simplified to .mcpb drag-and-drop (manual config moved to collapsible section)

## [1.2.6] - 2026-03-30

### Added
- **place_style_guide** tool — Place a visual style guide outside the artboard (color chips, font samples, spacing annotations with on-artboard colored bars, artboard margins, guide gaps). Same-value spacings are grouped and color-coded for easy identification.
- **select_objects** tool — Select objects by UUID (multi-select supported)
- **extract_design_tokens: `output_path` parameter** — Save tokens directly to a file (CSS/JSON/Tailwind)
- **manage_datasets: `import_csv` artboard duplication** — CSV import now creates physical artboard copies instead of dataset switching

### Fixed
- **extract_design_tokens** — Now skips "Style Guide" and "Color Chips" layers to avoid polluting token extraction with annotation artifacts
- **extract_design_tokens** — `output_path` file write errors now return a structured error message instead of crashing
- **All modify tools** — Post-operation verification added to all modify tools (`verified` field in results)
- **place_style_guide** — ES3-compliant function declarations moved to top-level scope
- **select_objects** — Correct `WRITE_IDEMPOTENT_ANNOTATIONS` annotation (selection is idempotent)

### Changed
- Tool count: 63 tools + 2 prompts (21 read / 37 modify / 2 export / 3 utility)

## [1.2.5] - 2026-03-30

### Added
- **19 new tools** (Phase 6) — manage_datasets, create_gradient, apply_graphic_style, list_graphic_styles, convert_to_outlines, assign_color_profile, get_separation_info, get_overprint_info, check_text_consistency, list_text_styles, apply_text_style, get_guidelines, create_path_text, place_color_chips, set_z_order, resize_for_variation, extract_design_tokens, get_effects, convert_coordinate
- **LLM manual E2E tests** — 9 test cases verifying LLM understanding of tool constraints (clipping mask order, gradient+mask, embed UUID change, cross-colorspace limits, artboard deletion, text line breaks, stack order, export side effects, GrayColor interpretation)

### Fixed
- **Tool descriptions improved** for LLM comprehension — group_objects (UUID order = stack order), export (selection state change on PNG/JPG), manage_linked_images (embed invalidates UUID), replace_color (SpotColor/GrayColor/cross-colorspace limits), check_contrast/preflight_check (GrayColor ink-quantity interpretation), find_objects (tolerance details), get_path_items (opacity note), get_text_frame_detail (leading API limitation), manage_artboards (last artboard undeletable)
- **create_text_frame** — literal `\\n` from MCP parameters now correctly converted to line breaks
- **group_objects** — corrected internal comment about PLACEATEND stacking direction
- **coerceBoolean** helper introduced for robust boolean parameter handling

### Changed
- E2E test suite expanded to 106 test cases across 6 phases covering all registered tools
- README updated to 63 tools + 2 prompts (21 read / 37 modify / 2 export / 3 utility)

## [1.2.4] - 2025-03-25

### Added
- **create_document** tool — create new Illustrator documents (size, color mode)
- **close_document** tool — close the active document (with save option)
- **place_image** tool — place image files as linked or embedded (with UUID tracking after embed)
- Image resolution E2E tests — linked/embedded image verification, preflight low-resolution detection

### Changed
- E2E test suite fully automated — creates fresh document, places test objects (shapes, text, images), runs 45 tests across 5 phases, and cleans up automatically. No pre-existing files required.

## [1.2.3] - 2025-03-24

### Added
- UUID-targeted raster export via isolated temporary document (PNG/JPG)
- Export output file verification after write

### Fixed
- SVG UUID export now uses selection-based approach instead of unsupported isolated export

## [1.2.2] - 2025-03-24

### Fixed
- Lazy transport initialization to avoid immediate throw on Linux CI

## [1.2.1] - 2025-03-24

### Fixed
- Removed stale cep-transport artifacts from dist/

## [1.2.0] - 2025-03-23

### Changed
- Removed CEP (Common Extensibility Platform) transport — osascript/PowerShell only
- Windows PowerShell COM transport foundation (not yet tested on real hardware)

### Fixed
- Multiple bugs found in codebase audit (export.ts unreachable code, export-pdf.ts undefined parameter, get-effects.ts hardcoded limit, jsx-runner.ts timeout messages, list-text-frames.ts null handling, file-transport.ts cleanup logging)
- Unit and E2E test improvements

## [1.1.1] - 2025-03-22

### Added
- WebP/PSD/HEIC image header parsing support
- Font resolution improvements — partial match search with candidates on failure

### Fixed
- Embedded image resolution calculation using matrix vector magnitude (handles rotation)
- create-text-frame now creates frame even when font not found (warns with candidates)
- CI platform compatibility (npm ci --force for Linux)

## [1.1.0] - 2025-03-21

### Added
- Real DPI resolution checking for images in preflight-check
- Linked image DPI computed via Node.js-side file header reading
- SECURITY.md and Dependabot configuration
- Unit tests for executor and modify tools

### Fixed
- Graceful shutdown handling
- Activate Illustrator for modify/export tools
- Shebang in entry point
- Multiple bugs from codebase audit

## [1.0.0] - 2025-03-20

### Added
- Initial release
- 26 tools: 15 read / 8 modify / 2 export / 1 utility
- macOS osascript transport
- Web coordinate system (artboard-relative, Y-down)
- UUID tracking for all objects
- File-based JSX communication (JSON params/results)
- BOM UTF-8 JSX generation for Japanese text support
