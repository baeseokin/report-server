#!/bin/bash

# 사용법: ./killproc.sh <프로세스명>
# 예시: ./killproc.sh node

if [ -z "$1" ]; then
  echo "❌ 사용법: $0 <프로세스명>"
  exit 1
fi

PROC_NAME=$1

# 해당 프로세스 ID 찾기 (grep -v grep: 자기 자신 제외)
PIDS=$(ps -ef | grep "$PROC_NAME" | grep -v grep | awk '{print $2}')

if [ -z "$PIDS" ]; then
  echo "⚠️ 프로세스 [$PROC_NAME] 가 실행 중이지 않습니다."
  exit 0
fi

echo "🔎 찾은 프로세스 ID: $PIDS"

# 프로세스 종료
for PID in $PIDS; do
  echo "🛑 PID $PID 종료 중..."
  kill -9 $PID
done

echo "✅ [$PROC_NAME] 프로세스 종료 완료"

