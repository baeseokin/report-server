#!/bin/bash

# === .env 파일 로드 ===
ENV_FILE="/Users/baeseokin/report-server/.env"

if [ -f "$ENV_FILE" ]; then
    set -o allexport
    . "$ENV_FILE"
    set +o allexport
else
    echo "ERROR: .env 파일을 찾을 수 없습니다: $ENV_FILE"
    exit 1
fi

# === 환경 설정 (development용) ===
USER="${DB_USER__development}"
PASSWORD="${DB_PASSWORD__development}"
HOST="${DB_HOST__development}"
PORT="${DB_PORT__development}"
BACKUP_DIR="/Users/baeseokin/report-server/data"

# === 복구 대상 파일 선택 ===
# 1순위: 인자로 받은 파일
# 2순위: BACKUP_DIR 내 가장 최신 all_databases_*.sql / .sql.gz
TARGET_FILE="$1"

if [ -z "$TARGET_FILE" ]; then
    # 최신 파일 검색 (.sql 또는 .sql.gz)
    TARGET_FILE=$(ls -1t "${BACKUP_DIR}"/all_databases_*.sql* 2>/dev/null | head -n 1)
fi

if [ -z "$TARGET_FILE" ] || [ ! -f "$TARGET_FILE" ]; then
    echo "ERROR: 복구할 dump 파일을 찾을 수 없습니다."
    echo " - 사용법: $0 [복구할_dump_파일경로]"
    echo " - 또는 ${BACKUP_DIR}/all_databases_*.sql(.gz) 가 존재해야 합니다."
    exit 1
fi

echo "복구 대상 파일: $TARGET_FILE"
echo
echo "⚠️  이 작업은 기존 DB들을 덮어쓸 수 있습니다."
read -p "계속 진행하시겠습니까? (yes/NO): " ANSWER

if [ "$ANSWER" != "yes" ]; then
    echo "복구 작업을 취소했습니다."
    exit 0
fi

echo
echo "[$(date +"%Y-%m-%d %H:%M:%S")] 전체 DB 복구 시작"

# === 실제 복구 수행 ===
# .gz 이면 gunzip -c 로 풀어서 mysql로 파이프
# .sql 이면 mysql < 파일
if [[ "$TARGET_FILE" == *.gz ]]; then
    gunzip -c "$TARGET_FILE" | mysql \
        -h "$HOST" \
        -P "$PORT" \
        -u "$USER" \
        -p"$PASSWORD"
else
    mysql \
        -h "$HOST" \
        -P "$PORT" \
        -u "$USER" \
        -p"$PASSWORD" \
        < "$TARGET_FILE"
fi

if [ $? -ne 0 ]; then
    echo "[$(date +"%Y-%m-%d %H:%M:%S")] 복구 실패"
    exit 1
fi

echo "[$(date +"%Y-%m-%d %H:%M:%S")] 복구 완료"
