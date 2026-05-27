#!/bin/bash
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPORT_SERVER_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BACKUP_DIR="$SCRIPT_DIR"
DATE="$(date +"%Y%m%d_%H%M")"

# 1. 로컬 uploads 폴더 확인
LOCAL_UPLOADS_DIR="${REPORT_SERVER_DIR}/uploads"

if [ -d "$LOCAL_UPLOADS_DIR" ]; then
    echo "🟢 로컬 uploads 폴더 발견: $LOCAL_UPLOADS_DIR"
    echo "압축 중..."
    # uploads 폴더 전체를 압축 (signatures 등 하위 디렉토리 포함)
    tar -czf "${BACKUP_DIR}/uploads_${DATE}.tar.gz" -C "${REPORT_SERVER_DIR}" uploads
    echo "✅ 첨부파일 백업 완료 → ${BACKUP_DIR}/uploads_${DATE}.tar.gz"
else
    echo "⚠️ 로컬 uploads 폴더를 찾을 수 없습니다. Kubernetes에서 다운로드를 시도합니다."
    
    # 2. Kubernetes에서 다운로드 시도
    POD_NAME=$(kubectl get pods -n report -l app=report-server -o jsonpath='{.items[0].metadata.name}' 2>/dev/null)
    
    if [ -z "$POD_NAME" ]; then
        echo "❌ ERROR: 로컬 uploads 폴더도 없고, Kubernetes에서 report-server 파드도 찾을 수 없습니다."
        exit 1
    fi
    
    echo "파드($POD_NAME)에서 첨부파일 다운로드 중..."
    kubectl cp -n report "${POD_NAME}:/app/uploads" "${BACKUP_DIR}/temp_uploads"
    
    tar -czf "${BACKUP_DIR}/uploads_${DATE}.tar.gz" -C "${BACKUP_DIR}" temp_uploads
    rm -rf "${BACKUP_DIR}/temp_uploads"
    
    echo "✅ 첨부파일 백업 완료 → ${BACKUP_DIR}/uploads_${DATE}.tar.gz"
fi
