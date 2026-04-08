#!/bin/bash
# Demo: Pattern 3 - Logo Concepts "Slow Drip"
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
    "Design three logo concepts for a fictional craft coffee brand \"Slow Drip\" — each with a different approach. Use English for all text. Use RGB color mode. Save the .ai file when done. Then visually inspect your own design — take a screenshot or export to check the actual result. Fix any layout mistakes, overlapping text, or misalignment you find.", ¬
    "For fonts, choose bold/heavy weights — nothing thin or light.", ¬
    "When aligning text, especially left-aligned text, use optical alignment rather than purely mathematical alignment. Align to where the text visually appears to start, not where the bounding box sits.", ¬
    "Please respond in English throughout. Do not ask for confirmation — just proceed on your own judgment."}
tell application "System Events"
    repeat with c in (characters of (item 1 of paraList))
        keystroke c
        delay 0.002
    end repeat
    repeat with i from 2 to count of paraList
        keystroke return using shift down
        delay 0.01
        keystroke return using shift down
        delay 0.01
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
