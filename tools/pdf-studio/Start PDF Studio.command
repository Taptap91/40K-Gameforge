#!/bin/bash
cd "$(dirname "$0")"
python3 -c "import pypdf" 2>/dev/null || python3 -m pip install pypdf
nohup python3 pdf_studio.py >/dev/null 2>&1 &
sleep 1; osascript -e 'tell application "Terminal" to close (every window whose name contains "Start PDF Studio")' >/dev/null 2>&1 &
exit 0
