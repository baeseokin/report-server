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
set -o pipefail

# === DB 접속 설정 (복구 권한 필요) ===
USER="${BACKUP_DB_USER:-$DB_USER__development}"
PASSWORD="${BACKUP_DB_PASSWORD:-$DB_PASSWORD__development}"
HOST="${DB_HOST__development:-localhost}"
PORT="${DB_PORT__development:-32006}"
BACKUP_DIR="${BACKUP_DIR:-$SCRIPT_DIR}"

TARGET_FILE="$1"

# === 복구 대상 파일 미지정 시 가이드 및 최근 백업 목록 출력 ===
if [ -z "$TARGET_FILE" ] || [ ! -f "$TARGET_FILE" ]; then
    echo "=================================================="
    echo " 사용법: $0 <복구할_DB_백업파일경로 (.sql.gz 또는 .sql)>"
    echo " 예시  : $0 ${BACKUP_DIR}/roomdb_20261023_2145.sql.gz"
    echo "=================================================="
    echo
    echo "최근 백업된 파일 목록 (최신 10개):"
    if [ -d "$BACKUP_DIR" ]; then
        ls -1t "${BACKUP_DIR}"/*.sql* 2>/dev/null | head -n 10
    else
        echo " (백업 디렉토리가 없습니다: $BACKUP_DIR)"
    fi
    exit 1
fi

# === gzip 파일 무결성 사전 검사 ===
if [[ "$TARGET_FILE" == *.gz ]]; then
    if ! gzip -t "$TARGET_FILE" 2>/dev/null; then
        echo "ERROR: '$TARGET_FILE' 파일이 유효한 gzip 압축 파일이 아니거나 손상되었습니다."
        exit 1
    fi
fi


echo "복구 대상 파일: $TARGET_FILE"
echo "대상 호스트   : $HOST:$PORT (User: $USER)"
echo
read -p "계속 진행하시겠습니까? (yes/y/NO): " ANSWER

# 공백 제거 및 소문자 변환
ANSWER_CLEAN=$(echo "$ANSWER" | tr -d '[:space:]' | tr '[:upper:]' '[:lower:]')

if [[ "$ANSWER_CLEAN" != "yes" && "$ANSWER_CLEAN" != "y" ]]; then
    echo "복구 작업을 취소했습니다."
    exit 0
fi


echo
echo "[$(date +"%Y-%m-%d %H:%M:%S")] 복구 시작..."

if [[ "$TARGET_FILE" == *.gz ]]; then
    gunzip -c "$TARGET_FILE" | mysql -h "$HOST" -P "$PORT" -u "$USER" -p"$PASSWORD"
else
    mysql -h "$HOST" -P "$PORT" -u "$USER" -p"$PASSWORD" < "$TARGET_FILE"
fi

if [ $? -ne 0 ]; then
    echo "[$(date +"%Y-%m-%d %H:%M:%S")] [ERROR] 복구 실패"
    exit 1
fi

echo "[$(date +"%Y-%m-%d %H:%M:%S")] 복구 완료!"
