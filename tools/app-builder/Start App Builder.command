#!/bin/bash
cd "$(dirname "$0")"
nohup python3 app_builder.py "$@" >/dev/null 2>&1 &
sleep 1; osascript -e 'tell application "Terminal" to close (every window whose name contains "Start App Builder")' >/dev/null 2>&1 &
exit 0
