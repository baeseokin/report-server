#!/bin/bash

# 💡 설정
NODE_PATH="/Users/baeseokin/.asdf/installs/nodejs/24.4.1/bin/node"
SCRIPT="server.js"
LOG_FILE="server.log"

# 해당 디렉토리로 이동 (스크립트 위치 기준)
cd "$(dirname "$0")"

echo "------------------------------------------"
echo "📅 실행 일시: $(date)"

# 1️⃣ 실행 중인 프로세스 찾기 (정확한 매칭을 위해 SCRIPT 파일명 검색)
PID=$(ps -ef | grep "$SCRIPT" | grep -v grep | awk '{print $2}')

if [ -n "$PID" ]; then
  echo "🔴 기존 프로세스 종료 중... (PID: $PID)"
  kill -9 $PID
  sleep 1
else
  echo "🟢 기존 프로세스 없음"
fi

echo "------------------------------------------"
