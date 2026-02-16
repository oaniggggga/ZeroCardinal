#!/bin/bash

# ZeroCardinal Linux Startup Script
# This script ensures no old processes are running and clears corrupted caches.

echo "🧹 Starting cleanup..."

# 1. Kill any Node.js processes related to ZeroCardinal
echo "Stopping any existing ZeroCardinal Node.js processes..."
pkill -9 -f "node.*index.js" || true
pkill -9 -f "ZeroCardinal/index.js" || true

# 2. Kill any Python processes related to the bridge
echo "Stopping any existing ZeroCardinal Python bridges..."
pkill -9 -f "python3.*FpCardinal/main.py" || true
pkill -9 -f "zerocardinal_bridge" || true
pkill -9 -f "FpCardinal/main.py" || true

# 3. Clear Python Bytecode Cache (fixes EOFError: marshal data too short)
echo "Clearing Python bytecode cache..."
find . -name "*.pyc" -delete
find . -name "__pycache__" -type d -exec rm -rf {} +

echo "✅ Environment cleaned."

# 4. Start the bot
echo "🚀 Starting ZeroCardinal..."

# We use & to run in background or just run sequentially if preferred.
# Since the user usually runs them together with &&, we'll follow that pattern
# but start Node first as it's the main controller.

node index.js &
NODE_PID=$!

# Wait a bit for Node to initialize its socket
sleep 2

python3 FpCardinal/main.py

# Wait for background node process
wait $NODE_PID
