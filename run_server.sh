#!/bin/bash

# 💡 설정
NODE_PATH="/Users/baeseokin/.asdf/installs/nodejs/24.4.1/bin/node"
SCRIPT="server.js"

# 1️⃣ 실행 중인 프로세스 찾기
PID=$(ps -ef | grep "$NODE_PATH $SCRIPT" | grep -v grep | awk '{print $2}')

if [ -n "$PID" ]; then
  echo "🔴 기존 프로세스 종료 중... (PID: $PID)"
  kill -9 $PID
  sleep 1
else
  echo "🟢 기존 프로세스 없음"
fi

# 2️⃣ 새로 실행
echo "🚀 서버 시작 중..."
nohup $NODE_PATH $SCRIPT > server.log 2>&1 &

# 3️⃣ 실행 결과 출력
NEW_PID=$(ps -ef | grep "$NODE_PATH $SCRIPT" | grep -v grep | awk '{print $2}')
echo "✅ 서버 실행 완료 (PID: $NEW_PID)"
echo "📜 로그 파일: server.log"

