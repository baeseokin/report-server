#!/usr/bin/env bash
# Claude Code PreToolUse(Bash) 훅: Claude 가 git commit 하기 전에 관련 테스트(서버 API + 화면 E2E) 통과 여부 확인.
# 실제 로직은 report-form-ui 의 같은 이름 훅에 있습니다 (report-form-ui 위치: REPORT_FORM_UI_DIR, 기본 ../report-form-ui).
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
UI_DIR="${REPORT_FORM_UI_DIR:-$HERE/../report-form-ui}"
HOOK="$UI_DIR/.claude/hooks/e2e-before-commit.sh"
if [[ ! -x "$HOOK" ]]; then
  exit 0  # report-form-ui 가 없으면 검사하지 않음 (git pre-commit 훅이 서버 API 테스트는 실행)
fi
REPORT_SERVER_DIR="$HERE" exec "$HOOK"
