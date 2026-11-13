---
name: e2e
description: report-server 변경을 커밋하기 전에 서버 API 테스트(jest)와 바뀐 API 를 쓰는 화면 E2E(PC · iPhone · Android)를 실행하고, 실패하면 원인을 분석·수정해 다시 통과시키며, 테스트가 없는 변경에는 케이스를 제안·작성한다. git commit 이 '미검증/미커버'로 차단됐을 때, 테스트 실행·실패 분석·케이스 작성 요청 시 사용한다.
---

# report-server 테스트 실행 · 수정 · 케이스 작성

전체 절차는 report-form-ui 의 스킬 문서에 있다. **먼저 `../report-form-ui/.claude/skills/e2e/SKILL.md` 를 Read 로 읽고 그대로 따른다.**
(report-form-ui 위치가 다르면 환경변수 `REPORT_FORM_UI_DIR`)

report-server 에서 쓸 때의 요점:
- 실행: `../report-form-ui/e2e/run-related.sh --server` (확인만: `--server --check`, 생략 기록: `--server --accept-uncovered`)
  - ① 서버 API 테스트(jest) 전체 → ② 바뀐 API 를 실제로 호출하는 화면 E2E 케이스만 3개 환경에서
- 서버 API 테스트 실패: jest 출력 확인, 서버 로그는 `DEBUG_TEST=1 npm test`. 테스트 단계 설명은 `tests/TEST_CASES.md`.
- 화면 E2E 실패: report-form-ui 의 `e2e-results/`, `e2e-screenshots/` 확인.
- 케이스 추가 위치:
  - API 규칙·권한·DB 상태 검증 → `tests/*.test.js` (+ `tests/TEST_CASES.md` 갱신)
  - 화면에서 하는 사용자 동작 → `../report-form-ui/e2e/*.spec.js` (PC · iPhone · Android 모두 통과)
  - 시드 데이터가 필요하면 `tests/helpers/fixtures.js`, `tests/e2e/seed.js`
- 화면 E2E 실행으로 `../report-form-ui/e2e/coverage-map.json` 이 바뀌면 report-form-ui 쪽에서 따로 커밋한다.
- push 할 때는 기존 `.githooks/pre-push` 가 서버 API 테스트 전체를 한 번 더 실행한다.
