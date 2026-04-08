#!/bin/bash
# Start interval screen capture (1 screenshot per second)
set -euo pipefail

OUTPUT_NAME="${1:-demo}"
FRAMES_DIR="/tmp/illustrator-mcp-capture"
PID_FILE="/tmp/illustrator-mcp-capture.pid"

# Clean up previous frames
rm -rf "$FRAMES_DIR"
mkdir -p "$FRAMES_DIR"

# Save output name for capture_stop.sh
echo "$OUTPUT_NAME" > /tmp/illustrator-mcp-capture.name

# --- Sub display (EV2785): 1280x720 at AppleScript coords (0, -720) ---
REGION="0,-720,1280,720"

echo "Capturing region: $REGION"
echo "Frames dir: $FRAMES_DIR"
echo "Output name: $OUTPUT_NAME"

# Start capture loop in background
(
  SEQ=0
  while true; do
    FNAME=$(printf "%s/frame_%06d.png" "$FRAMES_DIR" "$SEQ")
    screencapture -R "$REGION" -x "$FNAME" 2>/dev/null
    SEQ=$((SEQ + 1))
    sleep 1
  done
) &

echo $! > "$PID_FILE"
echo "Capture started (PID: $(cat "$PID_FILE")). Run capture_stop.sh to finish."
