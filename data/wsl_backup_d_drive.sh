#!/bin/bash
# ==============================================================================
# report-server 업로드 파일 백업 스크립트 (WSL -> Windows D 드라이브)
# ==============================================================================

# 백업할 대상 디렉토리 (WSL 환경의 D드라이브 경로)
# Windows의 D:\Backup\report_uploads 에 해당합니다. 필요시 경로를 수정하세요.
BACKUP_DIR="/mnt/d/Backup/report_uploads"

# 날짜를 포함한 백업 파일명 생성
DATE="$(date +"%Y%m%d_%H%M%S")"
BACKUP_FILE="${BACKUP_DIR}/uploads_backup_${DATE}.tar.gz"

# 1. D 드라이브 백업 디렉토리 생성 (없을 경우)
if [ ! -d "$BACKUP_DIR" ]; then
    echo "백업 디렉토리가 없습니다. 생성합니다: $BACKUP_DIR"
    mkdir -p "$BACKUP_DIR"
    if [ $? -ne 0 ]; then
        echo "❌ ERROR: $BACKUP_DIR 디렉토리를 생성할 수 없습니다. WSL에서 D 드라이브 접근 권한을 확인하세요."
        exit 1
    fi
fi

echo "🔍 Kubernetes에서 report-server 파드 검색 중..."
# 설정 파일의 PVC namespace(report)를 기준으로 파드를 찾습니다.
POD_NAME=$(kubectl get pods -n report -l app=report-server -o jsonpath='{.items[0].metadata.name}' 2>/dev/null)

if [ -z "$POD_NAME" ]; then
    echo "❌ ERROR: report 네임스페이스에서 report-server 파드를 찾을 수 없습니다."
    exit 1
fi

echo "🚀 파드($POD_NAME)에서 업로드 파일을 백업 중입니다..."
echo "저장 경로: $BACKUP_FILE"

# 2. 파드 내부의 /app/uploads 폴더를 tar로 압축하여 D 드라이브로 직접 스트리밍
# (중간에 WSL 로컬 디스크 공간을 사용하지 않아 안전하고 빠릅니다)
kubectl exec -n report "$POD_NAME" -- tar -czf - -C /app uploads > "$BACKUP_FILE"

if [ $? -eq 0 ]; then
    echo "✅ 백업 성공!"
    echo "📁 파일 크기: $(du -sh "$BACKUP_FILE" | cut -f1)"
    
    # -------------------------------------------------------------
    # [선택사항] 30일이 지난 오래된 백업 파일 자동 삭제 로직 (필요시 주석 해제)
    # -------------------------------------------------------------
    # echo "🧹 30일 이상 지난 오래된 백업 파일을 정리합니다..."
    # find "$BACKUP_DIR" -name "uploads_backup_*.tar.gz" -type f -mtime +30 -delete
else
    echo "❌ ERROR: 백업 중 오류가 발생했습니다."
    # 실패하여 생성된 불완전한 파일 삭제
    rm -f "$BACKUP_FILE"
    exit 1
fi
