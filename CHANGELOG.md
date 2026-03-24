# Changelog

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
