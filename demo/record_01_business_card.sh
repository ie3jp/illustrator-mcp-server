#!/bin/bash
# Demo: Pattern 1 - Business Card "KUMO Studio"
# Arranges windows and types prompt into Claude Desktop.
# Start capture_start.sh separately before running this.
set -euo pipefail

# --- Sub display (EV2785): AppleScript coords (0, -720), size=1280x720 ---
# --- Arrange windows ---
osascript -e '
tell application "System Events"
    tell process "Claude"
        set position of window 1 to {0, -720}
        set size of window 1 to {640, 720}
    end tell
    tell process "Illustrator"
        set position of window 1 to {640, -720}
        set size of window 1 to {640, 720}
    end tell
end tell'

sleep 1

# --- Type prompt into Claude Desktop ---
osascript <<'APPLESCRIPT'
tell application "System Events" to key code 102
delay 0.5
tell application "Claude" to activate
delay 1
set paraList to { ¬
    "Design a business card for a fictional design studio called \"KUMO Studio.\" Minimal and refined aesthetic. Use English for all text on the card. Include some made-up contact info.", ¬
    "Use CMYK color mode. Save the .ai file when done. Then visually inspect your own design — take a screenshot or export to check the actual result. Fix any layout mistakes, overlapping text, or misalignment you find. Add crop marks (trim marks) as the final step.", ¬
    "For fonts, choose bold/heavy weights — nothing thin or light.", ¬
    "When aligning text, especially left-aligned text, use optical alignment rather than purely mathematical alignment. Align to where the text visually appears to start, not where the bounding box sits.", ¬
    "Please respond in English throughout. Do not ask for confirmation — just proceed on your own judgment."}
tell application "System Events"
    repeat with i from 1 to count of paraList
        if i > 1 then
            keystroke return using shift down
            delay 0.01
            keystroke return using shift down
            delay 0.01
        end if
        repeat with c in (characters of (item i of paraList))
            keystroke c
            delay 0.002
        end repeat
    end repeat
    delay 0.5
    keystroke return
end tell
APPLESCRIPT

echo "Prompt sent. Waiting for Claude Desktop to finish..."
