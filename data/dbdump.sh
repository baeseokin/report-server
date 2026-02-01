#!/bin/bash

# === 스크립트 위치 기준 경로 (Mac / WSL 공통) ===
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPORT_SERVER_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="${REPORT_SERVER_DIR}/.env"
BACKUP_DIR="$SCRIPT_DIR"

# === .env 파일 로드 ===
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
DATE="$(date +"%Y%m%d_%H%M")"

# 백업 파일명
BACKUP_FILE="all_databases_${DATE}.sql"
LOG_FILE="${BACKUP_DIR}/backup.log"

# 백업 디렉토리 생성
mkdir -p "$BACKUP_DIR"

echo "[$(date +"%Y-%m-%d %H:%M:%S")] 전체 DB 백업 시작" | tee -a "$LOG_FILE"

# === 전체 DB dump ===
mysqldump \
  -h "$HOST" \
  -P "$PORT" \
  -u "$USER" \
  -p"$PASSWORD" \
  --all-databases \
  --single-transaction \
  --quick \
  --routines \
  --triggers \
  --events \
  > "${BACKUP_DIR}/${BACKUP_FILE}"

# 오류 체크
if [ $? -ne 0 ]; then
    echo "[$(date +"%Y-%m-%d %H:%M:%S")] 백업 실패" | tee -a "$LOG_FILE"
    exit 1
fi

# gzip 압축
gzip "${BACKUP_DIR}/${BACKUP_FILE}"

echo "[$(date +"%Y-%m-%d %H:%M:%S")] 백업 완료 → ${BACKUP_DIR}/${BACKUP_FILE}.gz" | tee -a "$LOG_FILE"
