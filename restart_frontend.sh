#!/bin/bash

PORT=5178
echo "Attempting to restart frontend on port $PORT..."

# Find and kill any process running on the port
PID=$(lsof -t -i :$PORT)
if [ -n "$PID" ]; then
  echo "Killing existing process $PID on port $PORT..."
  kill -9 $PID
  sleep 1
else
  echo "No process running on port $PORT."
fi

# Start Vite frontend
echo "Starting frontend dev server..."
cd app/frontend
nohup npm run dev -- --port $PORT > ../../frontend.log 2>&1 &

echo "Frontend started in background. Logs are written to frontend.log"
echo "URL: http://localhost:$PORT"
