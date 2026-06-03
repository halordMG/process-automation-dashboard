#!/bin/bash
# Stop the Process Automation Dashboard backend

PID_FILE="/volume1/pa-dashboard/logs/backend.pid"

if [ -f "$PID_FILE" ]; then
    PID=$(cat "$PID_FILE")
    if kill -0 "$PID" 2>/dev/null; then
        kill "$PID"
        rm -f "$PID_FILE"
        echo "Backend stopped (PID: $PID)"
    else
        echo "Backend is not running"
        rm -f "$PID_FILE"
    fi
else
    echo "PID file not found. Trying to find process..."
    PID=$(ps | grep "node server.js" | grep -v grep | awk '{print $1}')
    if [ -n "$PID" ]; then
        kill "$PID"
        echo "Backend stopped (PID: $PID)"
    else
        echo "Backend is not running"
    fi
fi
