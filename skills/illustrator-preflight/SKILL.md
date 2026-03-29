---
name: illustrator-preflight
description: Run comprehensive pre-press preflight checks on Adobe Illustrator documents using illustrator-mcp tools. Detects print-critical issues (RGB in CMYK, broken links, low-res images, white overprint, text not outlined), text consistency problems (dummy text, notation variations), and PDF/X compliance. Use when user asks to check a document before printing, submission, or handoff — or mentions "preflight", "入稿チェック", "印刷チェック", "納品前チェック".
---

# Illustrator Preflight Check

Comprehensive pre-press quality check workflow for Illustrator documents.

## Workflow

Execute these 3 tool calls in parallel, then analyze results together:

### Step 1: Parallel Data Collection

Run simultaneously:
1. `preflight_check` — core checks (RGB, links, resolution, text, overprint, transparency, spot colors)
2. `get_overprint_info` — detailed overprint analysis with intent classification
3. `check_text_consistency` — dummy text, notation variation detection, and full text dump for LLM analysis

If user specifies a target PDF profile, pass `target_pdf_profile: "x1a"` or `"x4"` to `preflight_check`.
If user specifies DPI threshold, pass `min_dpi` to `preflight_check` (default: 300).

### Step 1b: Conditional Follow-up

If `preflight_check` reports `spot_color` warnings, run `get_separation_info` to get detailed plate information and usage counts. This helps determine whether spot colors are actively used or just leftover swatches.

### Step 2: Analyze and Classify

Read [references/preflight-rules.md](references/preflight-rules.md) for severity levels and judgment criteria.

Merge results from all 3 tools into a unified report, grouped by severity:

1. **Critical** — Must fix. Blocks submission.
2. **Warning** — Review recommended. May or may not need fixing depending on context.
3. **Info** — Awareness items. No action required unless relevant.

For overprint results, cross-reference `get_overprint_info` intent classification:
- `intentional_k100`: Suppress from report (standard practice)
- `rich_black_overprint`: Include as warning if ink coverage exceeds the limit for the paper type (uncoated: 300%, coated: 350%, newspaper: 240%). If paper type is unknown, ask user or use 300% as default.
- `likely_accidental`: Escalate to critical

For text consistency:
- Dummy text hits → critical (must replace before submission)
- Notation variations (katakana, fullwidth/halfwidth) → warning
- Use `allTexts` from `check_text_consistency` for LLM-driven deeper analysis: look for typos, version mismatches, inconsistent terminology, and any other anomalies that regex patterns would miss.

### Step 3: Report

Present results as a structured summary in this order:

```
## Preflight Results: [document name]

### Critical Issues (X items)
[List with object UUID, description, and recommended action]

### Warnings (X items)
[List with context-dependent guidance]

### Info (X items)
[Brief notes]

### Summary
- Total issues: X critical, X warnings, X info
- Submission ready: Yes/No
```

For each critical issue that is auto-fixable (e.g., white overprint), offer to fix it immediately.

### Context-Dependent Decisions

Some checks require asking the user before acting:

- **Non-outlined text**: Ask "入稿先でフォント埋め込みPDFは受け付けていますか？" before recommending outlining
- **Spot colors**: Ask "スポットカラーは意図的ですか？（特色印刷 or CMYK変換？）"
- **Transparency with PDF/X-1a target**: Flag as critical; with X-4 or no target, flag as warning
- **DPI threshold**: If user hasn't specified, use 300 for print, 72 for web/screen

### Auto-Fix Capabilities

When the user agrees to fix issues, use these tools:
- Text outlining → `convert_to_outlines` (irreversible — confirm first)
- Text content replacement → `modify_object` with `contents` property (for dummy text fixes)

**Not currently auto-fixable** (require manual fix in Illustrator):
- White overprint — `modify_object` does not support `fillOverprint`/`strokeOverprint`. Instruct user: select the object and disable overprint in the Attributes panel.
- RGB to CMYK color conversion — requires designer decision on color appearance
- Broken links — requires user to locate and relink original files
- Low resolution images — requires higher resolution source
