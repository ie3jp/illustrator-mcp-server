# Preflight Rules Reference

Severity levels and judgment criteria for each check category.

## Critical (Must Fix Before Submission)

### RGB in CMYK Document (`rgb_in_cmyk`)
- **What**: RGB color objects in a CMYK color space document
- **Why critical**: Printing press uses CMYK plates. RGB colors cause unexpected color shifts or print failure.
- **Auto-fixable**: No (color conversion changes appearance; requires designer decision)
- **Action**: Report all occurrences with UUID. Suggest `modify_object` to convert, but warn that color appearance will change.

### Broken Links (`broken_link`)
- **What**: Placed images whose source file is missing or inaccessible
- **Why critical**: Missing images print as low-res preview or empty box.
- **Auto-fixable**: No (requires user to locate original file)
- **Action**: Report file path and UUID. User must relink manually.

### Low Resolution Images (`low_resolution`)
- **What**: Embedded or linked images below minimum DPI threshold
- **Thresholds**:
  - Print: 300 DPI minimum (standard), 150 DPI for large format/posters
  - Web: 72 DPI is acceptable
- **Why critical**: Low-res images appear pixelated/blurry in print.
- **Auto-fixable**: No (requires higher resolution source)
- **Action**: Report effective PPI, pixel dimensions, and UUID.

### White Overprint (`white_overprint`)
- **What**: White-colored objects with overprint enabled
- **Why critical**: White + overprint = invisible in print. The white "multiplies" with what's behind it, effectively disappearing.
- **Auto-fixable**: No. `modify_object` does not currently support overprint properties.
- **Action**: Instruct user to select the object (provide UUID) and disable overprint manually in the Attributes panel (Window > Attributes).

### Transparency + Overprint Interaction (`transparency_overprint_interaction`)
- **What**: Object has both transparency (opacity < 100 or blend mode) and overprint
- **Why critical**: RIP processors handle this combination unpredictably. Output varies between printers.
- **Auto-fixable**: Partially (can disable overprint, but transparency flattening requires designer review)
- **Action**: Flag for manual review. Suggest removing overprint as first step.

## Warnings (Review Recommended)

### Non-outlined Text (`non_outlined_text`)
- **What**: Live text frames (not converted to outlines)
- **Context-dependent**:
  - For **final print submission**: Usually must outline all text (convert with `convert_to_outlines`)
  - For **PDF with embedded fonts**: Outlining not required if fonts are properly embedded
  - For **editable files**: Do NOT outline (destroys editability)
- **Auto-fixable**: Yes, via `convert_to_outlines`, but irreversible
- **Action**: Ask user about submission context before recommending outlining.

### Spot Colors (`spot_color`)
- **What**: Spot color (special ink) swatches in use
- **Context-dependent**:
  - If **intentional** (Pantone matching, metallic, fluorescent): Correct behavior
  - If **unintentional** (designer used Pantone but printing is CMYK-only): Needs conversion
- **Action**: List all spot colors. Ask if they are intentional for this print job.

### Transparency (`transparency`)
- **What**: Objects with opacity < 100% or non-normal blend modes
- **Context-dependent**:
  - **PDF/X-4**: Transparency is allowed
  - **PDF/X-1a**: All transparency must be flattened
  - **General print**: Usually fine if RIP supports it, but flag for awareness
- **Action**: Report for awareness. Only escalate if target is PDF/X-1a.

### Spot Color + Transparency (`spot_transparency`)
- **What**: Spot color object with opacity < 100%
- **Why problematic**: During PDF flattening, spot color may get converted to process (CMYK), losing the special ink specification.
- **Action**: Warn user. Suggest separating transparency effect from spot color object.

## Informational

### Bleed (`bleed`)
- **What**: Bleed area around artboard edges for trimming tolerance
- **Standard**: 3mm (Japan), 3mm or 0.125in (US/EU)
- **Not checked in current implementation**: Bleed settings are not read by the current preflight tool
- **Action**: Remind user to verify bleed settings manually in Document Setup.

## PDF/X Compliance Rules

### PDF/X-1a (Strictest)
- No transparency allowed
- All colors must be CMYK or spot (no RGB)
- All fonts must be embedded (or outlined)
- ICC profile not required but recommended

### PDF/X-4 (Modern)
- Transparency allowed (preserved as live transparency)
- RGB allowed but mixed color spaces may cause issues in CMYK documents
- ICC color profile strongly recommended
- Fonts must be embedded

## Overprint Intent Classification

From `get_overprint_info`:
- **`intentional_k100`**: K100 (pure black) with overprint. This is standard practice to prevent white gaps around black text/objects. Usually correct.
- **`rich_black_overprint`**: Rich black (K>=90 + CMY) with overprint. Acceptable but review ink coverage against paper type limits (uncoated: 300%, coated: 350%, newspaper: 240%).
- **`likely_accidental`**: Non-black color with overprint. Almost always a mistake. Flag for review.

## Text Consistency Checks

From `check_text_consistency`:
- **Dummy/placeholder text**: Lorem ipsum, "テキストが入ります", "sample text", etc. Must be replaced before submission.
- **Katakana long vowel variation**: "サーバー" vs "サーバ" inconsistency within same document.
- **Fullwidth/halfwidth mixing**: "１２３" vs "123" in same document.
- **Wave dash/tilde confusion**: U+301C vs U+FF5E (visually similar, encoding differs).

## Ink Coverage Guidelines

- **Maximum total ink**: 300-350% (varies by printer/paper)
- **Newspaper**: 240% max
- **Coated paper**: 350% max
- **Uncoated paper**: 300% max
- Rich black recommendation: C60 M40 Y40 K100 (= 240%) or C40 M30 Y30 K100 (= 200%)
