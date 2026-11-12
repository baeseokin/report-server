#!/bin/bash
# 테스트 전용 MariaDB 컨테이너 관리 (운영·개발 DB와 완전히 분리)
#   ./scripts/test-db.sh up    # 컨테이너 시작 (127.0.0.1:33306, DB: reportdb_test)
#   ./scripts/test-db.sh down  # 컨테이너 삭제 (데이터는 tmpfs라 함께 사라짐)
set -e
NAME=report-test-db
IMAGE=mariadb:11.4.2
PORT=${TEST_DB_PORT:-33306}

case "$1" in
  up)
    if docker ps --format '{{.Names}}' | grep -qx "$NAME"; then
      echo "✅ $NAME 이미 실행 중 (port $PORT)"; exit 0
    fi
    docker rm -f "$NAME" >/dev/null 2>&1 || true
    docker run -d --name "$NAME" \
      -e MARIADB_ROOT_PASSWORD=test \
      -e MARIADB_DATABASE=reportdb_test \
      -e MARIADB_USER=test -e MARIADB_PASSWORD=test \
      -p 127.0.0.1:$PORT:3306 \
      --tmpfs /var/lib/mysql \
      "$IMAGE" >/dev/null
    echo -n "⏳ $NAME 기동 대기"
    for _ in $(seq 1 60); do
      if docker exec "$NAME" mariadb -utest -ptest -e "SELECT 1" reportdb_test >/dev/null 2>&1; then
        echo; echo "✅ $NAME 준비 완료 (127.0.0.1:$PORT)"; exit 0
      fi
      echo -n "."; sleep 1
    done
    echo; echo "❌ 기동 시간 초과"; docker logs "$NAME" | tail -20; exit 1
    ;;
  down)
    docker rm -f "$NAME" >/dev/null 2>&1 && echo "🗑  $NAME 삭제" || echo "없음"
    ;;
  *)
    echo "사용법: $0 up|down"; exit 1
    ;;
esac
