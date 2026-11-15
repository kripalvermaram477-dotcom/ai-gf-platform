#!/bin/bash
tmux kill-session -t aibot 2>/dev/null || true
pkill -f "node.*supervisor.js" 2>/dev/null || true
pkill -f "node.*server.js" 2>/dev/null || true
echo "AI GF Bot Platform stopped."
