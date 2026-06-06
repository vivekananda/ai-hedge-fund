#!/bin/bash

PORT=8008
echo "Attempting to restart backend on port $PORT..."

# Find and kill any process running on the port
PID=$(lsof -t -i :$PORT)
if [ -n "$PID" ]; then
  echo "Killing existing process $PID on port $PORT..."
  kill -9 $PID
  sleep 1
else
  echo "No process running on port $PORT."
fi
sleep 10
# Start FastAPI server
echo "Starting backend server..."
nohup .venv/bin/python -m uvicorn app.backend.main:app --reload --port $PORT > backend.log 2>&1 &

echo "Backend started in background. Logs are written to backend.log"
echo "URL: http://localhost:$PORT"
