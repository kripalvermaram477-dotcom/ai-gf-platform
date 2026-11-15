#!/bin/bash
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR" || exit 1

echo "=================================================="
echo "  Starting AI GF Platform in Detached TMUX Server "
echo "=================================================="

# 1. Acquire Android Termux Wake-Lock
if command -v termux-wake-lock >/dev/null 2>&1; then
  termux-wake-lock
  echo "✓ Termux Wake-Lock active (Android will not sleep)"
fi

# 2. Kill old session cleanly
tmux kill-session -t aibot 2>/dev/null || true
pkill -f "node.*supervisor.js" 2>/dev/null || true
pkill -f "node.*server.js" 2>/dev/null || true
sleep 1

# 3. Spawn inside detached tmux daemon (completely immune to subshell exit)
tmux new-session -d -s aibot "cd $DIR && node supervisor.js"
sleep 2

# 4. Verify health
READY=0
for i in {1..10}; do
  if curl -s -f http://127.0.0.1:3000/api/status >/dev/null 2>&1; then
    READY=1
    break
  fi
  sleep 0.5
done

if [ "$READY" -eq 1 ]; then
  echo ""
  echo "🎉 24/7 SERVER RUNNING INSIDE TMUX DAEMON!"
  echo "📱 URL: http://localhost:3000"
  echo "📱 IP:  http://127.0.0.1:3000"
  echo "💬 Bot: @HinataUchihaourgf_bot is ONLINE"
else
  echo "Server starting, check with: tmux capture-pane -t aibot -p"
fi
