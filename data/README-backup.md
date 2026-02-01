# DB 백업 (WSL 주기 실행)

## 1. 수동 실행

WSL에서:

```bash
cd /mnt/c/Users/본인사용자명/report-server/data   # 또는 프로젝트 data 경로
./dbdump.sh
```

또는 프로젝트 루트에서:

```bash
bash data/dbdump.sh
```

- `.env`는 스크립트 기준으로 `../.env`를 자동으로 찾습니다.
- 백업 파일: `data/all_databases_YYYYMMDD_HHMM.sql.gz`
- 로그: `data/backup.log`

## 2. WSL에서 주기 실행 (cron)

### 방법 A: cron 등록 도우미 실행

```bash
cd report-server/data
bash cron-dbdump-install.sh
```

프롬프트에서 `y` 입력 시 **매일 새벽 2시**에 `dbdump.sh`가 실행되도록 crontab에 추가됩니다.

### 방법 B: 수동으로 cron 등록

```bash
crontab -e
```

맨 아래에 한 줄 추가 (실제 `dbdump.sh` 경로로 수정):

```cron
# 매일 새벽 2시 DB 백업
0 2 * * * /경로/report-server/data/dbdump.sh >> /경로/report-server/data/backup.log 2>&1
```

예시 (WSL에서 Windows 디스크에 프로젝트가 있는 경우):

```cron
0 2 * * * /mnt/c/Users/baeseokin/report-server/data/dbdump.sh >> /mnt/c/Users/baeseokin/report-server/data/backup.log 2>&1
```

### cron 실행 주기 예시

| 설정        | 의미           |
|------------|----------------|
| `0 2 * * *` | 매일 02:00     |
| `0 */6 * * *` | 6시간마다    |
| `30 1 * * 0` | 매주 일요일 01:30 |

등록 확인: `crontab -l`

## 3. 요구 사항

- WSL에 `mysqldump`, `gzip` 사용 가능해야 함.
- `.env`에 `DB_USER__development`, `DB_PASSWORD__development`, `DB_HOST__development`, `DB_PORT__development` 등 DB 접속 정보가 있어야 함.
- DB 서버가 WSL에서 접근 가능한 주소/포트여야 함 (localhost 또는 실제 호스트).
