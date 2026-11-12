# DB 스키마 · 마이그레이션

| 경로 | 용도 |
|------|------|
| `schema.sql` | 전체 테이블 기준 스키마 (2026-11-12 운영 DB에서 추출). 신규 환경 구축과 테스트 DB 생성에 사용합니다. |
| `migrations/` | 운영 DB에 적용한 변경 이력. 파일명은 `YYYY-MM-DD_설명.sql`(또는 `.js`)입니다. |
| `scripts/` | 수동으로 실행하는 관리용 SQL (데이터 초기화 등). 실행 전 대상 DB를 반드시 확인하세요. |

## 스키마를 바꿀 때

1. `migrations/` 에 `YYYY-MM-DD_설명.sql` 파일을 추가합니다. 가능하면 다시 실행해도 안전하게(`IF NOT EXISTS` 등) 작성합니다.
2. 운영 DB에 적용한 뒤 파일 첫 줄에 `-- [적용 완료] YYYY-MM-DD` 를 적습니다.
3. `schema.sql` 에도 같은 변경을 반영합니다. (테스트가 이 파일로 DB를 만듭니다.)
   운영 DB 기준으로 다시 뽑으려면:
   ```bash
   mariadb-dump -h <host> -P <port> -u <user> -p --no-data --skip-comments reportdb
   ```

> 서버 시작 시 `lib/db.js` 의 `runStartupMigrations()` 가 일부 컬럼(payee, remarks)과 메뉴명을 자동 보정합니다.
> 새 변경은 이 방식 대신 `migrations/` 파일로 관리하세요.
