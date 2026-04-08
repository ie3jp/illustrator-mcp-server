#!/bin/bash
# Convert captured frames to timelapse video
# Usage: capture_to_video.sh [output.mov] [fps]
#   fps: playback frames per second (default: 10 = 10x speed)
set -euo pipefail

FRAMES_DIR="/tmp/illustrator-mcp-capture"
NAME_FILE="/tmp/illustrator-mcp-capture.name"
OUTPUT="${1:-$(cat "$NAME_FILE" 2>/dev/null || echo "demo").mov}"
FPS="${2:-10}"

FRAME_COUNT=$(ls "$FRAMES_DIR"/frame_*.png 2>/dev/null | wc -l | tr -d ' ')
if [ "$FRAME_COUNT" -eq 0 ]; then
  echo "No frames in $FRAMES_DIR"
  exit 1
fi

DURATION=$(echo "scale=1; $FRAME_COUNT / $FPS" | bc)
echo "Frames: $FRAME_COUNT → ${DURATION}s video at ${FPS}fps (${FPS}x speed)"

ffmpeg -y -framerate "$FPS" -i "$FRAMES_DIR/frame_%06d.png" \
  -c:v libx264 -pix_fmt yuv420p \
  -vf "scale=1280:720" \
  "$OUTPUT"

echo "Saved: $OUTPUT"
