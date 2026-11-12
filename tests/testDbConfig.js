// 테스트 DB 접속 정보 (scripts/test-db.sh 로 띄운 컨테이너 기준)
// 운영·개발 DB를 실수로 지우지 않도록 DB 이름은 반드시 _test 로 끝나야 합니다.
const config = {
  host: process.env.TEST_DB_HOST || "127.0.0.1",
  port: Number(process.env.TEST_DB_PORT || 33306),
  user: process.env.TEST_DB_USER || "root",
  password: process.env.TEST_DB_PASSWORD || "test",
  database: process.env.TEST_DB_NAME || "reportdb_test",
};

if (!/_test$/.test(config.database)) {
  throw new Error(`테스트 DB 이름은 _test 로 끝나야 합니다: ${config.database}`);
}

module.exports = config;
