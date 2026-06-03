#!/bin/bash
# Process Automation Dashboard - Node.js Backend Startup Script
# For Synology DSM 7.2 Task Scheduler
# Place this in /volume1/pa-dashboard/ and set as a Scheduled Task

APP_DIR="/volume1/pa-dashboard"
LOG_FILE="/volume1/pa-dashboard/logs/backend.log"
PID_FILE="/volume1/pa-dashboard/logs/backend.pid"

# Create logs directory if missing
mkdir -p "$(dirname "$LOG_FILE")"

# Load environment variables
if [ -f "$APP_DIR/.env" ]; then
    export $(grep -v '^#' "$APP_DIR/.env" | xargs)
fi

# Check if already running
if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
    echo "Backend is already running (PID: $(cat "$PID_FILE"))"
    exit 0
fi

cd "$APP_DIR/backend" || exit 1

# Start the server
nohup node server.js > "$LOG_FILE" 2>&1 &
echo $! > "$PID_FILE"

echo "Backend started with PID: $(cat "$PID_FILE")"
echo "Logs: $LOG_FILE"
