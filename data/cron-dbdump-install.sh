#!/bin/bash
# WSL에서 dbdump.sh 를 주기적으로 실행하기 위한 cron 등록 스크립트
# 사용법: bash cron-dbdump-install.sh
# (또는 chmod +x 후 ./cron-dbdump-install.sh)

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DUMP_SCRIPT="${SCRIPT_DIR}/dbdump.sh"

if [ ! -x "$DUMP_SCRIPT" ]; then
  chmod +x "$DUMP_SCRIPT"
fi

# cron에 넣을 한 줄 (매일 새벽 2시 실행)
CRON_LINE="0 2 * * * $DUMP_SCRIPT >> ${SCRIPT_DIR}/backup.log 2>&1"

echo "다음 cron 항목을 추가합니다:"
echo "  $CRON_LINE"
echo ""
echo "실제 등록은 아래 명령을 실행한 뒤, 편집기에서 맨 아래에 위 한 줄을 붙여넣고 저장하세요."
echo ""
echo "  crontab -e"
echo ""
echo "또는 지금 자동 등록하려면 (기존 crontab 유지):"
echo "  (crontab -l 2>/dev/null; echo '$CRON_LINE') | crontab -"
echo ""

read -p "지금 자동 등록할까요? (y/N): " ans
if [ "$ans" = "y" ] || [ "$ans" = "Y" ]; then
  (crontab -l 2>/dev/null; echo "$CRON_LINE") | crontab -
  echo "등록 완료. 확인: crontab -l"
else
  echo "수동으로 crontab -e 실행 후 위 한 줄을 추가하세요."
fi
