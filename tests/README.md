# 서버 테스트

결재 흐름·권한·예산편성 반영을 실제 DB(테스트 전용 MariaDB 컨테이너)로 검증하는 통합 테스트입니다.

```bash
npm run test:db:up    # 테스트 DB 컨테이너 시작 (127.0.0.1:33306, Docker 필요)
npm test              # 테스트 실행 — 매번 db/schema.sql 로 reportdb_test 를 새로 만듭니다
npm run test:db:down  # 컨테이너 삭제
```

## 커밋 전 자동 실행 (git hook)

`git commit` 때 `.githooks/pre-commit` 이 스테이징된 변경과 관련된 테스트를 실행하고, 실패하면 커밋을 막습니다.

1. 서버 API 테스트(jest) 전체 (약 5초)
2. 바뀐 API 를 실제로 호출하는 **화면 E2E 케이스**만 PC · iPhone · Android 에서 실행 (`../report-form-ui` 의 Playwright 사용)

- 영향 범위 계산과 실행은 `../report-form-ui/e2e/run-related.sh --server` 가 담당합니다. 자세한 내용은 `../report-form-ui/e2e/README.md`.
- 문서·배포 파일만 바뀌면 건너뜁니다. 화면 E2E 가 호출하지 않는 API 변경은 경고만 표시합니다.
- Claude Code 로 커밋할 때는 실패 원인 분석·수정·재실행과 테스트 케이스 제안까지 자동으로 진행합니다 (`.claude/skills/e2e`).
- report-form-ui 가 없으면 서버 API 테스트만 실행합니다. 위치가 다르면 `REPORT_FORM_UI_DIR` 로 지정하세요.

## push 전 자동 실행 (git hook)

`git push` 때 `.githooks/pre-push`가 테스트 DB를 띄우고 `npm test`를 실행합니다. 실패하면 push가 중단됩니다.

- 처음 clone 했을 때 `npm install` 을 하면 자동으로 훅이 연결됩니다 (`core.hooksPath=.githooks`).
- Docker가 꺼져 있으면 push가 중단됩니다. 급할 때만 `git push --no-verify`로 건너뛰세요.
- 테스트는 push할 커밋이 아니라 **현재 작업 폴더** 기준으로 실행됩니다. 커밋하지 않은 변경이 있으면 결과가 다를 수 있습니다.

## 참고

- 운영·개발 DB는 사용하지 않습니다. DB 이름이 `_test` 로 끝나지 않으면 실행을 거부합니다.
- 알림톡은 mock 처리되어 실제로 발송되지 않습니다.
- 서버 로그를 보려면 `DEBUG_TEST=1 npm test`.

| 파일 | 내용 |
|------|------|
| `approval-flow.test.js` | 상신 → 순차 승인 → 결재완료 → 재정부 이관, 반려, 결재선 순번 공백·기안자 미등록·위원장 직행, 재정부 기안 즉시 완료 |
| `permissions.test.js` | 권한별 목록 조회, 결재대기 필터, 수정·삭제 권한 |
| `budget-plan.test.js` | 예산편성서 상신·중복 방지, 이관 시 예산 반영과 신규 계정 코드 채번 |
| `notifications.test.js` | 알림톡 발송 대상 |
| `initial-expenses.test.js` | 가청구건 등록 권한·동작 |
| `auth.test.js` | 로그인·세션·미로그인 차단 |
| `env.test.js` | MOCK_DATE 운영 환경 무시 |

- 단계별 상세 내용: [TEST_CASES.md](TEST_CASES.md) (테스트를 바꾸면 함께 수정)
