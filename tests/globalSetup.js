// 테스트 시작 전 1회: 테스트 DB를 새로 만들고 db/schema.sql 을 적용합니다.
const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");
const cfg = require("./testDbConfig");

module.exports = async () => {
  let conn;
  try {
    conn = await mysql.createConnection({
      host: cfg.host, port: cfg.port, user: cfg.user, password: cfg.password,
      multipleStatements: true,
    });
  } catch (e) {
    throw new Error(
      `테스트 DB(${cfg.host}:${cfg.port})에 연결할 수 없습니다. 먼저 'npm run test:db:up' 을 실행하세요.\n원인: ${e.message}`
    );
  }
  try {
    const schema = fs.readFileSync(path.join(__dirname, "..", "db", "schema.sql"), "utf8");
    await conn.query(`DROP DATABASE IF EXISTS \`${cfg.database}\``);
    await conn.query(`CREATE DATABASE \`${cfg.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci`);
    await conn.query(`USE \`${cfg.database}\``);
    await conn.query(schema);
  } finally {
    await conn.end();
  }
};
