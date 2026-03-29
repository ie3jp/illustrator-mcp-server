# Changelog

## [1.2.4] - 2026-03-30

### Added
- **create_document** tool — create new Illustrator documents (size, color mode)
- **close_document** tool — close the active document (with save option)
- **place_image** tool — place image files as linked or embedded (with UUID tracking after embed)
- **19 new tools** (Phase 6) — manage_datasets, create_gradient, apply_graphic_style, list_graphic_styles, convert_to_outlines, assign_color_profile, get_separation_info, get_overprint_info, check_text_consistency, list_text_styles, apply_text_style, get_guidelines, create_path_text, place_color_chips, set_z_order, resize_for_variation, extract_design_tokens, get_effects, convert_coordinate
- **LLM manual E2E tests** — 9 test cases verifying LLM understanding of tool constraints (clipping mask order, gradient+mask, embed UUID change, cross-colorspace limits, artboard deletion, text line breaks, stack order, export side effects, GrayColor interpretation)

### Fixed
- **Tool descriptions improved** for LLM comprehension — group_objects (UUID order = stack order), export (selection state change on PNG/JPG), manage_linked_images (embed invalidates UUID), replace_color (SpotColor/GrayColor/cross-colorspace limits), check_contrast/preflight_check (GrayColor ink-quantity interpretation), find_objects (tolerance details), get_path_items (opacity note), get_text_frame_detail (leading API limitation), manage_artboards (last artboard undeletable)
- **create_text_frame** — literal `\\n` from MCP parameters now correctly converted to line breaks
- **group_objects** — corrected internal comment about PLACEATEND stacking direction
- **coerceBoolean** helper introduced for robust boolean parameter handling

### Changed
- E2E test suite expanded to 106 test cases across 6 phases covering all registered tools
- README updated to 61 tools + 3 utilities

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
