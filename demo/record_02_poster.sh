#!/bin/bash
# Demo recording: Pattern 2 - A3 Poster "SYNC TOKYO 2026"
set -euo pipefail

OUTPUT="${1:-demo_02_poster.mov}"

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

# --- Start recording in background ---
screencapture -v -R 0,-720,1280,720 -k "$OUTPUT" &
RECORD_PID=$!
trap 'kill $RECORD_PID 2>/dev/null; wait $RECORD_PID 2>/dev/null; echo "Recording saved: $OUTPUT"' INT TERM
sleep 2

# --- Type prompt into Claude Desktop ---
PROMPT='Design an A3 poster for a fictional tech×art festival "SYNC TOKYO 2026" — futuristic but warm. Use English for all text. Use CMYK color mode. Save the .ai file when done. Check that the layout actually works — verify text alignment, spacing, and balance. If anything looks off, fix it before finalizing. Add crop marks (trim marks) as the final step.

For fonts, choose bold/heavy weights — nothing thin or light.

When aligning text, especially left-aligned text, use optical alignment rather than purely mathematical alignment. Align to where the text visually appears to start, not where the bounding box sits.

Please respond in English throughout. Do not ask for confirmation — just proceed on your own judgment.'

osascript <<APPLESCRIPT
tell application "System Events" to key code 102
delay 0.5
tell application "Claude" to activate
delay 1
set inputText to "$(echo "$PROMPT" | sed 's/"/\\"/g')"
tell application "System Events"
    repeat with c in (characters of inputText)
        keystroke c
        delay 0.015
    end repeat
    delay 0.5
    keystroke return
end tell
APPLESCRIPT

echo "Recording in progress. Press Ctrl+C to stop when the task is done."
wait $RECORD_PID
