---
name: illustrator-preflight
description: Run comprehensive pre-press preflight checks on Adobe Illustrator documents using illustrator-mcp tools. Detects print-critical issues (RGB in CMYK, broken links, low-res images, white overprint, text not outlined), text consistency problems (dummy text, notation variations), and PDF/X compliance. Use when user asks to check a document before printing, submission, or handoff — or mentions "preflight", "pre-press check", "print check", "submission check".
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

- **Non-outlined text**: Ask whether the print shop accepts font-embedded PDFs before recommending outlining
- **Spot colors**: Ask whether spot colors are intentional (special ink printing or should be converted to CMYK)
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

## AI Limitation Awareness

Do NOT add a disclaimer to every report. Instead, apply these rules based on the situation:

### Rule 1: Distinguish mechanical checks from AI analysis
When reporting `check_text_consistency` results, clearly separate the two reliability tiers:
- **Mechanical checks** (`_reliability: deterministic`): pattern-matched results (dummy text, fullwidth/halfwidth, katakana long vowel). These are reliable.
- **AI analysis** (`_reliability: ai-assisted`): typos, contextual inconsistencies, terminology drift found by LLM analysis of `allTexts`. These may contain false positives or miss real errors. Label them as AI-based findings.

### Rule 2: When no issues are detected
Never say "no issues found — ready to submit." Instead:
- Say "no issues were detected by these automated checks"
- Note that items outside scope (design intent, contextual spelling, regulatory requirements, print-shop-specific rules) still require human review
- The `preflight_check` tool includes a `_note` field when all checks pass — relay its message

### Rule 3: When the user treats this as a final verification
This rule applies when:
- The user explicitly asks for a go/no-go decision ("Is this ready for submission?", "Can I send this to print?")
- The user's wording implies this is the last step before submission ("最終チェック", "入稿前チェック", "final check", "last check", "これで最後")

In these cases:
- Remind them that automated checks are not exhaustive
- A human must perform the final review
- This does not replace a professional preflight check

## Language

Always respond in the user's language.
