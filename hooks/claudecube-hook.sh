#!/bin/bash
# ClaudeCube hook — called by Claude Code for all hook events.
# Reads JSON from stdin, POSTs to the ClaudeCube server, outputs response.

INPUT=$(cat)
EVENT=$(echo "$INPUT" | jq -r '.hook_event_name')

# Prevent infinite Stop loops
if [ "$EVENT" = "Stop" ]; then
  if [ "$(echo "$INPUT" | jq -r '.stop_hook_active')" = "true" ]; then
    exit 0
  fi
fi

CLAUDECUBE_PORT="${CLAUDECUBE_PORT:-7080}"

RESPONSE=$(echo "$INPUT" | curl -s --max-time 60 \
  -X POST -H "Content-Type: application/json" \
  -d @- "http://localhost:${CLAUDECUBE_PORT}/hooks/$EVENT" 2>/dev/null)

# If ClaudeCube is not running, don't block Claude
if [ $? -ne 0 ] || [ -z "$RESPONSE" ]; then
  exit 0
fi

echo "$RESPONSE"
exit 0
