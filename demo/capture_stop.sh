#!/bin/bash
# Stop interval capture. Frames are kept in /tmp/illustrator-mcp-capture/.
set -euo pipefail

PID_FILE="/tmp/illustrator-mcp-capture.pid"
FRAMES_DIR="/tmp/illustrator-mcp-capture"

if [ ! -f "$PID_FILE" ]; then
  echo "No capture running (PID file not found)."
  exit 1
fi

PID=$(cat "$PID_FILE")
kill "$PID" 2>/dev/null && echo "Capture stopped (PID: $PID)." || echo "Capture process already stopped."
rm -f "$PID_FILE"

FRAME_COUNT=$(ls "$FRAMES_DIR"/frame_*.png 2>/dev/null | wc -l | tr -d ' ')
echo "Frames captured: $FRAME_COUNT"
echo "Frames dir: $FRAMES_DIR"
