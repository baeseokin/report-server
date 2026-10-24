#!/bin/bash

# === 스크립트 위치 기준 경로 (Mac / WSL 공통) ===
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPORT_SERVER_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# .env 파일 탐색 (프로젝트 루트 우선, 없으면 현재 폴더)
if [ -f "${REPORT_SERVER_DIR}/.env" ]; then
    ENV_FILE="${REPORT_SERVER_DIR}/.env"
elif [ -f "${SCRIPT_DIR}/.env" ]; then
    ENV_FILE="${SCRIPT_DIR}/.env"
else
    echo "ERROR: .env 파일을 찾을 수 없습니다."
    exit 1
fi

set -o allexport
. "$ENV_FILE"
set +o allexport

# === DB 접속 설정 (백업 전용 계정 우선 사용) ===
USER="${BACKUP_DB_USER:-$DB_USER__development}"
PASSWORD="${BACKUP_DB_PASSWORD:-$DB_PASSWORD__development}"
HOST="${DB_HOST__development:-localhost}"
PORT="${DB_PORT__development:-32006}"

# 백업 저장 경로 (로컬 기본값: data 디렉토리 자체)
BACKUP_DIR="${BACKUP_DIR:-$SCRIPT_DIR}"
DATE="$(date +"%Y%m%d_%H%M")"
LOG_FILE="${BACKUP_DIR}/backup.log"

mkdir -p "$BACKUP_DIR"

echo "==================================================" | tee -a "$LOG_FILE"
echo "[$(date +"%Y-%m-%d %H:%M:%S")] 로컬 DB 개별 백업 시작 (User: $USER, Host: $HOST:$PORT)" | tee -a "$LOG_FILE"

# === 1. 시스템 기본 DB를 제외한 실제 DB 목록 조회 ===
DATABASES=$(mysql -h "$HOST" -P "$PORT" -u "$USER" -p"$PASSWORD" -s -N -e "SHOW DATABASES;" 2>/dev/null \
    | grep -Ev "^(information_schema|performance_schema|mysql|sys)$")

if [ -z "$DATABASES" ]; then
    echo "[$(date +"%Y-%m-%d %H:%M:%S")] ERROR: 백업할 데이터베이스를 찾을 수 없거나 접근 권한이 없습니다." | tee -a "$LOG_FILE"
    exit 1
fi

FAIL_COUNT=0

# === 2. 각 DB별 파일 단위 덤프 및 압축 (예: reportdb_20261023_2145.sql.gz) ===
for DB in $DATABASES; do
    echo " -> [${DB}] 덤프 진행 중..." | tee -a "$LOG_FILE"
    TARGET_SQL="${BACKUP_DIR}/${DB}_${DATE}.sql"

    # --databases 옵션으로 CREATE DATABASE 구문 포함
    mysqldump \
      -h "$HOST" \
      -P "$PORT" \
      -u "$USER" \
      -p"$PASSWORD" \
      --databases "$DB" \
      --single-transaction \
      --quick \
      --routines \
      --triggers \
      --events \
      > "$TARGET_SQL" 2>> "$LOG_FILE"

    if [ $? -eq 0 ]; then
        gzip -f "$TARGET_SQL"
        echo "    └─ ${DB}_${DATE}.sql.gz 백업 완료" | tee -a "$LOG_FILE"
    else
        echo "    └─ [ERROR] ${DB} 백업 실패!" | tee -a "$LOG_FILE"
        FAIL_COUNT=$((FAIL_COUNT + 1))
        rm -f "$TARGET_SQL"
    fi
done

# === 3. 오래된 백업 파일 정리 (30일 이상 지난 .sql.gz 백업 파일만 안전하게 개별 삭제) ===
find "$BACKUP_DIR" -maxdepth 1 -type f \( -name "*_20*.sql.gz" -o -name "all_databases_*.sql.gz" \) -mtime +30 -delete 2>/dev/null

if [ $FAIL_COUNT -eq 0 ]; then
    echo "[$(date +"%Y-%m-%d %H:%M:%S")] 모든 DB 백업 성공 -> ${BACKUP_DIR}" | tee -a "$LOG_FILE"
else
    echo "[$(date +"%Y-%m-%d %H:%M:%S")] 일부 DB 백업 실패 (실패 수: ${FAIL_COUNT})" | tee -a "$LOG_FILE"
    exit 1
fi
